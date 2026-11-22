// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Outbound peer links with pinned TLS certificates and bidirectional heartbeats.

import * as tls from 'node:tls';
import { WebSocket } from 'ws';
import { bridgeState, broadcastState } from './bridge-state.js';
import { fingerprintFromSocket, publicKeyPinFromSocket } from './pairing.js';
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
  setInboundStatusListener,
} from './peer-inbound.js';
import {
  closePeerSocket,
  destroyQuietly,
  peerLinkTiming,
  sendPeerJson,
  stopTimer,
  watchPeerSocket,
  type PeerWatchdog,
} from './peer-liveness.js';
import {
  PEER_RELAY_TYPES,
  canWriteNow,
  roomOnSocket,
  sameConfig,
  isRecord,
  parseMessage,
} from './peer-message.js';
import { answerSetlistRequest } from './peer-setlist.js';
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
import { startPeerClock } from './peer-follow-runtime.js';
import { buildPeerMessage } from './peer-relay-message.js';
import { receivePeerUpstream } from './peer-upstream-master.js';

export { resetPeerLinkTiming, setPeerLinkTiming } from './peer-liveness.js';
export { PEER_RELAY_TYPES } from './peer-message.js';
export { setPeerUpstreamHandler, type PeerUpstreamReply } from './peer-upstream-master.js';

/** The client id this side announces itself with. */
const PEER_CLIENT_ID = 'rc-peer';

interface PeerLink {
  /** The key that tells this computer from another one. */
  key: string;
  config: PeerConfig;
  socket: WebSocket | null;
  secureSocket: tls.TLSSocket | null;
  watchdog: PeerWatchdog | null;
  reconnectTimer: NodeJS.Timeout | null;
  connectTimer: NodeJS.Timeout | null;
  handshakeTimer: NodeJS.Timeout | null;
  reconnectDelayMs: number;
  synchronized: boolean;
  stopped: boolean;
  clockTimer: NodeJS.Timeout | null;
  health: PeerLinkHealth;
  /** What this computer looks like from here. */
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

/** Stops every timer of the current attempt. */
function stopAttemptTimers(target: PeerLink): void {
  target.clockTimer = stopTimer(target.clockTimer);
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
  const version = typeof message.stateVersion === 'number' ? message.stateVersion : 0;
  sendToPeer(target, { type: 'sync_confirm', stateVersion: version });
  target.synchronized = true;
  target.health.onSynchronized({
    send: (msg) => (isStaleSocket(target, socket) ? false : sendToPeer(target, msg)),
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
  setLinkState(target, { connected: true });
  stopTimer(target.clockTimer);
  target.clockTimer = startPeerClock(() =>
    isStaleSocket(target, socket) || !target.synchronized ? null : target.socket,
  );
}

function handlePeerMessage(target: PeerLink, socket: WebSocket, data: WebSocket.Data): void {
  const message = parseMessage(data);
  if (!message) return;
  if (message.type === 'handshake_ack') {
    onPeerHandshakeAck(target, socket, message);
    return;
  }
  if (target.health.handleMessage(message, publishPeerStatus)) return;
  if (message.type === 'state') {
    updateMarkersMatch(target, message.state);
    return;
  }
  if (message.type === 'setlist_request' && typeof message.requestId === 'string') {
    void answerSetlistRequest(
      message.requestId,
      (msg) => sendToPeer(target, msg),
      undefined,
      undefined,
      () => roomOnSocket(target.socket),
    );
    return;
  }
  if (message.type === 'peer_upstream') {
    receivePeerUpstream(message.command, target.synchronized, (reply) => sendToPeer(target, reply));
    return;
  }
  if (message.type === 'error') handlePeerError(target, message.code);
}

function handlePeerError(target: PeerLink, code: unknown): void {
  if (code === 'not_synchronized') {
    target.synchronized = false;
    setLinkState(target, { connected: false });
    if (target.socket) closePeerSocket(target.socket);
    return;
  }

  if (code === 'peer_no_marker') {
    bridgeState.wsServer?.broadcastLog(
      'The paired computer has no marker at that beat; the jump did not go through.',
      'warn',
    );
  }
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

function abortOnFingerprintMismatch(target: PeerLink): void {
  if (dropIfStale(target)) return;
  target.stopped = true;
  target.synchronized = false;
  setLinkState(target, { connected: false, fingerprintMismatch: true });
  const socket = target.socket;
  target.socket = null;
  stopAttemptTimers(target);
  if (socket) closePeerSocket(socket);
  log.warn('peer', 'The paired computer presented a different certificate; the link stopped.');
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
    target.watchdog = watchPeerSocket(socket, () => {
      closePeerSocket(socket);
    });
    sendToPeer(target, { type: 'handshake', clientId: PEER_CLIENT_ID });
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
    // The close handler owns the reconnect; an error without a close would
    // otherwise leave the link waiting for a socket that is already gone.
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
    // A socket that is already open owns the reconnect: it closes with the
    // stream that died under it.
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
    // The pin follows the key when the pairing wrote one: a certificate that
    // was issued again for a new address keeps its key. A pairing from
    // before that holds the fingerprint of the certificate alone.
    const presented = keyPin
      ? publicKeyPinFromSocket(secureSocket)
      : fingerprintFromSocket(secureSocket);
    const expected = keyPin ?? fingerprint;
    if (presented !== expected) {
      givenUp = true;
      stopAttemptTimers(target);
      destroyQuietly(secureSocket);
      target.secureSocket = null;
      abortOnFingerprintMismatch(target);
      return;
    }
    openPeerSocket(target, secureSocket);
  });
}

function teardownLink(target: PeerLink): void {
  if (links.get(target.key) === target) links.delete(target.key);
  target.stopped = true;
  target.reconnectTimer = stopTimer(target.reconnectTimer);
  stopAttemptTimers(target);
  const { socket, secureSocket } = target;
  target.socket = null;
  target.secureSocket = null;
  target.synchronized = false;
  if (socket) closePeerSocket(socket);
  if (secureSocket) destroyQuietly(secureSocket);
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
      clockTimer: null,
      health: new PeerLinkHealth(key),
      state: { connected: false, markersMatch: true, fingerprintMismatch: false },
    };
    links.set(key, link);
    fresh.push(link);
  }
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
  if (matchAll || peerKeyValue === INBOUND_PEER_KEY) {
    acknowledgeInboundHealth(false);
  }
  publishPeerStatus();
}

/** Sends one message to every link that has room for it; whether one got it. */
function sendToTargets(targets: PeerLink[], type: string, message: unknown): boolean {
  let sent = false;
  for (const target of targets) {
    if (canWriteNow(target.socket, type) && sendToPeer(target, message)) sent = true;
  }
  return sent;
}

/** Returns wall-clock last-seen timestamps keyed by peer link key. */
export function getPeerLastSeenMap(): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const link of links.values()) map.set(link.key, link.health.lastSeenAt());
  return map;
}

/** Forwards a command to paired computers; returns whether at least one got it. */
export function relayToPeer(command: ShowCommand<unknown>): boolean {
  try {
    const targets = [...links.values()].filter((target) => target.synchronized);
    if (targets.length === 0) return false;
    if (!PEER_RELAY_TYPES.has(command.type)) return false;
    if (command.status === 'failed') return false;
    if (bridgeState.commandBus?.wouldRejectForSafety(command.type)) return false;
    const message = buildPeerMessage(command);
    if (!message) return false;
    return sendToTargets(targets, command.type, message);
  } catch {
    return false;
  }
}
