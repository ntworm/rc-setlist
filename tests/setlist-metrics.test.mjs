import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSetlistMetrics,
  calculateSongDurationSec,
} from '../src/core/setlist-metrics.ts';

test('metrics use chronological boundaries despite custom display order', () => {
  const first = { title: 'First', time: 0, bpm: 120 };
  const second = { title: 'Second', time: 120, bpm: 60 };
  const displayOrder = [second, first];
  const result = calculateSetlistMetrics(displayOrder, 240, 100);

  assert.deepEqual(
    [...result.songDurationSecondsByStart.entries()],
    [[0, 60], [120, 120]],
  );
  assert.equal(result.totalDurationSeconds, 180);
});

test('metrics return unknown final duration when Arrangement end is unavailable', () => {
  const song = { title: 'Only', time: 32, bpm: 120 };
  const result = calculateSetlistMetrics([song], null, 120);

  assert.equal(result.songDurationSecondsByStart.get(32), null);
  assert.equal(result.totalDurationSeconds, null);
});

test('song duration helper accepts an explicit final boundary', () => {
  const song = { title: 'Only', time: 16, bpm: null };
  assert.equal(calculateSongDurationSec(song, [song], 96, 112), 60);
});

test('metrics reject non-positive spans and invalid fallback tempo', () => {
  const first = { title: 'First', time: 20, bpm: null };
  const second = { title: 'Second', time: 20, bpm: 120 };

  assert.equal(calculateSongDurationSec(first, [first, second], 0, 40), null);
  assert.equal(calculateSongDurationSec(second, [first, second], 120, 20), null);
});

test('setlist metrics sorting does not scale with song count', () => {
  // The guard that matters is that sorting is a fixed cost for the whole call,
  // not a cost paid per song. Counting an exact number instead froze an
  // implementation detail: building the tempo timeline legitimately adds one
  // more constant sort.
  const countSorts = (songCount) => {
    const songs = Array.from({ length: songCount }, (_, index) => ({
      title: `Song ${index}`,
      time: (songCount - 1 - index) * 32,
      bpm: 120,
      sections: [{ name: 'A', time: (songCount - 1 - index) * 32, bpm: 120 }],
    }));
    const originalSort = Array.prototype.sort;
    let sortCalls = 0;
    Array.prototype.sort = function countedSort(...args) {
      sortCalls++;
      return originalSort.apply(this, args);
    };
    try {
      calculateSetlistMetrics(songs, songCount * 32, 120);
    } finally {
      Array.prototype.sort = originalSort;
    }
    return sortCalls;
  };

  const small = countSorts(10);
  const large = countSorts(400);
  assert.equal(small, large, 'sort count must not grow with the number of songs');
  assert.ok(large <= 2, `expected at most 2 sorts for the whole call, got ${large}`);
});

test('metrics keep distinct identities for songs that start on the same beat', () => {
  const first = { title: 'First', time: 0, bpm: 120 };
  const second = { title: 'Second', time: 0, bpm: 120 };
  const third = { title: 'Third', time: 120, bpm: 120 };
  const result = calculateSetlistMetrics([first, second, third], 240, 120);

  assert.equal(result.songDurationSecondsBySong.get(first), null);
  assert.equal(result.songDurationSecondsBySong.get(second), 60);
  assert.equal(result.songDurationSecondsBySong.get(third), 60);
});

test('untagged songs inherit the tempo of the nearest preceding tagged song', () => {
  const taggedFirst = { title: 'First', time: 0, bpm: 120 };
  const untaggedSecond = { title: 'Second', time: 120, bpm: null };
  const taggedThird = { title: 'Third', time: 240, bpm: 80 };
  const untaggedFourth = { title: 'Fourth', time: 320, bpm: null };
  const result = calculateSetlistMetrics([taggedFirst, untaggedSecond, taggedThird, untaggedFourth], 400, 200);

  // Second inherits 120 from First. (240 - 120) beats @ 120 bpm = 60s
  assert.equal(result.songDurationSecondsByStart.get(120), 60);
  
  // Fourth inherits 80 from Third. (400 - 320) beats @ 80 bpm = 60s
  assert.equal(result.songDurationSecondsByStart.get(320), 60);
});

test('untagged songs fall back to live tempo only if no preceding song has a tag', () => {
  const untaggedFirst = { title: 'First', time: 0, bpm: null };
  const untaggedSecond = { title: 'Second', time: 120, bpm: null };
  const result = calculateSetlistMetrics([untaggedFirst, untaggedSecond], 240, 200);

  // Both fall back to 200 bpm. 120 beats @ 200 bpm = 36s
  assert.equal(result.songDurationSecondsByStart.get(0), 36);
  assert.equal(result.songDurationSecondsByStart.get(120), 36);
});

test('metrics inherit song tempo from its first section when song has no tag', () => {
  const song = {
    title: 'Intro Song',
    time: 0,
    bpm: null,
    sections: [
      { name: 'Intro', time: 0, bpm: 120 },
      { name: 'Verse', time: 60, bpm: null },
    ],
  };
  const result = calculateSetlistMetrics([song], 120, 200);
  // (120 beats @ 120 bpm = 60s) instead of falling back to 200 bpm
  assert.equal(result.songDurationSecondsByStart.get(0), 60);
  assert.equal(result.totalDurationSeconds, 60);
});

test('metrics calculate piecewise duration across sections with different BPMs', () => {
  const song = {
    title: 'Multi-Tempo',
    time: 0,
    bpm: 120,
    sections: [
      { name: 'Part 1', time: 0, bpm: 120 }, // 60 beats @ 120 bpm = 30s
      { name: 'Part 2', time: 60, bpm: 60 },  // 60 beats @ 60 bpm = 60s
    ],
  };
  const result = calculateSetlistMetrics([song], 120, 100);
  // 30s + 60s = 90s
  assert.equal(result.songDurationSecondsByStart.get(0), 90);
  assert.equal(result.totalDurationSeconds, 90);
});

test('tempo carries across a song boundary from the LAST event, not the first tag', () => {
  // A chorus tagged [bpm 60] at the end of song A is still in effect when B
  // starts. Reading A's first tag instead made B twice as fast on paper.
  const songs = [
    { title: 'A', time: 0, bpm: 120, sections: [{ name: 'Refrao', time: 60, bpm: 60 }] },
    { title: 'B', time: 120, bpm: null, sections: [] },
  ];
  const result = calculateSetlistMetrics(songs, 240, 120);
  assert.equal(result.songDurationSecondsByStart.get(0), 90); // 60@120 + 60@60
  assert.equal(result.songDurationSecondsByStart.get(120), 120); // 120 beats @60
  assert.equal(result.totalDurationSeconds, 210);
});

test('a section tag mid-song does not apply backwards over the intro', () => {
  const songs = [
    { title: 'Balada', time: 120, bpm: null, sections: [{ name: 'Refrao', time: 180, bpm: 90 }] },
    { title: 'Encerra', time: 240, bpm: 90, sections: [] },
  ];
  const result = calculateSetlistMetrics(songs, 360, 120);
  // 60 beats at the inherited 120, then 60 beats at 90 = 30 + 40
  assert.equal(result.songDurationSecondsByStart.get(120), 70);
});

test('the set total is summed from exact seconds, not from rounded parts', () => {
  const songs = Array.from({ length: 40 }, (_, i) => ({
    title: `S${i}`, time: i * 133, bpm: 139, sections: [],
  }));
  const result = calculateSetlistMetrics(songs, 40 * 133, 139);
  const exact = 40 * (133 / 139) * 60;
  const sumOfRounded = [...result.songDurationSecondsByStart.values()].reduce((a, b) => a + b, 0);
  assert.equal(result.totalDurationSeconds, Math.round(exact));
  assert.notEqual(sumOfRounded, result.totalDurationSeconds);
});

test('calculateSongDurationSec agrees with the setlist metrics for the same song', () => {
  const songs = [
    { title: 'Balada', time: 120, bpm: null, sections: [{ name: 'Refrao', time: 180, bpm: 90 }] },
    { title: 'Encerra', time: 240, bpm: 90, sections: [] },
  ];
  const metrics = calculateSetlistMetrics(songs, 360, 120);
  for (const song of songs) {
    assert.equal(
      calculateSongDurationSec(song, songs, 120, 360),
      metrics.songDurationSecondsBySong.get(song),
      `${song.title} must read the same from both entry points`,
    );
  }
});
