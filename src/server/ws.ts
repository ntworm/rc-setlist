import * as http from 'node:http';
import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import type { SetlistState, AugmentedWebSocket } from '../types.js';
import { isPlainObject } from '../util/json.js';
import { decodeClientMessage } from './client-message.js';
import { log } from '../util/log.js';
import { classifyUpgradeRequest, type UpgradeClassification } from './ws-origin.js';

export { isValidOrigin } from './ws-origin.js';

const RATE_CHECKED = new Set(['allow_check_rate', 'forbid_check_rate', 'allow_direct']);

export interface SetlistWSServerOptions {
  heartbeatIntervalMs?: number;
  logDedupeWindowMs?: number;
  now?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  /** The credential a paired computer presents. */
  peerToken?: string;
  /** The credential a direct browser link presents. */
  directToken?: string;
}

/**
 * Manages the lifecycle and public surface of SetlistWSServer.
 */
export class SetlistWSServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients: Set<AugmentedWebSocket> = new Set();
  private lastState: SetlistState | null = null;

  /**
   * The last state each client was actually given: a frame that backpressure
   * dropped never reached the phone, so the next identical state has to go
   * out again, or that phone would keep a screen that is no longer true.
   */
  private lastStateJsonByClient = new WeakMap<AugmentedWebSocket, string>();
  private lastLogTimeByKey = new Map<string, number>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  private authToken: string;
  private peerToken: string;
  private directToken: string;
  private authFailures = new Map<string, { count: number; windowStart: number }>();

  private readonly heartbeatIntervalMs: number;
  private readonly logDedupeWindowMs: number;
  private readonly now: () => number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  constructor(authToken: string = '', options: SetlistWSServerOptions = {}) {
    super();
    this.authToken = authToken;
    this.peerToken = options.peerToken ?? '';
    this.directToken = options.directToken ?? '';
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    this.logDedupeWindowMs = options.logDedupeWindowMs ?? 1_000;
    this.now = options.now ?? Date.now;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  private tokens() {
    return { authToken: this.authToken, peerToken: this.peerToken, directToken: this.directToken };
  }

  private heartbeatTick(): void {
    for (const ws of [...this.clients]) {
      if (ws.readyState !== WebSocket.OPEN) {
        this.clients.delete(ws);
        continue;
      }
      if (ws.isAlive === false) {
        this.clients.delete(ws);
        try {
          ws.terminate();
        } catch {
          /* already closing */
        }
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        this.clients.delete(ws);
        try {
          ws.terminate();
        } catch {
          /* already closing */
        }
      }
    }
  }

  private cleanExpiredFailures(): void {
    const now = Date.now();
    const limitWindow = 60000; // 1 minute
    for (const [ip, tracker] of this.authFailures.entries()) {
      if (now - tracker.windowStart > limitWindow) {
        this.authFailures.delete(ip);
      }
    }
  }

  private isAuthRateLimited(ip: string): boolean {
    this.cleanExpiredFailures();
    const now = Date.now();
    const limitWindow = 60000;
    const tracker = this.authFailures.get(ip);
    if (tracker && now - tracker.windowStart <= limitWindow && tracker.count >= 5) {
      return true;
    }
    return false;
  }

  private recordAuthFailure(ip: string): void {
    this.cleanExpiredFailures();
    const now = Date.now();
    const limitWindow = 60000;
    const tracker = this.authFailures.get(ip);
    if (!tracker || now - tracker.windowStart > limitWindow) {
      this.authFailures.set(ip, { count: 1, windowStart: now });
    } else {
      tracker.count++;
    }
  }

  public init(): WebSocketServer {
    this.wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: 102400, // 100KB limit
    });

    this.wss.on('connection', (ws: AugmentedWebSocket, req) => {
      this.clients.add(ws);
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      const remote = req.socket.remoteAddress ?? 'unknown';
      ws.remoteAddress = remote;
      const classification = classifyUpgradeRequest(req, this.tokens());
      if (classification.urlInvalid) log.warn('ws', 'Could not parse the connection URL.');
      const { isController, isPeer, isDirect, hasToken } = classification;
      ws.isController = isController;
      ws.isPeer = isPeer;
      ws.isDirect = isDirect;
      log.info('ws', 'Client connected', {
        remote,
        hasToken,
        controller: isController,
        peer: isPeer,
        direct: ws.isDirect,
      });

      if (!ws.isDirect) {
        // Send immediate authentication status to client
        ws.send(JSON.stringify({ type: 'auth_status', isController }));

        // Send WS Debug log message to client for on-screen diagnostics
        ws.send(
          JSON.stringify({
            type: 'log',
            level: isController ? 'info' : 'warn',
            message: `[WS Debug] Connected from ${remote}. Controller: ${isController}`,
            timestamp: Date.now(),
          }),
        );

        if (this.lastState) {
          const stateJson = JSON.stringify({ type: 'state', state: this.lastState });
          ws.send(stateJson);
          this.lastStateJsonByClient.set(ws, stateJson);
        }
      }

      ws.on('message', (data) => {
        try {
          const text =
            typeof data === 'string'
              ? data
              : Buffer.isBuffer(data)
                ? data.toString('utf8')
                : Array.isArray(data)
                  ? Buffer.concat(data).toString('utf8')
                  : Buffer.from(data).toString('utf8');
          const raw: unknown = JSON.parse(text);
          const msg = isPlainObject(raw) ? raw : null;
          if (msg && msg.type === 'auth') {
            if (ws.isPeer || ws.isDirect) {
              ws.send(JSON.stringify({ type: 'auth_result', success: false }));
              const role = ws.isPeer ? 'peer' : 'direct';
              log.info('ws', `Manual authentication requested on ${role} connection: DENIED`, {
                remote,
              });
              return;
            }
            const hasToken = typeof msg.token === 'string' && msg.token !== '';
            if (hasToken) {
              const success =
                msg.token === this.authToken &&
                this.authToken !== '' &&
                msg.token !== this.peerToken &&
                msg.token !== this.directToken;
              if (success) {
                const wasController = ws.isController === true;
                this.authFailures.delete(remote);
                ws.isController = true;
                ws.send(JSON.stringify({ type: 'auth_result', success: true }));
                ws.send(JSON.stringify({ type: 'auth_status', isController: true }));
                log.info('ws', 'Manual authentication requested: SUCCESS', { remote });
                if (!wasController) this.emit('controller_authenticated', ws);
              } else {
                if (this.isAuthRateLimited(remote)) {
                  ws.send(
                    JSON.stringify({
                      type: 'auth_result',
                      success: false,
                      error: 'Too many authentication attempts',
                    }),
                  );
                  log.warn('ws', 'Manual authentication attempt blocked by rate limit', { remote });
                  return;
                }
                this.recordAuthFailure(remote);
                ws.send(JSON.stringify({ type: 'auth_result', success: false }));
                log.info('ws', 'Manual authentication requested: FAILURE', { remote });
              }
            } else {
              // Empty token manual auth fails normally without incrementing rate limits
              ws.send(JSON.stringify({ type: 'auth_result', success: false }));
              log.info('ws', 'Manual authentication requested: EMPTY/DENIED', { remote });
            }
            return;
          }
          const decoded = decodeClientMessage(msg);
          if (!decoded.ok) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  code: decoded.code,
                  message: decoded.message,
                  ...(decoded.commandId ? { commandId: decoded.commandId } : {}),
                }),
              );
            }
            return;
          }
          this.emit('client_message', decoded.message, ws);
        } catch {
          log.warn('ws', 'Rejected malformed JSON message.');
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'error',
                code: 'invalid_message',
                message: 'Message must be valid JSON.',
              }),
            );
          }
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        if (ws.isPeer) this.emit('peer_closed', ws);
        log.info('ws', 'Client disconnected');
      });

      ws.on('error', (error) => {
        const codeValue = (error as Error & { code?: unknown }).code;
        const code =
          typeof codeValue === 'string' && /^[A-Z0-9_]{1,64}$/.test(codeValue)
            ? codeValue
            : 'UNKNOWN';
        log.error('ws', 'Client socket error', { code });
      });
    });

    if (!this.heartbeatInterval) {
      this.heartbeatInterval = this.setIntervalFn(
        () => this.heartbeatTick(),
        this.heartbeatIntervalMs,
      );
      this.heartbeatInterval.unref?.();
    }

    return this.wss;
  }

  private allowUpgrade(
    classification: UpgradeClassification,
    req: http.IncomingMessage,
    socket: Duplex,
    remote: string,
  ): boolean {
    const { decision, isController } = classification;
    if (RATE_CHECKED.has(decision) && this.isAuthRateLimited(remote)) {
      log.warn('ws', 'Rejecting upgrade: authentication-attempt limit exceeded', { remote });
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return false;
    }
    if (decision === 'forbid' || decision === 'forbid_check_rate') {
      if (decision === 'forbid_check_rate') this.recordAuthFailure(remote);
      log.warn('ws', 'Rejecting upgrade with invalid origin or missing Host', {
        origin: req.headers['origin'],
        host: req.headers['host'],
      });
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return false;
    }
    if (decision === 'allow_check_rate') this.recordAuthFailure(remote);
    else if (isController) this.authFailures.delete(remote);
    return true;
  }

  public handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const urlPath = req.url ? req.url.split('?')[0] : '';
    if (urlPath === '/ws' && this.wss) {
      const remote = (socket as Socket).remoteAddress ?? 'unknown';
      const classification = classifyUpgradeRequest(req, this.tokens());
      if (!this.allowUpgrade(classification, req, socket, remote)) return;
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss!.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  }

  private sendWithBackpressure(ws: AugmentedWebSocket, payloadJson: string): boolean {
    if (ws.bufferedAmount > 2097152) {
      // 2 MB disconnect limit
      log.warn('ws', 'Disconnecting client due to severe backpressure', {
        remote: ws.remoteAddress ?? 'unknown',
        bufferedBytes: ws.bufferedAmount,
      });
      try {
        ws.terminate();
      } catch {
        // swallow: nothing to do here on purpose
      }
      this.clients.delete(ws);
      return false;
    }

    if (ws.bufferedAmount > 524288) {
      // 512 KB drop threshold
      return false;
    }

    try {
      ws.send(payloadJson);
      return true;
    } catch {
      return false;
    }
  }

  private isBroadcastTarget(ws: AugmentedWebSocket): boolean {
    return ws.readyState === WebSocket.OPEN && !ws.isDirect;
  }

  /** Sends a payload to all open WebSocket connections authenticated as controllers. */
  public sendToControllers(payload: unknown): void {
    const json = JSON.stringify(payload);
    for (const ws of [...this.clients]) {
      if (ws.readyState === WebSocket.OPEN && ws.isController === true) {
        this.sendWithBackpressure(ws, json);
      }
    }
  }

  public broadcastState(state: SetlistState): void {
    this.lastState = state;
    const json = JSON.stringify({ type: 'state', state });
    const open = [...this.clients].filter((ws) => this.isBroadcastTarget(ws));
    // The state is only settled when every open client already holds it: a
    // client whose frame was dropped still needs it.
    if (open.length > 0 && open.every((ws) => this.lastStateJsonByClient.get(ws) === json)) {
      return;
    }

    for (const ws of open) {
      if (this.lastStateJsonByClient.get(ws) === json) continue;
      if (this.sendWithBackpressure(ws, json)) {
        this.lastStateJsonByClient.set(ws, json);
      }
    }
  }

  public broadcast(payload: unknown): void {
    const json = JSON.stringify(payload);
    for (const ws of [...this.clients]) {
      if (this.isBroadcastTarget(ws)) {
        this.sendWithBackpressure(ws, json);
      }
    }
  }

  public broadcastLog(
    message: string,
    level: 'info' | 'warn' | 'error' | 'automation' = 'info',
  ): void {
    const key = `${level}:${message}`;
    const now = this.now();
    const previous = this.lastLogTimeByKey.get(key);
    if (previous !== undefined && now >= previous && now - previous < this.logDedupeWindowMs)
      return;
    this.lastLogTimeByKey.set(key, now);
    if (this.lastLogTimeByKey.size > 100) {
      const firstKey = this.lastLogTimeByKey.keys().next().value;
      if (firstKey !== undefined) {
        this.lastLogTimeByKey.delete(firstKey);
      }
    }
    const json = JSON.stringify({ type: 'log', message, level, timestamp: now });
    for (const ws of [...this.clients]) {
      if (this.isBroadcastTarget(ws)) {
        this.sendWithBackpressure(ws, json);
      }
    }
  }

  /**
   * How many paired computers are talking to this one right now.
   *
   * A computer that was paired comes in with the peer credential, and only
   * that credential makes it a peer: a phone watching the setlist is not one.
   */
  public peerConnectionCount(): number {
    let count = 0;
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN && ws.isPeer) count += 1;
    }
    return count;
  }

  /**
   * The open connections of the paired computers.
   */
  public peerSockets(): AugmentedWebSocket[] {
    return [...this.clients].filter((ws) => ws.readyState === WebSocket.OPEN && ws.isPeer === true);
  }

  public stop(): void {
    if (this.heartbeatInterval) {
      this.clearIntervalFn(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const ws of this.clients) {
      try {
        ws.removeAllListeners();
        ws.close(1001, 'server shutting down');
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.lastLogTimeByKey.clear();
    this.authFailures.clear();
    this.lastState = null;
    this.lastStateJsonByClient = new WeakMap<AugmentedWebSocket, string>();
    if (this.wss) {
      try {
        this.wss.removeAllListeners();
      } catch {
        // swallow: nothing to do here on purpose
      }
      try {
        this.wss.close();
      } catch {
        // swallow: nothing to do here on purpose
      }
      this.wss = null;
    }
  }
}
