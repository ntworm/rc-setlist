// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// What a peer connection is allowed to do, and what a jump by beat means.
//
// The paired computer may hold the same songs in another order, so a jump
// cannot travel as an index into a list. It travels as the beat it lands on,
// and the receiving side finds the marker that sits there.

import type { ClientMessage, SetlistState } from '../../types.js';
import { PEER_RELAY_TYPES } from '../../runtime/peer-link.js';

export interface PeerCommandRejection {
  code: string;
  message: string;
}

export interface PeerJumpTarget {
  songIndex: number;
  sectionIndex: number | null;
}

export type PeerJumpResolution =
  | { kind: 'none' }
  | { kind: 'jump'; message: ClientMessage }
  | { kind: 'error'; code: string; message: string };

/**
 * The command types a peer connection may run.
 *
 * The handshake and the confirmation belong to the connection itself, and
 * `jump_time` is how a jump travels between two computers. `jump` is not in
 * the list: an index into a list means nothing on the other side.
 */
export function isPeerCommandType(type: string): boolean {
  if (type === 'handshake' || type === 'sync_confirm' || type === 'jump_time') return true;
  return PEER_RELAY_TYPES.has(type) && type !== 'jump';
}

/**
 * Reports why a peer connection may not run this message, or null when it
 * may.
 */
export function peerCommandRejection(
  msg: ClientMessage,
  isPeer: boolean,
): PeerCommandRejection | null {
  if (msg.type === 'jump_time') {
    if (!isPeer) {
      return {
        code: 'unauthorized',
        message: 'Unauthorized: only a peer connection may send a jump by beat.',
      };
    }
    return null;
  }
  if (isPeer && !isPeerCommandType(msg.type)) {
    return {
      code: 'unauthorized',
      message: 'Unauthorized: this command is not allowed for a peer connection.',
    };
  }
  return null;
}

/**
 * How far a marker may sit from the beat of a jump and still be its marker.
 *
 * The limit is exclusive: a marker at less than a hundredth of a beat is the
 * marker, one a hundredth away is another. The closest marker wins, and on a
 * tie the first in the displayed order, so the answer never depends on which
 * of two equal candidates the loop met last.
 */
const MAX_BEAT_DISTANCE = 0.01;

function findSectionAtBeat(state: SetlistState, targetTime: number): PeerJumpTarget | null {
  let bestTarget: PeerJumpTarget | null = null;
  let minDistance = MAX_BEAT_DISTANCE;
  for (let songIndex = 0; songIndex < state.songs.length; songIndex += 1) {
    const song = state.songs[songIndex];
    if (!song) continue;
    for (let sectionIndex = 0; sectionIndex < song.sections.length; sectionIndex += 1) {
      const section = song.sections[sectionIndex];
      if (!section || section.automationOnly) continue;
      const distance = Math.abs(section.time - targetTime);
      if (distance < minDistance) {
        minDistance = distance;
        bestTarget = { songIndex, sectionIndex };
      }
    }
  }
  return bestTarget;
}

function findSongAtBeat(state: SetlistState, targetTime: number): PeerJumpTarget | null {
  let bestTarget: PeerJumpTarget | null = null;
  let minDistance = MAX_BEAT_DISTANCE;
  for (let songIndex = 0; songIndex < state.songs.length; songIndex += 1) {
    const song = state.songs[songIndex];
    if (!song) continue;
    const distance = Math.abs(song.time - targetTime);
    if (distance < minDistance) {
      minDistance = distance;
      bestTarget = { songIndex, sectionIndex: null };
    }
  }
  return bestTarget;
}

/**
 * Finds the marker that sits at a beat.
 *
 * The level of the jump decides what is looked for first. A jump that landed
 * on a section looks for the section first, and falls back to the song; a
 * jump that landed on a song looks for the song first, and answers with no
 * section at all, because the loop of a song is not the loop of the section
 * that happens to share its beat.
 */
export function resolveJumpTime(
  state: SetlistState,
  time: number,
  section = false,
): PeerJumpTarget | null {
  if (section) return findSectionAtBeat(state, time) ?? findSongAtBeat(state, time);
  return findSongAtBeat(state, time) ?? findSectionAtBeat(state, time);
}

/**
 * Turns a jump that arrived by beat into a jump this computer understands.
 */
export function resolvePeerJump(msg: ClientMessage, state: SetlistState): PeerJumpResolution {
  if (msg.type !== 'jump_time') return { kind: 'none' };
  const target = resolveJumpTime(state, msg.time, msg.section === true);
  if (!target) {
    return {
      kind: 'error',
      code: 'peer_no_marker',
      message: 'No marker sits at that beat.',
    };
  }
  const message: ClientMessage = {
    type: 'jump',
    songIndex: target.songIndex,
    sectionIndex: target.sectionIndex,
    ...(msg.commandId ? { commandId: msg.commandId } : {}),
  };
  return { kind: 'jump', message };
}
