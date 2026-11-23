// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Slave-side peer_command deduplication, TTL checks, transportSeq ordering, and peer_ack.

import { WebSocket } from 'ws';
import type { ClientMessage } from '../types.js';
import { bridgeState } from './bridge-state.js';
import { notePeerCommand } from './peer-follow-runtime.js';
import type { PeerAckMessage, PeerAckResult } from './peer-protocol.js';
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

type SlaveCacheEntry =
  | { status: 'in_flight'; startedAt: number; latestSocket: PeerAckSocket }
  | { status: 'settled'; settledAt: number; ack: PeerAckMessage };

function defaultTransportSnapshot(): SlaveTransportSnapshot {
  const state = bridgeState.manager?.getState();
  return {
    isPlaying: state?.isPlaying ?? false,
    beat: state?.currentSongTime ?? 0,
  };
}

function sendAck(ws: PeerAckSocket, ack: PeerAckMessage): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(ack));
    return true;
  } catch {
    return false;
  }
}

function makeAck(
  commandId: string,
  result: PeerAckResult,
  reason: string,
  snapshot: SlaveTransportSnapshot,
): PeerAckMessage {
  return {
    type: 'peer_ack',
    commandId,
    result,
    reason,
    isPlaying: snapshot.isPlaying,
    beat: snapshot.beat,
  };
}

/**
 * Tracks slave command deduplication, TTL expiry, transport sequence ordering, and session resets.
 */
export class SlaveCommandTracker {
  private readonly now: () => number;
  private readonly capacity: number;
  private readonly ttlMs: number;
  private readonly getTransportSnapshot: () => SlaveTransportSnapshot;
  private readonly noteCommand: (type: string) => void;
  private readonly adoptEcho: (msg: ClientMessage) => ClientMessage;

  private readonly cache = new Map<string, SlaveCacheEntry>();
  private sessionId: string | null = null;
  private lastExecutedTransportSeq = 0;
  private generation = 0;

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
    if (nextSessionId !== this.sessionId) {
      this.sessionId = nextSessionId;
      this.lastExecutedTransportSeq = 0;
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
    const now = this.now();
    const cached = this.lookupCached(ws, msg.commandId, now);
    if (cached.hit) return Promise.resolve(cached.ack);

    const rejection = this.preExecutionRejection(msg);
    if (rejection !== null) {
      return Promise.resolve(this.settleRejected(ws, msg.commandId, rejection, now));
    }

    this.setCacheEntry(
      msg.commandId,
      { status: 'in_flight', startedAt: now, latestSocket: ws },
      now,
    );
    if (msg.transportSeq !== null && msg.transportSeq > this.lastExecutedTransportSeq) {
      this.lastExecutedTransportSeq = msg.transportSeq;
    }
    const deadlineAt = msg.ttlMs === null ? null : now + msg.ttlMs;
    return this.runAndSettle(ws, msg, executeInner, this.generation, deadlineAt);
  }

  /**
   * Clears cached command results, session id, and transport sequence state.
   */
  reset(): void {
    this.generation += 1;
    this.cache.clear();
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

  private lookupCached(
    ws: PeerAckSocket,
    commandId: string,
    now: number,
  ): { hit: true; ack: PeerAckMessage | null } | { hit: false } {
    const existing = this.cache.get(commandId);
    if (!existing) return { hit: false };
    if (existing.status === 'in_flight') {
      if (ws.readyState === WebSocket.OPEN) existing.latestSocket = ws;
      this.cache.delete(commandId);
      this.cache.set(commandId, existing);
      return { hit: true, ack: null };
    }
    if (now - existing.settledAt >= this.ttlMs) {
      this.cache.delete(commandId);
      return { hit: false };
    }
    this.cache.delete(commandId);
    this.cache.set(commandId, existing);
    sendAck(ws, existing.ack);
    return { hit: true, ack: existing.ack };
  }

  private preExecutionRejection(msg: PeerCommandEnvelope): 'superseded' | 'expired' | null {
    if (msg.transportSeq !== null && msg.transportSeq < this.lastExecutedTransportSeq) {
      return 'superseded';
    }
    if (msg.ttlMs !== null && (!Number.isFinite(msg.ttlMs) || msg.ttlMs <= 0)) {
      return 'expired';
    }
    return null;
  }

  private settleRejected(
    ws: PeerAckSocket,
    commandId: string,
    result: 'superseded' | 'expired',
    now: number,
  ): PeerAckMessage {
    const ack = makeAck(commandId, result, result, this.getTransportSnapshot());
    this.setCacheEntry(commandId, { status: 'settled', settledAt: now, ack }, now);
    sendAck(ws, ack);
    return ack;
  }

  private async runAndSettle(
    ws: PeerAckSocket,
    msg: PeerCommandEnvelope,
    executeInner: SlaveCommandExecutor,
    myGen: number,
    deadlineAt: number | null,
  ): Promise<PeerAckMessage | null> {
    let outcome: SlaveCommandExecutionResult;
    const meta: SlaveCommandExecutionMeta = {
      deadlineAt,
      isExpired: () => deadlineAt !== null && this.now() >= deadlineAt,
    };
    try {
      this.noteCommand(msg.command.type);
      const inner = this.adoptEcho({ ...msg.command, commandId: msg.commandId });
      outcome = await executeInner(inner, meta);
    } catch {
      outcome = { result: 'failed', reason: 'execution_failed' };
    }
    if (myGen !== this.generation) return null;
    const settledAt = this.now();
    const defaultReason =
      outcome.result === 'failed'
        ? 'execution_failed'
        : outcome.result === 'expired'
          ? 'expired'
          : '';
    const reason = outcome.reason ?? defaultReason;
    const ack = makeAck(msg.commandId, outcome.result, reason, this.getTransportSnapshot());
    const inFlight = this.cache.get(msg.commandId);
    const targetSocket = inFlight?.status === 'in_flight' ? inFlight.latestSocket : ws;
    this.setCacheEntry(msg.commandId, { status: 'settled', settledAt, ack }, settledAt);
    sendAck(targetSocket, ack);
    return ack;
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

/**
 * Updates the default slave tracker with the master session id announced on handshake.
 */
export function onPeerHandshakeSession(nextSessionId?: string): void {
  defaultSlaveTracker.onHandshakeSession(nextSessionId);
}

/**
 * Processes an incoming `peer_command` envelope through the default slave command tracker.
 */
export function receivePeerCommand(
  ws: PeerAckSocket,
  msg: PeerCommandEnvelope,
  executeInner: SlaveCommandExecutor,
): Promise<PeerAckMessage | null> {
  return defaultSlaveTracker.receiveCommand(ws, msg, executeInner);
}

/**
 * Resets the default slave command tracker state for server shutdown or tests.
 */
export function resetSlaveCommandState(): void {
  defaultSlaveTracker.reset();
}
