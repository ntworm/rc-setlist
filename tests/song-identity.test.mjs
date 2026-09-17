import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSongIdentities } from '../src/core/song-identity.ts';

function idFactory(prefix = 'new') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const run = (stored, incoming, reloadCount = 1, tombstoneReloads = undefined) =>
  reconcileSongIdentities(stored, incoming, {
    reloadCount,
    makeId: idFactory(),
    tombstoneReloads,
  });

const cue = (name, time) => ({ name, time });

test('an unchanged setlist keeps every id', () => {
  const stored = [
    { id: 'a', name: 'INTRO', time: 0 },
    { id: 'b', name: 'JÚLIA', time: 1136 },
  ];
  const { present, tombstoned, pruned } = run(stored, [cue('INTRO', 0), cue('JÚLIA', 1136)]);
  assert.deepEqual(
    present.map((s) => s.id),
    ['a', 'b'],
  );
  assert.deepEqual(tombstoned, []);
  assert.deepEqual(pruned, []);
});

test('a rename keeps the id, because the position did not move', () => {
  const stored = [{ id: 'a', name: 'INTRO', time: 0 }];
  const { present } = run(stored, [cue('ABERTURA', 0)]);
  assert.equal(present[0].id, 'a');
  assert.equal(present[0].name, 'ABERTURA');
});

test('a move keeps the id, because the name did not change', () => {
  const stored = [{ id: 'a', name: 'INTRO', time: 0 }];
  const { present } = run(stored, [cue('INTRO', 240)]);
  assert.equal(present[0].id, 'a');
  assert.equal(present[0].time, 240);
});

test('a bis keeps two separate identities for the same title', () => {
  // The exact shape that broke observedSongBpm: the same song played twice.
  const stored = [
    { id: 'first', name: 'SOMÁLIA', time: 0 },
    { id: 'other', name: 'OUTRA', time: 100 },
    { id: 'encore', name: 'SOMÁLIA', time: 200 },
  ];
  const { present } = run(stored, [cue('SOMÁLIA', 0), cue('OUTRA', 100), cue('SOMÁLIA', 200)]);
  assert.deepEqual(
    present.map((s) => s.id),
    ['first', 'other', 'encore'],
  );
});

test('renaming one half of a bis does not steal the other half identity', () => {
  const stored = [
    { id: 'first', name: 'SOMÁLIA', time: 0 },
    { id: 'encore', name: 'SOMÁLIA', time: 200 },
  ];
  const { present } = run(stored, [cue('SOMÁLIA', 0), cue('SOMÁLIA (BIS)', 200)]);
  assert.equal(present[0].id, 'first');
  assert.equal(
    present[1].id,
    'encore',
    'the renamed encore must keep its own id, matched by position',
  );
});

test('changing the name AND the position is treated as a new song', () => {
  const stored = [{ id: 'a', name: 'INTRO', time: 0 }];
  const { present, tombstoned } = run(stored, [cue('ABERTURA', 240)]);
  assert.notEqual(present[0].id, 'a', 'no algorithm can tell this from delete-plus-add');
  assert.deepEqual(
    tombstoned.map((s) => s.id),
    ['a'],
    'the old entry is remembered, not destroyed',
  );
});

test('a deleted locator is tombstoned and its identity returns when recreated', () => {
  const stored = [{ id: 'a', name: 'INTRO', time: 0 }];
  const gone = run(stored, [], 5);
  assert.deepEqual(gone.present, []);
  assert.equal(gone.tombstoned[0].id, 'a');
  assert.equal(gone.tombstoned[0].missingSince, 5);

  const back = run(gone.tombstoned, [cue('INTRO', 0)], 6);
  assert.equal(back.present[0].id, 'a', 'recreating the locator restores its colour');
});

test('a tombstone is pruned only after it has been gone long enough', () => {
  const stored = [{ id: 'a', name: 'INTRO', time: 0, missingSince: 1 }];
  assert.deepEqual(run(stored, [], 3, 5).pruned, [], 'still within the grace window');
  assert.deepEqual(run(stored, [], 6, 5).pruned, ['a'], 'past the window, forgotten for good');
});

test('an ambiguous pair is left alone rather than guessed', () => {
  // Two stored entries share a name, and both incoming cues moved. Matching by
  // name would be a coin flip, so neither is matched.
  const stored = [
    { id: 'x', name: 'VERSO', time: 10 },
    { id: 'y', name: 'VERSO', time: 20 },
  ];
  const { present } = run(stored, [cue('VERSO', 30), cue('VERSO', 40)]);
  assert.equal(
    present.every((s) => s.id !== 'x' && s.id !== 'y'),
    true,
    'a coin flip would risk putting the colour on the wrong song',
  );
});

test('new songs get fresh ids and existing ones are untouched', () => {
  const stored = [{ id: 'a', name: 'INTRO', time: 0 }];
  const { present } = run(stored, [cue('INTRO', 0), cue('NOVA', 500)]);
  assert.equal(present[0].id, 'a');
  assert.match(present[1].id, /^new-/);
});

test('present preserves the order Live reported', () => {
  const stored = [];
  const { present } = run(stored, [cue('C', 300), cue('A', 100), cue('B', 200)]);
  assert.deepEqual(
    present.map((s) => s.name),
    ['C', 'A', 'B'],
  );
});
