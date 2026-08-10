import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
// @ts-ignore
import * as osc from 'osc-min';

const DEBUG_LOG = process.env.SETLIST_OSC_DEBUG === '1';
const DEBUG_LOG_PATH = process.env.SETLIST_OSC_DEBUG_LOG
  || path.join(process.env.TEMP || process.env.TMP || '/tmp', 'setlist-osc.log');

function dbg(tag: string, payload: string): void {
  if (!DEBUG_LOG) return;
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, `[${new Date().toISOString()}] ${tag} ${payload}\n`);
  } catch { /* best effort */ }
}

function ensureTextEncodingGlobals(): void {
  const runtime = globalThis as typeof globalThis & {
    TextDecoder?: typeof TextDecoder;
    TextEncoder?: typeof TextEncoder;
  };

  if (typeof runtime.TextEncoder !== 'function') {
    runtime.TextEncoder = NodeTextEncoder as typeof TextEncoder;
  }
  if (typeof runtime.TextDecoder !== 'function') {
    runtime.TextDecoder = NodeTextDecoder as typeof TextDecoder;
  }
}

export interface OscDebugSnapshot {
  oscTargetHost: string;
  oscTargetPort: number;
  oscListenPort: number;
  oscIsConnected: boolean;
  oscLastMessageTime: number;
  oscTimeSinceLastMessageMs: number | null;
  oscRxCount: number;
  oscTxCount: number;
}

export class OSCClient extends EventEmitter {
  private server: dgram.Socket | null = null;
  private targetPort: number = 11000;
  private targetHost: string = '127.0.0.1';
  private listenPort: number = 0; // bound to first free of [11001, 11101, 11201] at start()
  private onMessageCallback: ((msg: Buffer) => void) | null = null;
  // Tracks most recent value per rate-prone address so redundant replies
  // from AbletonOSC (e.g. current_song_time bursts) don't fan out identical
  // events to every WS client.
  private lastEmitted: Map<string, unknown> = new Map();
  public isConnected: boolean = false;
  private lastMessageTime: number = 0;
  private connectionCheckInterval: NodeJS.Timeout | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private cuePointsPollInterval: NodeJS.Timeout | null = null;
  private rxCount: number = 0;
  private txCount: number = 0;

  constructor() {
    super();
  }

  private handleMessage(msg: Buffer): void {
    this.rxCount++;
    dbg('RX', `#${this.rxCount} len=${msg.length} hex=${msg.toString('hex').slice(0, 80)}`);
    try {
      const oscMsg = osc.fromBuffer(msg);
      if (oscMsg.oscType === 'message') {
        dbg('RX-PARSED', `oscType=message address=${oscMsg.address} args=${JSON.stringify(oscMsg.args)}`);
      } else {
        dbg('RX-PARSED', `oscType=bundle elements=${oscMsg.elements.length}`);
      }
      this.handleIncoming(oscMsg);
    } catch (err) {
      // osc-min is permissive and rarely throws, but keep the safety net
      // so a future parser swap that DOES throw doesn't kill the listener.
      dbg('RX-PARSE-ERR', String(err));
      this.emit('error', err);
    }
  }

  private shouldEmit(address: string, value: unknown): boolean {
    const prev = this.lastEmitted.get(address);
    if (Object.is(prev, value)) return false;
    this.lastEmitted.set(address, value);
    return true;
  }

  private checkConnection(): void {
    const now = Date.now();
    if (this.isConnected && (this.lastMessageTime === 0 || now - this.lastMessageTime > 3000)) {
      this.isConnected = false;
      console.log('[OSC] Connection to Ableton Live lost.');
      this.emit('disconnect');
    }
  }

  private handleIncoming(oscMsg: any): void {
    this.lastMessageTime = Date.now();
    if (!this.isConnected) {
      this.isConnected = true;
      console.log('[OSC] Connection to Ableton Live established.');
      this.emit('connect');
    }

    if (oscMsg.oscType !== 'message') return;

    const address = oscMsg.address;
    const args = oscMsg.args || [];

    // Log any address that DOESN'T match the known set so we can spot
    // what AbletonOSC actually sends vs what we expected.
    const KNOWN = new Set([
      '/live/song/get/tempo',
      '/live/song/get/is_playing',
      '/live/song/get/current_song_time',
      '/live/song/get/cue_points',
      '/live/song/get/last_event_time',
      '/live/song/get/metronome',
      '/live/song/get/signature_numerator',
      '/live/song/get/signature_denominator',
      '/live/song/get/clip_trigger_quantization',
      '/live/song/tempo',
      '/live/song/is_playing',
      '/live/song/metronome',
    ]);
    if (!KNOWN.has(address)) {
      dbg('RX-UNKNOWN-ADDR', `address=${address} args=${JSON.stringify(args)}`);
    }

    if (address === '/live/song/get/tempo') {
      const bpm = args[0]?.value;
      if (typeof bpm === 'number') {
        console.log(`[OSC] tempo reply: ${bpm}`);
        if (this.shouldEmit(address, bpm)) {
          this.emit('tempo', bpm);
        }
      }
    } else if (address === '/live/song/get/is_playing') {
      const val = args[0]?.value;
      const isPlaying = val === 1 || val === true || val === 'true';
      this.emit('is_playing_sample', isPlaying);
      if (this.shouldEmit(address, isPlaying)) {
        this.emit('is_playing', isPlaying);
      }
    } else if (address === '/live/song/get/current_song_time') {
      const time = args[0]?.value;
      if (typeof time === 'number' && this.shouldEmit(address, time)) {
        this.emit('current_song_time', time);
      }
    } else if (address === '/live/song/get/cue_points') {
      const cues: { name: string; time: number }[] = [];
      for (let i = 0; i < args.length; i += 2) {
        const name = args[i]?.value;
        const time = args[i + 1]?.value;
        if (typeof name === 'string' && typeof time === 'number') {
          cues.push({ name, time });
        }
      }
      this.emit('cue_points', cues);
      console.log(`[OSC] cue_points reply: ${cues.length} cue(s) — ${cues.map(c => c.name).join(', ')}`);
    } else if (address === '/live/song/get/last_event_time') {
      const value = args[0]?.value;
      if (typeof value === 'number' && Number.isFinite(value) && this.shouldEmit(address, value)) {
        this.emit('last_event_time', value);
      }
    } else if (address === '/live/song/get/metronome') {
      const val = args[0]?.value;
      const metronome = val === 1 || val === true || val === 'true';
      console.log(`[OSC] metronome reply: ${metronome}`);
      if (this.shouldEmit(address, metronome)) {
        this.emit('metronome', metronome);
      }
    } else if (address === '/live/song/get/signature_numerator') {
      const val = args[0]?.value;
      if (typeof val === 'number' && this.shouldEmit(address, val)) {
        this.emit('signature_numerator', val);
      }
    } else if (address === '/live/song/get/signature_denominator') {
      const val = args[0]?.value;
      if (typeof val === 'number' && this.shouldEmit(address, val)) {
        this.emit('signature_denominator', val);
      }
        } else if (address === '/live/song/get/clip_trigger_quantization') {
      const val = args[0]?.value;
      if (typeof val === 'number' && this.shouldEmit(address, val)) {
        this.emit('clip_trigger_quantization', val);
      }
    }
  }

  public send(address: string, args: any[] = []): boolean {
    if (typeof address !== 'string' || !address.startsWith('/')) {
      this.emit('error', new Error(`[OSC] send: invalid address ${JSON.stringify(address)}`));
      return false;
    }
    const safeArgs = Array.isArray(args) ? args : [];
    const oscMsg = {
      oscType: 'message',
      address,
      args: safeArgs
    };
    let buffer: Buffer;
    try {
      ensureTextEncodingGlobals();
      const encoded = osc.toBuffer(oscMsg);
      buffer = Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    } catch (err) {
      this.emit('error', err);
      return false;
    }
    const socket = this.server;
    if (!socket) return false;
    this.txCount++;
    dbg('TX', `#${this.txCount} ${address} args=${JSON.stringify(safeArgs)} → ${this.targetHost}:${this.targetPort} via socket listenPort=${this.listenPort}`);
    socket.send(buffer, this.targetPort, this.targetHost, (err) => {
      if (err) {
        dbg('TX-ERR', `${address} ${err.message}`);
        this.emit('error', err);
      }
    });
    return true;
  }

  public start(): Promise<void> {
    this.lastMessageTime = 0;
    this.isConnected = false;
    
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
    }
    this.connectionCheckInterval = setInterval(() => {
      this.checkConnection();
    }, 1000);

    return new Promise((resolve, reject) => {
      const g = globalThis as any;

      this.onMessageCallback = (msg: Buffer) => {
        this.handleMessage(msg);
      };

      if (g.abletonOSCSocket) {
        this.server = g.abletonOSCSocket;
        if (!(g.abletonOSCListeners instanceof Set)) {
          g.abletonOSCListeners = new Set();
        }
        g.abletonOSCListeners.add(this.onMessageCallback);
        const addr = (g.abletonOSCSocket.address && typeof g.abletonOSCSocket.address === 'function') ? g.abletonOSCSocket.address() : null;
        if (addr && typeof addr === 'object' && Number.isInteger(addr.port) && addr.port > 0) {
          this.listenPort = addr.port;
        }
        dbg('START', `reused shared socket addr=${JSON.stringify(addr)} listenersCount=${g.abletonOSCListeners.size}`);
        console.log(`[OSC] Shared OSC listening socket reused on port ${this.listenPort || 'unknown'}`);
        resolve();
        return;
      }

      // Try 11001, then 11101, then 11201. These are spaced far enough
      // apart that they're unlikely to collide with both rc-surface
      // (11001) and any unrelated UDP server. We deliberately avoid
      // 11002..11010: binding a parallel socket on those ports would
      // make AbletonOSC route responses to whichever socket registered
      // the start_listen/* callbacks first, silently dropping our updates.
      const OSC_PORT_CANDIDATES = [11001, 11101, 11201];

      const tryBindOn = (port: number): void => {
        const serverSocket = dgram.createSocket('udp4');
        const onError = (_err: any) => {
          serverSocket.removeListener('error', onError);
          try { serverSocket.close(); } catch { /* ignore */ }
          const idx = OSC_PORT_CANDIDATES.indexOf(port);
          if (idx >= 0 && idx + 1 < OSC_PORT_CANDIDATES.length) {
            console.log(`[OSC] Port ${port} in use, trying ${OSC_PORT_CANDIDATES[idx + 1]}`);
            tryBindOn(OSC_PORT_CANDIDATES[idx + 1]!);
          } else {
            reject(new Error(`[OSC] Could not bind any of ${OSC_PORT_CANDIDATES.join(', ')}`));
          }
        };
        serverSocket.once('error', onError);

        serverSocket.bind(port, '127.0.0.1', () => {
          serverSocket.off('error', onError);

          serverSocket.on('error', (err) => {
            console.error('[OSC] Bound server socket error:', err);
            g.abletonOSCSocket = null;
          });

          g.abletonOSCSocket = serverSocket;
          g.abletonOSCListeners = new Set();
          g.abletonOSCListeners.add(this.onMessageCallback);

          serverSocket.on('message', (msg) => {
            if (g.abletonOSCListeners) {
              for (const cb of g.abletonOSCListeners) {
                try { cb(msg); } catch (err) { console.error('[OSC] Listener error:', err); }
              }
            }
          });

          this.server = serverSocket;
          this.listenPort = port;
          console.log(`[OSC] OSC listening socket created and bound on port ${port}`);
          resolve();
        });
      };

      tryBindOn(OSC_PORT_CANDIDATES[0]!);
    });
  }

  public stop(): Promise<void> {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
    this.stopPolling();
    const g = globalThis as any;
    if (this.onMessageCallback) {
      if (g.abletonOSCListeners) {
        g.abletonOSCListeners.delete(this.onMessageCallback);
        if (g.abletonOSCListeners.size === 0) {
          if (g.abletonOSCSocket) {
            try { g.abletonOSCSocket.close(); } catch {}
            g.abletonOSCSocket = null;
          }
          g.abletonOSCListeners = null;
        }
      }
      this.onMessageCallback = null;
    }
    this.server = null;
    return Promise.resolve();
  }

  public getTempo(): void { this.send('/live/song/get/tempo'); }
  public getIsPlaying(): void { this.send('/live/song/get/is_playing'); }
  public getCurrentSongTime(): void { this.send('/live/song/get/current_song_time'); }
  public setCurrentSongTime(value: number): void {
    this.send('/live/song/set/current_song_time', [{ type: 'float', value }]);
  }
  public getCuePoints(): void { this.send('/live/song/get/cue_points'); }
  public getLastEventTime(): void { this.send('/live/song/get/last_event_time'); }
  public startPlaying(): void { this.send('/live/song/start_playing'); }
  public stopPlaying(): void { this.send('/live/song/stop_playing'); }
  public getMetronome(): void { this.send('/live/song/get/metronome'); }
  public getSignatureNumerator(): void { this.send('/live/song/get/signature_numerator'); }
  public getSignatureDenominator(): void { this.send('/live/song/get/signature_denominator'); }
  public getClipTriggerQuantization(): void { this.send('/live/song/get/clip_trigger_quantization'); }
  
  public setMetronome(value: boolean): void {
    this.send('/live/song/set/metronome', [{ type: 'integer', value: value ? 1 : 0 }]);
  }

  public setClipTriggerQuantization(val: number): void {
    this.send('/live/song/set/clip_trigger_quantization', [{ type: 'integer', value: val }]);
  }

  public getDebugSnapshot(): OscDebugSnapshot {
    return {
      oscTargetHost: this.targetHost,
      oscTargetPort: this.targetPort,
      oscListenPort: this.listenPort,
      oscIsConnected: this.isConnected,
      oscLastMessageTime: this.lastMessageTime,
      oscTimeSinceLastMessageMs: this.lastMessageTime ? Date.now() - this.lastMessageTime : null,
      oscRxCount: this.rxCount,
      oscTxCount: this.txCount,
    };
  }
  
  public jumpToCuePoint(indexOrName: number | string): void {
    const type = typeof indexOrName === 'number' ? 'integer' : 'string';
    this.send('/live/song/cue_point/jump', [{ type, value: indexOrName }]);
  }

  public startPropertyListeners(): void {
    this.send('/live/song/start_listen/is_playing');
    this.send('/live/song/start_listen/tempo');
    this.send('/live/song/start_listen/metronome');
    this.send('/live/song/start_listen/signature_numerator');
    this.send('/live/song/start_listen/signature_denominator');
    this.send('/live/song/start_listen/clip_trigger_quantization');
  }

  /**
   * Active polling fallback for properties that AbletonOSC doesn't reliably
   * push via `start_listen`. Without this, transport / BPM / metronome / cue_points
   * never update on the page when the change happens in Live directly.
   * Mirrors the pattern used by ableton-rc-surface's OSC transport.
   */
  public startPolling(): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => {
      this.getIsPlaying();
      this.send('/live/song/get/tempo');
      this.send('/live/song/get/metronome');
      this.send('/live/song/get/signature_numerator');
      this.send('/live/song/get/signature_denominator');
      this.send('/live/song/get/clip_trigger_quantization');
    }, 500);
    // Slower poll for cue_points — they don't change often, and a tight
    // loop would cause noticeable UI lag when the set has many markers.
    this.cuePointsPollInterval = setInterval(() => {
      this.send('/live/song/get/cue_points');
      this.getLastEventTime();
    }, 2000);
  }

  public stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.cuePointsPollInterval) {
      clearInterval(this.cuePointsPollInterval);
      this.cuePointsPollInterval = null;
    }
  }

  public requestInitialState(): void {
    this.getTempo();
    this.getIsPlaying();
    this.getMetronome();
    this.getSignatureNumerator();
    this.getSignatureDenominator();
    this.getClipTriggerQuantization();
    this.getCurrentSongTime();
    this.getLastEventTime();
  }

  public requestDiagnosticProbe(): void {
    this.requestInitialState();
    this.getCuePoints();
  }

  public stopPropertyListeners(): void {
    this.send('/live/song/stop_listen/is_playing');
    this.send('/live/song/stop_listen/tempo');
    this.send('/live/song/stop_listen/metronome');
    this.send('/live/song/stop_listen/signature_numerator');
    this.send('/live/song/stop_listen/signature_denominator');
    this.send('/live/song/stop_listen/clip_trigger_quantization');
  }
}
