// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Slave-side peer_command deduplication, TTL checks, transportSeq ordering, and peer_ack.

import { WebSocket } from 'ws';
import type { ClientMessage } from '../types.js';
import { bridgeState } from './bridge-state.js';
import { notePeerCommand } from './peer-follow-runtime.js';
import { peerCommandId } from './peer-message.js';
import {
  addDirectWaiter,
  isSafetyStopCommand,
  isTransportCommandType,
  makeDirectAck,
  makePeerAck,
  pruneTimedIds,
  recordTimedId,
  sendPeerFrame,
  type ConfirmedDirectSummary,
  type DirectAckMessage,
  type DirectCommandMessage,
  type DirectSyncListener,
  type DirectWaiter,
  type PeerAckMessage,
} from './peer-protocol.js';
import { adoptUpstreamEcho } from './peer-upstream.js';

/** Maximum number of outer command IDs retained in the slave dedupe LRU cache. */
export const SLAVE_COMMAND_CACHE_CAPACITY = 512;

/** Retention window in milliseconds for settled slave command acknowledgements. */
export const SLAVE_COMMAND_CACHE_TTL_MS = 10 * 60_000;

/** Local transport snapshot attached to slave `peer_ack` frames. */
export interface SlaveTransportSnapshot {
  isPlaying: boolean;
  beat: number;
}

/** Settlement result returned by the local command pipeline executor. */
export interface SlaveCommandExecutionResult {
  result: 'confirmed' | 'failed' | 'expired';
  reason?: string;
}

/** Deadline metadata passed to the local command executor to detect queue-wait TTL expiry. */
export interface SlaveCommandExecutionMeta {
  readonly deadlineAt: number | null;
  isExpired(): boolean;
}

/** Executor invoked once per accepted slave peer command. */
export type SlaveCommandExecutor = (
  inner: ClientMessage,
  meta?: SlaveCommandExecutionMeta,
) => SlaveCommandExecutionResult | Promise<SlaveCommandExecutionResult>;

/** Minimal WebSocket surface required to transmit `peer_ack` frames. */
export interface PeerAckSocket {
  readyState: number;
  send(data: string): void;
}

/** Incoming `peer_command` envelope received from the master. */
export interface PeerCommandEnvelope {
  type: 'peer_command';
  commandId: string;
  ttlMs: number | null;
  transportSeq: number | null;
  command: ClientMessage;
}

/** Injectable hooks and cache limits for `SlaveCommandTracker`. */
export interface SlaveCommandTrackerOptions {
  now?: () => number;
  capacity?: number;
  ttlMs?: number;
  getTransportSnapshot?: () => SlaveTransportSnapshot;
  noteCommand?: (type: string) => void;
  adoptEcho?: (msg: ClientMessage) => ClientMessage;
}

/** Diagnostic snapshot of slave session and dedupe cache state. */
export interface SlaveSessionSnapshot {
  sessionId: string | null;
  lastExecutedTransportSeq: number;
  cacheSize: number;
}

type SeqAdvance = { prevSeq: number; appliedSeq: number };
type RunOrigin = {
  origin: 'peer' | 'direct';
  ws: PeerAckSocket;
  id: string;
  rawId: string;
  cmd: { type: string; active?: unknown };
};
type SlaveCacheEntry =
  | {
      status: 'in_flight';
      startedAt: number;
      latestPeerSocket: PeerAckSocket | null;
      directWaiters: DirectWaiter<PeerAckSocket>[];
    }
  | { status: 'settled'; settledAt: number; ack: PeerAckMessage };

function defaultTransportSnapshot(): SlaveTransportSnapshot {
  const state = bridgeState.manager?.getState();
  return { isPlaying: state?.isPlaying ?? false, beat: state?.currentSongTime ?? 0 };
}

/** Tracks slave command deduplication, TTL expiry, transportSeq ordering, and dual-path fan-out. */
export class SlaveCommandTracker {
  private readonly now: () => number;
  private readonly capacity: number;
  private readonly ttlMs: number;
  private readonly getTransportSnapshot: () => SlaveTransportSnapshot;
  private readonly noteCommand: (type: string) => void;
  private readonly adoptEcho: (msg: ClientMessage) => ClientMessage;

  private readonly cache = new Map<string, SlaveCacheEntry>();
  private readonly confirmedDirectIds = new Map<string, number>();
  private sessionId: string | null = null;
  private sessionEpoch = 0;
  private lastExecutedTransportSeq = 0;
  private generation = 0;
  private directSyncListener: DirectSyncListener | null = null;

  constructor(options: SlaveCommandTrackerOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.capacity = options.capacity ?? SLAVE_COMMAND_CACHE_CAPACITY;
    this.ttlMs = options.ttlMs ?? SLAVE_COMMAND_CACHE_TTL_MS;
    this.getTransportSnapshot = options.getTransportSnapshot ?? defaultTransportSnapshot;
    this.noteCommand = options.noteCommand ?? notePeerCommand;
    this.adoptEcho = options.adoptEcho ?? adoptUpstreamEcho;
  }

  /**
   * Updates the active master session id and resets transport sequence tracking on session change.
   */
  onHandshakeSession(nextSessionId?: string): void {
    if (!nextSessionId) return;
    if (this.sessionId === null) {
      this.sessionId = nextSessionId;
      return;
    }
    if (nextSessionId !== this.sessionId) {
      this.sessionId = nextSessionId;
      this.sessionEpoch += 1;
      this.lastExecutedTransportSeq = 0;
      this.confirmedDirectIds.clear();
    }
  }

  /**
   * Handles a `peer_command` envelope with dedupe, sequence ordering, TTL checks, and `peer_ack`.
   */
  receiveCommand(
    ws: PeerAckSocket,
    msg: PeerCommandEnvelope,
    executeInner: SlaveCommandExecutor,
  ): Promise<PeerAckMessage | null> {
    const run: RunOrigin = {
      origin: 'peer',
      ws,
      id: msg.commandId,
      rawId: msg.commandId,
      cmd: msg.command,
    };
    return this.dispatch(run, msg.command, msg.transportSeq, msg.ttlMs, executeInner).then(
      (r) => r?.ack ?? null,
    );
  }

  /** Handles a `direct`-role transport command with canonical dedupe, TTL, and `direct_ack`. */
  receiveDirectCommand(
    ws: PeerAckSocket,
    msg: DirectCommandMessage,
    executeInner: SlaveCommandExecutor,
  ): Promise<DirectAckMessage | null> {
    const id = peerCommandId(msg.commandId);
    const { ttlMs: _t, transportSeq: _s, ...rest } = msg;
    const run: RunOrigin = { origin: 'direct', ws, id, rawId: msg.commandId, cmd: msg };
    const p = this.dispatch(
      run,
      { ...rest, commandId: id },
      msg.transportSeq ?? null,
      msg.ttlMs ?? null,
      executeInner,
    );
    return p.then((r) => (r ? makeDirectAck(msg.commandId, id, r.ack, r.seq) : null));
  }

  /** Registers or clears the listener notified when confirmed direct commands need sync. */
  setDirectSyncListener(listener: DirectSyncListener | null): void {
    this.directSyncListener = listener;
  }

  /** Returns non-expired confirmed direct command IDs and highest executed transportSeq. */
  getConfirmedDirectSummary(): ConfirmedDirectSummary {
    pruneTimedIds(this.confirmedDirectIds, this.now(), this.ttlMs);
    return {
      confirmedIds: [...this.confirmedDirectIds.keys()],
      lastExecutedTransportSeq: this.lastExecutedTransportSeq,
    };
  }

  /** Returns the highest executed transport sequence number on this slave. */
  getLastExecutedTransportSeq(): number {
    return this.lastExecutedTransportSeq;
  }

  /**
   * Clears cached command results, session id, and transport sequence state.
   */
  reset(): void {
    this.generation += 1;
    this.sessionEpoch += 1;
    this.cache.clear();
    this.confirmedDirectIds.clear();
    this.sessionId = null;
    this.lastExecutedTransportSeq = 0;
  }

  /**
   * Returns the current session id, highest accepted transportSeq, and cache entry count.
   */
  getSessionState(): SlaveSessionSnapshot {
    return {
      sessionId: this.sessionId,
      lastExecutedTransportSeq: this.lastExecutedTransportSeq,
      cacheSize: this.cache.size,
    };
  }

  private dispatch(
    run: RunOrigin,
    inner: ClientMessage,
    seq: number | null,
    ttlMs: number | null,
    executeInner: SlaveCommandExecutor,
  ): Promise<{ ack: PeerAckMessage; seq: number } | null> {
    const now = this.now();
    const cached = this.lookupCached(run, now);
    if (cached.hit) return Promise.resolve(cached.res);
    const rej = this.preExecutionRejection(run.cmd, seq, ttlMs);
    if (rej !== null) {
      const ack = makePeerAck(run.id, rej, rej, this.getTransportSnapshot());
      this.setCacheEntry(run.id, { status: 'settled', settledAt: now, ack }, now);
      return Promise.resolve({ ack, seq: this.replySingle(run, ack) });
    }
    const directWaiters: DirectWaiter<PeerAckSocket>[] = [];
    if (run.origin === 'direct') addDirectWaiter(directWaiters, run.ws, run.rawId);
    const latestPeerSocket = run.origin === 'peer' ? run.ws : null;
    this.setCacheEntry(
      run.id,
      { status: 'in_flight', startedAt: now, latestPeerSocket, directWaiters },
      now,
    );
    const seqChange = this.advanceSeq(run.cmd, seq);
    return this.runAndSettle(
      run,
      inner,
      executeInner,
      ttlMs === null ? null : now + ttlMs,
      seqChange,
    );
  }

  private replySingle(run: RunOrigin, ack: PeerAckMessage): number {
    const seq = this.lastExecutedTransportSeq;
    sendPeerFrame(run.ws, run.origin === 'peer' ? ack : makeDirectAck(run.rawId, run.id, ack, seq));
    return seq;
  }

  private lookupCached(
    run: RunOrigin,
    now: number,
  ): { hit: true; res: { ack: PeerAckMessage; seq: number } | null } | { hit: false } {
    const existing = this.cache.get(run.id);
    if (!existing) return { hit: false };
    if (existing.status === 'in_flight') {
      if (run.origin === 'peer') {
        if (run.ws.readyState === WebSocket.OPEN) existing.latestPeerSocket = run.ws;
      } else addDirectWaiter(existing.directWaiters, run.ws, run.rawId);
      this.cache.delete(run.id);
      this.cache.set(run.id, existing);
      return { hit: true, res: null };
    }
    if (now - existing.settledAt >= this.ttlMs) {
      this.cache.delete(run.id);
      return { hit: false };
    }
    this.cache.delete(run.id);
    this.cache.set(run.id, existing);
    const seq = this.replySingle(run, existing.ack);
    if (run.origin === 'direct' && existing.ack.result === 'confirmed')
      this.recordConfirmedDirect(run.id, now);
    return { hit: true, res: { ack: existing.ack, seq } };
  }

  private preExecutionRejection(
    cmd: { type: string; active?: unknown },
    seq: number | null,
    ttlMs: number | null,
  ): 'superseded' | 'expired' | null {
    if (seq !== null) {
      const nonSafety = isTransportCommandType(cmd) && !isSafetyStopCommand(cmd);
      if (nonSafety ? seq <= this.lastExecutedTransportSeq : seq < this.lastExecutedTransportSeq)
        return 'superseded';
    }
    return ttlMs !== null && (!Number.isFinite(ttlMs) || ttlMs <= 0) ? 'expired' : null;
  }

  private advanceSeq(
    cmd: { type: string; active?: unknown },
    seq: number | null,
  ): SeqAdvance | null {
    const prevSeq = this.lastExecutedTransportSeq;
    const higher = seq !== null && seq > prevSeq ? seq : null;
    const appliedSeq = higher ?? (isSafetyStopCommand(cmd) ? prevSeq + 1 : null);
    if (appliedSeq === null) return null;
    this.lastExecutedTransportSeq = appliedSeq;
    return { prevSeq, appliedSeq };
  }

  private async runAndSettle(
    run: RunOrigin,
    inner: ClientMessage,
    executeInner: SlaveCommandExecutor,
    deadlineAt: number | null,
    seqChange: SeqAdvance | null,
  ): Promise<{ ack: PeerAckMessage; seq: number } | null> {
    const [myGen, epoch] = [this.generation, this.sessionEpoch];
    let outcome: SlaveCommandExecutionResult;
    const meta: SlaveCommandExecutionMeta = {
      deadlineAt,
      isExpired: () => deadlineAt !== null && this.now() >= deadlineAt,
    };
    try {
      this.noteCommand(run.cmd.type);
      const execMsg =
        run.origin === 'peer' ? this.adoptEcho({ ...inner, commandId: run.id }) : inner;
      outcome = await executeInner(execMsg, meta);
    } catch {
      outcome = { result: 'failed', reason: 'execution_failed' };
    }
    if (myGen !== this.generation) return null;
    const def =
      outcome.result === 'confirmed'
        ? ''
        : outcome.result === 'expired'
          ? 'expired'
          : 'execution_failed';
    const ack = makePeerAck(
      run.id,
      outcome.result,
      outcome.reason ?? def,
      this.getTransportSnapshot(),
    );
    const seq = this.commitAndFanOut(run, outcome.result, ack, epoch, seqChange);
    return { ack, seq };
  }

  private resolveTargets(run: RunOrigin): {
    peerWs: PeerAckSocket | null;
    waiters: DirectWaiter<PeerAckSocket>[];
  } {
    const cur = this.cache.get(run.id);
    if (cur?.status === 'in_flight')
      return { peerWs: cur.latestPeerSocket, waiters: cur.directWaiters };
    return {
      peerWs: run.origin === 'peer' ? run.ws : null,
      waiters: run.origin === 'direct' ? [{ ws: run.ws, rawCommandId: run.rawId }] : [],
    };
  }

  private rollbackSeq(epoch: number, seqChange: SeqAdvance | null): void {
    if (
      seqChange &&
      this.sessionEpoch === epoch &&
      this.lastExecutedTransportSeq === seqChange.appliedSeq
    ) {
      this.lastExecutedTransportSeq = seqChange.prevSeq;
    }
  }

  private commitAndFanOut(
    run: RunOrigin,
    result: SlaveCommandExecutionResult['result'],
    ack: PeerAckMessage,
    epoch: number,
    seqChange: SeqAdvance | null,
  ): number {
    const settledAt = this.now();
    const { peerWs, waiters } = this.resolveTargets(run);
    if (result !== 'confirmed' && isSafetyStopCommand(run.cmd)) {
      this.cache.delete(run.id);
      this.rollbackSeq(epoch, seqChange);
    } else this.setCacheEntry(run.id, { status: 'settled', settledAt, ack }, settledAt);
    if (peerWs) sendPeerFrame(peerWs, ack);
    const seq = this.lastExecutedTransportSeq;
    for (const w of waiters) sendPeerFrame(w.ws, makeDirectAck(w.rawCommandId, run.id, ack, seq));
    if (result === 'confirmed' && (run.origin === 'direct' || waiters.length > 0))
      this.recordConfirmedDirect(run.id, settledAt);
    return seq;
  }

  private recordConfirmedDirect(id: string, now: number): void {
    recordTimedId(this.confirmedDirectIds, id, now, this.ttlMs, this.capacity);
    try {
      this.directSyncListener?.(id);
    } catch {
      // Listener errors must never block command settlement.
    }
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.cache) {
      if (entry.status === 'settled' && now - entry.settledAt >= this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  private evictIfFull(commandId: string, now: number): void {
    if (this.cache.has(commandId)) return;
    this.pruneExpired(now);
    while (this.cache.size >= this.capacity) {
      const victim = this.oldestEvictableKey();
      if (victim === undefined) break;
      this.cache.delete(victim);
    }
  }

  private oldestEvictableKey(): string | undefined {
    let fallback: string | undefined;
    for (const [key, entry] of this.cache) {
      if (fallback === undefined) fallback = key;
      if (entry.status === 'settled') return key;
    }
    return fallback;
  }

  private setCacheEntry(commandId: string, entry: SlaveCacheEntry, now: number): void {
    this.evictIfFull(commandId, now);
    this.cache.delete(commandId);
    this.cache.set(commandId, entry);
  }
}

const defaultSlaveTracker = new SlaveCommandTracker();

/** Updates the default slave tracker with the master session id announced on handshake. */
export function onPeerHandshakeSession(nextSessionId?: string): void {
  defaultSlaveTracker.onHandshakeSession(nextSessionId);
}

/** Processes an incoming `peer_command` envelope through the default slave command tracker. */
export function receivePeerCommand(
  ws: PeerAckSocket,
  msg: PeerCommandEnvelope,
  executeInner: SlaveCommandExecutor,
): Promise<PeerAckMessage | null> {
  return defaultSlaveTracker.receiveCommand(ws, msg, executeInner);
}

/** Processes an incoming `direct`-role command through the default slave command tracker. */
export function receiveDirectCommand(
  ws: PeerAckSocket,
  msg: DirectCommandMessage,
  executeInner: SlaveCommandExecutor,
): Promise<DirectAckMessage | null> {
  return defaultSlaveTracker.receiveDirectCommand(ws, msg, executeInner);
}

/** Registers or clears the listener notified when confirmed direct commands need master sync. */
export function setDirectSyncListener(listener: DirectSyncListener | null): void {
  defaultSlaveTracker.setDirectSyncListener(listener);
}

/** Returns confirmed direct command IDs and highest executed transportSeq on this slave. */
export function getConfirmedDirectSummary(): ConfirmedDirectSummary {
  return defaultSlaveTracker.getConfirmedDirectSummary();
}

/** Returns the highest executed transportSeq on this slave. */
export function getLastExecutedTransportSeq(): number {
  return defaultSlaveTracker.getLastExecutedTransportSeq();
}

/**
 * Resets the default slave command tracker state for server shutdown or tests.
 */
export function resetSlaveCommandState(): void {
  defaultSlaveTracker.reset();
}
