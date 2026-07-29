import type { Song } from '../types.js';

type TimedSong = Pick<Song, 'title' | 'time' | 'bpm'>;

export interface SetlistMetrics {
  songDurationSecondsByStart: Map<number, number | null>;
  totalDurationSeconds: number | null;
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

export function calculateSetlistMetrics(
  songs: readonly TimedSong[],
  arrangementEndTime: number | null,
  fallbackBpm: number,
): SetlistMetrics {
  const chronological = [...songs].sort((a, b) => a.time - b.time);
  const songDurationSecondsByStart = new Map<number, number | null>();
  let total = 0;
  let complete = chronological.length > 0;

  for (const song of chronological) {
    const duration = calculateSongDurationSec(
      song,
      chronological,
      fallbackBpm,
      arrangementEndTime,
    );
    songDurationSecondsByStart.set(song.time, duration);
    if (duration === null) complete = false;
    else total += duration;
  }

  return {
    songDurationSecondsByStart,
    totalDurationSeconds: complete ? total : null,
  };
}
