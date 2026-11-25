// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Slave-side single inbound peer health record with socket-generation guard.

import { WebSocket } from 'ws';
import { readPeerConfigs, readSlaveRole } from '../preferences.js';
import type { AugmentedWebSocket, ClientMessage, PeerHealthView } from '../types.js';
import { bridgeState, broadcastState } from './bridge-state.js';
import { isPeerOutOfStep, resetPeerFollowRuntime } from './peer-follow-runtime.js';
import { PeerHealthTracker } from './peer-health.js';
import {
  buildLocalHealthView,
  evaluatePeerLinkHealth,
  localHealthSignals,
  startPeerHeartbeat,
  type LastSeenEntry,
  type PeerHeartbeatSession,
} from './peer-heartbeat.js';
import { STALLED_SOCKET_BYTES } from './peer-message.js';
import {
  getConfirmedDirectSummary,
  getLastExecutedTransportSeq,
  setDirectSyncListener,
} from './peer-slave-commands.js';
import type { PeerLinkSummary } from './peer-status-list.js';

/** Synthetic row key for the inbound master link on a slave computer. */
export const INBOUND_PEER_KEY = 'inbound:master';
const DEFAULT_INBOUND_PORT = 4444;
const DIRECT_SYNC_CHUNK_SIZE = 64;

let generation = 0;
let activeSocket: AugmentedWebSocket | null = null;
let tracker: PeerHealthTracker | null = null;
let heartbeat: PeerHeartbeatSession | null = null;
let remoteView: PeerHealthView | null = null;
let synchronized = false;
let versionMismatch = false;
let lastLogged = '';
let onStatusChange: (() => void) | null = null;
let cachedSlaveRole: ReturnType<typeof readSlaveRole> = null;
let cachedHasOutboundPeers = false;
let roleCachePrimed = false;

function refreshRoleCache(): void {
  cachedSlaveRole = readSlaveRole();
  cachedHasOutboundPeers = readPeerConfigs().length > 0;
  roleCachePrimed = true;
}

function ensureRoleCache(): void {
  if (!roleCachePrimed) refreshRoleCache();
}

function hasStandaloneSlaveRole(): boolean {
  ensureRoleCache();
  return cachedSlaveRole !== null && !cachedHasOutboundPeers;
}

function syncInboundSlaveSynced(): void {
  const next = synchronized && hasStandaloneSlaveRole();
  if (bridgeState.inboundSlaveSynced === next) return;
  bridgeState.inboundSlaveSynced = next;
  broadcastState();
}

function sendOnSocket(ws: AugmentedWebSocket | null, msg: unknown): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

function parseMasterAddress(masterAddress: string | undefined): { host: string; port: number } {
  const raw = (masterAddress ?? '').trim();
  if (!raw) return { host: 'master', port: DEFAULT_INBOUND_PORT };
  const colon = raw.lastIndexOf(':');
  if (colon > 0) {
    const maybePort = raw.slice(colon + 1);
    const before = raw.slice(0, colon);
    const isBareIpv6 = before.includes(':') && !before.startsWith('[');
    if (!isBareIpv6 && /^\d{1,5}$/.test(maybePort)) {
      const port = Number(maybePort);
      if (port >= 1 && port <= 65535) {
        return { host: before.replace(/^\[|\]$/g, ''), port };
      }
    }
  }
  return { host: raw, port: DEFAULT_INBOUND_PORT };
}

function canSendDirectSync(ws: AugmentedWebSocket): boolean {
  return activeSocket === ws && synchronized && !((ws.bufferedAmount ?? 0) >= STALLED_SOCKET_BYTES);
}

function sendInboundDirectSyncDelta(confirmedId?: string): void {
  const ws = activeSocket;
  if (!ws || !synchronized) return;
  // Skip under backpressure; reconnect full sync recovers any missed deltas.
  if ((ws.bufferedAmount ?? 0) >= STALLED_SOCKET_BYTES) return;
  sendOnSocket(ws, {
    type: 'peer_direct_sync',
    confirmedIds: confirmedId ? [confirmedId] : [],
    lastExecutedTransportSeq: getLastExecutedTransportSeq(),
  });
}

function sendDirectSyncChunks(
  ws: AugmentedWebSocket,
  ordered: string[],
  lastExecutedTransportSeq: number,
): void {
  for (let i = 0; i < ordered.length; i += DIRECT_SYNC_CHUNK_SIZE) {
    if (!canSendDirectSync(ws)) break;
    const chunk = ordered.slice(i, i + DIRECT_SYNC_CHUNK_SIZE);
    const ok = sendOnSocket(ws, {
      type: 'peer_direct_sync',
      confirmedIds: chunk,
      lastExecutedTransportSeq,
    });
    if (!ok) break;
  }
}

function sendInboundDirectSyncFull(): void {
  const ws = activeSocket;
  if (!ws || !synchronized) return;
  const { confirmedIds, lastExecutedTransportSeq } = getConfirmedDirectSummary();
  if (confirmedIds.length === 0) {
    if (lastExecutedTransportSeq > 0 && canSendDirectSync(ws)) {
      sendOnSocket(ws, {
        type: 'peer_direct_sync',
        confirmedIds: [],
        lastExecutedTransportSeq,
      });
    }
    return;
  }
  sendDirectSyncChunks(ws, [...confirmedIds].reverse(), lastExecutedTransportSeq);
}

function clearInboundRecord(): void {
  heartbeat?.stop();
  heartbeat = null;
  activeSocket = null;
  tracker = null;
  remoteView = null;
  synchronized = false;
  versionMismatch = false;
  lastLogged = '';
  setDirectSyncListener(null);
  resetPeerFollowRuntime();
  syncInboundSlaveSynced();
}

/**
 * Registers the status-change callback invoked whenever inbound peer health updates.
 */
export function setInboundStatusListener(cb: (() => void) | null): void {
  onStatusChange = cb;
}

/**
 * Synchronizes the inbound health record with the persisted SlaveRole file.
 */
export function syncInboundSlaveRole(): void {
  refreshRoleCache();
  if (hasStandaloneSlaveRole()) {
    if (!tracker) tracker = new PeerHealthTracker();
    syncInboundSlaveSynced();
    onStatusChange?.();
    return;
  }
  if (cachedSlaveRole === null || !activeSocket) {
    generation += 1;
    closeQuietly(activeSocket, 'unpaired');
    clearInboundRecord();
  }
  syncInboundSlaveSynced();
  onStatusChange?.();
}

function closeQuietly(ws: AugmentedWebSocket | null, reason: string): void {
  if (!ws) return;
  try {
    ws.close(4003, reason);
  } catch {
    // socket already closing
  }
}

/**
 * Reports whether a peer socket is the active inbound master link.
 */
export function isActiveInboundPeer(ws: AugmentedWebSocket): boolean {
  return ws === activeSocket;
}

/**
 * Updates cached outbound-peer presence when outbound links start or stop.
 */
export function setInboundHasOutboundPeers(hasOutbound: boolean): void {
  ensureRoleCache();
  cachedHasOutboundPeers = hasOutbound;
  syncInboundSlaveSynced();
}

/**
 * Activates or supersedes the inbound peer heartbeat session after sync_confirm.
 */
export function onInboundPeerSyncConfirm(ws: AugmentedWebSocket): void {
  if (ws.isPeer !== true) return;
  refreshRoleCache();
  if (!tracker) tracker = new PeerHealthTracker();
  const superseding = activeSocket !== null && activeSocket !== ws && synchronized;
  generation += 1;
  const myGen = generation;
  heartbeat?.stop();
  heartbeat = null;
  if (superseding) {
    tracker.onSuperseded();
  } else {
    tracker.onSynchronized();
  }
  const previousSocket = activeSocket;
  activeSocket = ws;
  if (superseding) closeQuietly(previousSocket, 'superseded');
  synchronized = true;
  remoteView = null;
  versionMismatch = false;
  resetPeerFollowRuntime();
  const activeTracker = tracker;
  const isCurrent = (): boolean => myGen === generation && activeSocket === ws;
  heartbeat = startPeerHeartbeat({
    tracker: activeTracker,
    send: (msg) => (isCurrent() ? sendOnSocket(ws, msg) : false),
    getLocalView: () =>
      buildLocalHealthView(activeTracker, isPeerOutOfStep(), bridgeState.peerFollowMode),
    onRemoteView: (view) => {
      if (!isCurrent()) return;
      remoteView = view;
    },
    onRefresh: () => {
      if (!isCurrent()) return;
      onStatusChange?.();
    },
    onDead: () => {
      if (!isCurrent()) return;
      try {
        ws.terminate();
      } catch {
        // socket already closing
      }
      onInboundPeerClosed(ws);
    },
  });
  setDirectSyncListener(sendInboundDirectSyncDelta);
  sendInboundDirectSyncFull();
  syncInboundSlaveSynced();
  onStatusChange?.();
}

/**
 * Dispatches peer_hb and peer_hb_ack frames for the active inbound peer socket.
 */
export function onInboundPeerMessage(ws: AugmentedWebSocket, msg: ClientMessage): boolean {
  if (msg.type !== 'peer_hb' && msg.type !== 'peer_hb_ack') return false;
  if (ws !== activeSocket || !heartbeat) return true;
  if (msg.type === 'peer_hb') {
    heartbeat.handleHb({ hbId: msg.hbId, t0: msg.t0, view: msg.view });
  } else {
    heartbeat.handleHbAck({ hbId: msg.hbId, t0: msg.t0, t1: msg.t1, t2: msg.t2, view: msg.view });
  }
  return true;
}

/**
 * Handles closure of an inbound peer socket while ignoring superseded sockets.
 */
export function onInboundPeerClosed(ws: AugmentedWebSocket): void {
  if (ws !== activeSocket) return;
  const wasSync = synchronized;
  activeSocket = null;
  synchronized = false;
  heartbeat?.stop();
  heartbeat = null;
  remoteView = null;
  tracker?.onDisconnected(wasSync);
  setDirectSyncListener(null);
  resetPeerFollowRuntime();
  if (!hasStandaloneSlaveRole()) {
    tracker = null;
    lastLogged = '';
  }
  syncInboundSlaveSynced();
  onStatusChange?.();
}

/**
 * Applies an operator health acknowledgement on the inbound record and forwards it once when local.
 */
export function acknowledgeInboundHealth(fromPeer: boolean): boolean {
  if (!tracker) return false;
  const acked = tracker.acknowledge();
  if (!fromPeer && activeSocket && activeSocket.readyState === WebSocket.OPEN) {
    sendOnSocket(activeSocket, { type: 'peer_health_ack' });
  }
  heartbeat?.sendNow();
  onStatusChange?.();
  return acked;
}

/**
 * Triggers an immediate heartbeat on the active inbound peer link when local signals change.
 */
export function nudgeInboundHeartbeat(): void {
  heartbeat?.sendNow();
}

/**
 * Records or clears an inbound link protocol version mismatch, persisting above down until
 * a matching protocol handshake, unpair, or server reset.
 */
export function markInboundVersionMismatch(mismatch: boolean): void {
  refreshRoleCache();
  versionMismatch = mismatch;
  if (mismatch && !tracker) tracker = new PeerHealthTracker();
  onStatusChange?.();
}

function shouldEmitInboundSummary(): boolean {
  if (activeSocket !== null || versionMismatch) {
    ensureRoleCache();
    return true;
  }
  if (!tracker) return false;
  return hasStandaloneSlaveRole();
}

function computeInboundMarkersMatch(localFingerprint: string): boolean {
  if (!synchronized) return true;
  return remoteView !== null && remoteView.cuesFingerprint === localFingerprint;
}

/**
 * Builds the merged inbound PeerLinkSummary row when paired as slave or connected to a master.
 */
export function getInboundPeerSummary(): PeerLinkSummary | null {
  if (!shouldEmitInboundSummary()) return null;
  if (!tracker) tracker = new PeerHealthTracker();
  const signals = localHealthSignals();
  const markersMatch = computeInboundMarkersMatch(signals.cuesFingerprint);
  const { patch, logged } = evaluatePeerLinkHealth(
    INBOUND_PEER_KEY,
    tracker,
    remoteView,
    markersMatch,
    lastLogged,
    isPeerOutOfStep(),
  );
  lastLogged = logged;
  return {
    key: INBOUND_PEER_KEY,
    role: 'inbound',
    config: parseMasterAddress(cachedSlaveRole?.masterAddress),
    state: {
      connected: synchronized,
      markersMatch,
      fingerprintMismatch: false,
      versionMismatch,
      ...patch,
    },
  };
}

/**
 * Returns the lightweight lastSeenAt entry for the inbound master link, if tracked.
 */
export function getInboundLastSeen(): LastSeenEntry | null {
  if (!tracker) return null;
  if (!activeSocket && !hasStandaloneSlaveRole()) return null;
  return { key: INBOUND_PEER_KEY, lastSeenAt: tracker.localSnapshot().lastSeenAt };
}

/**
 * Stops inbound heartbeats and resets module state during server shutdown or tests.
 */
export function resetInboundPeerState(): void {
  generation += 1;
  roleCachePrimed = false;
  cachedSlaveRole = null;
  cachedHasOutboundPeers = false;
  clearInboundRecord();
}
