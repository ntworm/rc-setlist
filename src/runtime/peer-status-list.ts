// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The state of the paired computers, as a list.
//
// The page asks one question about the link, and there may be several
// computers behind it. The answer is the honest one: the link is up when
// every computer is up, the markers differ when they differ anywhere, and a
// computer that presented another certificate is said so even when the
// others are fine.

import type {
  PeerFollowMode,
  PeerHealthReason,
  PeerHealthTier,
  PeerLinkStatus,
  PeerStatus,
} from '../types.js';

/** What one computer looks like from here. */
export interface PeerLinkState {
  connected: boolean;
  markersMatch: boolean;
  fingerprintMismatch: boolean;
  versionMismatch?: boolean;
  health?: PeerHealthTier;
  reason?: PeerHealthReason;
  canAcknowledge?: boolean;
  rttP95Ms?: number | null;
  drops5m?: number;
  lastDropAt?: number | null;
  remoteLinkHealth?: PeerHealthTier | null;
  followMode?: PeerFollowMode | null;
}

/** The parts of a link the list of the paired computers is built from. */
export interface PeerLinkSummary {
  key?: string;
  role?: 'outbound' | 'inbound';
  config: { host: string; port: number };
  state: PeerLinkState;
}

const HEALTH_RANK: Readonly<Record<PeerHealthTier, number>> = {
  ok: 0,
  unstable: 1,
  down: 2,
};

function rowHealth(state: {
  connected: boolean;
  markersMatch: boolean;
  health?: PeerHealthTier;
}): PeerHealthTier {
  if (state.health !== undefined) return state.health;
  if (!state.connected) return 'down';
  return state.markersMatch ? 'ok' : 'unstable';
}

function rowReason(state: PeerLinkState): PeerHealthReason {
  if (state.reason !== undefined) return state.reason;
  if (!state.connected) return 'link_down';
  return state.markersMatch ? 'ok' : 'markers_differ';
}

function rowTelemetry(state: PeerLinkState) {
  return {
    versionMismatch: state.versionMismatch ?? false,
    canAcknowledge: state.canAcknowledge ?? false,
    rttP95Ms: state.rttP95Ms ?? null,
    drops5m: state.drops5m ?? 0,
    lastDropAt: state.lastDropAt ?? null,
    remoteLinkHealth: state.remoteLinkHealth ?? null,
    followMode: state.followMode ?? null,
  };
}

function toPeerStatusRow(link: PeerLinkSummary): PeerLinkStatus {
  const { state } = link;
  return {
    key: link.key ?? `${link.config.host.toLowerCase()}:${link.config.port}`,
    role: link.role ?? 'outbound',
    host: link.config.host,
    port: link.config.port,
    connected: state.connected,
    markersMatch: state.markersMatch,
    fingerprintMismatch: state.fingerprintMismatch,
    health: rowHealth(state),
    reason: rowReason(state),
    ...rowTelemetry(state),
  };
}

/**
 * The rows the paired computers take in the list.
 */
export function peerStatusRows(links: readonly PeerLinkSummary[]): PeerLinkStatus[] {
  return links.map(toPeerStatusRow);
}

/**
 * Whether two lists of computers are the same list.
 */
export function samePeerStatusRows(
  a: readonly PeerLinkStatus[],
  b: readonly PeerLinkStatus[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function entryReason(entry: PeerLinkStatus, tier: PeerHealthTier): PeerHealthReason {
  if (entry.reason !== undefined) return entry.reason;
  if (!entry.connected) return 'link_down';
  if (!entry.markersMatch) return 'markers_differ';
  if (tier === 'down') return 'link_down';
  if (tier === 'unstable') return 'markers_differ';
  return 'ok';
}

function worstPeerEntry(list: readonly PeerLinkStatus[]): {
  health: PeerHealthTier;
  reason: PeerHealthReason;
} {
  let worstHealth: PeerHealthTier = 'ok';
  let worstEntry: PeerLinkStatus | null = null;
  for (const entry of list) {
    const health = rowHealth(entry);
    if (worstEntry === null || HEALTH_RANK[health] > HEALTH_RANK[worstHealth]) {
      worstHealth = health;
      worstEntry = entry;
    }
  }
  if (!worstEntry) return { health: 'ok', reason: 'ok' };
  return { health: worstHealth, reason: entryReason(worstEntry, worstHealth) };
}

function maxNullableNumber(values: readonly (number | null | undefined)[]): number | null {
  let max: number | null = null;
  for (const value of values) {
    if (typeof value !== 'number') continue;
    if (max === null || value > max) max = value;
  }
  return max;
}

function maxDrops5m(list: readonly PeerLinkStatus[]): number {
  let max = 0;
  for (const entry of list) {
    const drops = entry.drops5m ?? 0;
    if (drops > max) max = drops;
  }
  return max;
}

/**
 * The state of the link, read from the state of every paired computer.
 *
 * An empty list means no computer is paired at all.
 */
export function aggregatePeerStatus(list: readonly PeerLinkStatus[]): PeerStatus {
  const { health, reason } = worstPeerEntry(list);
  return {
    paired: list.length > 0,
    connected: list.length > 0 && list.every((entry) => entry.connected),
    markersMatch: list.every((entry) => entry.markersMatch),
    fingerprintMismatch: list.some((entry) => entry.fingerprintMismatch),
    versionMismatch: list.some((entry) => entry.versionMismatch === true),
    health,
    reason,
    canAcknowledge: health === 'unstable' && list.some((entry) => entry.canAcknowledge === true),
    rttP95Ms: maxNullableNumber(list.map((entry) => entry.rttP95Ms)),
    drops5m: maxDrops5m(list),
    lastDropAt: maxNullableNumber(list.map((entry) => entry.lastDropAt)),
  };
}
