// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Pure injectable peer link health state machine and symmetric status view.

import type { PeerHealthReason, PeerHealthTier, PeerHealthView } from '../types.js';

/**
 * Tunable timing thresholds for peer link health evaluation.
 */
export interface PeerHealthTiming {
  heartbeatIntervalMs: number;
  heartbeatLostMs: number;
  heartbeatDownMs: number;
  warmupCleanMs: number;
  unstableCleanMs: number;
  ackCleanMs: number;
  rttWindowMs: number;
  rttP95ThresholdMs: number;
  dropWindowMs: number;
  penaltyDropsThreshold: number;
  penaltyHoldMs: number;
}

const DEFAULT_TIMING: PeerHealthTiming = {
  heartbeatIntervalMs: 500,
  heartbeatLostMs: 1_500,
  heartbeatDownMs: 3_000,
  warmupCleanMs: 20_000,
  unstableCleanMs: 60_000,
  ackCleanMs: 10_000,
  rttWindowMs: 60_000,
  rttP95ThresholdMs: 150,
  dropWindowMs: 300_000,
  penaltyDropsThreshold: 3,
  penaltyHoldMs: 300_000,
};

let currentTiming: PeerHealthTiming = { ...DEFAULT_TIMING };

/**
 * Returns the active peer health timing thresholds.
 */
export function peerHealthTiming(): PeerHealthTiming {
  return currentTiming;
}

/**
 * Overrides one or more peer health timing thresholds.
 */
export function setPeerHealthTiming(next: Partial<PeerHealthTiming>): void {
  currentTiming = { ...currentTiming, ...next };
}

/**
 * Restores peer health timing thresholds to their default values.
 */
export function resetPeerHealthTiming(): void {
  currentTiming = { ...DEFAULT_TIMING };
}

/**
 * Local link health snapshot produced by `PeerHealthTracker`.
 */
export interface LocalHealthSnapshot {
  linkHealth: PeerHealthTier;
  linkReason: PeerHealthReason;
  canAcknowledge: boolean;
  rttP95Ms: number | null;
  drops5m: number;
  lastDropAt: number | null;
  lastSeenAt: number | null;
}

/**
 * Combined local and remote inputs used to compute the shown link health.
 */
export interface ShownHealthInput {
  local: LocalHealthSnapshot;
  localOscConnected: boolean;
  localLiveReady: boolean;
  localOutOfStep: boolean;
  markersMatch: boolean;
  remoteView: PeerHealthView | null;
}

/**
 * Effective link health shown to the operator after merging local and remote signals.
 */
export interface ShownHealthSnapshot {
  health: PeerHealthTier;
  reason: PeerHealthReason;
  canAcknowledge: boolean;
}

/**
 * Injectable clocks and timing source for `PeerHealthTracker`.
 */
export interface PeerHealthTrackerOptions {
  now?: () => number;
  wallNow?: () => number;
  timing?: () => PeerHealthTiming;
}

interface PendingHeartbeat {
  hbId: number;
  sentAt: number;
  t0: number;
  markedLost: boolean;
}

interface DropRecord {
  monoAt: number;
  wallAt: number;
}

interface RttSample {
  at: number;
  rtt: number;
}

interface LinkStateResult {
  linkHealth: PeerHealthTier;
  linkReason: PeerHealthReason;
  canAcknowledge: boolean;
}

/**
 * Tracks monotonic peer link health, RTT p95, drop penalties, and operator acknowledgements.
 */
export class PeerHealthTracker {
  private readonly now: () => number;
  private readonly wallNow: () => number;
  private readonly timing: () => PeerHealthTiming;

  private synchronized = false;
  private hasEverSynchronized = false;
  private warmupActive = false;
  private warmupStartAt = 0;
  private lastAckAt = 0;
  private lastSeenAt: number | null = null;
  private lastDropAt: number | null = null;
  private lastBadEventAt: number | null = null;
  private lastBadReason: PeerHealthReason = 'ok';
  private ackWatermark = Number.NEGATIVE_INFINITY;
  private ackActive = false;
  private penaltyUntil = Number.NEGATIVE_INFINITY;

  private readonly pendingHeartbeats = new Map<number, PendingHeartbeat>();
  private drops: DropRecord[] = [];
  private rttSamples: RttSample[] = [];

  constructor(options: PeerHealthTrackerOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.wallNow = options.wallNow ?? Date.now;
    this.timing = options.timing ?? peerHealthTiming;
  }

  /**
   * Marks the link as synchronized and starts the initial cold-start warmup once.
   */
  onSynchronized(): void {
    const t = this.now();
    const wasSynchronized = this.synchronized;
    this.synchronized = true;
    this.lastAckAt = t;
    this.lastSeenAt = this.wallNow();
    this.pendingHeartbeats.clear();
    if (!this.hasEverSynchronized) {
      this.hasEverSynchronized = true;
      this.warmupActive = true;
      this.warmupStartAt = t;
    } else if (!wasSynchronized) {
      // Time spent down is not clean time: reconnecting after any outage must
      // hold unstable for a full clean window instead of flashing green.
      this.recordBadEvent(t, 'recent_drop');
    }
  }

  /**
   * Marks the link down and counts a drop only when transitioning out of a synchronized session.
   */
  onDisconnected(wasSynchronized: boolean): boolean {
    return this.disconnectAt(wasSynchronized, this.now());
  }

  /**
   * Records a drop when an inbound socket supersedes an already synchronized session.
   */
  onSuperseded(): void {
    if (!this.synchronized) return;
    const t = this.now();
    const wall = this.wallNow();
    this.recordDrop(t, wall);
    this.pendingHeartbeats.clear();
    this.lastAckAt = t;
    this.lastSeenAt = wall;
  }

  /**
   * Records an outbound heartbeat waiting for its acknowledgement.
   */
  onHeartbeatSent(hbId: number, t0: number): void {
    this.pendingHeartbeats.set(hbId, {
      hbId,
      sentAt: this.now(),
      t0,
      markedLost: false,
    });
  }

  /**
   * Records a heartbeat acknowledgement, updates RTT p95, and returns the clamped RTT in ms.
   */
  onHeartbeatAck(hbId: number, t0: number, t1: number, t2: number, t3: number): number {
    const t = this.now();
    const cfg = this.timing();
    const elapsed = t3 - t0;
    const remoteProc = t2 - t1;
    const rtt = Math.max(0, elapsed - remoteProc);

    this.pendingHeartbeats.delete(hbId);
    this.rttSamples.push({ at: t, rtt });
    this.pruneRttSamples(t, cfg);
    this.lastAckAt = t;
    this.lastSeenAt = this.wallNow();

    const rawP95 = this.computeRawRttP95(t, cfg);
    if (rawP95 !== null && rawP95 > cfg.rttP95ThresholdMs) {
      this.recordBadEvent(t, 'high_rtt');
    }
    return rtt;
  }

  /**
   * Refreshes the wall-clock timestamp when a heartbeat frame is received from the peer.
   */
  onHeartbeatReceived(): void {
    this.lastSeenAt = this.wallNow();
  }

  /**
   * Advances lost-heartbeat detection and reports whether silence exceeded the down threshold.
   */
  tick(): { shouldTerminate: boolean } {
    if (!this.synchronized) return { shouldTerminate: false };
    const t = this.now();
    const cfg = this.timing();
    const staleLimit = cfg.heartbeatDownMs * 2;

    for (const [hbId, entry] of this.pendingHeartbeats) {
      const age = t - entry.sentAt;
      if (!entry.markedLost && age >= cfg.heartbeatLostMs) {
        entry.markedLost = true;
        this.recordBadEvent(t, 'heartbeat_lost');
      }
      if (age > staleLimit) {
        this.pendingHeartbeats.delete(hbId);
      }
    }

    if (t - this.lastAckAt >= cfg.heartbeatDownMs) {
      this.disconnectAt(true, t);
      return { shouldTerminate: true };
    }
    return { shouldTerminate: false };
  }

  /**
   * Accepts an operator acknowledgement when eligible and starts the shortened recovery window.
   */
  acknowledge(): boolean {
    const t = this.now();
    const snap = this.snapshotAt(t);
    if (!snap.canAcknowledge) return false;
    this.ackWatermark = t;
    this.ackActive = true;
    this.rttSamples = [];
    return true;
  }

  /**
   * Computes the current local health snapshot for this link.
   */
  localSnapshot(): LocalHealthSnapshot {
    return this.snapshotAt(this.now());
  }

  private disconnectAt(wasSynchronized: boolean, t: number): boolean {
    const counted = wasSynchronized && this.synchronized;
    this.synchronized = false;
    this.pendingHeartbeats.clear();
    if (counted) {
      this.recordDrop(t, this.wallNow());
    }
    return counted;
  }

  private recordDrop(t: number, wallAt: number): void {
    const cfg = this.timing();
    this.drops.push({ monoAt: t, wallAt });
    this.lastDropAt = wallAt;
    this.recordBadEvent(t, 'recent_drop');
    this.pruneDrops(t, cfg);
    if (this.drops.length >= cfg.penaltyDropsThreshold) {
      this.penaltyUntil = t + cfg.penaltyHoldMs;
    }
  }

  private recordBadEvent(t: number, reason: PeerHealthReason): void {
    // The cold-start warm-up is independent of bad events: it is never shortened by them.
    this.ackActive = false;
    this.lastBadEventAt = t;
    this.lastBadReason = reason;
  }

  private pruneDrops(t: number, cfg: PeerHealthTiming): void {
    const cutoff = t - cfg.dropWindowMs;
    this.drops = this.drops.filter((drop) => drop.monoAt >= cutoff);
  }

  private pruneRttSamples(t: number, cfg: PeerHealthTiming): void {
    const cutoff = t - cfg.rttWindowMs;
    this.rttSamples = this.rttSamples.filter((sample) => sample.at >= cutoff);
  }

  private computeRawRttP95(t: number, cfg: PeerHealthTiming): number | null {
    const floor = Math.max(t - cfg.rttWindowMs, this.ackWatermark);
    const values: number[] = [];
    for (const sample of this.rttSamples) {
      if (sample.at >= floor) values.push(sample.rtt);
    }
    if (values.length === 0) return null;
    values.sort((a, b) => a - b);
    const index = Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1);
    return values[index] ?? null;
  }

  private snapshotAt(t: number): LocalHealthSnapshot {
    const cfg = this.timing();
    this.pruneDrops(t, cfg);
    this.pruneRttSamples(t, cfg);
    const rawP95 = this.computeRawRttP95(t, cfg);
    const rttP95Ms = rawP95 === null ? null : Math.round(rawP95 / 10) * 10;
    const state = this.evaluateLinkState(t, cfg);
    return {
      linkHealth: state.linkHealth,
      linkReason: state.linkReason,
      canAcknowledge: state.canAcknowledge,
      rttP95Ms,
      drops5m: this.drops.length,
      lastDropAt: this.lastDropAt,
      lastSeenAt: this.lastSeenAt,
    };
  }

  private evaluateLinkState(t: number, cfg: PeerHealthTiming): LinkStateResult {
    if (!this.synchronized) {
      return { linkHealth: 'down', linkReason: 'link_down', canAcknowledge: false };
    }
    if (t < this.penaltyUntil) {
      return { linkHealth: 'unstable', linkReason: 'link_oscillating', canAcknowledge: false };
    }
    if (this.warmupActive) {
      if (t - this.warmupStartAt < cfg.warmupCleanMs) {
        return { linkHealth: 'unstable', linkReason: 'warming_up', canAcknowledge: false };
      }
      this.warmupActive = false;
    }
    return this.evaluateBadEventLatch(t, cfg);
  }

  private evaluateBadEventLatch(t: number, cfg: PeerHealthTiming): LinkStateResult {
    if (this.lastBadEventAt === null) {
      return { linkHealth: 'ok', linkReason: 'ok', canAcknowledge: false };
    }
    const anchor = this.ackActive ? this.ackWatermark : this.lastBadEventAt;
    const required = this.ackActive ? cfg.ackCleanMs : cfg.unstableCleanMs;
    if (t - anchor < required) {
      return {
        linkHealth: 'unstable',
        linkReason: this.lastBadReason,
        canAcknowledge: !this.ackActive,
      };
    }
    this.ackActive = false;
    this.lastBadEventAt = null;
    return { linkHealth: 'ok', linkReason: 'ok', canAcknowledge: false };
  }
}

function isRemoteOscUnready(remote: PeerHealthView | null): boolean {
  return remote !== null && (!remote.oscConnected || !remote.liveReady);
}

function isLocalAckBlocked(reason: PeerHealthReason): boolean {
  return reason === 'link_oscillating' || reason === 'warming_up';
}

function downReason(input: ShownHealthInput): PeerHealthReason | null {
  if (input.local.linkHealth === 'down') return 'link_down';
  if (input.remoteView?.linkHealth === 'down') return 'remote_link_down';
  if (!input.localOscConnected || !input.localLiveReady) return 'local_osc_live_unready';
  if (isRemoteOscUnready(input.remoteView)) return 'remote_osc_live_unready';
  return null;
}

function unstableReason(input: ShownHealthInput): PeerHealthReason | null {
  if (input.local.linkHealth === 'unstable') return input.local.linkReason;
  if (input.remoteView?.linkHealth === 'unstable') return 'remote_unstable';
  if (!input.markersMatch) return 'markers_differ';
  if (input.localOutOfStep || input.remoteView?.outOfStep === true) return 'out_of_step';
  return null;
}

/**
 * Combines local and remote health inputs into the symmetric shown peer status.
 */
export function computeShownHealth(input: ShownHealthInput): ShownHealthSnapshot {
  const down = downReason(input);
  if (down !== null) {
    return { health: 'down', reason: down, canAcknowledge: false };
  }
  const unstable = unstableReason(input);
  if (unstable !== null) {
    const ackBlocked = isLocalAckBlocked(input.local.linkReason);
    const ackAllowed = input.local.canAcknowledge || input.remoteView?.canAcknowledge === true;
    return { health: 'unstable', reason: unstable, canAcknowledge: !ackBlocked && ackAllowed };
  }
  return { health: 'ok', reason: 'ok', canAcknowledge: false };
}
