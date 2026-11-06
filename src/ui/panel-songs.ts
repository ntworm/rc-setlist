/**
 * The songs of the active setlist and the deleted setlists, as the panel
 * lists them.
 *
 * Both are read out of state the extension already holds. A value that
 * does not look right is skipped, never trusted: the panel still opens.
 */

import { colorsByTime, parseSongBook } from '../core/song-book.js';
import type { PanelDeletedProfileEntry } from './panel-project.js';

/** One song of the active setlist. */
export interface PanelSongEntry {
  title: string;
  durationSeconds: number | null;
  sectionCount: number;
  color: string;
}

/** The most songs the panel lists. */
const MAX_SONGS = 300;

/** A colour of the song book: a hex colour, nothing else. */
const COLOR = /^#[0-9a-f]{6}$/i;

/**
 * The colours of the song book, by the beat a song starts on.
 */
export function readSongColors(songBook: unknown): Record<string, string> {
  if (!songBook || typeof songBook !== 'object') return {};
  try {
    return colorsByTime(parseSongBook(songBook));
  } catch {
    return {};
  }
}

/**
 * One song of the setlist, as the panel lists it.
 */
function readSong(item: unknown, colors: Record<string, string>): PanelSongEntry | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  if (typeof record.title !== 'string') return null;
  const duration = record.durationSeconds;
  const color = colors[String(record.time)] ?? '';
  return {
    title: record.title,
    durationSeconds: typeof duration === 'number' && Number.isFinite(duration) ? duration : null,
    sectionCount: Array.isArray(record.sections) ? record.sections.length : 0,
    color: COLOR.test(color) ? color : '',
  };
}

/**
 * The songs of the setlist, in the order the setlist plays them.
 */
export function readSongs(value: unknown, colors: Record<string, string>): PanelSongEntry[] {
  if (!Array.isArray(value)) return [];
  const songs: PanelSongEntry[] = [];
  for (const item of value.slice(0, MAX_SONGS)) {
    const song = readSong(item, colors);
    if (song) songs.push(song);
  }
  return songs;
}

/**
 * The deleted setlists, out of the payload of the profile state.
 */
export function readDeletedProfiles(value: unknown): PanelDeletedProfileEntry[] {
  if (!Array.isArray(value)) return [];
  const deleted: PanelDeletedProfileEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.name !== 'string') continue;
    deleted.push({
      id: record.id,
      name: record.name,
      deletedAt: typeof record.deletedAt === 'string' ? record.deletedAt : '',
    });
  }
  return deleted;
}
