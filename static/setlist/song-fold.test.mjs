import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'song-fold.js'), 'utf8');
const scope = {};
vm.runInNewContext(source, { globalThis: scope });
const songFold = scope.RcSongFold;

const SONGS = [
  { title: 'WALK-IN', sections: [{ name: 'INTRO' }] },
  { title: 'NEON SIGNAL', sections: [] },
  { title: 'NIGHT TRANSIT', sections: [{ name: 'VERSE' }, { name: 'CHORUS' }] },
];

// The module runs in its own realm, so its arrays are not the arrays this
// file knows. Comparing the plain values keeps the assertions about the
// content and not about the prototype.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertList(actual, expected, message) {
  assert.deepEqual(plain(actual), expected, message);
}

function fakeStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
  };
}

function fakeDots() {
  const attributes = new Map();
  return {
    attributes,
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name);
    },
  };
}

function fakeItem(songIndex, dots) {
  const classNames = new Set(['song-item']);
  return {
    dataset: { song: String(songIndex) },
    classList: {
      add: (name) => classNames.add(name),
      remove: (name) => classNames.delete(name),
      contains: (name) => classNames.has(name),
      toggle: (name, on) => {
        if (on) classNames.add(name);
        else classNames.delete(name);
        return on;
      },
    },
    querySelector(selector) {
      return selector === '.song-reorder-handle' ? dots : null;
    },
  };
}

function fakeContainer(items) {
  return { children: items };
}

test('every setlist remembers its folded songs under its own key', () => {
  assert.equal(songFold.storageKey('abc'), 'rcsetlist:folded:abc');
  assert.equal(songFold.storageKey(''), 'rcsetlist:folded:default');
  assert.equal(songFold.storageKey(null), 'rcsetlist:folded:default');
});

test('a stored list of folded titles is read back as titles', () => {
  assertList(songFold.parseFoldedTitles('["A","B"]'), ['A', 'B']);
  assertList(songFold.parseFoldedTitles('[]'), []);
  assertList(songFold.parseFoldedTitles(''), []);
});

test('storage that cannot be read means nothing is folded', () => {
  assertList(songFold.parseFoldedTitles('not json'), []);
  assertList(songFold.parseFoldedTitles('{"a":1}'), []);
  assertList(songFold.parseFoldedTitles('["A",7,null]'), ['A']);
  assertList(songFold.parseFoldedTitles(undefined), []);
});

test('the folded titles are written as a list of names', () => {
  assert.equal(songFold.serializeFoldedTitles(['A', 'B']), '["A","B"]');
  assert.equal(songFold.serializeFoldedTitles([]), '[]');
  assert.equal(songFold.serializeFoldedTitles(null), '[]');
});

test('reading and writing the folded songs goes through the setlist key', () => {
  const storage = fakeStorage();
  assert.equal(songFold.writeFoldedTitles(storage, 'abc', ['A']), true);
  assert.equal(storage.getItem('rcsetlist:folded:abc'), '["A"]');
  assertList(songFold.readFoldedTitles(storage, 'abc'), ['A']);
  assertList(songFold.readFoldedTitles(storage, 'other'), []);
});

test('storage that refuses to answer leaves every song open', () => {
  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assertList(songFold.readFoldedTitles(broken, 'abc'), []);
  assert.equal(songFold.writeFoldedTitles(broken, 'abc', ['A']), false);
});

test('folding a song twice folds it and unfolds it again', () => {
  assert.equal(songFold.isFolded(['A'], 'A'), true);
  assert.equal(songFold.isFolded(['A'], 'B'), false);
  assertList(songFold.toggleTitle([], 'A'), ['A']);
  assertList(songFold.toggleTitle(['A'], 'A'), []);
  assertList(songFold.toggleTitle(['A'], 'B'), ['A', 'B']);
  assertList(songFold.toggleTitle(['A'], ''), ['A']);
});

test('only the songs that have sections can be folded', () => {
  assertList(
    songFold.songsWithSections(SONGS).map((song) => song.title),
    ['WALK-IN', 'NIGHT TRANSIT'],
  );
  assertList(songFold.songsWithSections(null), []);
});

test('the bar button folds while any song is open and unfolds when they are all closed', () => {
  assert.equal(songFold.foldAllLabelKey([], SONGS), 'setlist.foldAll');
  assert.equal(songFold.foldAllLabelKey(['WALK-IN'], SONGS), 'setlist.foldAll');
  assert.equal(songFold.foldAllLabelKey(['WALK-IN', 'NIGHT TRANSIT'], SONGS), 'setlist.unfoldAll');
  assert.equal(songFold.foldAllLabelKey([], []), 'setlist.unfoldAll');
});

test('a folded card hides its sections and tells the dots about it', () => {
  const dots = fakeDots();
  const item = fakeItem(0, dots);
  songFold.applyItemFoldState(item, true);
  assert.equal(item.classList.contains('sections-folded'), true);
  assert.equal(dots.getAttribute('aria-expanded'), 'false');

  songFold.applyItemFoldState(item, false);
  assert.equal(item.classList.contains('sections-folded'), false);
  assert.equal(dots.getAttribute('aria-expanded'), 'true');
});

test('painting the list folds every song that is remembered', () => {
  const firstDots = fakeDots();
  const secondDots = fakeDots();
  const thirdDots = fakeDots();
  const items = [fakeItem(0, firstDots), fakeItem(1, secondDots), fakeItem(2, thirdDots)];
  const container = fakeContainer(items);
  songFold.applyFoldState(container, SONGS, ['NIGHT TRANSIT']);
  assert.equal(firstDots.getAttribute('aria-expanded'), 'true');
  assert.equal(items[0].classList.contains('sections-folded'), false);
  assert.equal(thirdDots.getAttribute('aria-expanded'), 'false');
  assert.equal(items[2].classList.contains('sections-folded'), true);
});

test('the controller folds one song, remembers it, and forgets it again', () => {
  const storage = fakeStorage();
  const dots = fakeDots();
  const item = fakeItem(0, dots);
  const container = fakeContainer([item]);
  const songs = SONGS;
  const controller = songFold.createFoldState({
    container,
    storage,
    getProfileId: () => 'abc',
    getSongs: () => songs,
    translate: (key) => key,
  });

  controller.load();
  assert.equal(controller.label(), 'setlist.foldAll');
  controller.toggleSong(0);
  assertList(controller.getTitles(), ['WALK-IN']);
  assert.equal(item.classList.contains('sections-folded'), true);
  assert.equal(dots.getAttribute('aria-expanded'), 'false');
  assert.equal(controller.label(), 'setlist.foldAll');

  controller.toggleAll();
  assertList(controller.getTitles(), ['WALK-IN', 'NIGHT TRANSIT']);
  assert.equal(controller.label(), 'setlist.unfoldAll');

  controller.toggleAll();
  assertList(controller.getTitles(), []);
  assert.equal(controller.label(), 'setlist.foldAll');

  controller.toggleSong(0);
  const reloaded = songFold.createFoldState({
    container,
    storage,
    getProfileId: () => 'abc',
    getSongs: () => songs,
    translate: (key) => key,
  });
  reloaded.load();
  assertList(reloaded.getTitles(), ['WALK-IN']);
});
