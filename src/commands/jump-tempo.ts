import { bridgeState } from '../core/bridge-state.js';
import { getExtensionContext } from '../context.js';

function isValidTempo(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function resolveJumpTargetTempo(songIndex: number, sectionIndex: number | null): number | null {
  const song = bridgeState.manager?.getState().songs[songIndex];
  if (!song) return null;

  const section = sectionIndex === null ? null : song.sections[sectionIndex];
  if (isValidTempo(section?.bpm)) return section.bpm;
  return isValidTempo(song.bpm) ? song.bpm : null;
}

export function applyJumpTargetTempo(songIndex: number, sectionIndex: number | null): number | null {
  const bpm = resolveJumpTargetTempo(songIndex, sectionIndex);
  if (bpm === null) return null;

  try {
    const liveSong = getExtensionContext()?.application.song;
    if (liveSong) {
      liveSong.tempo = bpm;
      return bpm;
    }
  } catch {
    console.warn('[Jump] SDK tempo setter failed; falling back to AbletonOSC.');
  }

  try {
    bridgeState.oscClient?.send('/live/song/set/tempo', [{ type: 'float', value: bpm }]);
  } catch {
    // Preserve the established jump boundary if the fallback transport is unavailable.
  }
  return bpm;
}
