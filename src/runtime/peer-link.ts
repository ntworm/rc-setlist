// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The links to the paired computers.
//
// The main computer forwards what the operator asks for to every computer it
// is paired with, and its clock twice a second. Each link is one client per
// process. Nothing is queued: a command that lands late is worse than one
// that never lands, and the clock lets the second computer catch up on what
// it missed.
//
// The certificate is pinned: the fingerprint the socket presents is compared
// against the one the pairing wrote down before a single byte goes out, so a
// computer that presents another certificate is never talked to.

import * as tls from 'node:tls';
import { WebSocket } from 'ws';
import { bridgeState, broadcastState } from './bridge-state.js';
import { fingerprintFromSocket, publicKeyPinFromSocket } from './pairing.js';
import { peerLinkTiming, watchPeerSocket, type PeerWatchdog } from './peer-liveness.js';
import { canWriteNow, roomOnSocket, sameConfig, isRecord, parseMessage } from './peer-message.js';
import { answerSetlistRequest } from './peer-setlist.js';
import {
  aggregatePeerStatus,
  peerStatusRows,
  samePeerStatusRows,
  type PeerLinkState,
} from './peer-status-list.js';
import { peerKey, type PeerConfig } from '../preferences.js';
import type { ShowCommand } from '../types.js';
import { log } from '../util/log.js';
import { startPeerClock } from './peer-follow-runtime.js';
import { buildPeerMessage } from './peer-relay-message.js';

export { resetPeerLinkTiming, setPeerLinkTiming } from './peer-liveness.js';

/**
 * The command types the main computer forwards to the paired computer.
 *
 * Everything else stays here: the setlist is the operator's business here.
 */
export const PEER_RELAY_TYPES: ReadonlySet<string> = new Set([
  'play',
  'stop',
  'jump',
  'metronome',
  'set_quantization',
  'trigger_count_in',
  'refresh',
  'set_panic',
]);

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
  lastRemoteFingerprint: string | null;
  clockTimer: NodeJS.Timeout | null;
  /** What this computer looks like from here. */
  state: PeerLinkState;
}

/** Every computer this one is paired with, by the key that tells them apart. */
const links = new Map<string, PeerLink>();

/** Stops a timer and hands back the empty slot it sat in. */
function stopTimer(timer: NodeJS.Timeout | null): null {
  if (timer) clearTimeout(timer);
  return null;
}

/** Stops every timer of the current attempt. */
function stopAttemptTimers(target: PeerLink): void {
  target.clockTimer = stopTimer(target.clockTimer);
  target.connectTimer = stopTimer(target.connectTimer);
  target.handshakeTimer = stopTimer(target.handshakeTimer);
  target.watchdog?.stop();
  target.watchdog = null;
}

/** Takes a socket down, whether it is still handshaking or already open. */
function closePeerSocket(socket: WebSocket): void {
  try {
    // A socket that is still handshaking has no stream to destroy yet: the
    // library knows how to abort that one on its own.
    if (socket.readyState === WebSocket.CONNECTING) socket.close();
    else socket.terminate();
  } catch {
    // swallow: the socket is going away anyway.
  }
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

/**
 * Writes down what every paired computer looks like from here. The summary
 * the page reads is what the computers add up to, so it is computed here.
 */
function publishPeerStatus(): void {
  const rows = peerStatusRows([...links.values()]);
  const next = aggregatePeerStatus(rows);
  const current = bridgeState.peerStatus;
  const changed =
    current.paired !== next.paired ||
    current.connected !== next.connected ||
    current.markersMatch !== next.markersMatch ||
    current.fingerprintMismatch !== next.fingerprintMismatch ||
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

function localCuesFingerprint(): string {
  return bridgeState.manager?.getState().cuesFingerprint ?? '';
}

function updateMarkersMatch(target: PeerLink, state: unknown): void {
  const remote = isRecord(state) ? state.cuesFingerprint : null;
  target.lastRemoteFingerprint = typeof remote === 'string' ? remote : null;
  recheckMarkersMatch(target);
}

function recheckMarkersMatch(target: PeerLink): void {
  const remote = target.lastRemoteFingerprint;
  setLinkState(target, { markersMatch: remote !== null && remote === localCuesFingerprint() });
}

function sendToPeer(target: PeerLink, message: unknown): boolean {
  const socket = target.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function handlePeerMessage(target: PeerLink, data: WebSocket.Data): void {
  const message = parseMessage(data);
  if (!message) return;
  if (message.type === 'handshake_ack') {
    const version = typeof message.stateVersion === 'number' ? message.stateVersion : 0;
    updateMarkersMatch(target, message.state);
    sendToPeer(target, { type: 'sync_confirm', stateVersion: version });
    target.synchronized = true;
    setLinkState(target, { connected: true });
    stopTimer(target.clockTimer);
    target.clockTimer = startPeerClock(() =>
      dropIfStale(target) || !target.synchronized ? null : target.socket,
    );
    return;
  }
  if (message.type === 'state') {
    updateMarkersMatch(target, message.state);
    return;
  }
  if (message.type === 'setlist_request' && typeof message.requestId === 'string') {
    // The second computer asks for the setlist of this one.
    // The pieces wait for room on the socket: a full socket would drop the
    // transport commands and the clock that share it.
    void answerSetlistRequest(
      message.requestId,
      (msg) => sendToPeer(target, msg),
      undefined,
      undefined,
      () => roomOnSocket(target.socket),
    );
    return;
  }
  if (message.type === 'error') handlePeerError(target, message.code);
}

function handlePeerError(target: PeerLink, code: unknown): void {
  if (code === 'not_synchronized') {
    // The link called itself in sync before the other side accepted the
    // confirmation. A peer that says otherwise refuses every command, so the
    // link goes down and handshakes again instead of showing a green dot.
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
  target.socket = null;
  target.secureSocket = null;
  target.synchronized = false;
  stopAttemptTimers(target);
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
    // The socket is handed to the request as it is: the certificate it
    // carries was checked a moment ago, and a library that opened a socket of
    // its own would present another one.
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
    if (dropIfStale(target)) return;
    target.handshakeTimer = stopTimer(target.handshakeTimer);
    target.reconnectDelayMs = peerLinkTiming().reconnectBaseMs;
    target.watchdog = watchPeerSocket(socket, () => {
      closePeerSocket(socket);
    });
    sendToPeer(target, { type: 'handshake', clientId: PEER_CLIENT_ID });
  });
  socket.on('message', (data: WebSocket.Data) => {
    if (dropIfStale(target)) return;
    handlePeerMessage(target, data);
  });
  socket.on('pong', () => {
    if (dropIfStale(target)) return;
    recheckMarkersMatch(target);
  });
  socket.on('close', () => {
    if (dropIfStale(target)) return;
    onPeerClosed(target);
  });
  socket.on('error', () => {
    // The close handler owns the reconnect; an error without a close would
    // otherwise leave the link waiting for a socket that is already gone.
  });
}

/** Opens the TLS connection and checks the certificate before anything. */
function destroyQuietly(socket: tls.TLSSocket): void {
  try {
    socket.destroy();
  } catch {
    // swallow: the attempt is over.
  }
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
  // The listeners stay: a socket that still has its own error handling is
  // a socket that cannot raise an unhandled error on the way out.
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
      lastRemoteFingerprint: null,
      clockTimer: null,
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
 * Forwards a command to the paired computers. Never throws and never
 * rejects: a link that is down must not change what happens on this machine.
 */
export function relayToPeer(command: ShowCommand<unknown>): void {
  try {
    const targets = [...links.values()].filter((target) => target.synchronized);
    if (targets.length === 0) return;
    if (!PEER_RELAY_TYPES.has(command.type)) return;
    // A command this computer already refused, a full queue among the
    // reasons, must not run on the other ones: the two would part ways.
    if (command.status === 'failed') return;
    if (bridgeState.commandBus?.wouldRejectForSafety(command.type)) return;
    const message = buildPeerMessage(command);
    if (!message) return;
    for (const target of targets) {
      // Every link has a socket of its own: one that is busy is dropped
      // here and not for the others.
      if (canWriteNow(target.socket, command.type)) sendToPeer(target, message);
    }
  } catch {
    // swallow: a relay failure must never reach the local command.
  }
}
