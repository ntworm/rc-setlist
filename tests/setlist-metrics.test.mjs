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
