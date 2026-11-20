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

/** The commands handed up, by the id the main computer sends them back with. */
const pending = new Map<string, { original: string; timer: NodeJS.Timeout }>();

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

/** Whether this computer would refuse the command itself, or cannot send it now. */
function refusedHere(msg: ClientMessage, socket: AugmentedWebSocket): boolean {
  if (!canWriteNow(socket, msg.type)) return true;
  if (bridgeState.commandBus?.wouldRejectForSafety(msg.type)) return true;
  if (bridgeState.profileScopeSwitching) return true;
  return msg.type === 'jump' && immediateJumpRefused(msg);
}

/**
 * Hands a command of a phone or of the panel up to the main computer.
 * Returns true when the main computer has it, and false when it must run
 * here as before. Never throws.
 */
export function forwardToMaster(msg: ClientMessage, commandId: string): boolean {
  try {
    if (!PEER_RELAY_TYPES.has(msg.type)) return false;
    const socket = masterSocket();
    if (!socket) return false;
    const key = peerCommandId(commandId);
    // A retry of a command already handed up waits for the first one.
    if (pending.has(key)) return true;
    if (pending.size >= MAX_PENDING || refusedHere(msg, socket)) return false;
    const built = buildPeerMessage({ commandId, type: msg.type, payload: msg } as ShowCommand);
    if (!built) return false;
    socket.send(JSON.stringify({ type: 'peer_upstream', command: { ...built, commandId } }));
    const timer = setTimeout(() => {
      if (forget(key) === null) return;
      settleFailed(
        commandId,
        'timeout',
        'The main computer did not answer; the command did not run.',
      );
    }, UPSTREAM_TIMEOUT_MS);
    timer.unref?.();
    pending.set(key, { original: commandId, timer });
    bridgeState.wsServer?.broadcast({ type: 'command_status', commandId, status: 'sent' });
    return true;
  } catch {
    return false;
  }
}

/**
 * A command the main computer sent down, with the id the phone of this
 * computer gave it when it was one that was handed up from here.
 */
export function adoptUpstreamEcho(msg: ClientMessage): ClientMessage {
  if (!msg.commandId) return msg;
  const original = forget(msg.commandId);
  return original === null ? msg : { ...msg, commandId: original };
}

/** The main computer refused a command handed up from here. */
export function handleUpstreamRefusal(refusal: UpstreamRefusal): void {
  const key = peerCommandId(refusal.commandId);
  if (forget(key) === null) return;
  settleFailed(
    refusal.commandId,
    'execution_failed',
    `The main computer refused the command (${refusal.reason}); it did not run.`,
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
}
