import * as net from 'node:net';

export interface SessionInfo {
  tempo: number;
  signature_numerator: number;
  signature_denominator: number;
  is_playing: boolean;
  current_song_time: number;
}

export class McpTcpClient {
  private socket: net.Socket | null = null;
  private pending: { resolve: (val: any) => void; reject: (err: any) => void }[] = [];
  private dataBuffer = '';
  private isConnecting = false;

  constructor() {}

  public connect(): Promise<void> {
    if (this.socket) return Promise.resolve();
    if (this.isConnecting) {
      return new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (this.socket) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
      });
    }

    this.isConnecting = true;
    return new Promise<void>((resolve, reject) => {
      const sock = new net.Socket();
      sock.setTimeout(1000);

      sock.connect(9888, '127.0.0.1', () => {
        sock.setTimeout(0); // clear timeout after connect
        this.socket = sock;
        this.isConnecting = false;
        resolve();
      });

      sock.on('data', (data) => {
        this.dataBuffer += data.toString();
        while (this.dataBuffer.includes('\n')) {
          const idx = this.dataBuffer.indexOf('\n');
          const line = this.dataBuffer.slice(0, idx);
          this.dataBuffer = this.dataBuffer.slice(idx + 1);

          const p = this.pending.shift();
          if (p) {
            try {
              const res = JSON.parse(line);
              if (res.status === 'ok') {
                resolve(res.result); // Resolve connect promise if it was pending (redundant but safe)
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

      const handleError = (err: Error) => {
        this.isConnecting = false;
        this.destroy(err);
        reject(err);
      };

      sock.on('error', handleError);
      sock.on('timeout', () => {
        sock.destroy();
        handleError(new Error('Connection timeout'));
      });
      sock.on('close', () => {
        this.isConnecting = false;
        this.destroy(new Error('Connection closed'));
      });
    });
  }

  private destroy(err: Error): void {
    if (this.socket) {
      try { this.socket.destroy(); } catch {}
      this.socket = null;
    }
    this.dataBuffer = '';
    const active = this.pending;
    this.pending = [];
    for (const p of active) {
      p.reject(err);
    }
  }

  public call(type: string, params: any = {}): Promise<any> {
    return this.connect()
      .then(() => {
        if (!this.socket) throw new Error('Socket not connected');
        return new Promise((resolve, reject) => {
          this.pending.push({ resolve, reject });
          this.socket!.write(JSON.stringify({ type, params }) + '\n');
        });
      })
      .catch((err) => {
        this.destroy(err);
        throw err;
      });
  }

  public stop(): void {
    this.destroy(new Error('Stopped'));
  }
}
