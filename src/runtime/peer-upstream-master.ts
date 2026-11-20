// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The commands the main computer takes from its second computers.
//
// A phone opened on a second computer hands its transport commands up the
// link; the main computer reads each one as it would read one of its own
// pages, and runs it through the handler the server sets.

import { PEER_RELAY_TYPES, isRecord } from './peer-message.js';
import { decodeClientMessage } from '../server/client-message.js';
import type { ClientMessage } from '../types.js';

/**
 * The commands a second computer may hand up: the ones that travel down,
 * with a jump by beat instead of a jump by index.
 */
const UPSTREAM_TYPES: ReadonlySet<string> = new Set(
  [...PEER_RELAY_TYPES].map((type) => (type === 'jump' ? 'jump_time' : type)),
);

/** How the main computer answers a second computer about a command it handed up. */
export type PeerUpstreamReply = (refusal: { reason: string }) => void;

/** Runs a command a second computer handed up, as if it were one of this computer. */
export type PeerUpstreamHandler = (message: ClientMessage, refuse: PeerUpstreamReply) => void;

let upstreamHandler: PeerUpstreamHandler | null = null;

/** Sets who runs the commands the second computers hand up, or null for nobody. */
export function setPeerUpstreamHandler(handler: PeerUpstreamHandler | null): void {
  upstreamHandler = handler;
}

/**
 * A second computer handed up a command of a phone or of its panel. Only a
 * computer in sync may, only for the commands that travel, and only once the
 * message reads as one this computer would take from a page.
 */
export function receivePeerUpstream(
  command: unknown,
  synchronized: boolean,
  send: (reply: Record<string, unknown>) => void,
): void {
  const commandId =
    isRecord(command) && typeof command.commandId === 'string' ? command.commandId : null;
  const refuse: PeerUpstreamReply = ({ reason }) => {
    if (commandId === null) return;
    send({ type: 'peer_upstream_result', commandId, ok: false, reason });
  };
  if (!synchronized || !upstreamHandler) {
    refuse({ reason: 'not_ready' });
    return;
  }
  const decoded = decodeClientMessage(command);
  if (!decoded.ok || !UPSTREAM_TYPES.has(decoded.message.type) || !decoded.message.commandId) {
    refuse({ reason: 'invalid' });
    return;
  }
  try {
    upstreamHandler(decoded.message, refuse);
  } catch {
    refuse({ reason: 'failed' });
  }
}
