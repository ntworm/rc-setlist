// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Per-link master pending command table with retries, dynamic TTL, backpressure, and alerts.

import { STALLED_SOCKET_BYTES } from './peer-message.js';
import type { PeerAckMessage, PeerCommandWire } from './peer-protocol.js';

/** Maximum number of active pending commands kept per peer link. */
export const MAX_PENDING_ENTRIES = 64;

/** Retry cadence in milliseconds for unacknowledged commands on synchronized links. */
export const RETRY_INTERVAL_MS = 150;

/** Elapsed time in milliseconds before an unacknowledged safety stop raises an alert. */
export const SAFETY_STOP_ALERT_MS = 1_000;

/** Retention window in milliseconds for recently expired commands awaiting late confirmation. */
export const RECENTLY_EXPIRED_TTL_MS = 60_000;

const MAX_RECENTLY_EXPIRED = 512;

/** Active pending command record held by `PeerPendingTable`. */
export interface PendingEntry {
  commandId: string;
  originalCommandId: string;
  commandType: string;
  wireCommand: Record<string, unknown>;
  transportSeq: number | null;
  safetyStop: boolean;
  createdAt: number;
  deadlineAt: number | null;
  lastSentAt: number;
  stopAlertSent: boolean;
  expiredReported: boolean;
}

/** Input fields required to enqueue a command into `PeerPendingTable`. */
export interface EnqueuePendingInput {
  commandId: string;
  originalCommandId: string;
  commandType: string;
  wireCommand: Record<string, unknown>;
  transportSeq: number | null;
  safetyStop: boolean;
  deadlineAt: number | null;
  createdAt?: number;
}

/** Result returned by `PeerPendingTable.enqueue`. */
export interface EnqueuePendingResult {
  entry: PendingEntry;
  evicted: PendingEntry | null;
  cancelled: PendingEntry[];
}

/** Per-tick context passed to `PeerPendingTable.collectDueSends`. */
export interface CollectDueSendsOptions {
  now?: number;
  synchronized: boolean;
  rttMs: number;
  bufferedAmount: number;
  masterIsStopped: boolean;
  masterIsPanicked: boolean;
}

/** Wire messages and alert events emitted by one `collectDueSends` tick. */
export interface CollectDueSendsResult {
  toSend: PeerCommandWire[];
  expired: PendingEntry[];
  stopAlerts: PendingEntry[];
  cancelled: PendingEntry[];
}

/** Settlement classification returned by `PeerPendingTable.onAck`. */
export type PeerPendingAckOutcome =
  | { kind: 'settled'; entry: PendingEntry; ack: PeerAckMessage }
  | { kind: 'late_confirmed'; entry: PendingEntry; ack: PeerAckMessage }
  | { kind: 'unknown' };

/** Injectable clock and eviction callback for `PeerPendingTable`. */
export interface PeerPendingTableOptions {
  now?: () => number;
  onExpired?: (entry: PendingEntry) => void;
}

/** Status values broadcast to clients in `peer_command_status` events. */
export type PeerCommandStatus =
  'pending' | 'confirmed' | 'failed' | 'expired' | 'superseded' | 'late_confirmed' | 'stop_unacked';

/** Per-computer command delivery event broadcast over WebSocket. */
export interface PeerCommandStatusEvent {
  type: 'peer_command_status';
  peerKey: string;
  host: string;
  port: number;
  commandId: string;
  peerCommandId: string;
  commandType: string;
  status: PeerCommandStatus;
  reason?: string;
}

/** Input options for constructing a `PeerCommandStatusEvent`. */
export interface BuildPeerCommandStatusOptions {
  peerKey: string;
  host: string;
  port: number;
  entry: Pick<PendingEntry, 'originalCommandId' | 'commandId' | 'commandType'>;
  status: PeerCommandStatus;
  reason?: string;
}

interface RecentlyExpiredRecord {
  entry: PendingEntry;
  expiredAt: number;
}

function isPanicRelease(entry: PendingEntry): boolean {
  return entry.commandType === 'set_panic' && entry.wireCommand.active === false;
}

function safeHalfRttMs(rttMs: number): number {
  return Number.isFinite(rttMs) && rttMs > 0 ? rttMs / 2 : 0;
}

function shouldSkipForBackpressure(
  backpressured: boolean,
  safetyStop: boolean,
  safetyUsed: boolean,
): boolean {
  if (!backpressured) return false;
  return !safetyStop || safetyUsed;
}

/**
 * Builds a `peer_command_status` WebSocket broadcast payload for a pending command entry.
 */
export function buildPeerCommandStatusEvent(
  opts: BuildPeerCommandStatusOptions,
): PeerCommandStatusEvent {
  return {
    type: 'peer_command_status',
    peerKey: opts.peerKey,
    host: opts.host,
    port: opts.port,
    commandId: opts.entry.originalCommandId,
    peerCommandId: opts.entry.commandId,
    commandType: opts.entry.commandType,
    status: opts.status,
    ...(opts.reason ? { reason: opts.reason } : {}),
  };
}

/**
 * Manages outbound unacknowledged commands for one peer link.
 */
export class PeerPendingTable {
  private readonly now: () => number;
  private readonly onExpired: ((entry: PendingEntry) => void) | undefined;
  private readonly entries = new Map<string, PendingEntry>();
  private readonly sentOnce = new Set<string>();
  private readonly recentlyExpired = new Map<string, RecentlyExpiredRecord>();

  constructor(options: PeerPendingTableOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.onExpired = options.onExpired;
  }

  /**
   * Enqueues a pending command, cancelling stale safety stops and enforcing the 64-entry cap.
   */
  enqueue(input: EnqueuePendingInput): EnqueuePendingResult {
    const createdAt = input.createdAt ?? this.now();
    const entry: PendingEntry = {
      commandId: input.commandId,
      originalCommandId: input.originalCommandId,
      commandType: input.commandType,
      wireCommand: input.wireCommand,
      transportSeq: input.transportSeq,
      safetyStop: input.safetyStop,
      createdAt,
      deadlineAt: input.deadlineAt,
      lastSentAt: 0,
      stopAlertSent: false,
      expiredReported: false,
    };

    const cancelled = this.cancelSupersededSafetyStops(entry);
    const evicted = this.ensureCapacityFor(entry, createdAt);
    if (evicted === entry) {
      return { entry, evicted, cancelled };
    }

    this.entries.set(entry.commandId, entry);
    this.sentOnce.delete(entry.commandId);
    return { entry, evicted, cancelled };
  }

  /**
   * Checks expirations and stop alerts, then builds due wire commands when synchronized.
   */
  collectDueSends(opts: CollectDueSendsOptions): CollectDueSendsResult {
    const now = opts.now ?? this.now();
    const toSend: PeerCommandWire[] = [];
    const expired: PendingEntry[] = [];
    const stopAlerts: PendingEntry[] = [];
    const cancelled: PendingEntry[] = [];

    this.pruneRecentlyExpired(now);
    for (const entry of [...this.entries.values()]) {
      this.evaluateEntryHealth(entry, opts, now, expired, stopAlerts, cancelled);
    }
    if (!opts.synchronized) return { toSend, expired, stopAlerts, cancelled };

    this.collectSynchronizedSends(opts, now, toSend, expired);
    return { toSend, expired, stopAlerts, cancelled };
  }

  /**
   * Resets send timestamps so every pending entry resends immediately after reconnect.
   */
  onReconnect(): void {
    this.sentOnce.clear();
    for (const entry of this.entries.values()) {
      entry.lastSentAt = 0;
    }
  }

  /**
   * Reconciles a slave `peer_ack` against active entries or recently expired commands.
   */
  onAck(ack: PeerAckMessage, now?: number): PeerPendingAckOutcome {
    const t = now ?? this.now();
    this.pruneRecentlyExpired(t);
    const active = this.entries.get(ack.commandId);
    if (active) {
      this.entries.delete(ack.commandId);
      this.sentOnce.delete(ack.commandId);
      return { kind: 'settled', entry: active, ack };
    }
    const expired = this.recentlyExpired.get(ack.commandId);
    if (expired) {
      this.recentlyExpired.delete(ack.commandId);
      if (ack.result === 'confirmed') {
        return { kind: 'late_confirmed', entry: expired.entry, ack };
      }
    }
    return { kind: 'unknown' };
  }

  /**
   * Returns the number of currently active pending commands.
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Reports whether a command id is currently active in the pending table.
   */
  has(commandId: string): boolean {
    return this.entries.has(commandId);
  }

  /**
   * Clears all active and recently expired command state.
   */
  clear(): void {
    this.entries.clear();
    this.sentOnce.clear();
    this.recentlyExpired.clear();
  }

  private cancelSupersededSafetyStops(incoming: PendingEntry): PendingEntry[] {
    const cancelled: PendingEntry[] = [];
    const incomingSeq = incoming.transportSeq;
    if (incoming.safetyStop && incomingSeq !== null) {
      this.cancelMatching(
        (item) => !item.safetyStop && item.transportSeq !== null && item.transportSeq < incomingSeq,
        cancelled,
      );
    } else if (
      (incoming.commandType === 'play' || incoming.commandType === 'trigger_count_in') &&
      incomingSeq !== null
    ) {
      this.cancelMatching(
        (item) =>
          item.safetyStop &&
          item.commandType === 'stop' &&
          item.transportSeq !== null &&
          item.transportSeq < incomingSeq,
        cancelled,
      );
    }
    if (isPanicRelease(incoming)) {
      this.cancelMatching((item) => item.safetyStop && item.commandType === 'set_panic', cancelled);
    }
    return cancelled;
  }

  private cancelMatching(
    predicate: (entry: PendingEntry) => boolean,
    cancelled: PendingEntry[],
  ): void {
    for (const [id, entry] of this.entries) {
      if (!predicate(entry)) continue;
      this.entries.delete(id);
      this.sentOnce.delete(id);
      cancelled.push(entry);
    }
  }

  private ensureCapacityFor(incoming: PendingEntry, now: number): PendingEntry | null {
    if (this.entries.has(incoming.commandId) || this.entries.size < MAX_PENDING_ENTRIES) {
      return null;
    }
    const victim = this.findEvictionVictim(incoming.safetyStop);
    if (!victim) {
      incoming.expiredReported = true;
      this.recordRecentlyExpired(incoming, now);
      this.onExpired?.(incoming);
      return incoming;
    }
    this.entries.delete(victim.commandId);
    this.sentOnce.delete(victim.commandId);
    victim.expiredReported = true;
    this.recordRecentlyExpired(victim, now);
    this.onExpired?.(victim);
    return victim;
  }

  private findEvictionVictim(incomingIsSafety: boolean): PendingEntry | null {
    let oldestSafety: PendingEntry | null = null;
    for (const entry of this.entries.values()) {
      if (!entry.safetyStop) return entry;
      if (oldestSafety === null) oldestSafety = entry;
    }
    return incomingIsSafety ? oldestSafety : null;
  }

  private evaluateEntryHealth(
    entry: PendingEntry,
    opts: CollectDueSendsOptions,
    now: number,
    expired: PendingEntry[],
    stopAlerts: PendingEntry[],
    cancelled: PendingEntry[],
  ): void {
    if (entry.safetyStop) {
      const stillActive =
        entry.commandType === 'set_panic' ? opts.masterIsPanicked : opts.masterIsStopped;
      if (!stillActive) {
        this.entries.delete(entry.commandId);
        this.sentOnce.delete(entry.commandId);
        cancelled.push(entry);
        return;
      }
      if (!entry.stopAlertSent && now - entry.createdAt >= SAFETY_STOP_ALERT_MS) {
        entry.stopAlertSent = true;
        stopAlerts.push(entry);
      }
      return;
    }
    if (entry.deadlineAt !== null && now >= entry.deadlineAt) {
      this.expireEntry(entry, now, expired);
    }
  }

  private orderedEntries(): PendingEntry[] {
    const safety: PendingEntry[] = [];
    const normal: PendingEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.safetyStop) safety.push(entry);
      else normal.push(entry);
    }
    return [...safety, ...normal];
  }

  private collectSynchronizedSends(
    opts: CollectDueSendsOptions,
    now: number,
    toSend: PeerCommandWire[],
    expired: PendingEntry[],
  ): void {
    const halfRttMs = safeHalfRttMs(opts.rttMs);
    const backpressured = opts.bufferedAmount >= STALLED_SOCKET_BYTES;
    let safetyUsed = false;

    for (const entry of this.orderedEntries()) {
      if (!this.isEntryDue(entry, now)) continue;
      if (shouldSkipForBackpressure(backpressured, entry.safetyStop, safetyUsed)) continue;
      const ttlMs = this.computeWireTtl(entry, now, halfRttMs);
      if (ttlMs === 'expired') {
        this.expireEntry(entry, now, expired);
        continue;
      }
      entry.lastSentAt = now;
      this.sentOnce.add(entry.commandId);
      if (backpressured && entry.safetyStop) safetyUsed = true;
      toSend.push({
        type: 'peer_command',
        commandId: entry.commandId,
        ttlMs,
        transportSeq: entry.transportSeq,
        command: entry.wireCommand,
      });
    }
  }

  private isEntryDue(entry: PendingEntry, now: number): boolean {
    if (!this.sentOnce.has(entry.commandId)) return true;
    return now - entry.lastSentAt >= RETRY_INTERVAL_MS;
  }

  private computeWireTtl(
    entry: PendingEntry,
    now: number,
    halfRttMs: number,
  ): number | null | 'expired' {
    if (entry.deadlineAt === null) return null;
    const remaining = entry.deadlineAt - now - halfRttMs;
    if (remaining <= 0) return 'expired';
    return Math.max(1, Math.round(remaining));
  }

  private expireEntry(entry: PendingEntry, now: number, expired: PendingEntry[]): void {
    this.entries.delete(entry.commandId);
    this.sentOnce.delete(entry.commandId);
    entry.expiredReported = true;
    this.recordRecentlyExpired(entry, now);
    expired.push(entry);
  }

  private pruneRecentlyExpired(now: number): void {
    for (const [id, record] of this.recentlyExpired) {
      if (now - record.expiredAt >= RECENTLY_EXPIRED_TTL_MS) {
        this.recentlyExpired.delete(id);
      }
    }
  }

  private recordRecentlyExpired(entry: PendingEntry, now: number): void {
    this.pruneRecentlyExpired(now);
    if (this.recentlyExpired.size >= MAX_RECENTLY_EXPIRED) {
      const oldest = this.recentlyExpired.keys().next().value;
      if (oldest !== undefined) this.recentlyExpired.delete(oldest);
    }
    this.recentlyExpired.set(entry.commandId, { entry, expiredAt: now });
  }
}
