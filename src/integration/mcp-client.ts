import * as net from 'node:net';
import { isPlainObject, parseJson } from '../util/json.js';

export interface SessionInfo {
  tempo: number;
  signature_numerator: number;
  signature_denominator: number;
  is_playing: boolean;
  current_song_time: number;
}

export interface ProjectMetadata {
  song_name?: unknown;
  file_path?: unknown;
  is_dirty?: unknown;
}

/** Wire shape of one line of reply coming back from the MCP bridge. */
interface McpResponse {
  status: 'ok' | 'error';
  result?: unknown;
  message?: unknown;
}

function isMcpResponse(value: unknown): value is McpResponse {
  if (!isPlainObject(value)) return false;
  const status = value['status'];
  return status === 'ok' || status === 'error';
}

export interface McpTcpClientOptions {
  host?: string;
  port?: number;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
}

/**
 * Manages the lifecycle and public surface of McpTcpClient.
 */
export class McpTcpClient {
  private socket: net.Socket | null = null;
  private connectingSocket: net.Socket | null = null;
  private pending: Array<{
    resolve: (val: unknown) => void;
    reject: (err: unknown) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  private dataBuffer = '';
  private connectPromise: Promise<void> | null = null;
  private readonly host: string;
  private readonly port: number;
  private readonly connectionTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(options: McpTcpClientOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 9888;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 1000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 1000;
  }

  public connect(): Promise<void> {
    if (this.socket) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    const attempt = new Promise<void>((resolve, reject) => {
      const sock = new net.Socket();
      this.connectingSocket = sock;
      let settled = false;

      const rejectAttempt = (err: Error) => {
        if (settled) return;
        settled = true;
        this.connectingSocket = null;
        try {
          sock.destroy();
        } catch {
          // swallow: nothing to do here on purpose
        }
        reject(err);
      };

      sock.setTimeout(this.connectionTimeoutMs);

      sock.on('data', (data) => {
        this.dataBuffer += data.toString();
        while (this.dataBuffer.includes('\n')) {
          const idx = this.dataBuffer.indexOf('\n');
          const line = this.dataBuffer.slice(0, idx);
          this.dataBuffer = this.dataBuffer.slice(idx + 1);

          const p = this.pending.shift();
          if (p) {
            clearTimeout(p.timeout);
            try {
              const res = parseJson<McpResponse>(line, isMcpResponse);
              if (!res) throw new Error('MCP reply is not a JSON object');
              if (res.status === 'ok') {
                p.resolve(res.result);
              } else {
                const detail = typeof res.message === 'string' ? res.message : 'MCP Error';
                p.reject(new Error(detail));
              }
            } catch (err) {
              p.reject(err);
            }
          }
        }
      });

      sock.once('connect', () => {
        if (settled) return;
        settled = true;
        sock.setTimeout(0);
        this.connectingSocket = null;
        this.socket = sock;
        resolve();
      });

      sock.on('error', (err) => {
        if (!settled) {
          rejectAttempt(err);
          return;
        }
        this.destroy(err);
      });
      sock.on('timeout', () => {
        rejectAttempt(new Error('Connection timeout'));
      });
      sock.on('close', () => {
        if (!settled) {
          rejectAttempt(new Error('Connection closed'));
          return;
        }
        this.destroy(new Error('Connection closed'));
      });

      sock.connect(this.port, this.host);
    });

    const wrapped: Promise<void> = attempt.finally(() => {
      if (this.connectPromise === wrapped) this.connectPromise = null;
    });
    this.connectPromise = wrapped;
    return wrapped;
  }

  private destroy(err: unknown): void {
    if (this.connectingSocket) {
      try {
        this.connectingSocket.destroy();
      } catch {
        // swallow: nothing to do here on purpose
      }
      this.connectingSocket = null;
    }
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // swallow: nothing to do here on purpose
      }
      this.socket = null;
    }
    this.connectPromise = null;
    this.dataBuffer = '';
    const active = this.pending;
    this.pending = [];
    for (const p of active) {
      clearTimeout(p.timeout);
      p.reject(err);
    }
  }

  public call(type: string, params: unknown = {}): Promise<unknown> {
    return this.connect()
      .then(() => {
        if (!this.socket) throw new Error('Socket not connected');
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            this.destroy(new Error(`MCP request timeout after ${this.requestTimeoutMs}ms`));
          }, this.requestTimeoutMs);
          this.pending.push({ resolve: (value) => resolve(value), reject, timeout });
          this.socket!.write(JSON.stringify({ type, params }) + '\n');
        });
      })
      .catch((err: unknown) => {
        this.destroy(err instanceof Error ? err : new Error(String(err)));
        throw err;
      });
  }

  public getProjectMetadata(): Promise<ProjectMetadata | null> {
    return this.call('get_project_metadata').then((value) =>
      isPlainObject(value) ? (value as ProjectMetadata) : null,
    );
  }

  public stop(): void {
    this.destroy(new Error('Stopped'));
  }
}
