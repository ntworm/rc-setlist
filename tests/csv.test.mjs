/**
 * Tests for src/core/csv-export.ts (helper, pure functions — node:test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTracklistCsv,
  calculateSongDurationSec,
  csvFilenameTimestamp,
  UTF8_BOM,
} from '../src/core/csv-export.ts';

const sampleRows = [
  {
    index: 1,
    title: 'Sunrise Loop',
    bpm: 120,
    signature: '4/4',
    key: 'C',
    durationSec: 195,
    plays: 12,
    lyricLines: 8,
    customOrder: 2,
    inSetlist: true,
    cuesCount: 3,
    lastPlayedAt: '2026-06-30T22:14:00Z',
  },
  {
    index: 2,
    title: 'Tarde, com; poeira',
    bpm: null,
    signature: '3/4',
    key: '',
    durationSec: null,
    plays: 0,
    lyricLines: 0,
    customOrder: null,
    inSetlist: false,
    cuesCount: 0,
    lastPlayedAt: null,
  },
];

test('buildTracklistCsv: header + rows count', () => {
  const csv = buildTracklistCsv(sampleRows);
  const lines = csv.split('\r\n').filter((l) => l.length > 0);
  assert.equal(lines.length, 3, 'header + 2 rows');
});

test('buildTracklistCsv: BOM present', () => {
  const csv = buildTracklistCsv(sampleRows);
  assert.equal(csv[0], UTF8_BOM, 'starts with UTF-8 BOM');
});

test('buildTracklistCsv: uses ; delim', () => {
  const csv = buildTracklistCsv(sampleRows);
  const header = csv.replace(UTF8_BOM, '').split('\r\n')[0];
  assert.ok(header.includes(';'), 'header uses ;');
  assert.equal(header.split(';')[0], '#');
});

test('buildTracklistCsv: fields with ; or " or newline are quoted', () => {
  const csv = buildTracklistCsv(sampleRows);
  // Row 2 contains "Tarde, com; poeira" — must be quoted, ; inside quoted.
  assert.ok(csv.includes('"Tarde, com; poeira"'), 'quoted semicolon field');
});

test('buildTracklistCsv: null bpm renders as empty', () => {
  const csv = buildTracklistCsv(sampleRows);
  const lines = csv.replace(UTF8_BOM, '').split('\r\n');
  // RFC4180 lite parse: returns string fields respecting double-quotes.
  const parseRow = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQ = false; }
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ';') { out.push(cur); cur = ''; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  };
  // header is line 0, rows start line 1.
  const cols = parseRow(lines[2]);
  assert.equal(cols[2], '', `null bpm -> empty (got "${cols[2]}")`);
});

test('buildTracklistCsv: in_setlist yes/no', () => {
  const csv = buildTracklistCsv(sampleRows);
  assert.ok(csv.includes(';yes;'), 'first row in_setlist=yes');
  assert.ok(csv.includes(';no;'), 'second row in_setlist=no');
});

test('buildTracklistCsv: ends with CRLF', () => {
  const csv = buildTracklistCsv(sampleRows);
  assert.ok(csv.endsWith('\r\n'), 'CSV ends with CRLF');
});

test('csvFilenameTimestamp: stable shape', () => {
  const ts = csvFilenameTimestamp(new Date('2026-07-07T15:04:05Z'));
  assert.match(ts, /^\d{8}-\d{6}$/);
});

test('calculateSongDurationSec: ignores custom display order', () => {
  const first = { time: 0, bpm: 120 };
  const second = { time: 100, bpm: 120 };
  const third = { time: 220, bpm: 120 };
  const displayOrder = [third, first, second];

  assert.equal(calculateSongDurationSec(first, displayOrder, 110), 50);
  assert.equal(calculateSongDurationSec(second, displayOrder, 110), 60);
  assert.equal(calculateSongDurationSec(third, displayOrder, 110), null);
});
