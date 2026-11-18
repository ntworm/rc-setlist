// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The setlist of the main computer, pulled over the link.
//
// The second computer asks the first one for its setlist and gets it as a
// package of text, in pieces: the link carries at most one piece at a time.
// A setlist too big for the link is refused rather than cut in half, and a
// piece of a request nobody made is ignored.

import { randomBytes } from 'node:crypto';

import {
  exportSetlistText,
  importPackageText,
  type PackageProfileManager,
} from '../core/setlist-package.js';
import { OperatorError } from '../core/operator-error.js';
import { bridgeState, broadcastProfileState } from './bridge-state.js';
import type { ClientMessage } from '../types.js';

/** The most a piece of the setlist may carry. */
const PIECE_BYTES = 48 * 1024;

/** The most pieces one setlist may be sent in. */
const MAX_PIECES = 600;

/** The most text one setlist may add up to. */
const MAX_SETLIST_BYTES = 25 * 1024 * 1024;

/** How long the second computer waits for the setlist of the first one. */
const SETLIST_TIMEOUT_MS = 20_000;

/** The sentence a pull that did not come through ends with. */
const SETLIST_FAILED = 'The master did not send its setlist.';

/** Where the setlist of the main computer is read from. */
export interface SetlistSource extends PackageProfileManager {
  /** The setlist this computer is showing. */
  getActive(): { id: string; name: string };
}

/** One piece of the setlist of the main computer. */
type SetlistPiece = Extract<ClientMessage, { type: 'setlist_chunk' }>;

/** A request for the setlist of the main computer, waiting for its pieces. */
interface PendingSetlist {
  requestId: string;
  pieces: Map<number, string>;
  total: number | null;
  bytes: number;
  settle: (error: Error | null, text?: string) => void;
  timer: NodeJS.Timeout;
}

/** The requests that are waiting for their pieces. */
const pending = new Map<string, PendingSetlist>();

/**
 * The number of bytes a character takes.
 */
function charBytes(code: number): number {
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/**
 * The text in pieces of at most a piece, so the link never carries more
 * than that at a time.
 */
function splitIntoPieces(text: string): string[] {
  const pieces: string[] = [];
  let current = '';
  let size = 0;
  for (const character of text) {
    const bytes = charBytes(character.codePointAt(0) ?? 0);
    if (size + bytes > PIECE_BYTES) {
      pieces.push(current);
      current = '';
      size = 0;
    }
    current += character;
    size += bytes;
  }
  if (current.length > 0 || pieces.length === 0) pieces.push(current);
  return pieces;
}

/**
 * The name of the project the setlists belong to.
 */
function projectNameOf(name?: string): string {
  return name ?? bridgeState.projectIdentity?.displayName ?? '';
}

/** How long a piece waits for room on the socket, and how often it looks. */
const ROOM_WAIT_MS = 15_000;
const ROOM_POLL_MS = 20;

/**
 * Waits until the socket has room, or says it never came: null from the
 * check means the socket is gone.
 */
async function waitForRoom(room: () => boolean | null): Promise<boolean> {
  const deadline = Date.now() + ROOM_WAIT_MS;
  for (;;) {
    const answer = room();
    if (answer === null) return false;
    if (answer) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, ROOM_POLL_MS));
  }
}

/**
 * Answers a request for the setlist of this computer.
 *
 * The setlist travels in pieces: the link carries at most one at a time. A
 * setlist that cannot be read is refused, so the second computer learns
 * that nothing is coming instead of waiting for an answer that never comes.
 */
export async function answerSetlistRequest(
  requestId: string,
  send: (message: unknown) => boolean,
  manager?: SetlistSource,
  projectName?: string,
  room: () => boolean | null = () => true,
): Promise<void> {
  const source = manager ?? bridgeState.profileManager;
  const name = projectNameOf(projectName);
  try {
    if (!source) throw new Error('There is no setlist to send.');
    const active = source.getActive();
    const text = await exportSetlistText(source, active.id, name);
    const pieces = splitIntoPieces(text);
    if (pieces.length > MAX_PIECES || Buffer.byteLength(text, 'utf8') > MAX_SETLIST_BYTES) {
      throw new Error('The setlist is too large to send.');
    }
    for (const [index, data] of pieces.entries()) {
      // A piece waits for room on the socket, so the commands of the show
      // that share it are never held back behind the setlist.
      if (!(await waitForRoom(room))) return;
      if (!send({ type: 'setlist_chunk', requestId, index, total: pieces.length, data })) return;
    }
  } catch {
    // The refusal is a piece of its own: the second computer reads it as
    // "there is nothing to send" and stops waiting.
    send({ type: 'setlist_chunk', requestId, index: 0, total: 0, data: '' });
  }
}

/**
 * Closes a request and hands back its answer.
 */
function settle(request: PendingSetlist, error: Error | null, text?: string): void {
  clearTimeout(request.timer);
  pending.delete(request.requestId);
  request.settle(error, text);
}

/**
 * Gives up on a request that cannot be answered.
 */
function failSetlist(requestId: string): void {
  const request = pending.get(requestId);
  if (!request) return;
  settle(request, new OperatorError(SETLIST_FAILED));
}

/**
 * Waits for the pieces of the setlist of the main computer.
 */
function waitForSetlist(requestId: string): Promise<string> {
  let answer: (error: Error | null, text?: string) => void = () => {};
  const promise = new Promise<string>((resolve, reject) => {
    answer = (error, text) => {
      if (error) reject(error);
      else resolve(text ?? '');
    };
  });
  const request: PendingSetlist = {
    requestId,
    pieces: new Map(),
    total: null,
    bytes: 0,
    settle: answer,
    timer: setTimeout(() => {
      settle(request, new OperatorError(SETLIST_FAILED));
    }, SETLIST_TIMEOUT_MS),
  };
  request.timer.unref?.();
  pending.set(requestId, request);
  return promise;
}

/**
 * Whether a piece belongs to the setlist that is being waited for.
 */
function isPieceOfRequest(request: PendingSetlist, msg: SetlistPiece): boolean {
  // The refusal of the main computer: there is nothing to send.
  if (msg.total === 0) return false;
  if (msg.index < 0 || msg.index >= msg.total) return false;
  if (request.total !== null && request.total !== msg.total) return false;
  const bytes = Buffer.byteLength(msg.data, 'utf8');
  if (request.bytes + bytes > MAX_SETLIST_BYTES) return false;
  return true;
}

/**
 * The pieces of a setlist, in the order they belong together.
 */
function joinPieces(request: PendingSetlist): string {
  let text = '';
  for (let index = 0; index < (request.total ?? 0); index += 1) {
    text += request.pieces.get(index) ?? '';
  }
  return text;
}

/**
 * Takes in a piece of the setlist of the main computer.
 *
 * A piece of a request nobody made is ignored: the link carries what the
 * other side said, and a request that is not ours is not ours to answer.
 */
export function receiveSetlistChunk(msg: ClientMessage): void {
  if (msg.type !== 'setlist_chunk') return;
  const request = pending.get(msg.requestId);
  if (!request) return;
  // A piece that came twice keeps the first one.
  if (request.pieces.has(msg.index)) return;
  if (!isPieceOfRequest(request, msg)) {
    settle(request, new OperatorError(SETLIST_FAILED));
    return;
  }
  request.total = msg.total;
  request.bytes += Buffer.byteLength(msg.data, 'utf8');
  request.pieces.set(msg.index, msg.data);
  if (request.pieces.size < msg.total) return;
  settle(request, null, joinPieces(request));
}

/**
 * Asks the main computer for its setlist and brings it here.
 *
 * The setlist comes in as a package of text, in pieces, and lands here as a
 * setlist of its own: the one the main computer has, with its order, its
 * song book and its lyrics.
 */
export async function requestMasterSetlist(): Promise<{ names: string[] }> {
  const socket = bridgeState.wsServer?.peerSockets()[0];
  if (!socket) throw new OperatorError('No master is connected.');
  const requestId = randomBytes(8).toString('hex');
  const answer = waitForSetlist(requestId);
  try {
    socket.send(JSON.stringify({ type: 'setlist_request', requestId }));
  } catch {
    // The request never left this computer: nothing will come back.
    failSetlist(requestId);
  }
  const text = await answer;
  const manager = bridgeState.profileManager;
  if (!manager) throw new OperatorError(SETLIST_FAILED);
  const result = await importPackageText(manager, text);
  broadcastProfileState();
  return result;
}
