import type { Song } from '../types.js';

export type TimedSong = Pick<Song, 'title' | 'time' | 'bpm'>;

export interface SetlistMetrics {
  songDurationSecondsByStart: Map<number, number | null>;
  songDurationSecondsBySong: Map<TimedSong, number | null>;
  totalDurationSeconds: number | null;
}

function durationFromBoundary(
  song: Pick<TimedSong, 'time' | 'bpm'>,
  nextStart: number | null | undefined,
  fallbackBpm: number,
): number | null {
  const bpm = song.bpm ?? fallbackBpm;
  if (
    typeof nextStart !== 'number'
    || !Number.isFinite(nextStart)
    || typeof bpm !== 'number'
    || !Number.isFinite(bpm)
    || bpm <= 0
  ) {
    return null;
  }
  const durationBeats = nextStart - song.time;
  return durationBeats > 0 ? Math.round((durationBeats / bpm) * 60) : null;
}

export function calculateSongDurationSec(
  song: Pick<TimedSong, 'time' | 'bpm'>,
  songs: readonly Pick<TimedSong, 'time' | 'bpm'>[],
  fallbackBpm: number,
  arrangementEndTime: number | null = null,
): number | null {
  const chronological = [...songs].sort((a, b) => a.time - b.time);
  const index = chronological.indexOf(song);
  const nextStart = index >= 0 && index < chronological.length - 1
    ? chronological[index + 1]!.time
    : arrangementEndTime;
  return durationFromBoundary(song, nextStart, fallbackBpm);
}

export function calculateSetlistMetrics(
  songs: readonly TimedSong[],
  arrangementEndTime: number | null,
  fallbackBpm: number,
): SetlistMetrics {
  const chronological = [...songs].sort((a, b) => a.time - b.time);
  const songDurationSecondsByStart = new Map<number, number | null>();
  const songDurationSecondsBySong = new Map<TimedSong, number | null>();
  let total = 0;
  let complete = chronological.length > 0;

  for (let index = 0; index < chronological.length; index++) {
    const song = chronological[index]!;
    const nextStart = index < chronological.length - 1
      ? chronological[index + 1]!.time
      : arrangementEndTime;
    const duration = durationFromBoundary(song, nextStart, fallbackBpm);
    songDurationSecondsByStart.set(song.time, duration);
    songDurationSecondsBySong.set(song, duration);
    if (duration === null) complete = false;
    else total += duration;
  }

  return {
    songDurationSecondsByStart,
    songDurationSecondsBySong,
    totalDurationSeconds: complete ? total : null,
  };
}
