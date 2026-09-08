import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptySongBook,
  parseSongBook,
  applyCues,
  getSongColor,
  setSongColor,
  colorsByTime,
} from '../src/core/song-book.ts';

function idFactory() {
  let n = 0;
  return () => `id-${++n}`;
}

const cue = (name, time) => ({ name, time });

test('a colour survives renaming the song in Live', () => {
  let book = applyCues(emptySongBook(), [cue('INTRO [bpm 136]', 0)], idFactory());
  const id = book.present[0].id;
  book = setSongColor(book, id, '#d9c7a7');

  book = applyCues(book, [cue('ABERTURA [bpm 136]', 0)], idFactory());
  assert.equal(book.present[0].id, id, 'same song');
  assert.equal(getSongColor(book, id), '#d9c7a7', 'the colour follows the rename');
});

test('a colour survives dragging the locator to a new position', () => {
  let book = applyCues(emptySongBook(), [cue('BOSSA', 4047)], idFactory());
  const id = book.present[0].id;
  book = setSongColor(book, id, '#98c4c0');

  book = applyCues(book, [cue('BOSSA', 5000)], idFactory());
  assert.equal(book.present[0].id, id);
  assert.equal(getSongColor(book, id), '#98c4c0');
});

test('deleting a locator keeps the colour, and recreating it brings the colour back', () => {
  let book = applyCues(emptySongBook(), [cue('DERRETE', 772)], idFactory());
  const id = book.present[0].id;
  book = setSongColor(book, id, '#d6a89a');

  book = applyCues(book, [], idFactory());
  assert.deepEqual(book.present, []);
  assert.equal(book.tombstoned[0].id, id);
  assert.equal(getSongColor(book, id), '#d6a89a', 'a tombstoned song keeps its colour');

  book = applyCues(book, [cue('DERRETE', 772)], idFactory());
  assert.equal(book.present[0].id, id);
  assert.equal(getSongColor(book, id), '#d6a89a');
});

test('side data is dropped once its identity is forgotten for good', () => {
  let book = applyCues(emptySongBook(), [cue('SUMIU', 10)], idFactory());
  const id = book.present[0].id;
  book = setSongColor(book, id, '#bfa8d1');

  for (let i = 0; i < 25; i++) book = applyCues(book, [], idFactory());

  assert.deepEqual(book.tombstoned, [], 'the tombstone aged out');
  assert.equal(getSongColor(book, id), undefined, 'and took its colour with it');
  assert.deepEqual(book.data, {}, 'no orphaned side data is left behind');
});

test('a bis keeps two independent colours', () => {
  let book = applyCues(
    emptySongBook(),
    [cue('SOMÁLIA', 0), cue('OUTRA', 100), cue('SOMÁLIA', 200)],
    idFactory(),
  );
  const [first, , encore] = book.present;
  book = setSongColor(book, first.id, '#a9c4a0');
  book = setSongColor(book, encore.id, '#d9a3b0');

  book = applyCues(book, [cue('SOMÁLIA', 0), cue('OUTRA', 100), cue('SOMÁLIA', 200)], idFactory());
  assert.equal(getSongColor(book, first.id), '#a9c4a0');
  assert.equal(getSongColor(book, encore.id), '#d9a3b0');
});

test('clearing a colour removes the entry rather than storing an empty object', () => {
  let book = applyCues(emptySongBook(), [cue('A', 0)], idFactory());
  const id = book.present[0].id;
  book = setSongColor(book, id, '#9db8d4');
  book = setSongColor(book, id, undefined);
  assert.equal(getSongColor(book, id), undefined);
  assert.deepEqual(book.data, {});
});

test('colours are exposed to the client keyed by beat position', () => {
  let book = applyCues(emptySongBook(), [cue('A', 0), cue('B', 240)], idFactory());
  book = setSongColor(book, book.present[1].id, '#c9c9c9');
  assert.deepEqual(colorsByTime(book), { '240': '#c9c9c9' });
});

test('a corrupt book degrades to empty instead of throwing', () => {
  assert.deepEqual(parseSongBook(null), emptySongBook());
  assert.deepEqual(parseSongBook('nonsense'), emptySongBook());
  assert.deepEqual(parseSongBook({ version: 99 }), emptySongBook());
  const salvaged = parseSongBook({
    version: 1,
    reloadCount: 3,
    present: [{ id: 'a', name: 'A', time: 0 }, { id: 'bad' }],
    tombstoned: 'not an array',
    data: { a: { color: '#d9c7a7' }, b: { color: 42 } },
  });
  assert.equal(salvaged.present.length, 1, 'malformed entries are dropped, valid ones kept');
  assert.deepEqual(salvaged.tombstoned, []);
  assert.deepEqual(salvaged.data, { a: { color: '#d9c7a7' } });
});

test('a round trip through JSON preserves the book', () => {
  let book = applyCues(emptySongBook(), [cue('A', 0)], idFactory());
  book = setSongColor(book, book.present[0].id, '#d9c7a7');
  assert.deepEqual(parseSongBook(JSON.parse(JSON.stringify(book))), book);
});
