// Tag-evaluation helpers that used to live inside `SetlistManager`. Lifted
// here so the song/section key rules ("section overrides song, fires once
// per entry") have one owner.
//
// The full check-and-fire logic stays in `SetlistManager` because it has to
// reach into loop state, getLoopRegion / getNextCue / resolveJumpTarget, and
// several other manager-only concerns. What lives here are the pieces that
// are pure over the inputs they are given: the song/section keys, the
// fired-flag reconcile, and the reset for a fresh song.

import type { Song, Section } from '../types.js';

/** The `<tag>:song@<beat>` key used to mark a fired song-level tag. */
export function songKey(song: Song): string {
  return `song@${song.time}`;
}

/** The `<tag>:section@<beat>` key used to mark a fired section-level tag. */
export function sectionKey(section: Section): string {
  return `section@${section.time}`;
}

export interface FiredStateSnapshot {
  firedAutomations: Set<string>;
  lastSongKey: string | null;
  lastSectionKey: string | null;
}

export interface FiredStateUpdate {
  lastSongKey: string | null;
  lastSectionKey: string | null;
}

/**
 * Update the song/section key tracking. Crossing into a new section makes
 * that section's tags fresh again. It must not make the song's tags fresh: a
 * song-level tag fires once when the song is entered, not once per section
 * boundary inside it. Only a new song clears everything.
 *
 * Song keys are `<tag>:song@<beat>`; section keys are `<tag>:section@<beat>`.
 *
 * The function mutates the passed-in `firedAutomations` Set in place, but
 * returns the new key values so the caller can write them back to its own
 * fields (those are strings, which are passed by value).
 */
export function reconcileSongSectionKeys(
  state: FiredStateSnapshot,
  activeSong: Song | null,
  activeSection: Section | null,
): FiredStateUpdate {
  const songKeyValue = activeSong ? songKey(activeSong) : null;
  const sectionKeyValue = activeSection ? sectionKey(activeSection) : null;
  if (songKeyValue !== state.lastSongKey) {
    state.firedAutomations.clear();
    return { lastSongKey: songKeyValue, lastSectionKey: sectionKeyValue };
  }
  if (sectionKeyValue !== state.lastSectionKey) {
    for (const fired of [...state.firedAutomations]) {
      if (!fired.includes(':song@')) state.firedAutomations.delete(fired);
    }
    return { lastSongKey: state.lastSongKey, lastSectionKey: sectionKeyValue };
  }
  return { lastSongKey: state.lastSongKey, lastSectionKey: state.lastSectionKey };
}

/** Clear the song-level fired flags so the next song can re-fire them. */
export function resetFiredAutomations(
  state: { firedAutomations: Set<string> } & FiredStateSnapshot,
): void {
  state.firedAutomations.clear();
  state.lastSongKey = null;
  state.lastSectionKey = null;
}
