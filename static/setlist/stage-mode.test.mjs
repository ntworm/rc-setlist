import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'stage-mode.js'), 'utf8');
const scope = {};
vm.runInNewContext(source, { globalThis: scope });
const stageMode = scope.RcStageMode;

function fakeStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
  };
}

function fakeButton(mode) {
  const attributes = new Map();
  return {
    dataset: { stageMode: mode },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name);
    },
  };
}

function fakeBody() {
  const classes = new Set();
  const editButton = fakeButton('edit');
  const showButton = fakeButton('show');
  return {
    editButton,
    showButton,
    classList: {
      contains: (name) => classes.has(name),
      toggle: (name, on) => {
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    },
    querySelectorAll(selector) {
      return selector === '[data-stage-mode]' ? [editButton, showButton] : [];
    },
  };
}

function fakeScrollContainer(topsBySong, initialScrollTop = 0) {
  return {
    scrollTop: initialScrollTop,
    getBoundingClientRect() {
      return { top: 100 };
    },
    querySelector(selector) {
      const match = selector.match(/^\.song-item\[data-song="(\d+)"\]$/);
      if (!match) return null;
      const top = topsBySong[Number(match[1])];
      if (typeof top !== 'number') return null;
      return {
        getBoundingClientRect() {
          return { top };
        },
      };
    },
  };
}

test('STORAGE_KEY matches the panel mode contract', () => {
  assert.equal(stageMode.STORAGE_KEY, 'rcsetlist:stageMode');
});

test('parseMode returns show only for the exact string show', () => {
  assert.equal(stageMode.parseMode('show'), 'show');
  assert.equal(stageMode.parseMode('edit'), 'edit');
  assert.equal(stageMode.parseMode('garbage'), 'edit');
  assert.equal(stageMode.parseMode('SHOW'), 'edit');
  assert.equal(stageMode.parseMode(''), 'edit');
  assert.equal(stageMode.parseMode(null), 'edit');
  assert.equal(stageMode.parseMode(undefined), 'edit');
});

test('readMode and writeMode survive throwing or missing storage', () => {
  const storage = fakeStorage();
  assert.equal(stageMode.readMode(storage), 'edit');
  stageMode.writeMode(storage, 'show');
  assert.equal(storage.getItem(stageMode.STORAGE_KEY), 'show');
  assert.equal(stageMode.readMode(storage), 'show');

  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.equal(stageMode.readMode(broken), 'edit');
  assert.doesNotThrow(() => stageMode.writeMode(broken, 'show'));
  assert.equal(stageMode.readMode(null), 'edit');
});

test('applyMode toggles show-mode class and button aria-pressed', () => {
  const body = fakeBody();
  stageMode.applyMode(body, 'show');
  assert.equal(body.classList.contains('show-mode'), true);
  assert.equal(body.editButton.getAttribute('aria-pressed'), 'false');
  assert.equal(body.showButton.getAttribute('aria-pressed'), 'true');

  stageMode.applyMode(body, 'edit');
  assert.equal(body.classList.contains('show-mode'), false);
  assert.equal(body.editButton.getAttribute('aria-pressed'), 'true');
  assert.equal(body.showButton.getAttribute('aria-pressed'), 'false');
});

test('scrollSongToTop aligns the target song top with container top and ignores missing items', () => {
  const container = fakeScrollContainer({ 2: 340 }, 120);
  stageMode.scrollSongToTop(container, 2);
  assert.equal(container.scrollTop, 360);

  stageMode.scrollSongToTop(container, 99);
  assert.equal(container.scrollTop, 360);
});

test('createFollower scrolls only in show mode, skips repeats unless forced, and ignores -1', () => {
  let mode = 'edit';
  const container = fakeScrollContainer({ 0: 100, 1: 220, 2: 410 }, 50);
  const follower = stageMode.createFollower({
    container,
    getMode: () => mode,
  });

  follower.follow(1);
  follower.follow(1, true);
  assert.equal(container.scrollTop, 50);

  mode = 'show';
  follower.follow(-1);
  follower.follow(-1, true);
  assert.equal(container.scrollTop, 50);

  follower.follow(1);
  assert.equal(container.scrollTop, 170);

  container.scrollTop = 90;
  follower.follow(1);
  assert.equal(container.scrollTop, 90);

  follower.follow(1, true);
  assert.equal(container.scrollTop, 210);

  follower.follow(2);
  assert.equal(container.scrollTop, 520);
});

test('createFollower pins the same song again after no song was active', () => {
  const container = fakeScrollContainer({ 1: 220 }, 50);
  const follower = stageMode.createFollower({ container, getMode: () => 'show' });
  follower.follow(1);
  assert.equal(container.scrollTop, 170);
  follower.follow(-1);
  container.scrollTop = 0;
  follower.follow(1);
  assert.equal(container.scrollTop, 120);
});
