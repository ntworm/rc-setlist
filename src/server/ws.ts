import * as http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import { URL as NodeURL } from 'node:url';
import { SetlistState, AugmentedWebSocket } from '../types.js';
import { decodeClientMessage } from './client-message.js';

export function isValidOrigin(origin: string, reqHost: string): boolean {
  const expected = reqHost.toLowerCase();
  // 1) Try the node:url import (works even when the global URL is masked or undefined)
  try {
    const parsed = new NodeURL(origin);
    if (parsed.host.toLowerCase() === expected) return true;
  } catch {}
  // 2) Fallback: extract authority (host:port) with a regex and no URL dependency
  const m = origin.match(/^[a-z][a-z0-9+.\-]*:\/\/([^/?#]+)/i);
  if (m && m[1]!.toLowerCase() === expected) return true;
  return false;
}

export interface SetlistWSServerOptions {
  heartbeatIntervalMs?: number;
  logDedupeWindowMs?: number;
  now?: () => number;
}

export class SetlistWSServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients: Set<AugmentedWebSocket> = new Set();
  private lastState: SetlistState | null = null;

  private lastStateJson: string = '';
  private lastLogTimeByKey = new Map<string, number>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  private authToken: string;
  private authFailures = new Map<string, { count: number; windowStart: number }>();

  private readonly heartbeatIntervalMs: number;
  private readonly logDedupeWindowMs: number;
  private readonly now: () => number;

  constructor(authToken: string = '', options: SetlistWSServerOptions = {}) {
    super();
    this.authToken = authToken;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    this.logDedupeWindowMs = options.logDedupeWindowMs ?? 1_000;
    this.now = options.now ?? Date.now;
  }

  private heartbeatTick(): void {
    for (const ws of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) {
        this.clients.delete(ws);
        continue;
      }
      if (ws.isAlive === false) {
        this.clients.delete(ws);
        try { ws.terminate(); } catch { /* already closing */ }
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        this.clients.delete(ws);
        try { ws.terminate(); } catch { /* already closing */ }
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
    if (tracker && (now - tracker.windowStart <= limitWindow) && tracker.count >= 5) {
      return true;
    }
    return false;
  }

  private recordAuthFailure(ip: string): void {
    this.cleanExpiredFailures();
    const now = Date.now();
    const limitWindow = 60000;
    const tracker = this.authFailures.get(ip);
    if (!tracker || (now - tracker.windowStart > limitWindow)) {
      this.authFailures.set(ip, { count: 1, windowStart: now });
    } else {
      tracker.count++;
    }
  }

  public init(): WebSocketServer {
    this.wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: 102400 // 100KB limit
    });
    
    this.wss.on('connection', (ws: AugmentedWebSocket, req) => {
      this.clients.add(ws);
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      const remote = req.socket.remoteAddress ?? 'unknown';
      ws.remoteAddress = remote;
      // Parse token from connection URL query parameter
      let isController = false;
      let tokenParsed: string | null = null;
      try {
        const host = req.headers.host ?? 'localhost';
        // node:url import: the global URL is masked or undefined in Ableton's embedded Node runtime
        const url = new NodeURL(req.url ?? '', `http://${host}`);
        tokenParsed = url.searchParams.get('token');
        isController = tokenParsed === this.authToken && this.authToken !== '';
      } catch (err) {
        console.warn('[WS] Could not extract the token from the URL:', err);
      }

      ws.isController = isController;
      console.log(`[WS] Client connected from ${remote}, hasToken=${!!tokenParsed}, controller=${isController}`);

      // Send immediate authentication status to client
      ws.send(JSON.stringify({ type: 'auth_status', isController }));

      // Send WS Debug log message to client for on-screen diagnostics
      ws.send(JSON.stringify({
        type: 'log',
        level: isController ? 'info' : 'warn',
        message: `[WS Debug] Connected from ${remote}. Controller: ${isController}`,
        timestamp: Date.now()
      }));

      if (this.lastState) {
        ws.send(JSON.stringify({ type: 'state', state: this.lastState }));
      }

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg && msg.type === 'auth') {
            const hasToken = typeof msg.token === 'string' && msg.token !== '';
            if (hasToken) {
              const success = msg.token === this.authToken && this.authToken !== '';
              if (success) {
                this.authFailures.delete(remote);
                ws.isController = true;
                ws.send(JSON.stringify({ type: 'auth_result', success: true }));
                ws.send(JSON.stringify({ type: 'auth_status', isController: true }));
                console.log(`[WS] Manual authentication requested from ${remote}: SUCCESS`);
              } else {
                if (this.isAuthRateLimited(remote)) {
                  ws.send(JSON.stringify({ type: 'auth_result', success: false, error: 'Too many authentication attempts' }));
                  console.warn(`[WS] Manual authentication attempt blocked by rate limit for ${remote}`);
                  return;
                }
                this.recordAuthFailure(remote);
                ws.send(JSON.stringify({ type: 'auth_result', success: false }));
                console.log(`[WS] Manual authentication requested from ${remote}: FAILURE`);
              }
            } else {
              // Empty token manual auth fails normally without incrementing rate limits
              ws.send(JSON.stringify({ type: 'auth_result', success: false }));
              console.log(`[WS] Manual authentication requested from ${remote}: EMPTY/DENIED`);
            }
            return;
          }
          const decoded = decodeClientMessage(msg);
          if (!decoded.ok) {
            ws.send(JSON.stringify({ type: 'error', ...decoded }));
            return;
          }
          this.emit('client_message', decoded.message, ws);
        } catch {
          console.warn('[WS] Rejected malformed JSON message.');
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              ok: false,
              code: 'invalid_message',
              message: 'Message must be valid JSON.',
            }));
          }
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log('[WS] Client disconnected');
      });

      ws.on('error', (err) => {
        console.error('[WS] Client socket error:', err);
      });
    });

    if (!this.heartbeatInterval) {
      this.heartbeatInterval = setInterval(() => this.heartbeatTick(), this.heartbeatIntervalMs);
      this.heartbeatInterval.unref?.();
    }

    return this.wss;
  }

  public handleUpgrade(req: http.IncomingMessage, socket: any, head: Buffer): void {
    const urlPath = req.url ? req.url.split('?')[0] : '';
    if (urlPath === '/ws' && this.wss) {
      const remote = socket.remoteAddress ?? 'unknown';

      // 1. Origin validation
      const origin = req.headers['origin'];
      const reqHost = req.headers['host'];
      if (origin) {
        if (!reqHost || !isValidOrigin(origin, reqHost)) {
          console.warn(`[WS] Rejecting upgrade with an invalid origin or missing Host: ${origin} (Host: ${reqHost})`);
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      // 2. Auth attempts rate limit (per connection upgrade request)
      let tokenParsed: string | null = null;
      try {
        const host = req.headers.host ?? 'localhost';
        const url = new NodeURL(req.url ?? '', `http://${host}`);
        tokenParsed = url.searchParams.get('token');
      } catch {}

      if (tokenParsed !== null && tokenParsed !== '') {
        const isValid = tokenParsed === this.authToken && this.authToken !== '';
        if (isValid) {
          this.authFailures.delete(remote);
        } else {
          if (this.isAuthRateLimited(remote)) {
            console.warn(`[WS] Rejecting upgrade because ${remote} exceeded the authentication-attempt limit`);
            socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
            socket.destroy();
            return;
          }
          this.recordAuthFailure(remote);
        }
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss!.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  }

  public broadcastState(state: SetlistState): void {
    this.lastState = state;
    const json = JSON.stringify({ type: 'state', state });
    if (json === this.lastStateJson) {
      return;
    }
    this.lastStateJson = json;
    
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(json);
        } catch {
          console.warn('[WS] State broadcast failed for an open client.');
        }
      }
    }
  }

  public broadcast(payload: any): void {
    const json = JSON.stringify(payload);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(json);
        } catch {
          console.warn('[WS] Broadcast failed for an open client.');
        }
      }
    }
  }

  public broadcastLog(message: string, level: 'info' | 'warn' | 'error' | 'automation' = 'info'): void {
    const key = `${level}:${message}`;
    const now = this.now();
    const previous = this.lastLogTimeByKey.get(key);
    if (previous !== undefined && now - previous < this.logDedupeWindowMs) return;
    this.lastLogTimeByKey.set(key, now);
    if (this.lastLogTimeByKey.size > 100) {
      const firstKey = this.lastLogTimeByKey.keys().next().value;
      if (firstKey !== undefined) {
        this.lastLogTimeByKey.delete(firstKey);
      }
    }
    const json = JSON.stringify({ type: 'log', message, level, timestamp: now });
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(json);
        } catch {
          console.warn('[WS] Log broadcast failed for an open client.');
        }
      }
    }
  }

  public stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
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
    this.lastStateJson = '';
    if (this.wss) {
      try { this.wss.removeAllListeners(); } catch {}
      try { this.wss.close(); } catch {}
      this.wss = null;
    }
  }
}
