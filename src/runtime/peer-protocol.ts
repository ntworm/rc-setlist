// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Delivery 2 peer protocol constants, session tokens, command classifiers, and deadlines.

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getQuantizationBeats, nextQuantizationBoundary } from '../core/next-downbeat-jump.js';
import type { ClientMessage, SetlistState, ShowCommand } from '../types.js';
import { isRecord } from './peer-message.js';

/** Computed delivery deadline and safety-stop classification for a relayed command. */
export interface CommandDeadline {
  deadlineAt: number | null;
  safetyStop: boolean;
}

/** Terminal outcome reported by a slave in a `peer_ack` frame. */
export type PeerAckResult = 'confirmed' | 'failed' | 'expired' | 'superseded';

/** Wire payload for slave-to-master command acknowledgements. */
export interface PeerAckMessage {
  type: 'peer_ack';
  commandId: string;
  result: PeerAckResult;
  reason: string;
  isPlaying: boolean;
  beat: number;
}

/** Direct transport command accepted on a `direct`-role WebSocket with mandatory `commandId`. */
export type DirectCommandMessage = Extract<
  ClientMessage,
  { type: 'jump_time' | 'play' | 'stop' | 'set_panic' }
> & { commandId: string };

/** Wire payload for slave-to-phone direct command acknowledgements. */
export interface DirectAckMessage {
  type: 'direct_ack';
  commandId: string;
  peerCommandId: string;
  result: PeerAckResult;
  reason: string;
  isPlaying: boolean;
  beat: number;
  transportSeq: number;
}

/** Snapshot of confirmed direct command IDs and highest executed transport sequence. */
export interface ConfirmedDirectSummary {
  confirmedIds: string[];
  lastExecutedTransportSeq: number;
}

/** Callback invoked when direct command confirmation needs master reconciliation. */
export type DirectSyncListener = (confirmedId?: string) => void;

/** Builds a `peer_ack` frame from a command outcome and transport snapshot. */
export function makePeerAck(
  commandId: string,
  result: PeerAckResult,
  reason: string,
  snapshot: { isPlaying: boolean; beat: number },
): PeerAckMessage {
  return {
    type: 'peer_ack',
    commandId,
    result,
    reason,
    isPlaying: snapshot.isPlaying,
    beat: snapshot.beat,
  };
}

const WS_READY_OPEN = 1;

/** Sends a JSON-serialized ACK frame if the socket is open, swallowing write errors. */
export function sendPeerFrame(
  ws: { readyState: number; send(data: string): void },
  frame: PeerAckMessage | DirectAckMessage,
): boolean {
  if (ws.readyState !== WS_READY_OPEN) return false;
  try {
    ws.send(JSON.stringify(frame));
    return true;
  } catch {
    return false;
  }
}

/** Builds a `direct_ack` frame from a settled `PeerAckMessage` and current transportSeq. */
export function makeDirectAck(
  commandId: string,
  peerCommandId: string,
  ack: PeerAckMessage,
  transportSeq: number,
): DirectAckMessage {
  return { ...ack, type: 'direct_ack', commandId, peerCommandId, transportSeq };
}

/** Pending direct socket waiting for an in-flight command to settle. */
export interface DirectWaiter<TSocket = { readyState: number; send(data: string): void }> {
  ws: TSocket;
  rawCommandId: string;
}

/** Appends a unique open direct waiter socket for an in-flight command. */
export function addDirectWaiter<TSocket extends { readyState: number; send(data: string): void }>(
  waiters: DirectWaiter<TSocket>[],
  ws: TSocket,
  rawCommandId: string,
): void {
  if (ws.readyState !== WS_READY_OPEN) return;
  if (!waiters.some((w) => w.ws === ws && w.rawCommandId === rawCommandId)) {
    waiters.push({ ws, rawCommandId });
  }
}

/** Removes expired entries from a timestamped ID map using `ttlMs`. */
export function pruneTimedIds(map: Map<string, number>, now: number, ttlMs: number): void {
  for (const [k, ts] of map) {
    if (now - ts >= ttlMs) map.delete(k);
  }
}

/** Records an ID in a bounded LRU map with TTL eviction. */
export function recordTimedId(
  map: Map<string, number>,
  id: string,
  now: number,
  ttlMs: number,
  capacity: number,
): void {
  pruneTimedIds(map, now, ttlMs);
  map.delete(id);
  if (map.size >= capacity) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(id, now);
}

/** Wire envelope for master-to-slave confirmed commands. */
export interface PeerCommandWire {
  type: 'peer_command';
  commandId: string;
  ttlMs: number | null;
  transportSeq: number | null;
  command: Record<string, unknown>;
}

const FALLBACK_EXTENSION_VERSION = '1.2.1';
const DEFAULT_COMMAND_TTL_MS = 1_000;
const MIN_QUANTIZED_DEADLINE_MS = 100;

const TRANSPORT_COMMAND_TYPES: ReadonlySet<string> = new Set([
  'play',
  'stop',
  'jump_time',
  'trigger_count_in',
]);

/** Protocol version announced on peer handshakes for Delivery 2 confirmed commands. */
export const LINK_PROTOCOL_VERSION = 2;

function readExtensionVersion(): string {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const parsed: unknown = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (isRecord(parsed) && typeof parsed.version === 'string') {
      const trimmed = parsed.version.trim();
      if (trimmed !== '') return trimmed;
    }
  } catch {
    // Fall back to static extension version when package.json is unavailable.
  }
  return FALLBACK_EXTENSION_VERSION;
}

/** Extension version read once from package.json with a static fallback. */
export const EXTENSION_VERSION: string = readExtensionVersion();

/**
 * Creates a unique master session identifier for each server start.
 */
export function createMasterSessionId(): string {
  return randomUUID();
}

/**
 * Reports whether a peer wire command mutates transport state and carries a transportSeq.
 */
export function isTransportCommandType(msg: { type: string; active?: unknown }): boolean {
  if (TRANSPORT_COMMAND_TYPES.has(msg.type)) return true;
  return msg.type === 'set_panic' && msg.active === true;
}

/**
 * Reports whether a peer wire command is a safety stop that bypasses normal expiry.
 */
export function isSafetyStopCommand(msg: { type: string; active?: unknown }): boolean {
  return msg.type === 'stop' || (msg.type === 'set_panic' && msg.active === true);
}

function isActivePanicPayload(payload: unknown): boolean {
  return isRecord(payload) && payload.active === true;
}

function isImmediateJump(command: ShowCommand<unknown>): boolean {
  if (command.type !== 'jump' || !isRecord(command.payload)) return false;
  return command.payload.immediate === true;
}

function shouldUseQuantizedWindow(
  command: ShowCommand<unknown>,
  state: SetlistState | null,
): state is SetlistState {
  if (state === null || !state.isPlaying) return false;
  if (command.type === 'play') return true;
  return command.type === 'jump' && !isImmediateJump(command);
}

function quantizedWindowMs(state: SetlistState): number {
  const quant = state.clipTriggerQuantization;
  const quantBeats = getQuantizationBeats(quant, state.signatureNumerator);
  if (quantBeats <= 0 || !Number.isFinite(state.tempo) || state.tempo <= 0) {
    return DEFAULT_COMMAND_TTL_MS;
  }
  if (!Number.isFinite(state.currentSongTime)) return DEFAULT_COMMAND_TTL_MS;
  let nextBeat = nextQuantizationBoundary(state.currentSongTime, quantBeats);
  if (nextBeat <= state.currentSongTime) nextBeat += quantBeats;
  const msToBoundary = ((nextBeat - state.currentSongTime) * 60_000) / state.tempo;
  return Math.max(MIN_QUANTIZED_DEADLINE_MS, Math.round(msToBoundary));
}

/**
 * Computes the delivery deadline and safety-stop classification for a relayed command.
 */
export function computeCommandDeadline(
  command: ShowCommand<unknown>,
  state: SetlistState | null,
  nowMs: number,
): CommandDeadline {
  if (command.type === 'stop') return { deadlineAt: null, safetyStop: true };
  if (command.type === 'set_panic' && isActivePanicPayload(command.payload)) {
    return { deadlineAt: null, safetyStop: true };
  }
  if (shouldUseQuantizedWindow(command, state)) {
    return { deadlineAt: nowMs + quantizedWindowMs(state), safetyStop: false };
  }
  return { deadlineAt: nowMs + DEFAULT_COMMAND_TTL_MS, safetyStop: false };
}
