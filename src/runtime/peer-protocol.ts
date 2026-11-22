// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Delivery 2 peer protocol constants, session tokens, command classifiers, and deadlines.

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getQuantizationBeats, nextQuantizationBoundary } from '../core/next-downbeat-jump.js';
import type { SetlistState, ShowCommand } from '../types.js';
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
