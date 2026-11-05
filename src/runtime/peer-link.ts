// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The link to the paired computer.
//
// The main computer runs the show and forwards what the operator asks for to
// the second computer, which follows along. The link is one client per
// process: it connects, handshakes, and stays connected. Nothing is ever
// queued — a command that arrives while the link is down is dropped, because
// a transport command that lands late is worse than one that never lands.
//
// The certificate is pinned. The TLS connection is opened first and the
// fingerprint the socket presents is compared against the one the pairing
// wrote down before a single byte goes out: a computer that presents another
// certificate is never talked to, and never even sees the credential.

import * as tls from 'node:tls';
import { WebSocket } from 'ws';
import { bridgeState, broadcastState } from './bridge-state.js';
import { fingerprintFromSocket, publicKeyPinFromSocket } from './pairing.js';
import { peerLinkTiming, watchPeerSocket, type PeerWatchdog } from './peer-liveness.js';
import { isRecord, parseMessage, payloadFields, peerCommandId } from './peer-message.js';
import type { PeerConfig } from '../preferences.js';
import type { PeerStatus, ShowCommand } from '../types.js';
import { log } from '../util/log.js';

export { resetPeerLinkTiming, setPeerLinkTiming } from './peer-liveness.js';

/**
 * The command types the main computer forwards to the paired computer.
 *
 * Everything else stays here: an edit to the setlist is the operator's
 * business on this machine, and the second computer has its own copy.
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
}

let link: PeerLink | null = null;

/**
 * Stops a timer and hands back the empty slot it sat in.
 */
function stopTimer(timer: NodeJS.Timeout | null): null {
  if (timer) clearTimeout(timer);
  return null;
}

/**
 * Stops every timer of the current attempt.
 */
function stopAttemptTimers(target: PeerLink): void {
  target.connectTimer = stopTimer(target.connectTimer);
  target.handshakeTimer = stopTimer(target.handshakeTimer);
  target.watchdog?.stop();
  target.watchdog = null;
}

/**
 * Takes a socket down, whether it is still handshaking or already open.
 */
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
 *
 * Every callback of a socket starts here: a link that is no longer the current
 * one must never touch the status of the one that replaced it.
 */
function dropIfStale(target: PeerLink): boolean {
  if (!target.stopped && link === target) return false;
  stopAttemptTimers(target);
  return true;
}

function setPeerStatus(patch: Partial<PeerStatus>): void {
  const current = bridgeState.peerStatus;
  const next: PeerStatus = { ...current, ...patch };
  if (
    current.paired === next.paired &&
    current.connected === next.connected &&
    current.markersMatch === next.markersMatch &&
    current.fingerprintMismatch === next.fingerprintMismatch
  )
    return;
  bridgeState.peerStatus = next;
  broadcastState();
}

function localCuesFingerprint(): string {
  return bridgeState.manager?.getState().cuesFingerprint ?? '';
}

function remoteCuesFingerprint(state: unknown): string | null {
  if (!isRecord(state)) return null;
  const fingerprint = state.cuesFingerprint;
  return typeof fingerprint === 'string' ? fingerprint : null;
}

function updateMarkersMatch(target: PeerLink, state: unknown): void {
  target.lastRemoteFingerprint = remoteCuesFingerprint(state);
  recheckMarkersMatch(target);
}

function recheckMarkersMatch(target: PeerLink): void {
  const remote = target.lastRemoteFingerprint;
  setPeerStatus({ markersMatch: remote !== null && remote === localCuesFingerprint() });
}

/** The beat a jump lands on, and the level it lands on. */
function localJumpBeat(payload: unknown): { time: number; section: boolean } | null {
  const state = bridgeState.manager?.getState();
  if (!state || !isRecord(payload)) return null;
  const songIndex = payload.songIndex;
  if (typeof songIndex !== 'number') return null;
  const song = state.songs[songIndex];
  if (!song) return null;
  const sectionIndex = payload.sectionIndex;
  if (typeof sectionIndex === 'number' && sectionIndex >= 0) {
    // A section that does not exist fails here too, so it must not travel.
    const section = song.sections[sectionIndex];
    return section ? { time: section.time, section: true } : null;
  }
  return { time: song.time, section: false };
}

function buildPeerMessage(command: ShowCommand<unknown>): Record<string, unknown> | null {
  const commandId = peerCommandId(command.commandId);
  if (command.type === 'jump') {
    // The paired computer may hold the same songs in another order, so the
    // jump travels as the beat it lands on, not as an index into a list. The
    // level travels with it: a section and the song that shares its beat are
    // not the same jump.
    const beat = localJumpBeat(command.payload);
    if (!beat) return null;
    return { type: 'jump_time', time: beat.time, section: beat.section, commandId };
  }
  return { type: command.type, ...payloadFields(command.payload), commandId };
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
    setPeerStatus({ connected: true });
    return;
  }

  if (message.type === 'state') {
    updateMarkersMatch(target, message.state);
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
    setPeerStatus({ connected: false });
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
  if (target.stopped || link !== target || target.reconnectTimer) return;
  const timing = peerLinkTiming();
  const delay = target.reconnectDelayMs;
  target.reconnectDelayMs = Math.min(delay * 2, timing.reconnectMaxMs);
  target.reconnectTimer = setTimeout(() => {
    target.reconnectTimer = null;
    connectPeer();
  }, delay);
  target.reconnectTimer.unref?.();
}

function onPeerClosed(target: PeerLink): void {
  if (dropIfStale(target)) return;
  target.socket = null;
  target.secureSocket = null;
  target.synchronized = false;
  stopAttemptTimers(target);
  setPeerStatus({ connected: false });
  scheduleReconnect(target);
}

function abortOnFingerprintMismatch(target: PeerLink): void {
  if (dropIfStale(target)) return;
  target.stopped = true;
  target.synchronized = false;
  setPeerStatus({ connected: false, fingerprintMismatch: true });
  const socket = target.socket;
  target.socket = null;
  stopAttemptTimers(target);
  if (socket) closePeerSocket(socket);
  log.warn('peer', 'The paired computer presented a different certificate; the link stopped.');
}

/**
 * Opens the WebSocket on the socket whose certificate was just verified.
 */
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

/**
 * Opens the TLS connection and checks the certificate before anything is
 * said to the paired computer.
 */
function destroyQuietly(socket: tls.TLSSocket): void {
  try {
    socket.destroy();
  } catch {
    // swallow: the attempt is over.
  }
}

function connectPeer(): void {
  const target = link;
  if (!target || target.stopped) return;
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
    if (target.stopped || link !== target) return;
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

function teardownLink(): void {
  const target = link;
  link = null;
  if (!target) return;
  target.stopped = true;
  target.reconnectTimer = stopTimer(target.reconnectTimer);
  stopAttemptTimers(target);
  const { socket, secureSocket } = target;
  target.socket = null;
  target.secureSocket = null;
  target.synchronized = false;
  try {
    // The listeners stay: a socket that still has its own error handling is
    // a socket that cannot raise an unhandled error on the way out.
    socket?.close();
    secureSocket?.destroy();
  } catch {
    // swallow: nothing to do here on purpose.
  }
}

/**
 * Starts the link to the paired computer, if there is one.
 */
export function startPeerLink(config: PeerConfig | null): void {
  teardownLink();
  if (!config) {
    setPeerStatus({
      paired: false,
      connected: false,
      markersMatch: true,
      fingerprintMismatch: false,
    });
    return;
  }
  link = {
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
  };
  setPeerStatus({ paired: true, connected: false, markersMatch: true, fingerprintMismatch: false });
  connectPeer();
}

/**
 * Stops the link to the paired computer.
 */
export function stopPeerLink(): void {
  teardownLink();
  setPeerStatus({ connected: false });
}

/**
 * Whether a command may be written to the socket right now.
 *
 * A socket that still holds what was written to it is a socket nobody is
 * reading, so a command is dropped rather than queued behind the others. Stop
 * and panic go anyway: a second computer left playing is the worse failure.
 */
function canWriteNow(socket: WebSocket | null, type: string): boolean {
  if (!socket) return false;
  return socket.bufferedAmount === 0 || type === 'stop' || type === 'set_panic';
}

/**
 * Forwards a command to the paired computer.
 *
 * Never throws and never rejects: a link that is down must not change what
 * happens on this machine.
 */
export function relayToPeer(command: ShowCommand<unknown>): void {
  try {
    const target = link;
    if (!target || !target.synchronized) return;
    if (!PEER_RELAY_TYPES.has(command.type)) return;
    // A command this computer already refused, a full queue among the
    // reasons, must not run on the other one: the two would part ways.
    if (command.status === 'failed') return;
    if (bridgeState.commandBus?.wouldRejectForSafety(command.type)) return;
    const message = buildPeerMessage(command);
    if (!message) return;
    if (canWriteNow(target.socket, command.type)) sendToPeer(target, message);
  } catch {
    // swallow: a relay failure must never reach the local command.
  }
}
