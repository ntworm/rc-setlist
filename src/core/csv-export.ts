import type { Section, Song } from '../types.js';

/**
 * CSV export helper for setlist tracklist.
 *
 * Format: ';'-separated, '\r\n' line endings, UTF-8 with BOM.
 * Optimized for Excel BR (default list separator). Also opens cleanly in
 * LibreOffice / Google Sheets / Numbers.
 */

export { calculateSongDurationSec } from './setlist-metrics.js';

export const CSV_DELIM = ';';
export const CSV_LINE_END = '\r\n';
export const UTF8_BOM = '\uFEFF';

export interface CsvTracklistRow {
  index: number;
  setlist: string;
  title: string;
  startBeat: number;
  bpm: number | null;
  durationSec: number | null;
  duration: string;
  sectionsCount: number;
  sections: string;
  automations: string;
  lyricLines: number;
}

type AutomationTarget = Pick<
  Song | Section,
  'loopCount' | 'autoStop' | 'autoNext' | 'bpm' | 'autoClick' | 'skip'
>;

function formatAutomationTags(target: AutomationTarget): string[] {
  const tags: string[] = [];
  if (target.loopCount === -1) tags.push('[loop]');
  else if (target.loopCount !== null && target.loopCount > 0) tags.push(`[loop ${target.loopCount}x]`);
  if (target.autoStop) tags.push('[stop]');
  if (target.autoNext) tags.push('[next]');
  if (target.bpm !== null && Number.isFinite(target.bpm) && target.bpm > 0) {
    tags.push(`[bpm ${target.bpm}]`);
  }
  if (target.autoClick === true) tags.push('[click]');
  else if (target.autoClick === false) tags.push('[click off]');
  if (target.skip) tags.push('[skip]');
  return tags;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '';
  const wholeSeconds = Math.round(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

export function formatSongSections(song: Pick<Song, 'sections'>): { count: number; names: string } {
  const names = [...song.sections]
    .sort((a, b) => a.time - b.time)
    .map((section) => section.name.trim())
    .filter(Boolean);
  return { count: names.length, names: names.join(' | ') };
}

export function formatSongAutomations(song: Song): string {
  const entries: string[] = [];
  const songTags = formatAutomationTags(song);
  if (songTags.length > 0) entries.push(`song ${songTags.join(' ')}`);

  for (const section of [...song.sections].sort((a, b) => a.time - b.time)) {
    const tags = formatAutomationTags(section);
    if (tags.length === 0) continue;
    const label = section.name.trim() || `@${section.time}`;
    entries.push(`${label} ${tags.join(' ')}`);
  }

  return entries.join(' | ');
}

function escapeField(value: string | number | null | boolean | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Quote if contains delim, quote, newline or carriage return.
  // Double up quotes inside.
  if (/[";\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildTracklistCsv(rows: CsvTracklistRow[]): string {
  const header = [
    '#',
    'setlist',
    'title',
    'start_beat',
    'bpm',
    'duration_sec',
    'duration',
    'sections_count',
    'sections',
    'automations',
    'lyric_lines',
  ];

  const lines: string[] = [];
  lines.push(header.map(escapeField).join(CSV_DELIM));

  for (const r of rows) {
    lines.push(
      [
        escapeField(r.index),
        escapeField(r.setlist),
        escapeField(r.title),
        escapeField(r.startBeat),
        escapeField(r.bpm),
        escapeField(r.durationSec),
        escapeField(r.duration),
        escapeField(r.sectionsCount),
        escapeField(r.sections),
        escapeField(r.automations),
        escapeField(r.lyricLines),
      ].join(CSV_DELIM)
    );
  }

  return UTF8_BOM + lines.join(CSV_LINE_END) + CSV_LINE_END;
}

export function csvFilenameTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}
