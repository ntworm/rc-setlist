import { bridgeState } from '../runtime/bridge-state.js';
import { getExtensionContext } from '../context.js';
import { log } from '../util/log.js';

function isValidTempo(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Resolves the jump target tempo.
 */
export function resolveJumpTargetTempo(
  songIndex: number,
  sectionIndex: number | null,
): number | null {
  const song = bridgeState.manager?.getState().songs[songIndex];
  if (!song) return null;

  const section = sectionIndex === null ? null : song.sections[sectionIndex];
  if (isValidTempo(section?.bpm)) return section.bpm;
  return isValidTempo(song.bpm) ? song.bpm : null;
}

/**
 * Apply the destination tempo before a cue jump — but only when the user has
 * asked for it and nothing suggests Live owns the tempo.
 *
 * Returns the tempo written, or null when nothing was written. A null return is
 * the normal, safe case; it is not an error.
 */
export function applyJumpTargetTempo(
  songIndex: number,
  sectionIndex: number | null,
): number | null {
  if (!bridgeState.writeTempoOnJump) return null;
  if (bridgeState.manager?.isTempoAutomationSuspected()) return null;

  const bpm = resolveJumpTargetTempo(songIndex, sectionIndex);
  if (bpm === null) return null;

  try {
    const liveSong = getExtensionContext()?.application.song;
    if (liveSong) {
      liveSong.tempo = bpm;
      return bpm;
    }
  } catch {
    log.warn('commands', 'SDK tempo setter failed; falling back to AbletonOSC.');
  }

  try {
    bridgeState.oscClient?.send('/live/song/set/tempo', [{ type: 'float', value: bpm }]);
  } catch {
    // Preserve the established jump boundary if the fallback transport is unavailable.
  }
  return bpm;
}
