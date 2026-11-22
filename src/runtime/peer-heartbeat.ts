// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Bidirectional peer heartbeat runner, telemetry logging, and last-seen broadcaster.

import { decodePeerHb, decodePeerHbAck } from '../server/peer-client-message.js';
import type { PeerHealthReason, PeerHealthTier, PeerHealthView } from '../types.js';
import { bridgeState } from './bridge-state.js';
import { computeShownHealth, PeerHealthTracker, peerHealthTiming } from './peer-health.js';
import type { PeerLinkState } from './peer-status-list.js';

export interface PeerHbPayload {
  hbId: number;
  t0: number;
  view: PeerHealthView;
}

export interface PeerHbAckPayload {
  hbId: number;
  t0: number;
  t1: number;
  t2: number;
  view: PeerHealthView;
}

export interface PeerHeartbeatOptions {
  tracker: PeerHealthTracker;
  send: (msg: unknown) => boolean;
  getLocalView: () => PeerHealthView;
  onRemoteView: (view: PeerHealthView) => void;
  onRefresh: () => void;
  onDead: () => void;
}

export interface PeerHeartbeatSession {
  sendNow(): void;
  handleHb(msg: PeerHbPayload): void;
  handleHbAck(msg: PeerHbAckPayload): void;
  stop(): void;
}

export interface PeerHealthTransition {
  health: PeerHealthTier;
  reason: PeerHealthReason;
  rttP95Ms: number | null;
  drops5m: number;
}

export interface LastSeenEntry {
  key: string;
  lastSeenAt: number | null;
}

export interface LastSeenBroadcaster {
  sync(hasLinks: boolean): void;
}

/**
 * Reads local OSC, Ableton Live, and cue-fingerprint health signals.
 */
export function localHealthSignals(): {
  oscConnected: boolean;
  liveReady: boolean;
  cuesFingerprint: string;
} {
  const state = bridgeState.manager?.getState();
  return {
    oscConnected: bridgeState.oscClient?.isConnected === true,
    liveReady: state?.connection.ableton === 'synced',
    cuesFingerprint: state?.cuesFingerprint ?? '',
  };
}

/**
 * Returns a compact signature of local health signals to detect changes across ticks.
 */
export function localHealthViewKey(): string {
  const s = localHealthSignals();
  return `${s.oscConnected ? 1 : 0}:${s.liveReady ? 1 : 0}:${s.cuesFingerprint}`;
}

/**
 * Builds the local PeerHealthView snapshot exchanged on peer heartbeats.
 */
export function buildLocalHealthView(
  tracker: PeerHealthTracker,
  outOfStep = false,
): PeerHealthView {
  const local = tracker.localSnapshot();
  const signals = localHealthSignals();
  return {
    linkHealth: local.linkHealth,
    canAcknowledge: local.canAcknowledge,
    oscConnected: signals.oscConnected,
    liveReady: signals.liveReady,
    cuesFingerprint: signals.cuesFingerprint,
    outOfStep,
  };
}

function replyToHb(
  opts: PeerHeartbeatOptions,
  msg: PeerHbPayload,
  recordView: (viewJson: string) => void,
): void {
  const t1 = performance.now();
  opts.tracker.onHeartbeatReceived();
  opts.onRemoteView(msg.view);
  const view = opts.getLocalView();
  recordView(JSON.stringify(view));
  const t2 = performance.now();
  opts.send({ type: 'peer_hb_ack', hbId: msg.hbId, t0: msg.t0, t1, t2, view });
  opts.onRefresh();
}

/**
 * Starts a bidirectional peer heartbeat session and silence-termination monitor.
 */
export function startPeerHeartbeat(opts: PeerHeartbeatOptions): PeerHeartbeatSession {
  let stopped = false;
  let nextHbId = 0;
  let lastSentViewJson = '';
  const { heartbeatIntervalMs } = peerHealthTiming();
  const tickMs = Math.max(25, Math.min(250, Math.floor(heartbeatIntervalMs / 2)));

  const sendNow = (): void => {
    if (stopped) return;
    nextHbId += 1;
    const t0 = performance.now();
    const view = opts.getLocalView();
    lastSentViewJson = JSON.stringify(view);
    opts.tracker.onHeartbeatSent(nextHbId, t0);
    opts.send({ type: 'peer_hb', hbId: nextHbId, t0, view });
  };
  const handleHb = (msg: PeerHbPayload): void => {
    if (stopped) return;
    replyToHb(opts, msg, (viewJson) => {
      lastSentViewJson = viewJson;
    });
  };
  const handleHbAck = (msg: PeerHbAckPayload): void => {
    if (stopped) return;
    const t3 = performance.now();
    opts.tracker.onHeartbeatAck(msg.hbId, msg.t0, msg.t1, msg.t2, t3);
    opts.onRemoteView(msg.view);
    opts.onRefresh();
  };
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(hbTimer);
    clearInterval(tickTimer);
  };
  const hbTimer = setInterval(sendNow, heartbeatIntervalMs);
  hbTimer.unref?.();
  const tickTimer = setInterval(() => {
    if (stopped) return;
    if (opts.tracker.tick().shouldTerminate) {
      stop();
      opts.onDead();
      return;
    }
    opts.onRefresh();
    if (JSON.stringify(opts.getLocalView()) !== lastSentViewJson) sendNow();
  }, tickMs);
  tickTimer.unref?.();
  sendNow();
  return { sendNow, handleHb, handleHbAck, stop };
}

/**
 * Logs a peer health transition to events.log when health or reason changes.
 */
export function logPeerHealthTransition(
  peerLabel: string,
  prevKey: string,
  next: PeerHealthTransition,
): string {
  const key = `${next.health}:${next.reason}`;
  if (key !== prevKey) {
    bridgeState.eventLogger?.log({
      type: 'peer_health',
      peer: peerLabel,
      health: next.health,
      reason: next.reason,
      rttP95Ms: next.rttP95Ms,
      drops5m: next.drops5m,
      message: `peer ${peerLabel} -> ${next.health} (${next.reason})`,
    });
  }
  return key;
}

/**
 * Broadcasts lightweight peer_health lastSeenAt frames for active peer entries.
 */
export function broadcastPeerHealthLastSeen(entries: readonly LastSeenEntry[]): void {
  const serverNow = Date.now();
  for (const entry of entries) {
    if (entry.lastSeenAt === null) continue;
    bridgeState.wsServer?.broadcast({
      type: 'peer_health',
      key: entry.key,
      lastSeenAt: entry.lastSeenAt,
      serverNow,
    });
  }
}

/**
 * Evaluates merged shown health for a peer link, logs transitions, and returns a state patch.
 */
export function evaluatePeerLinkHealth(
  peerLabel: string,
  tracker: PeerHealthTracker,
  remoteView: PeerHealthView | null,
  markersMatch: boolean,
  prevLogged: string,
): { patch: Partial<PeerLinkState>; logged: string } {
  const local = tracker.localSnapshot();
  const signals = localHealthSignals();
  const shown = computeShownHealth({
    local,
    localOscConnected: signals.oscConnected,
    localLiveReady: signals.liveReady,
    localOutOfStep: false,
    markersMatch,
    remoteView,
  });
  const logged = logPeerHealthTransition(peerLabel, prevLogged, {
    health: shown.health,
    reason: shown.reason,
    rttP95Ms: local.rttP95Ms,
    drops5m: local.drops5m,
  });
  return {
    logged,
    patch: {
      markersMatch,
      health: shown.health,
      reason: shown.reason,
      canAcknowledge: shown.canAcknowledge,
      rttP95Ms: local.rttP95Ms,
      drops5m: local.drops5m,
      lastDropAt: local.lastDropAt,
      remoteLinkHealth: remoteView?.linkHealth ?? null,
    },
  };
}

/**
 * Creates a 1-second unref'd broadcaster for peer_health lastSeenAt updates.
 */
export function createLastSeenBroadcaster(
  collect: () => readonly LastSeenEntry[],
): LastSeenBroadcaster {
  let timer: NodeJS.Timeout | null = null;
  const sync = (hasLinks: boolean): void => {
    if (!hasLinks) {
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    if (timer) return;
    timer = setInterval(() => {
      const entries = collect();
      if (entries.length === 0) {
        sync(false);
        return;
      }
      broadcastPeerHealthLastSeen(entries);
    }, 1_000);
    timer.unref?.();
  };
  return { sync };
}

/**
 * Owns outbound peer health tracking, heartbeat lifecycle, and remote view state.
 */
export class PeerLinkHealth {
  readonly tracker = new PeerHealthTracker();
  private heartbeat: PeerHeartbeatSession | null = null;
  private remoteView: PeerHealthView | null = null;
  private lastRemoteFingerprint: string | null = null;
  private lastLogged = '';

  constructor(private readonly key: string) {}

  onSynchronized(opts: {
    send: (msg: unknown) => boolean;
    onRefresh: () => void;
    onDead: () => void;
  }): void {
    this.tracker.onSynchronized();
    this.heartbeat?.stop();
    this.heartbeat = startPeerHeartbeat({
      tracker: this.tracker,
      send: opts.send,
      getLocalView: () => buildLocalHealthView(this.tracker, false),
      onRemoteView: (view) => {
        const prevFp = this.remoteView?.cuesFingerprint;
        this.remoteView = view;
        if (prevFp !== view.cuesFingerprint) {
          this.lastRemoteFingerprint =
            view.cuesFingerprint.length > 0 ? view.cuesFingerprint : null;
        }
      },
      onRefresh: opts.onRefresh,
      onDead: opts.onDead,
    });
  }

  onDisconnected(wasSynchronized: boolean): void {
    this.stop();
    this.remoteView = null;
    this.lastRemoteFingerprint = null;
    this.tracker.onDisconnected(wasSynchronized);
  }

  stop(): void {
    this.heartbeat?.stop();
    this.heartbeat = null;
  }

  setRemoteFingerprint(fingerprint: string | null): void {
    this.lastRemoteFingerprint = fingerprint;
  }

  private handleHbMessage(message: Record<string, unknown>): void {
    const decoded = decodePeerHb(message);
    if (decoded.ok && decoded.message.type === 'peer_hb') {
      this.heartbeat?.handleHb(decoded.message);
    }
  }

  private handleHbAckMessage(message: Record<string, unknown>): void {
    const decoded = decodePeerHbAck(message);
    if (decoded.ok && decoded.message.type === 'peer_hb_ack') {
      this.heartbeat?.handleHbAck(decoded.message);
    }
  }

  handleMessage(message: Record<string, unknown>, onRefresh: () => void): boolean {
    if (message.type === 'peer_hb') {
      this.handleHbMessage(message);
      return true;
    }
    if (message.type === 'peer_hb_ack') {
      this.handleHbAckMessage(message);
      return true;
    }
    if (message.type === 'peer_health_ack') {
      this.tracker.acknowledge();
      this.heartbeat?.sendNow();
      onRefresh();
      return true;
    }
    return false;
  }

  acknowledge(send: (msg: unknown) => boolean, synchronized: boolean): void {
    this.tracker.acknowledge();
    if (synchronized) {
      send({ type: 'peer_health_ack' });
      this.heartbeat?.sendNow();
    }
  }

  nudge(): void {
    this.heartbeat?.sendNow();
  }

  lastSeenAt(): number | null {
    return this.tracker.localSnapshot().lastSeenAt;
  }

  computePatch(synchronized: boolean): Partial<PeerLinkState> {
    const cuesFingerprint = localHealthSignals().cuesFingerprint;
    const markersMatch = synchronized
      ? this.lastRemoteFingerprint !== null && this.lastRemoteFingerprint === cuesFingerprint
      : true;
    const { patch, logged } = evaluatePeerLinkHealth(
      this.key,
      this.tracker,
      this.remoteView,
      markersMatch,
      this.lastLogged,
    );
    this.lastLogged = logged;
    return patch;
  }
}
