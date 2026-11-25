// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Slave follow-mode enforcement helpers for relay filtering, pending cleanup, and navigation lock.

import type { ConnectionRole, PeerFollowMode } from '../types.js';
import { bridgeState, broadcastState, isSlaveLocked } from './bridge-state.js';

/** Browser command types refused on a synchronized slave following a master. */
const SLAVE_LOCKED_COMMAND_TYPES: ReadonlySet<string> = new Set([
  'play',
  'jump',
  'trigger_count_in',
  'metronome',
  'set_quantization',
  'set_pre_roll',
]);

/** Minimal target surface needed to inspect remote follow mode on the master. */
export interface FollowModeTargetView {
  readonly state: {
    readonly followMode?: PeerFollowMode | null;
  };
  remoteFollowMode?: () => PeerFollowMode | null;
}

/** Minimal target surface needed to clear pending commands and alerts when a slave goes independent. */
export interface ClearablePendingTarget {
  readonly key: string;
  readonly pending: { clear(): void };
}

/**
 * Reports whether a peer target currently advertises `independent` mode.
 * Missing or null follow mode (such as older peers) is treated as `follow`.
 */
export function isIndependentTarget(target: FollowModeTargetView): boolean {
  const mode = target.remoteFollowMode ? target.remoteFollowMode() : target.state.followMode;
  return mode === 'independent';
}

/**
 * Clears queued pending commands and active alerts for a peer that switched to `independent`
 * without raising new alerts or stopping the link's flush timer.
 */
export function clearPendingForIndependent(target: ClearablePendingTarget): void {
  target.pending.clear();
  if (bridgeState.peerAlerts[target.key]) {
    delete bridgeState.peerAlerts[target.key];
    broadcastState();
  }
}

/**
 * Reports whether an incoming client command must be rejected with `slave_locked`.
 */
export function shouldRejectSlaveLocked(role: ConnectionRole, commandType: string): boolean {
  return role === 'browser' && isSlaveLocked() && SLAVE_LOCKED_COMMAND_TYPES.has(commandType);
}
