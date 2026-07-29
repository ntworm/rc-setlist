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
  title: string;
  bpm: number | null;
  signature: string;
  key: string;
  durationSec: number | null;
  plays: number;
  lyricLines: number;
  customOrder: number | null;
  inSetlist: boolean;
  cuesCount: number;
  lastPlayedAt: string | null;
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
    'title',
    'bpm',
    'signature',
    'key',
    'duration_sec',
    'plays',
    'lyric_lines',
    'custom_order',
    'in_setlist',
    'cues_count',
    'last_played_at',
  ];

  const lines: string[] = [];
  lines.push(header.map(escapeField).join(CSV_DELIM));

  for (const r of rows) {
    lines.push(
      [
        escapeField(r.index),
        escapeField(r.title),
        escapeField(r.bpm),
        escapeField(r.signature),
        escapeField(r.key),
        escapeField(r.durationSec),
        escapeField(r.plays),
        escapeField(r.lyricLines),
        escapeField(r.customOrder),
        escapeField(r.inSetlist ? 'yes' : 'no'),
        escapeField(r.cuesCount),
        escapeField(r.lastPlayedAt),
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
