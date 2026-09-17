import type { Song, Section } from '../types.js';

export type TimedSection = Pick<Section, 'time'> & { bpm?: number | null };
export type TimedSong = Pick<Song, 'title' | 'time' | 'bpm'> & {
  sections?: readonly TimedSection[];
};

export interface SetlistMetrics {
  songDurationSecondsByStart: Map<number, number | null>;
  songDurationSecondsBySong: Map<TimedSong, number | null>;
  totalDurationSeconds: number | null;
}

/**
 * How duration is measured, and why it is measured this way.
 *
 * The arrangement is laid out in BEATS. Turning beats into seconds needs a
 * tempo, and the tempo Live is playing right now is the wrong one to use: it
 * makes every duration — and therefore the set total — depend on what the
 * player happened to be doing at the moment you looked. A set total that moves
 * while you play is not a number anyone can plan a show around.
 *
 * So duration is a pure function of declared data:
 *
 *   1. The whole setlist is one chronological timeline of TEMPO EVENTS. A song
 *      tag `[bpm N]` is an event at the song's beat position; a section tag is
 *      an event at the section's position. There is no per-song fallback chain,
 *      because tempo does not reset at a song boundary — whatever was last
 *      declared is still in effect when the next song starts.
 *   2. Any beat span is integrated piecewise across the events inside it.
 *   3. Before the first declared event, `fallbackBpm` applies. The caller
 *      freezes that value; see SetlistManager.computeDurationFallbackBpm.
 *
 * Nothing here ever reads the live transport. That is the whole point.
 */

interface TempoEvent {
  time: number;
  bpm: number;
}

function usableBpm(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** One chronological tempo timeline for the entire setlist. */
export function buildTempoTimeline(songs: readonly TimedSong[]): TempoEvent[] {
  const events: TempoEvent[] = [];
  for (const song of songs) {
    if (!Number.isFinite(song.time)) continue;
    const songBpm = usableBpm(song.bpm);
    if (songBpm !== null) events.push({ time: song.time, bpm: songBpm });
    for (const section of song.sections ?? []) {
      const sectionBpm = usableBpm(section?.bpm);
      if (sectionBpm !== null && Number.isFinite(section.time)) {
        events.push({ time: section.time, bpm: sectionBpm });
      }
    }
  }
  events.sort((a, b) => a.time - b.time);
  // A later declaration at the same beat wins; earlier ones never took effect.
  const deduped: TempoEvent[] = [];
  for (const event of events) {
    const last = deduped[deduped.length - 1];
    if (last && last.time === event.time) deduped[deduped.length - 1] = event;
    else deduped.push(event);
  }
  return deduped;
}

/**
 * Exact seconds for a beat span, integrated across the tempo timeline.
 * Returns null when the span is not measurable. Never rounds: rounding is done
 * once, at the boundary where a human reads the number.
 */
export function spanSeconds(
  fromBeat: number,
  toBeat: number,
  timeline: readonly TempoEvent[],
  fallbackBpm: number,
): number | null {
  if (!Number.isFinite(fromBeat) || !Number.isFinite(toBeat) || usableBpm(fallbackBpm) === null) {
    return null;
  }
  const span = toBeat - fromBeat;
  if (!(span > 0)) return null;

  // Tempo in effect at fromBeat: the last event at or before it.
  let currentBpm = fallbackBpm;
  for (const event of timeline) {
    if (event.time <= fromBeat) currentBpm = event.bpm;
    else break;
  }

  let seconds = 0;
  let cursor = fromBeat;
  for (const event of timeline) {
    if (event.time <= fromBeat) continue;
    if (event.time >= toBeat) break;
    seconds += ((event.time - cursor) / currentBpm) * 60;
    cursor = event.time;
    currentBpm = event.bpm;
  }
  seconds += ((toBeat - cursor) / currentBpm) * 60;
  return seconds;
}

/**
 * CalculateSetlistMetrics — implementation detail.
 */
export function calculateSetlistMetrics(
  songs: readonly TimedSong[],
  arrangementEndTime: number | null,
  fallbackBpm: number,
): SetlistMetrics {
  const chronological = [...songs]
    .filter((song) => Number.isFinite(song.time))
    .sort((a, b) => a.time - b.time);
  const timeline = buildTempoTimeline(chronological);

  const songDurationSecondsByStart = new Map<number, number | null>();
  const songDurationSecondsBySong = new Map<TimedSong, number | null>();
  let exactTotal = 0;
  let complete = chronological.length > 0;

  for (let index = 0; index < chronological.length; index++) {
    const song = chronological[index]!;
    const nextStart =
      index < chronological.length - 1 ? chronological[index + 1]!.time : arrangementEndTime;

    const exact =
      typeof nextStart === 'number'
        ? spanSeconds(song.time, nextStart, timeline, fallbackBpm)
        : null;

    const displayed = exact === null ? null : Math.round(exact);
    songDurationSecondsByStart.set(song.time, displayed);
    songDurationSecondsBySong.set(song, displayed);

    if (exact === null) complete = false;
    else exactTotal += exact;
  }

  // The total is summed from EXACT seconds and rounded once. Summing values
  // that were each already rounded drifts by up to half a second per song and
  // the bias does not cancel: a 40-song set can be off by a quarter minute.
  return {
    songDurationSecondsByStart,
    songDurationSecondsBySong,
    totalDurationSeconds: complete ? Math.round(exactTotal) : null,
  };
}

/**
 * Single-song entry point. Delegates to the same timeline the setlist uses, so
 * the CSV export and the UI can never disagree about the same song.
 */
export function calculateSongDurationSec(
  song: TimedSong,
  songs: readonly TimedSong[],
  fallbackBpm: number,
  arrangementEndTime: number | null = null,
): number | null {
  const metrics = calculateSetlistMetrics(songs, arrangementEndTime, fallbackBpm);
  const direct = metrics.songDurationSecondsBySong.get(song);
  if (direct !== undefined) return direct;
  return metrics.songDurationSecondsByStart.get(song.time) ?? null;
}
