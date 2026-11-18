// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// A command of this computer, as it travels to the paired computers.

import { bridgeState } from './bridge-state.js';
import { isRecord, payloadFields, peerCommandId } from './peer-message.js';
import type { ShowCommand } from '../types.js';

/** The beat a jump lands on, and the level it lands on. */
function localJumpBeat(payload: unknown): { time: number; section: boolean } | null {
  const state = bridgeState.manager?.getState();
  if (!state || !isRecord(payload)) return null;
  const songIndex = payload.songIndex;
  if (typeof songIndex !== 'number') return null;
  const song = state.songs[songIndex];
  if (!song) return null;
  const sectionIndex = payload.sectionIndex;
  if (typeof sectionIndex === 'number' && sectionIndex >= 0) {
    // A section that does not exist fails here too, so it must not travel.
    const section = song.sections[sectionIndex];
    return section ? { time: section.time, section: true } : null;
  }
  return { time: song.time, section: false };
}

/** The message a command of this computer becomes for the paired ones. */
export function buildPeerMessage(command: ShowCommand<unknown>): Record<string, unknown> | null {
  const commandId = peerCommandId(command.commandId);
  if (command.type === 'jump') {
    // The paired computer may hold the same songs in another order, so the
    // jump travels as the beat it lands on, not as an index into a list. The
    // level travels with it: a section and the song that shares its beat are
    // not the same jump.
    const beat = localJumpBeat(command.payload);
    if (!beat) return null;
    // An immediate jump lands at once on this computer, so it must land at
    // once on the other one too.
    const immediate =
      isRecord(command.payload) && typeof command.payload.immediate === 'boolean'
        ? command.payload.immediate
        : undefined;
    return {
      type: 'jump_time',
      time: beat.time,
      section: beat.section,
      ...(immediate === undefined ? {} : { immediate }),
      commandId,
    };
  }
  return { type: command.type, ...payloadFields(command.payload), commandId };
}
