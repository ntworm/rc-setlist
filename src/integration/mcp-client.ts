import * as net from 'node:net';

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

export interface McpTcpClientOptions {
  host?: string;
  port?: number;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export class McpTcpClient {
  private socket: net.Socket | null = null;
  private connectingSocket: net.Socket | null = null;
  private pending: Array<{
    resolve: (val: any) => void;
    reject: (err: any) => void;
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
        try { sock.destroy(); } catch {}
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
              const res = JSON.parse(line);
              if (res.status === 'ok') {
                p.resolve(res.result);
              } else {
                p.reject(new Error(res.message || 'MCP Error'));
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

    let wrapped!: Promise<void>;
    wrapped = attempt.finally(() => {
      if (this.connectPromise === wrapped) this.connectPromise = null;
    });
    this.connectPromise = wrapped;
    return wrapped;
  }

  private destroy(err: Error): void {
    if (this.connectingSocket) {
      try { this.connectingSocket.destroy(); } catch {}
      this.connectingSocket = null;
    }
    if (this.socket) {
      try { this.socket.destroy(); } catch {}
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

  public call(type: string, params: any = {}): Promise<any> {
    return this.connect()
      .then(() => {
        if (!this.socket) throw new Error('Socket not connected');
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            this.destroy(new Error(`MCP request timeout after ${this.requestTimeoutMs}ms`));
          }, this.requestTimeoutMs);
          this.pending.push({ resolve, reject, timeout });
          this.socket!.write(JSON.stringify({ type, params }) + '\n');
        });
      })
      .catch((err) => {
        this.destroy(err);
        throw err;
      });
  }

  public getProjectMetadata(): Promise<ProjectMetadata | null> {
    return this.call('get_project_metadata').then((value) => (
      value && typeof value === 'object' ? value as ProjectMetadata : null
    ));
  }

  public stop(): void {
    this.destroy(new Error('Stopped'));
  }
}
