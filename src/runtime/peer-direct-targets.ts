// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Validation and master-side reconciliation of slave peer_direct_sync frames.

import { bridgeState, broadcastState } from './bridge-state.js';
import { peerCommandId } from './peer-message.js';
import type { PeerPendingTable, PendingEntry } from './peer-pending.js';

const MAX_SYNC_CONFIRMED_IDS = 512;
const MAX_SYNC_COMMAND_ID_LEN = 256;
const MAX_SYNC_TRANSPORT_SEQ = Number.MAX_SAFE_INTEGER - 1_000_000;

/** Minimal outbound link target surface needed to reconcile `peer_direct_sync`. */
export interface DirectSyncTarget {
  readonly key: string;
  readonly pending: PeerPendingTable;
  readonly config: { readonly host: string; readonly port: number };
}

/** Minimal command reference required to broadcast a confirmed `peer_command_status`. */
export type ConfirmedRef = Pick<PendingEntry, 'originalCommandId' | 'commandId' | 'commandType'>;

function isValidSyncSeq(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_SYNC_TRANSPORT_SEQ
  );
}

function parseConfirmedIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_SYNC_CONFIRMED_IDS) return null;
  const confirmedIds: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_SYNC_COMMAND_ID_LEN) {
      return null;
    }
    confirmedIds.push(id);
  }
  return confirmedIds;
}

/** Validates a `peer_direct_sync` frame and returns a clean copy or `null` when malformed. */
export function parsePeerDirectSync(
  message: Record<string, unknown>,
): { confirmedIds: string[]; lastExecutedTransportSeq: number } | null {
  if (message.type !== 'peer_direct_sync') return null;
  const seq = message.lastExecutedTransportSeq;
  if (!isValidSyncSeq(seq)) return null;
  const confirmedIds = parseConfirmedIds(message.confirmedIds);
  if (confirmedIds === null) return null;
  return { confirmedIds, lastExecutedTransportSeq: seq };
}

function reconcileConfirmedId(
  target: DirectSyncTarget,
  id: string,
  clearAlert: (entry: PendingEntry) => void,
  broadcastConfirmed: (entry: ConfirmedRef) => void,
): void {
  const match = target.pending.onExternalConfirm(id);
  if (match) {
    if (match.kind === 'active') {
      clearAlert(match.entry);
    } else {
      const existing = bridgeState.peerAlerts[target.key];
      if (existing && existing.commandId === match.entry.originalCommandId) {
        delete bridgeState.peerAlerts[target.key];
        broadcastState();
      }
    }
    broadcastConfirmed(match.entry);
    return;
  }
  const existing = bridgeState.peerAlerts[target.key];
  if (existing && peerCommandId(existing.commandId) === id) {
    delete bridgeState.peerAlerts[target.key];
    broadcastState();
    broadcastConfirmed({
      originalCommandId: existing.commandId,
      commandId: id,
      commandType: existing.commandType,
    });
  }
}

/**
 * Reconciles confirmed direct command IDs against pending entries and alerts,
 * advancing `masterTransportSeq` without moving `masterTargetSeq`.
 */
export function applyPeerDirectSync(
  target: DirectSyncTarget,
  sync: { confirmedIds: string[]; lastExecutedTransportSeq: number },
  clearAlert: (entry: PendingEntry) => void,
  broadcastConfirmed: (entry: ConfirmedRef) => void,
): void {
  for (const id of sync.confirmedIds) {
    reconcileConfirmedId(target, id, clearAlert, broadcastConfirmed);
  }
  bridgeState.masterTransportSeq = Math.max(
    bridgeState.masterTransportSeq,
    sync.lastExecutedTransportSeq,
  );
}
