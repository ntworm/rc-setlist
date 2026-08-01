/**
 * Tests for src/core/csv-export.ts (helper, pure functions — node:test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTracklistCsv,
  calculateSongDurationSec,
  csvFilenameTimestamp,
  formatDuration,
  formatSongAutomations,
  formatSongSections,
  UTF8_BOM,
} from '../src/core/csv-export.ts';

const sampleRows = [
  {
    index: 1,
    setlist: 'Tour; "A"',
    title: 'Sunrise Loop',
    startBeat: 16,
    bpm: 120,
    durationSec: 195,
    duration: '3:15',
    sectionsCount: 3,
    sections: 'Intro | Verse | Chorus',
    automations: 'song [bpm 120] | Chorus [loop 2x] [next]',
    lyricLines: 8,
  },
  {
    index: 2,
    setlist: 'Tour; "A"',
    title: 'Tarde, com; poeira',
    startBeat: 240,
    bpm: null,
    durationSec: null,
    duration: '',
    sectionsCount: 2,
    sections: 'Intro; Rise | Chorus "Finale"',
    automations: '',
    lyricLines: 0,
  },
];

const automationSong = {
  title: 'EM SEU COLO',
  time: 0,
  sections: [
    {
      name: 'Intro', time: 8, loopCount: 2, autoStop: false, autoNext: false,
      bpm: null, autoClick: null, skip: false,
    },
    {
      name: '', time: 32, automationOnly: true, loopCount: null, autoStop: true,
      autoNext: false, bpm: null, autoClick: null, skip: false,
    },
    {
      name: 'Finale', time: 48, loopCount: null, autoStop: false, autoNext: true,
      bpm: null, autoClick: false, skip: true,
    },
  ],
  loopCount: null,
  autoStop: false,
  autoNext: false,
  bpm: 111.11,
  autoClick: true,
  skip: false,
};

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
  assert.equal(
    header,
    '#;setlist;title;start_beat;bpm;duration_sec;duration;sections_count;sections;automations;lyric_lines',
  );
  for (const removed of [
    'signature', 'key', 'plays', 'custom_order', 'in_setlist', 'cues_count', 'last_played_at',
  ]) {
    assert.equal(header.includes(removed), false, `${removed} placeholder must not be exported`);
  }
});

test('buildTracklistCsv: fields with ; or " or newline are quoted', () => {
  const csv = buildTracklistCsv(sampleRows);
  assert.ok(csv.includes('"Tour; ""A"""'), 'quoted setlist field');
  // Row 2 contains "Tarde, com; poeira" — must be quoted, ; inside quoted.
  assert.ok(csv.includes('"Tarde, com; poeira"'), 'quoted semicolon field');
  assert.ok(csv.includes('"Intro; Rise | Chorus ""Finale"""'), 'quoted sections field');
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
  assert.equal(cols[4], '', `null bpm -> empty (got "${cols[4]}")`);
});

test('formatDuration: renders whole nonnegative seconds and leaves unavailable values blank', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(195), '3:15');
  assert.equal(formatDuration(59.6), '1:00');
  assert.equal(formatDuration(null), '');
  assert.equal(formatDuration(Number.NaN), '');
  assert.equal(formatDuration(-1), '');
});

test('formatSongSections: lists only named sections in chronological order', () => {
  assert.deepEqual(formatSongSections(automationSong), {
    count: 2,
    names: 'Intro | Finale',
  });
});

test('formatSongAutomations: preserves song, section and automation-only actions', () => {
  assert.equal(
    formatSongAutomations(automationSong),
    'song [bpm 111.11] [click] | Intro [loop 2x] | @32 [stop] | Finale [next] [click off] [skip]',
  );
  assert.equal(
    formatSongAutomations({ ...automationSong, sections: [], loopCount: -1, bpm: null, autoClick: null }),
    'song [loop]',
  );
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
