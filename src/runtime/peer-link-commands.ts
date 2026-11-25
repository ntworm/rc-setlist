// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Master-side pending command relay, 150 ms retry flushing, peer_ack handling, and alerts.

import type { WebSocket } from 'ws';
import type { ShowCommand } from '../types.js';
import { bridgeState, broadcastState } from './bridge-state.js';
import {
  applyPeerDirectSync,
  parsePeerDirectSync,
  type ConfirmedRef,
} from './peer-direct-targets.js';
import { sendPeerJson, stopTimer } from './peer-liveness.js';
import { isRecord, PEER_RELAY_TYPES, roomOnSocket } from './peer-message.js';
import { answerSetlistRequest } from './peer-setlist.js';
import { receivePeerUpstream } from './peer-upstream-master.js';
import {
  buildPeerCommandStatusEvent,
  PeerPendingTable,
  type PeerCommandStatus,
  type PendingEntry,
} from './peer-pending.js';
import {
  computeCommandDeadline,
  createMasterSessionId,
  EXTENSION_VERSION,
  isTransportCommandType,
  LINK_PROTOCOL_VERSION,
  type PeerAckMessage,
  type PeerAckResult,
} from './peer-protocol.js';
import { buildPeerMessage } from './peer-relay-message.js';

/** The client id this side announces itself with on peer handshakes. */
const PEER_CLIENT_ID = 'rc-peer';

/** Poll cadence for checking due 150 ms command retries and deadlines without interval aliasing. */
const PENDING_FLUSH_POLL_MS = 30;

/** Minimal link surface required to enqueue, flush, and acknowledge confirmed peer commands. */
export interface PeerCommandTarget {
  readonly key: string;
  readonly config: { readonly host: string; readonly port: number };
  socket: WebSocket | null;
  synchronized: boolean;
  stopped: boolean;
  readonly state: {
    readonly fingerprintMismatch: boolean;
    readonly versionMismatch?: boolean;
  };
  readonly pending: PeerPendingTable;
  pendingTimer: NodeJS.Timeout | null;
  rttMs(): number;
}

interface PreparedRelayCommand {
  commandId: string;
  originalCommandId: string;
  commandType: string;
  wireCommand: Record<string, unknown>;
  transportSeq: number | null;
  safetyStop: boolean;
  deadlineAt: number | null;
  createdAt: number;
}

let stopPendingIntent = false;
let sawStoppedSinceStop = false;
let panicPendingIntent = false;
let sawPanickedSincePanic = false;

/**
 * Creates a fresh per-link pending command table.
 */
export function createPeerPendingTable(): PeerPendingTable {
  return new PeerPendingTable();
}

/**
 * Builds the Protocol 2 outbound peer handshake frame using the active master session id.
 */
export function buildPeerHandshakeMessage(): Record<string, unknown> {
  const sessionId =
    bridgeState.masterSessionId || (bridgeState.masterSessionId = createMasterSessionId());
  return {
    type: 'handshake',
    clientId: PEER_CLIENT_ID,
    extensionVersion: EXTENSION_VERSION,
    linkProtocol: LINK_PROTOCOL_VERSION,
    sessionId,
  };
}

/**
 * Reports whether an incoming `handshake_ack` announces the required link protocol version.
 */
export function isCompatiblePeerProtocol(message: Record<string, unknown>): boolean {
  const remoteProtocol = typeof message.linkProtocol === 'number' ? message.linkProtocol : 1;
  return remoteProtocol === LINK_PROTOCOL_VERSION;
}

/**
 * Resets tracked master stop and panic relay intents on server or link reset.
 */
export function resetMasterRelayIntent(): void {
  stopPendingIntent = false;
  sawStoppedSinceStop = false;
  panicPendingIntent = false;
  sawPanickedSincePanic = false;
}

function isRelayEligible(target: PeerCommandTarget): boolean {
  if (target.stopped || target.state.fingerprintMismatch) return false;
  return target.state.versionMismatch !== true;
}

function isPeerAckResult(value: unknown): value is PeerAckResult {
  return (
    value === 'confirmed' || value === 'failed' || value === 'expired' || value === 'superseded'
  );
}

function parsePeerAck(message: Record<string, unknown>): PeerAckMessage | null {
  if (message.type !== 'peer_ack') return null;
  if (typeof message.commandId !== 'string' || message.commandId === '') return null;
  if (!isPeerAckResult(message.result)) return null;
  if (typeof message.reason !== 'string') return null;
  if (typeof message.isPlaying !== 'boolean') return null;
  if (typeof message.beat !== 'number' || !Number.isFinite(message.beat)) return null;
  return {
    type: 'peer_ack',
    commandId: message.commandId,
    result: message.result,
    reason: message.reason,
    isPlaying: message.isPlaying,
    beat: message.beat,
  };
}

function broadcastCommandStatus(
  target: PeerCommandTarget,
  entry: ConfirmedRef,
  status: PeerCommandStatus,
  reason?: string,
): void {
  bridgeState.wsServer?.broadcast(
    buildPeerCommandStatusEvent({
      peerKey: target.key,
      host: target.config.host,
      port: target.config.port,
      entry,
      status,
      ...(reason ? { reason } : {}),
    }),
  );
}

function recordAlert(
  peerKey: string,
  entry: PendingEntry,
  status: PeerCommandStatus,
  reason?: string,
): void {
  const existing = bridgeState.peerAlerts[peerKey];
  if (existing?.status === 'stop_unacked' && status !== 'stop_unacked') {
    return;
  }
  bridgeState.peerAlerts[peerKey] = {
    commandId: entry.originalCommandId,
    commandType: entry.commandType,
    status,
    ...(reason ? { reason } : {}),
    at: Date.now(),
  };
  broadcastState();
}

function shouldClearStopUnacked(
  existingCommandId: string,
  entry: PendingEntry,
  settledStatus: PeerCommandStatus,
): boolean {
  if (existingCommandId === entry.originalCommandId) return true;
  if (settledStatus !== 'confirmed') return false;
  return (
    entry.safetyStop || entry.commandType === 'play' || entry.commandType === 'trigger_count_in'
  );
}

function clearAlertIfMatches(
  peerKey: string,
  entry: PendingEntry,
  settledStatus: PeerCommandStatus,
): void {
  const existing = bridgeState.peerAlerts[peerKey];
  if (!existing) return;
  const shouldClear =
    existing.status === 'stop_unacked'
      ? shouldClearStopUnacked(existing.commandId, entry, settledStatus)
      : existing.commandId === entry.originalCommandId ||
        (settledStatus === 'confirmed' && existing.commandType === entry.commandType);
  if (shouldClear) {
    delete bridgeState.peerAlerts[peerKey];
    broadcastState();
  }
}

function updateMasterRelayIntent(
  command: ShowCommand<unknown>,
  isPlaying: boolean,
  isPanicked: boolean,
): void {
  if (command.type === 'stop') {
    stopPendingIntent = true;
    sawStoppedSinceStop = !isPlaying;
    return;
  }
  if (command.type === 'play' || command.type === 'trigger_count_in') {
    stopPendingIntent = false;
    sawStoppedSinceStop = false;
    return;
  }
  if (command.type === 'set_panic') {
    const active = isRecord(command.payload) && command.payload.active === true;
    panicPendingIntent = active;
    sawPanickedSincePanic = active && isPanicked;
  }
}

function resolveMasterStopped(isPlaying: boolean): boolean {
  if (stopPendingIntent) {
    if (!isPlaying) sawStoppedSinceStop = true;
    else if (sawStoppedSinceStop) stopPendingIntent = false;
  }
  return !isPlaying || (stopPendingIntent && !sawStoppedSinceStop);
}

function resolveMasterPanicked(isPanicked: boolean): boolean {
  if (panicPendingIntent) {
    if (isPanicked) sawPanickedSincePanic = true;
    else if (sawPanickedSincePanic) panicPendingIntent = false;
  }
  return isPanicked || (panicPendingIntent && !sawPanickedSincePanic);
}

function readMasterFlags(): { masterIsStopped: boolean; masterIsPanicked: boolean } {
  const state = bridgeState.manager?.getState();
  const isPlaying = state ? state.isPlaying : false;
  const isPanicked = state ? state.safety.panicActive : false;
  return {
    masterIsStopped: resolveMasterStopped(isPlaying),
    masterIsPanicked: resolveMasterPanicked(isPanicked),
  };
}

function flushPeerPending(target: PeerCommandTarget): void {
  if (!isRelayEligible(target) || target.pending.size() === 0) return;
  const { masterIsStopped, masterIsPanicked } = readMasterFlags();
  const bufferedAmount = target.socket ? target.socket.bufferedAmount : 0;
  const due = target.pending.collectDueSends({
    synchronized: target.synchronized,
    rttMs: target.rttMs(),
    bufferedAmount,
    masterIsStopped,
    masterIsPanicked,
  });
  for (const entry of due.cancelled) {
    clearAlertIfMatches(target.key, entry, 'superseded');
    broadcastCommandStatus(target, entry, 'superseded');
  }
  for (const entry of due.expired) {
    recordAlert(target.key, entry, 'expired', 'timeout');
    broadcastCommandStatus(target, entry, 'expired', 'timeout');
  }
  for (const entry of due.stopAlerts) {
    recordAlert(target.key, entry, 'stop_unacked');
    broadcastCommandStatus(target, entry, 'stop_unacked');
  }
  for (const wire of due.toSend) {
    sendPeerJson(target.socket, wire);
  }
}

/**
 * Starts the unref'd retry and expiry flush timer for a peer link.
 */
export function startPendingFlushTimer(target: PeerCommandTarget): void {
  if (target.pendingTimer) return;
  target.pendingTimer = setInterval(() => {
    if (!isRelayEligible(target)) {
      target.pendingTimer = stopTimer(target.pendingTimer);
      return;
    }
    flushPeerPending(target);
  }, PENDING_FLUSH_POLL_MS);
  target.pendingTimer.unref?.();
}

/**
 * Stops the pending flush timer and clears queued commands and alerts for a peer link.
 */
export function stopPendingCommandState(target: PeerCommandTarget): void {
  target.pendingTimer = stopTimer(target.pendingTimer);
  target.pending.clear();
  if (bridgeState.peerAlerts[target.key]) {
    delete bridgeState.peerAlerts[target.key];
    broadcastState();
  }
}

/**
 * Re-arms all queued commands after reconnect and flushes due frames immediately.
 */
export function onPeerPendingReconnect(target: PeerCommandTarget): void {
  target.pending.onReconnect();
  flushPeerPending(target);
}

function handlePeerAck(target: PeerCommandTarget, message: Record<string, unknown>): void {
  const ack = parsePeerAck(message);
  if (!ack) return;
  const outcome = target.pending.onAck(ack);
  if (outcome.kind === 'unknown') return;
  if (outcome.kind === 'safety_retry') {
    recordAlert(target.key, outcome.entry, 'stop_unacked');
    broadcastCommandStatus(target, outcome.entry, 'stop_unacked', ack.reason || undefined);
    return;
  }
  if (outcome.kind === 'late_confirmed') {
    recordAlert(target.key, outcome.entry, 'late_confirmed');
    broadcastCommandStatus(target, outcome.entry, 'late_confirmed');
    return;
  }
  const { entry } = outcome;
  const reason = ack.reason || undefined;
  if (ack.result === 'failed' || ack.result === 'expired') {
    recordAlert(target.key, entry, ack.result, reason);
  } else {
    clearAlertIfMatches(target.key, entry, ack.result);
  }
  broadcastCommandStatus(target, entry, ack.result, reason);
}

function handlePeerDirectSync(target: PeerCommandTarget, message: Record<string, unknown>): void {
  if (!target.synchronized || !isRelayEligible(target)) return;
  const sync = parsePeerDirectSync(message);
  if (sync === null) return;
  applyPeerDirectSync(
    target,
    sync,
    (entry) => clearAlertIfMatches(target.key, entry, 'confirmed'),
    (entry) => broadcastCommandStatus(target, entry, 'confirmed'),
  );
}

/**
 * Dispatches peer_ack, peer_direct_sync, setlist_request, and peer_upstream frames for an outbound peer link.
 */
export function dispatchPeerCommandFrame(
  target: PeerCommandTarget,
  message: Record<string, unknown>,
): boolean {
  if (message.type === 'peer_ack') {
    handlePeerAck(target, message);
    return true;
  }
  if (message.type === 'peer_direct_sync') {
    handlePeerDirectSync(target, message);
    return true;
  }
  if (message.type === 'setlist_request' && typeof message.requestId === 'string') {
    void answerSetlistRequest(
      message.requestId,
      (msg) => sendPeerJson(target.socket, msg),
      undefined,
      undefined,
      () => roomOnSocket(target.socket),
    );
    return true;
  }
  if (message.type === 'peer_upstream') {
    receivePeerUpstream(message.command, target.synchronized, (reply) =>
      sendPeerJson(target.socket, reply),
    );
    return true;
  }
  return false;
}

/**
 * Broadcasts a warning when the paired computer rejects a relayed jump for a missing marker.
 */
export function warnPeerNoMarker(): void {
  bridgeState.wsServer?.broadcastLog(
    'The paired computer has no marker at that beat; the jump did not go through.',
    'warn',
  );
}

function validateAndBuildWire(
  command: ShowCommand<unknown>,
): { commandId: string; type: string; wireCommand: Record<string, unknown> } | null {
  if (!PEER_RELAY_TYPES.has(command.type) || command.status === 'failed') return null;
  const bus = bridgeState.commandBus;
  if (bus && bus.wouldRejectForSafety(command.type)) return null;
  const wireCommand = buildPeerMessage(command);
  if (!wireCommand || typeof wireCommand.commandId !== 'string') return null;
  if (typeof wireCommand.type !== 'string') return null;
  return { commandId: wireCommand.commandId, type: wireCommand.type, wireCommand };
}

function nextTransportSeq(type: string, active: unknown): number | null {
  if (!isTransportCommandType({ type, active })) return null;
  bridgeState.masterTransportSeq += 1;
  bridgeState.masterTargetSeq = bridgeState.masterTransportSeq;
  return bridgeState.masterTransportSeq;
}

function prepareRelayCommand(command: ShowCommand<unknown>): PreparedRelayCommand | null {
  const built = validateAndBuildWire(command);
  if (!built) return null;
  const state = bridgeState.manager ? bridgeState.manager.getState() : null;
  const createdAt = performance.now();
  const { deadlineAt, safetyStop } = computeCommandDeadline(command, state, createdAt);
  const transportSeq = nextTransportSeq(built.type, built.wireCommand.active);
  updateMasterRelayIntent(
    command,
    state ? state.isPlaying : false,
    state ? state.safety.panicActive : false,
  );
  return {
    commandId: built.commandId,
    originalCommandId: command.commandId,
    commandType: command.type,
    wireCommand: built.wireCommand,
    transportSeq,
    safetyStop,
    deadlineAt,
    createdAt,
  };
}

function enqueueForTarget(target: PeerCommandTarget, prepared: PreparedRelayCommand): boolean {
  const result = target.pending.enqueue(prepared);
  for (const cancelled of result.cancelled) {
    clearAlertIfMatches(target.key, cancelled, 'superseded');
    broadcastCommandStatus(target, cancelled, 'superseded');
  }
  if (result.evicted) {
    recordAlert(target.key, result.evicted, 'expired', 'timeout');
    broadcastCommandStatus(target, result.evicted, 'expired', 'timeout');
  }
  if (result.evicted === result.entry) return false;
  broadcastCommandStatus(target, result.entry, 'pending');
  if (target.synchronized) flushPeerPending(target);
  return true;
}

/**
 * Enqueues a validated show command on every eligible paired link and flushes synchronized links.
 */
export function relayCommandToPeers(
  targets: Iterable<PeerCommandTarget>,
  command: ShowCommand<unknown>,
): boolean {
  const eligible = [...targets].filter(isRelayEligible);
  if (eligible.length === 0) return false;
  const prepared = prepareRelayCommand(command);
  if (!prepared) return false;
  let enqueuedAny = false;
  for (const target of eligible) {
    if (enqueueForTarget(target, prepared)) enqueuedAny = true;
  }
  return enqueuedAny;
}
