// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The commands a second computer hands up to the main one.
//
// A phone opened on a second computer drives the whole show: its transport
// commands travel up the connection the main computer holds with this one,
// the main computer runs them as its own and sends them down to every
// computer it is paired with, this one included. The command lands here when
// it comes back down, with the id the phone gave it, so the phone sees its
// own command settle and nothing runs twice.
//
// When the main computer is not there, the command runs here alone, as it
// always did, and the operator is told so.

import { bridgeState, readPeerRole } from './bridge-state.js';
import { PEER_RELAY_TYPES, canWriteNow, peerCommandId } from './peer-message.js';
import { buildPeerMessage } from './peer-relay-message.js';
import { immediateJumpRefused } from '../commands/handlers/transport.js';
import type { AugmentedWebSocket, ClientMessage, ShowCommand } from '../types.js';

/** How long the main computer has to send a command back, and how many may wait. */
const UPSTREAM_TIMEOUT_MS = 3000;
const MAX_PENDING = 64;
/** How long a command that timed out still takes its own id when it comes back late. */
const LATE_ECHO_MS = 60_000;

/** The commands handed up, by the id the main computer sends them back with. */
const pending = new Map<string, { original: string; timer: NodeJS.Timeout }>();
/** The commands that timed out: the main computer may still have run them. */
const late = new Map<string, { original: string; at: number }>();

/** What the main computer answers when it refuses a command handed up to it. */
export interface UpstreamRefusal {
  commandId: string;
  reason: string;
}

/** The connection of the main computer, when it is there and in sync. */
function masterSocket(): AugmentedWebSocket | null {
  const sockets = bridgeState.wsServer?.peerSockets() ?? [];
  return sockets.find((ws) => ws.synchronized === true) ?? null;
}

/** Tells the pages that a command handed up did not run anywhere. */
function settleFailed(commandId: string, reason: 'timeout' | 'execution_failed', error: string) {
  bridgeState.wsServer?.broadcast({
    type: 'command_status',
    commandId,
    status: 'failed',
    reason,
    error,
  });
  bridgeState.wsServer?.broadcastLog(error, 'warn');
}

/** Forgets one command handed up, and stops its clock. */
function forget(key: string): string | null {
  const entry = pending.get(key);
  if (!entry) return null;
  clearTimeout(entry.timer);
  pending.delete(key);
  return entry.original;
}

/**
 * Whether this computer refuses the command itself. Such a command takes the
 * path it always took here, and is refused there the same way.
 */
function refusedHere(msg: ClientMessage): boolean {
  if (bridgeState.commandBus?.wouldRejectForSafety(msg.type)) return true;
  return msg.type === 'jump' && immediateJumpRefused(msg);
}

/**
 * The link a command of this type goes up, when this computer is a second
 * computer whose main computer is there: a computer that is the main one
 * itself hands nothing up, even to a computer it was once the second of.
 */
function upstreamSocket(type: string): AugmentedWebSocket | null {
  if (!PEER_RELAY_TYPES.has(type)) return null;
  if (readPeerRole().role !== 'slave') return null;
  return masterSocket();
}

/** Remembers a command that timed out, so a late echo still takes its id. */
function rememberLate(key: string, original: string, now: number): void {
  for (const [lateKey, entry] of late) {
    if (now - entry.at >= LATE_ECHO_MS || late.size >= MAX_PENDING) late.delete(lateKey);
  }
  late.set(key, { original, at: now });
}

/** Sends the command up and starts the clock it has to come back within. */
function sendUp(socket: AugmentedWebSocket, msg: ClientMessage, commandId: string): boolean {
  const built = buildPeerMessage({ commandId, type: msg.type, payload: msg } as ShowCommand);
  if (!built) return false;
  socket.send(JSON.stringify({ type: 'peer_upstream', command: { ...built, commandId } }));
  const key = peerCommandId(commandId);
  const timer = setTimeout(() => {
    if (forget(key) === null) return;
    rememberLate(key, commandId, Date.now());
    settleFailed(commandId, 'timeout', 'The main computer did not answer in time.');
  }, UPSTREAM_TIMEOUT_MS);
  timer.unref?.();
  pending.set(key, { original: commandId, timer });
  bridgeState.wsServer?.broadcast({ type: 'command_status', commandId, status: 'sent' });
  return true;
}

/**
 * Hands a command of a phone or of the panel up to the main computer.
 *
 * Returns true when the command is taken care of: it went up, or the link
 * to the main computer could not carry it and the command failed here
 * rather than run on this computer alone. Returns false when it must run
 * here as before: no main computer, or a command this computer refuses
 * anyway. Never throws.
 */
export function forwardToMaster(msg: ClientMessage, commandId: string): boolean {
  const socket = upstreamSocket(msg.type);
  if (!socket) return false;
  // A retry of a command already handed up waits for the first one.
  if (pending.has(peerCommandId(commandId))) return true;
  if (refusedHere(msg)) return false;
  try {
    if (pending.size < MAX_PENDING && canWriteNow(socket, msg.type)) {
      if (sendUp(socket, msg, commandId)) return true;
      // A jump to a marker this computer does not have fails here as before.
      if (msg.type === 'jump') return false;
    }
  } catch {
    // The link broke under the send: the command fails below.
  }
  settleFailed(
    commandId,
    'execution_failed',
    'The link to the main computer is busy; the command did not run.',
  );
  return true;
}

/**
 * A command the main computer sent down, with the id the phone of this
 * computer gave it when it was one that was handed up from here.
 */
export function adoptUpstreamEcho(msg: ClientMessage): ClientMessage {
  if (!msg.commandId) return msg;
  let original = forget(msg.commandId);
  if (original === null) {
    // A late echo: the main computer ran it, so this computer follows.
    original = late.get(msg.commandId)?.original ?? null;
    late.delete(msg.commandId);
  }
  return original === null ? msg : { ...msg, commandId: original };
}

/** Tells the phone that a command that came back down could not land here. */
export function failAdoptedEcho(commandId: string, error: string): void {
  settleFailed(commandId, 'execution_failed', error);
}

/** The main computer refused a command handed up from here. */
export function handleUpstreamRefusal(refusal: UpstreamRefusal): void {
  const key = peerCommandId(refusal.commandId);
  if (forget(key) === null) return;
  settleFailed(
    refusal.commandId,
    'execution_failed',
    `The main computer refused the command (${refusal.reason}).`,
  );
}

/**
 * Tells the operator of a second computer that a command ran here alone,
 * because the main computer is not connected.
 */
export function noteRanWithoutMaster(type: string): void {
  if (!PEER_RELAY_TYPES.has(type)) return;
  if (readPeerRole().role !== 'slave' || masterSocket() !== null) return;
  bridgeState.wsServer?.broadcastLog(
    'The main computer is not connected: the command ran on this computer only.',
    'warn',
  );
}

/** Forgets every command handed up; the server is going down. */
export function resetPeerUpstream(): void {
  for (const key of [...pending.keys()]) forget(key);
  late.clear();
}
