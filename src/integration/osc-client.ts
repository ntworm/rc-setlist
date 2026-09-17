import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import * as osc from 'osc-min';
import { log } from '../util/log.js';
import { isOscMessage, parseOsc, type OscArg } from './osc-types.js';

/**
 * The legacy AbletonOSC path shares one UDP socket across every RC
 * extension on the machine so each does not bind its own 11001.
 * Both ends of that handshake hang values off `globalThis`; this
 * interface narrows those values so the unsafe `any` no longer leaks
 * into every call site.
 */
interface SharedOscGlobals {
  abletonOSCSocket?: dgram.Socket | null;
  abletonOSCListeners?: Set<(msg: Buffer) => void> | null;
}

const DEBUG_LOG = process.env.SETLIST_OSC_DEBUG === '1';
const DEBUG_LOG_PATH =
  process.env.SETLIST_OSC_DEBUG_LOG ||
  path.join(process.env.TEMP || process.env.TMP || '/tmp', 'setlist-osc.log');

function dbg(tag: string, payload: string): void {
  if (!DEBUG_LOG) return;
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, `[${new Date().toISOString()}] ${tag} ${payload}\n`);
  } catch {
    /* best effort */
  }
}

function ensureTextEncodingGlobals(): void {
  const runtime = globalThis as typeof globalThis & {
    TextDecoder?: typeof TextDecoder;
    TextEncoder?: typeof TextEncoder;
  };

  if (typeof runtime.TextEncoder !== 'function') {
    runtime.TextEncoder = NodeTextEncoder;
  }
  if (typeof runtime.TextDecoder !== 'function') {
    runtime.TextDecoder = NodeTextDecoder as typeof TextDecoder;
  }
}

export type OscBridgeKind = 'rcbridge' | 'abletonosc';

export interface OscDebugSnapshot {
  oscTargetHost: string;
  oscTargetPort: number;
  oscListenPort: number;
  oscIsConnected: boolean;
  oscLastMessageTime: number;
  oscTimeSinceLastMessageMs: number | null;
  oscRxCount: number;
  oscTxCount: number;
  /** Which remote script answered: the bundled fork, or a stock AbletonOSC. Null until start(). */
  oscBridge: OscBridgeKind | null;
  oscBridgeVersion: string | null;
}

/**
 * Where to look for the two remote scripts this client can talk to.
 *
 * RC Bridge — the fork shipped in the installation kit — listens on 11020 and
 * replies to whichever socket asked, so this client binds an ephemeral port of
 * its own. A stock AbletonOSC listens on 11000 and replies to a fixed 11001,
 * which is why the legacy path below shares one socket between RC extensions
 * and falls back through 11101 and 11201 when 11001 is taken.
 */
export interface OscBridgeOptions {
  bridgeHost: string;
  bridgePort: number;
  probeTimeoutMs: number;
  legacyTargetPort: number;
  legacyListenPorts: number[];
}

export const RC_BRIDGE_PORT = 11020;
export const ABLETON_OSC_PORT = 11000;

/**
 * Manages the lifecycle and public surface of OSCClient.
 */
export class OSCClient extends EventEmitter {
  private server: dgram.Socket | null = null;
  private targetPort: number = 11000;
  private targetHost: string = '127.0.0.1';
  private listenPort: number = 0; // ephemeral in RC Bridge mode; first free of legacyListenPorts on the AbletonOSC path
  private onMessageCallback: ((msg: Buffer) => void) | null = null;
  // Tracks most recent value per rate-prone address so redundant replies
  // from AbletonOSC (e.g. current_song_time bursts) don't fan out identical
  // events to every WS client.
  private lastEmitted: Map<string, unknown> = new Map();
  // Count-In requests need one authoritative acknowledgement even when its
  // value matches the last streamed sample. Keep this bounded to explicit
  // queries so rate-prone listener traffic remains deduplicated.
  private requestedConfirmations: Set<string> = new Set();
  public isConnected: boolean = false;
  private lastMessageTime: number = 0;
  private connectionCheckInterval: NodeJS.Timeout | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private cuePointsPollInterval: NodeJS.Timeout | null = null;
  private rxCount: number = 0;
  private txCount: number = 0;
  private bridge: OscBridgeKind | null = null;
  private bridgeVersion: string | null = null;
  /** Bumped by stop() so a probe still in flight when the client stops is discarded. */
  private generation = 0;
  private bridgeOptions: OscBridgeOptions = {
    bridgeHost: '127.0.0.1',
    bridgePort: RC_BRIDGE_PORT,
    probeTimeoutMs: 700,
    legacyTargetPort: ABLETON_OSC_PORT,
    legacyListenPorts: [11001, 11101, 11201],
  };

  constructor() {
    super();
  }

  /** Test seam and future preference hook; production keeps the defaults. */
  public configureBridge(options: Partial<OscBridgeOptions>): void {
    this.bridgeOptions = { ...this.bridgeOptions, ...options };
  }

  private handleMessage(msg: Buffer): void {
    this.rxCount++;
    dbg('RX', `#${this.rxCount} len=${msg.length} hex=${msg.toString('hex').slice(0, 80)}`);
    try {
      const oscNode = parseOsc(msg);
      if (oscNode === null) {
        dbg('RX-PARSE-ERR', 'parseOsc returned null');
        this.emit('error', new Error(`OSC parse failed (${msg.length} bytes)`));
        return;
      }
      if (isOscMessage(oscNode)) {
        dbg(
          'RX-PARSED',
          `oscType=message address=${oscNode.address} args=${JSON.stringify(oscNode.args)}`,
        );
      } else {
        const packetCount = oscNode.packets?.length ?? 0;
        dbg('RX-PARSED', `oscType=bundle packets=${packetCount}`);
      }
      this.handleIncoming(oscNode);
    } catch (err) {
      // osc-min is permissive and rarely throws, but keep the safety net
      // so a future parser swap that DOES throw doesn't kill the listener.
      dbg('RX-PARSE-ERR', String(err));
      this.emit('error', err);
    }
  }

  private shouldEmit(address: string, value: unknown, confirmation = false): boolean {
    if (confirmation) {
      this.lastEmitted.set(address, value);
      return true;
    }
    const prev = this.lastEmitted.get(address);
    if (Object.is(prev, value)) return false;
    this.lastEmitted.set(address, value);
    return true;
  }

  private consumeRequestedConfirmation(address: string): boolean {
    return this.requestedConfirmations.delete(address);
  }

  private requestConfirmation(address: string): void {
    this.requestedConfirmations.add(address);
  }

  private checkConnection(): void {
    const now = Date.now();
    if (this.isConnected && (this.lastMessageTime === 0 || now - this.lastMessageTime > 3000)) {
      this.isConnected = false;
      log.info('osc', 'Connection to Ableton Live lost.');
      this.emit('disconnect');
    }
  }

  private handleIncoming(oscMsg: unknown): void {
    if (!isOscMessage(oscMsg)) return;
    this.lastMessageTime = Date.now();
    if (!this.isConnected) {
      this.isConnected = true;
      log.info('osc', 'Connection to Ableton Live established.');
      this.emit('connect');
    }

    const address = oscMsg.address;
    const args = oscMsg.args ?? [];

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
      '/live/rcbridge/version',
    ]);
    if (!KNOWN.has(address)) {
      dbg('RX-UNKNOWN-ADDR', `address=${address} args=${JSON.stringify(args)}`);
    }

    if (address === '/live/rcbridge/version') {
      const name = args[0]?.value;
      const version = args[1]?.value;
      if (typeof name === 'string' && typeof version === 'string') {
        this.bridgeVersion = `${name} ${version}`;
      }
    } else if (address === '/live/song/get/tempo') {
      const bpm = args[0]?.value;
      if (typeof bpm === 'number') {
        log.info('osc', 'tempo reply', { bpm });
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
      if (
        typeof time === 'number' &&
        this.shouldEmit(address, time, this.consumeRequestedConfirmation(address))
      ) {
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
      log.info('osc', 'cue_points reply', {
        count: cues.length,
        names: cues.map((c) => c.name).join(', '),
      });
    } else if (address === '/live/song/get/last_event_time') {
      const value = args[0]?.value;
      if (typeof value === 'number' && Number.isFinite(value) && this.shouldEmit(address, value)) {
        this.emit('last_event_time', value);
      }
    } else if (address === '/live/song/get/metronome') {
      const val = args[0]?.value;
      const metronome = val === 1 || val === true || val === 'true';
      log.info('osc', 'metronome reply', { metronome });
      if (this.shouldEmit(address, metronome, this.consumeRequestedConfirmation(address))) {
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

  public send(address: string, args: readonly OscArg[] = []): boolean {
    // A malformed address or an unencodable argument is a programming error
    // on this side, not a transport failure: report it and return false as
    // the signature promises rather than raising 'error' at the caller.
    if (typeof address !== 'string' || !address.startsWith('/')) {
      log.error('osc', 'send: invalid address', { address: JSON.stringify(address) });
      return false;
    }
    const baseArgs: readonly OscArg[] = Array.isArray(args) ? args : [];
    const safeArgs: OscArg[] = [...baseArgs];
    const oscMsg = {
      oscType: 'message' as const,
      address,
      args: safeArgs,
    };
    let buffer: Buffer;
    try {
      ensureTextEncodingGlobals();
      // Cast: my OscArg uses open string `type`; osc-min expects a discriminated
      // union of literal types. The wire format is the same; the cast lives
      // here, at the boundary, instead of widening the public type.
      const encoded = osc.toBuffer(oscMsg as unknown as osc.OscPacketInput);
      buffer = Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    } catch (err) {
      log.error('osc', 'send: could not encode', {
        address,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
    const socket = this.server;
    if (!socket) return false;
    this.txCount++;
    dbg(
      'TX',
      `#${this.txCount} ${address} args=${JSON.stringify(safeArgs)} → ${this.targetHost}:${this.targetPort} via socket listenPort=${this.listenPort}`,
    );
    socket.send(buffer, this.targetPort, this.targetHost, (err) => {
      if (err) {
        dbg('TX-ERR', `${address} ${err.message}`);
        this.emit('error', err);
      }
    });
    return true;
  }

  public async start(): Promise<void> {
    if (this.server) return; // already started; stop() first to change bridge
    this.lastMessageTime = 0;
    this.isConnected = false;
    this.bridge = null;
    this.bridgeVersion = null;

    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
    }
    this.connectionCheckInterval = setInterval(() => {
      this.checkConnection();
    }, 1000);

    this.onMessageCallback = (msg: Buffer) => {
      this.handleMessage(msg);
    };

    const generation = this.generation;
    const probe = await this.probeBridge();
    if (generation !== this.generation) {
      // stop() ran while the probe was out; whatever answered is not ours to keep.
      if (probe) {
        try {
          probe.socket.close();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (probe) {
      // Adopt the socket before handing over its first message: 'connect'
      // fires from handleMessage, and the connect handler sends the listener
      // registrations, which need this.server to be set.
      this.server = probe.socket;
      this.targetHost = this.bridgeOptions.bridgeHost;
      this.targetPort = this.bridgeOptions.bridgePort;
      this.listenPort = probe.socket.address().port;
      this.bridge = 'rcbridge';
      probe.socket.removeAllListeners('error');
      probe.socket.on('error', (err) => {
        log.error('osc', 'RC Bridge socket error', {
          error: err instanceof Error ? err.message : String(err),
        });
        if (this.isConnected) {
          this.isConnected = false;
          this.emit('disconnect');
        }
      });
      this.handleMessage(probe.versionReply);
      log.info('osc', `${this.bridgeVersion ?? 'RC Bridge'} answered`, {
        targetPort: this.targetPort,
        listenPort: this.listenPort,
      });
      return;
    }

    this.targetPort = this.bridgeOptions.legacyTargetPort;
    this.bridge = 'abletonosc';
    log.info('osc', 'No RC Bridge; using AbletonOSC', {
      bridgePort: this.bridgeOptions.bridgePort,
      targetPort: this.targetPort,
    });
    await this.startLegacy();
  }

  /**
   * Ask RC Bridge to identify itself. Resolves with the socket that heard the
   * answer — already receiving, already the one to keep — and the answer
   * itself, which start() feeds through handleMessage once the socket is
   * adopted; or null after the timeout, which is how a stock AbletonOSC
   * (silent on unknown addresses) and an absent script both look.
   */
  private probeBridge(): Promise<{ socket: dgram.Socket; versionReply: Buffer } | null> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      let settled = false;
      let found = false;
      const finish = (versionReply: Buffer | null) => {
        if (settled) return;
        settled = true;
        found = versionReply !== null;
        clearTimeout(timer);
        if (versionReply) {
          resolve({ socket, versionReply });
        } else {
          try {
            socket.close();
          } catch {
            /* ignore */
          }
          resolve(null);
        }
      };
      const timer = setTimeout(() => finish(null), this.bridgeOptions.probeTimeoutMs);
      socket.on('error', () => finish(null));
      socket.on('message', (msg) => {
        if (!settled) {
          try {
            const oscNode = parseOsc(msg);
            if (isOscMessage(oscNode) && oscNode.address === '/live/rcbridge/version') {
              finish(msg);
              return;
            }
          } catch {
            /* not the answer being waited for */
          }
          return;
        }
        if (found && this.onMessageCallback) this.onMessageCallback(msg);
      });
      socket.bind(0, '127.0.0.1', () => {
        let buffer: Buffer;
        try {
          ensureTextEncodingGlobals();
          const probe = {
            oscType: 'message' as const,
            address: '/live/rcbridge/version',
            args: [] as OscArg[],
          };
          const encoded = osc.toBuffer(probe as unknown as osc.OscPacketInput);
          buffer = Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength);
        } catch {
          finish(null);
          return;
        }
        socket.send(buffer, this.bridgeOptions.bridgePort, this.bridgeOptions.bridgeHost, (err) => {
          if (err) finish(null);
        });
      });
    });
  }

  private startLegacy(): Promise<void> {
    return new Promise((resolve, reject) => {
      const g = globalThis as unknown as SharedOscGlobals;

      if (g.abletonOSCSocket) {
        this.server = g.abletonOSCSocket;
        if (!(g.abletonOSCListeners instanceof Set)) {
          g.abletonOSCListeners = new Set();
        }
        const sharedCb = this.onMessageCallback;
        if (sharedCb) g.abletonOSCListeners.add(sharedCb);
        const addr =
          g.abletonOSCSocket.address && typeof g.abletonOSCSocket.address === 'function'
            ? g.abletonOSCSocket.address()
            : null;
        if (addr && typeof addr === 'object' && Number.isInteger(addr.port) && addr.port > 0) {
          this.listenPort = addr.port;
        }
        dbg(
          'START',
          `reused shared socket addr=${JSON.stringify(addr)} listenersCount=${g.abletonOSCListeners.size}`,
        );
        log.info('osc', 'Shared OSC listening socket reused', {
          port: this.listenPort || 'unknown',
        });
        resolve();
        return;
      }

      // Try 11001, then 11101, then 11201. These are spaced far enough
      // apart that they're unlikely to collide with both rc-surface
      // (11001) and any unrelated UDP server. We deliberately avoid
      // 11002..11010: binding a parallel socket on those ports would
      // make AbletonOSC route responses to whichever socket registered
      // the start_listen/* callbacks first, silently dropping our updates.
      const OSC_PORT_CANDIDATES = this.bridgeOptions.legacyListenPorts;

      const tryBindOn = (port: number): void => {
        const serverSocket = dgram.createSocket('udp4');
        const onError = (_err: Error) => {
          serverSocket.removeListener('error', onError);
          try {
            serverSocket.close();
          } catch {
            /* ignore */
          }
          const idx = OSC_PORT_CANDIDATES.indexOf(port);
          if (idx >= 0 && idx + 1 < OSC_PORT_CANDIDATES.length) {
            log.info('osc', 'Port in use, trying next candidate', {
              port,
              next: OSC_PORT_CANDIDATES[idx + 1],
            });
            tryBindOn(OSC_PORT_CANDIDATES[idx + 1]!);
          } else {
            reject(new Error(`[OSC] Could not bind any of ${OSC_PORT_CANDIDATES.join(', ')}`));
          }
        };
        serverSocket.once('error', onError);

        serverSocket.bind(port, '127.0.0.1', () => {
          serverSocket.off('error', onError);

          serverSocket.on('error', (err) => {
            log.error('osc', 'Bound server socket error', {
              error: err instanceof Error ? err.message : String(err),
            });
            g.abletonOSCSocket = null;
          });

          g.abletonOSCSocket = serverSocket;
          g.abletonOSCListeners = new Set();
          const sharedCb = this.onMessageCallback;
          if (sharedCb) g.abletonOSCListeners.add(sharedCb);

          serverSocket.on('message', (msg) => {
            if (g.abletonOSCListeners) {
              for (const cb of g.abletonOSCListeners) {
                try {
                  cb(msg);
                } catch (err) {
                  log.error('osc', 'Listener error', {
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            }
          });

          this.server = serverSocket;
          this.listenPort = port;
          log.info('osc', 'OSC listening socket created and bound', { port });
          resolve();
        });
      };

      tryBindOn(OSC_PORT_CANDIDATES[0]!);
    });
  }

  public stop(): Promise<void> {
    this.generation++;
    this.clearRequestedConfirmations();
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
    this.stopPolling();
    if (this.bridge === 'rcbridge') {
      // Bridge mode owns its socket outright.
      if (this.server) {
        try {
          this.server.close();
        } catch {
          /* ignore */
        }
      }
      this.server = null;
      this.onMessageCallback = null;
      this.bridge = null;
      return Promise.resolve();
    }
    const g = globalThis as unknown as SharedOscGlobals;
    if (this.onMessageCallback) {
      if (g.abletonOSCListeners) {
        g.abletonOSCListeners.delete(this.onMessageCallback);
        if (g.abletonOSCListeners.size === 0) {
          if (g.abletonOSCSocket) {
            try {
              g.abletonOSCSocket.close();
            } catch {
              // swallow: nothing to do here on purpose
            }
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

  public getTempo(): void {
    this.send('/live/song/get/tempo');
  }
  public getIsPlaying(): void {
    this.send('/live/song/get/is_playing');
  }
  public getCurrentSongTime(requireConfirmation = false): void {
    const address = '/live/song/get/current_song_time';
    if (this.send(address) && requireConfirmation) this.requestConfirmation(address);
  }
  public setCurrentSongTime(value: number): void {
    this.send('/live/song/set/current_song_time', [{ type: 'float', value }]);
  }
  public getCuePoints(): void {
    this.send('/live/song/get/cue_points');
  }
  public getLastEventTime(): void {
    this.send('/live/song/get/last_event_time');
  }
  /**
   * Live has two ways to start, and neither is "from the playhead":
   * `start_playing` begins at the start marker (which a cue jump or a click
   * while stopped moves, but a stop does not), `continue_playing` resumes where
   * the transport last came to rest (ignoring anything done to the playhead
   * while stopped). Which one Play means is decided in the command handler
   * from what the playhead did since the transport stopped.
   */
  public startPlaying(): void {
    this.send('/live/song/start_playing');
  }
  public continuePlaying(): void {
    this.send('/live/song/continue_playing');
  }
  public stopPlaying(): void {
    this.send('/live/song/stop_playing');
  }
  public getMetronome(requireConfirmation = false): void {
    const address = '/live/song/get/metronome';
    if (this.send(address) && requireConfirmation) this.requestConfirmation(address);
  }
  public clearRequestedConfirmations(addresses?: Iterable<string>): void {
    if (!addresses) {
      this.requestedConfirmations.clear();
      return;
    }
    for (const address of addresses) this.requestedConfirmations.delete(address);
  }
  public getSignatureNumerator(): void {
    this.send('/live/song/get/signature_numerator');
  }
  public getSignatureDenominator(): void {
    this.send('/live/song/get/signature_denominator');
  }
  public getClipTriggerQuantization(): void {
    this.send('/live/song/get/clip_trigger_quantization');
  }

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
      oscBridge: this.bridge,
      oscBridgeVersion: this.bridgeVersion,
    };
  }

  public jumpToCuePoint(indexOrName: number | string): void {
    const type = typeof indexOrName === 'number' ? 'integer' : 'string';
    this.send('/live/song/cue_point/jump', [{ type, value: indexOrName }]);
  }

  /** Rename the cue at `index` in Live's chronological cue list. */
  public setCuePointName(index: number, name: string): boolean {
    return this.send('/live/song/cue_point/set/name', [
      { type: 'integer', value: index },
      { type: 'string', value: name },
    ]);
  }

  /**
   * Ask for the cue list and wait for the answer. Null when nothing came
   * back in time, which the caller must treat as "unknown", not as "empty".
   */
  public readCuePoints(timeoutMs = 1_000): Promise<{ name: string; time: number }[] | null> {
    return new Promise((resolve) => {
      const onCues = (cues: { name: string; time: number }[]) => {
        clearTimeout(timer);
        resolve(cues);
      };
      const timer = setTimeout(() => {
        this.off('cue_points', onCues);
        resolve(null);
      }, timeoutMs);
      this.once('cue_points', onCues);
      if (!this.send('/live/song/get/cue_points')) {
        clearTimeout(timer);
        this.off('cue_points', onCues);
        resolve(null);
      }
    });
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
