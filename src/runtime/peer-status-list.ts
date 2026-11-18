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

import type { PeerLinkStatus, PeerStatus } from '../types.js';

/** What one computer looks like from here. */
export interface PeerLinkState {
  connected: boolean;
  markersMatch: boolean;
  fingerprintMismatch: boolean;
}

/** The parts of a link the list of the paired computers is built from. */
export interface PeerLinkSummary {
  config: { host: string; port: number };
  state: PeerLinkState;
}

/**
 * The rows the paired computers take in the list.
 */
export function peerStatusRows(links: readonly PeerLinkSummary[]): PeerLinkStatus[] {
  return links.map((link) => ({
    host: link.config.host,
    port: link.config.port,
    connected: link.state.connected,
    markersMatch: link.state.markersMatch,
    fingerprintMismatch: link.state.fingerprintMismatch,
  }));
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

/**
 * The state of the link, read from the state of every paired computer.
 *
 * An empty list means no computer is paired at all.
 */
export function aggregatePeerStatus(list: readonly PeerLinkStatus[]): PeerStatus {
  return {
    paired: list.length > 0,
    connected: list.length > 0 && list.every((entry) => entry.connected),
    markersMatch: list.every((entry) => entry.markersMatch),
    fingerprintMismatch: list.some((entry) => entry.fingerprintMismatch),
  };
}
