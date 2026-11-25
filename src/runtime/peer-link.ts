// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Outbound peer links with pinned TLS certificates and bidirectional heartbeats.

import * as tls from 'node:tls';
import { WebSocket } from 'ws';
import { bridgeState, broadcastState } from './bridge-state.js';
import { fingerprintFromSocket, publicKeyPinFromSocket } from './pairing.js';
import { clearPendingForIndependent } from './peer-follow-mode.js';
import {
  createLastSeenBroadcaster,
  localHealthViewKey,
  PeerLinkHealth,
  type LastSeenEntry,
} from './peer-heartbeat.js';
import {
  acknowledgeInboundHealth,
  getInboundLastSeen,
  getInboundPeerSummary,
  INBOUND_PEER_KEY,
  nudgeInboundHeartbeat,
  setInboundHasOutboundPeers,
  setInboundStatusListener,
} from './peer-inbound.js';
import {
  buildPeerHandshakeMessage,
  createPeerPendingTable,
  dispatchPeerCommandFrame,
  isCompatiblePeerProtocol,
  onPeerPendingReconnect,
  relayCommandToPeers,
  resetMasterRelayIntent,
  startPendingFlushTimer,
  stopPendingCommandState,
  warnPeerNoMarker,
  type PeerCommandTarget,
} from './peer-link-commands.js';
import {
  closePeerSocket,
  destroyQuietly,
  peerLinkTiming,
  sendPeerJson,
  stopTimer,
  watchPeerSocket,
  type PeerWatchdog,
} from './peer-liveness.js';
import { isRecord, parseMessage, sameConfig } from './peer-message.js';
import {
  aggregatePeerStatus,
  peerStatusRows,
  samePeerStatusRows,
  type PeerLinkState,
  type PeerLinkSummary,
} from './peer-status-list.js';
import { peerKey, type PeerConfig } from '../preferences.js';
import type { ShowCommand } from '../types.js';
import { log } from '../util/log.js';
import { setPeerOutOfStepListener, startPeerTarget } from './peer-follow-runtime.js';

export { resetPeerLinkTiming, setPeerLinkTiming } from './peer-liveness.js';
export { PEER_RELAY_TYPES } from './peer-message.js';
export { setPeerUpstreamHandler, type PeerUpstreamReply } from './peer-upstream-master.js';

interface PeerLink extends PeerCommandTarget {
  config: PeerConfig;
  secureSocket: tls.TLSSocket | null;
  watchdog: PeerWatchdog | null;
  reconnectTimer: NodeJS.Timeout | null;
  connectTimer: NodeJS.Timeout | null;
  handshakeTimer: NodeJS.Timeout | null;
  reconnectDelayMs: number;
  targetTimer: NodeJS.Timeout | null;
  health: PeerLinkHealth;
  state: PeerLinkState;
}

/** Every computer this one is paired with, by the key that tells them apart. */
const links = new Map<string, PeerLink>();
let lastLocalViewKey = '';

const healthBroadcaster = createLastSeenBroadcaster((): LastSeenEntry[] => {
  const entries: LastSeenEntry[] = [];
  for (const link of links.values()) {
    entries.push({ key: link.key, lastSeenAt: link.health.lastSeenAt() });
  }
  const inbound = getInboundLastSeen();
  if (inbound) entries.push(inbound);
  return entries;
});

setInboundStatusListener(() => publishPeerStatus());
setPeerOutOfStepListener(() => {
  nudgeInboundHeartbeat();
  publishPeerStatus();
});

/** Stops every timer of the current attempt. */
function stopAttemptTimers(target: PeerLink): void {
  target.targetTimer = stopTimer(target.targetTimer);
  target.connectTimer = stopTimer(target.connectTimer);
  target.handshakeTimer = stopTimer(target.handshakeTimer);
  target.watchdog?.stop();
  target.watchdog = null;
  target.health.stop();
}

/**
 * Whether a link was replaced or stopped, cleaning up what it left running.
 * A stale link must never touch the status of the one that replaced it.
 */
function dropIfStale(target: PeerLink): boolean {
  if (!target.stopped && links.get(target.key) === target) return false;
  stopAttemptTimers(target);
  return true;
}

function isStaleSocket(target: PeerLink, socket: WebSocket): boolean {
  return dropIfStale(target) || target.socket !== socket;
}

function nudgeIfLocalViewChanged(): void {
  const viewKey = localHealthViewKey();
  const changed = lastLocalViewKey !== '' && viewKey !== lastLocalViewKey;
  lastLocalViewKey = viewKey;
  if (!changed) return;
  for (const target of links.values()) {
    if (target.synchronized) target.health.nudge();
  }
  nudgeInboundHeartbeat();
}

/**
 * Writes down what every paired computer looks like from here, merging outbound
 * links and any inbound master link before broadcasting state changes.
 */
export function publishPeerStatus(): void {
  for (const target of links.values()) {
    target.state = { ...target.state, ...target.health.computePatch(target.synchronized) };
  }
  const summaries: PeerLinkSummary[] = [...links.values()];
  const inbound = getInboundPeerSummary();
  if (inbound) summaries.push(inbound);
  healthBroadcaster.sync(summaries.length > 0);
  if (summaries.length > 0) nudgeIfLocalViewChanged();
  const rows = peerStatusRows(summaries);
  const next = aggregatePeerStatus(rows);
  const changed =
    JSON.stringify(bridgeState.peerStatus) !== JSON.stringify(next) ||
    !samePeerStatusRows(bridgeState.peerStatuses, rows);
  if (!changed) return;
  bridgeState.peerStatus = next;
  bridgeState.peerStatuses = rows;
  broadcastState();
}

/** Records what one computer looks like from here. */
function setLinkState(target: PeerLink, patch: Partial<PeerLinkState>): void {
  target.state = { ...target.state, ...patch };
  publishPeerStatus();
}

function updateMarkersMatch(target: PeerLink, state: unknown): void {
  const remote = isRecord(state) ? state.cuesFingerprint : null;
  target.health.setRemoteFingerprint(typeof remote === 'string' ? remote : null);
  publishPeerStatus();
}

function sendToPeer(target: PeerLink, message: unknown): boolean {
  return sendPeerJson(target.socket, message);
}

function onPeerHandshakeAck(
  target: PeerLink,
  socket: WebSocket,
  message: Record<string, unknown>,
): void {
  if (!isCompatiblePeerProtocol(message)) {
    abortLink(target, 'version');
    return;
  }
  const version = typeof message.stateVersion === 'number' ? message.stateVersion : 0;
  sendToPeer(target, { type: 'sync_confirm', stateVersion: version });
  target.synchronized = true;
  target.health.onSynchronized({
    send: (msg) => (isStaleSocket(target, socket) ? false : sendToPeer(target, msg)),
    onRemoteView: (view) => {
      if (!isStaleSocket(target, socket) && view.followMode === 'independent') {
        clearPendingForIndependent(target);
      }
    },
    onRefresh: () => {
      if (!isStaleSocket(target, socket)) publishPeerStatus();
    },
    onDead: () => {
      if (isStaleSocket(target, socket)) return;
      closePeerSocket(socket);
      onPeerClosed(target);
    },
  });
  updateMarkersMatch(target, message.state);
  setLinkState(target, { connected: true, versionMismatch: false });
  stopTimer(target.targetTimer);
  target.targetTimer = startPeerTarget(() =>
    isStaleSocket(target, socket) || !target.synchronized ? null : target.socket,
  );
  onPeerPendingReconnect(target);
}

function handlePeerMessage(target: PeerLink, socket: WebSocket, data: WebSocket.Data): void {
  const message = parseMessage(data);
  if (!message) return;
  if (message.type === 'handshake_ack') {
    onPeerHandshakeAck(target, socket, message);
    return;
  }
  if (dispatchPeerCommandFrame(target, message)) return;
  if (target.health.handleMessage(message, publishPeerStatus)) return;
  if (message.type === 'state') {
    updateMarkersMatch(target, message.state);
    return;
  }
  if (message.type === 'error') handlePeerError(target, message.code);
}

function handlePeerError(target: PeerLink, code: unknown): void {
  if (code === 'version_mismatch') {
    abortLink(target, 'version');
    return;
  }
  if (code === 'not_synchronized') {
    // Close without clearing `synchronized` first: onPeerClosed counts the drop.
    if (target.socket) closePeerSocket(target.socket);
    return;
  }
  if (code === 'peer_no_marker') warnPeerNoMarker();
}

function scheduleReconnect(target: PeerLink): void {
  if (target.stopped || links.get(target.key) !== target || target.reconnectTimer) return;
  const timing = peerLinkTiming();
  const delay = target.reconnectDelayMs;
  target.reconnectDelayMs = Math.min(delay * 2, timing.reconnectMaxMs);
  target.reconnectTimer = setTimeout(() => {
    target.reconnectTimer = null;
    connectPeer(target);
  }, delay);
  target.reconnectTimer.unref?.();
}

function onPeerClosed(target: PeerLink): void {
  if (dropIfStale(target)) return;
  const wasSync = target.synchronized;
  target.socket = null;
  target.secureSocket = null;
  target.synchronized = false;
  stopAttemptTimers(target);
  target.health.onDisconnected(wasSync);
  setLinkState(target, { connected: false });
  scheduleReconnect(target);
}

function abortLink(target: PeerLink, kind: 'fingerprint' | 'version'): void {
  if (dropIfStale(target)) return;
  target.stopped = true;
  target.synchronized = false;
  target.reconnectTimer = stopTimer(target.reconnectTimer);
  stopPendingCommandState(target);
  const patch = kind === 'version' ? { versionMismatch: true } : { fingerprintMismatch: true };
  setLinkState(target, { connected: false, ...patch });
  const socket = target.socket;
  target.socket = null;
  stopAttemptTimers(target);
  if (socket) closePeerSocket(socket);
  log.warn(
    'peer',
    kind === 'version'
      ? 'The paired computer uses a different link protocol version; the link stopped.'
      : 'The paired computer presented a different certificate; the link stopped.',
  );
}

/** Opens the WebSocket on the socket whose certificate was just verified. */
function openPeerSocket(target: PeerLink, secureSocket: tls.TLSSocket): void {
  const { host, port, peerToken } = target.config;
  let socket: WebSocket;
  try {
    const options = {
      createConnection: () => secureSocket,
    } as unknown as ConstructorParameters<typeof WebSocket>[1];
    socket = new WebSocket(
      `wss://${host}:${port}/ws?token=${encodeURIComponent(peerToken)}`,
      options,
    );
  } catch {
    destroyQuietly(secureSocket);
    if (target.secureSocket === secureSocket) target.secureSocket = null;
    scheduleReconnect(target);
    return;
  }
  target.socket = socket;
  target.handshakeTimer = setTimeout(() => {
    closePeerSocket(socket);
  }, peerLinkTiming().handshakeTimeoutMs);
  target.handshakeTimer.unref?.();
  listenToPeerSocket(target, socket);
}

function listenToPeerSocket(target: PeerLink, socket: WebSocket): void {
  socket.on('open', () => {
    if (isStaleSocket(target, socket)) return;
    target.handshakeTimer = stopTimer(target.handshakeTimer);
    target.reconnectDelayMs = peerLinkTiming().reconnectBaseMs;
    target.watchdog = watchPeerSocket(socket, () => closePeerSocket(socket));
    sendToPeer(target, buildPeerHandshakeMessage());
  });
  socket.on('message', (data: WebSocket.Data) => {
    if (isStaleSocket(target, socket)) return;
    handlePeerMessage(target, socket, data);
  });
  socket.on('pong', () => {
    if (isStaleSocket(target, socket)) return;
    publishPeerStatus();
  });
  socket.on('close', () => {
    if (isStaleSocket(target, socket)) return;
    onPeerClosed(target);
  });
  socket.on('error', () => {
    // Close handler owns reconnect.
  });
}

function connectPeer(target: PeerLink): void {
  if (target.stopped || links.get(target.key) !== target) return;
  const { host, port, fingerprint, keyPin } = target.config;
  let secureSocket: tls.TLSSocket;
  try {
    secureSocket = tls.connect({ host, port, rejectUnauthorized: false });
  } catch {
    scheduleReconnect(target);
    return;
  }
  target.secureSocket = secureSocket;
  let givenUp = false;
  const giveUp = (): void => {
    if (givenUp) return;
    givenUp = true;
    stopAttemptTimers(target);
    destroyQuietly(secureSocket);
    if (target.secureSocket === secureSocket) target.secureSocket = null;
    if (target.stopped || links.get(target.key) !== target) return;
    if (!target.socket) scheduleReconnect(target);
  };
  target.connectTimer = setTimeout(giveUp, peerLinkTiming().connectTimeoutMs);
  target.connectTimer.unref?.();
  secureSocket.on('error', giveUp);
  secureSocket.on('secureConnect', () => {
    if (dropIfStale(target)) {
      destroyQuietly(secureSocket);
      return;
    }
    if (givenUp) return;
    target.connectTimer = stopTimer(target.connectTimer);
    const presented = keyPin
      ? publicKeyPinFromSocket(secureSocket)
      : fingerprintFromSocket(secureSocket);
    if (presented !== (keyPin ?? fingerprint)) {
      givenUp = true;
      stopAttemptTimers(target);
      destroyQuietly(secureSocket);
      target.secureSocket = null;
      abortLink(target, 'fingerprint');
      return;
    }
    secureSocket.off('error', giveUp);
    openPeerSocket(target, secureSocket);
  });
}

function teardownLink(target: PeerLink): void {
  if (links.get(target.key) === target) links.delete(target.key);
  target.stopped = true;
  target.reconnectTimer = stopTimer(target.reconnectTimer);
  stopPendingCommandState(target);
  stopAttemptTimers(target);
  const { socket, secureSocket } = target;
  target.socket = null;
  target.secureSocket = null;
  target.synchronized = false;
  if (socket) closePeerSocket(socket);
  if (secureSocket) destroyQuietly(secureSocket);
}

function createPeerLink(key: string, config: PeerConfig): PeerLink {
  const health = new PeerLinkHealth(key);
  const link: PeerLink = {
    key,
    config,
    socket: null,
    secureSocket: null,
    watchdog: null,
    reconnectTimer: null,
    connectTimer: null,
    handshakeTimer: null,
    reconnectDelayMs: peerLinkTiming().reconnectBaseMs,
    synchronized: false,
    stopped: false,
    targetTimer: null,
    pending: createPeerPendingTable(),
    pendingTimer: null,
    health,
    rttMs: () => health.tracker.localSnapshot().rttP95Ms ?? 0,
    remoteFollowMode: () => health.remoteFollowMode(),
    state: { connected: false, markersMatch: true, fingerprintMismatch: false },
  };
  startPendingFlushTimer(link);
  return link;
}

/**
 * Starts the links to the paired computers. The list of pairings is the
 * truth: a link whose pairing is unchanged stays up, so pairing or unpairing
 * one slave never drops the others; the rest goes down or comes up.
 */
export function startPeerLinks(configs: PeerConfig[]): void {
  const wanted = new Map(configs.map((config) => [peerKey(config), config]));
  for (const target of [...links.values()]) {
    const config = wanted.get(target.key);
    if (config && sameConfig(config, target.config)) wanted.delete(target.key);
    else teardownLink(target);
  }
  const fresh: PeerLink[] = [];
  for (const [key, config] of wanted) {
    const link = createPeerLink(key, config);
    links.set(key, link);
    fresh.push(link);
  }
  setInboundHasOutboundPeers(links.size > 0);
  publishPeerStatus();
  for (const target of fresh) connectPeer(target);
}

/** Starts the link to the paired computer, if there is one. */
export function startPeerLink(config: PeerConfig | null): void {
  startPeerLinks(config ? [config] : []);
}

/** Stops the links to the paired computers. */
export function stopPeerLink(): void {
  for (const target of [...links.values()]) teardownLink(target);
  resetMasterRelayIntent();
  publishPeerStatus();
}

/**
 * Applies an operator peer_health_ack locally and forwards it once without looping.
 */
export function handlePeerHealthAck(peerKeyValue: string | undefined, fromPeer: boolean): void {
  if (fromPeer) {
    acknowledgeInboundHealth(true);
    return;
  }
  const matchAll = peerKeyValue === undefined;
  for (const target of links.values()) {
    if (!matchAll && target.key !== peerKeyValue) continue;
    target.health.acknowledge((msg) => sendToPeer(target, msg), target.synchronized);
  }
  if (matchAll || peerKeyValue === INBOUND_PEER_KEY) acknowledgeInboundHealth(false);
  publishPeerStatus();
}

/** Returns wall-clock last-seen timestamps keyed by peer link key. */
export function getPeerLastSeenMap(): Map<string, number | null> {
  return new Map([...links.values()].map((link) => [link.key, link.health.lastSeenAt()]));
}

/** Forwards a command to paired computers; returns whether at least one accepted it. */
export function relayToPeer(command: ShowCommand<unknown>): boolean {
  try {
    return relayCommandToPeers(links.values(), command);
  } catch {
    return false;
  }
}
