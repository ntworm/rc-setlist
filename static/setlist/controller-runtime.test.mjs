import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, 'controller-runtime.js');

function loadRuntime() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const context = { console, URL, globalThis: null, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'controller-runtime.js' });
  return context.RcSetlistControllerRuntime;
}

test('MIDI mappings recover from corrupt storage and discard malformed entries', () => {
  const runtime = loadRuntime();
  const defaults = { play: null, stop: null, toggle_click: null };
  const corruptStorage = { getItem: () => '{not json' };
  assert.deepEqual({ ...runtime.readMidiMappings(corruptStorage, 'mappings', defaults) }, defaults);

  const storage = {
    getItem: () =>
      JSON.stringify({
        play: { type: 'note', channel: 1, number: 64 },
        stop: { type: 'cc', channel: 17, number: 1 },
        toggle_click: 'bad',
        injected_action: { type: 'note', channel: 1, number: 1 },
      }),
  };
  const sanitized = JSON.parse(
    JSON.stringify(runtime.readMidiMappings(storage, 'mappings', defaults)),
  );
  assert.deepEqual(sanitized, {
    play: { type: 'note', channel: 1, number: 64 },
    stop: null,
    toggle_click: null,
  });
});

test('controller token is stored and removed from the visible URL', () => {
  const runtime = loadRuntime();
  const writes = [];
  const replacements = [];
  const token = runtime.consumeControllerToken({
    locationRef: { href: 'https://stage.local/setlist?token=secret-123&lang=pt-BR#lyrics' },
    historyRef: { replaceState: (...args) => replacements.push(args) },
    storageRef: {
      getItem: () => 'old-token',
      setItem: (key, value) => writes.push([key, value]),
    },
  });

  assert.equal(token, 'secret-123');
  assert.deepEqual(writes, [['setlist_token', 'secret-123']]);
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0][2], '/setlist?lang=pt-BR#lyrics');
});

test('invalid token query values are removed and fall back to stored credentials', () => {
  const runtime = loadRuntime();
  const replacements = [];
  const token = runtime.consumeControllerToken({
    locationRef: { href: 'http://localhost:4444/static/setlist/?token=undefined&view=compact' },
    historyRef: { replaceState: (_state, _title, url) => replacements.push(url) },
    storageRef: {
      getItem: () => 'stored-token',
      setItem: () => assert.fail('must not store invalid token'),
    },
  });
  assert.equal(token, 'stored-token');
  assert.deepEqual(replacements, ['/static/setlist/?view=compact']);
});

test('pending commands settle only on matching terminal status', () => {
  const runtime = loadRuntime();
  const settled = [];
  const tracker = runtime.createPendingCommandTracker({
    timeoutMs: 5_000,
    onSettled: (entry, status) => settled.push([entry.kind, status]),
  });
  tracker.begin({ commandId: 'lyrics-edit-1', kind: 'edit' });
  assert.equal(tracker.hasKind('edit'), true);
  assert.equal(tracker.settle({ commandId: 'other', status: 'confirmed' }), false);
  assert.equal(tracker.settle({ commandId: 'lyrics-edit-1', status: 'sent' }), false);
  assert.equal(tracker.hasKind('edit'), true);
  assert.equal(tracker.settle({ commandId: 'lyrics-edit-1', status: 'failed' }), true);
  assert.equal(tracker.hasKind('edit'), false);
  assert.deepEqual(settled, [['edit', 'failed']]);
});

test('pending lyrics state remains dirty until confirmation and survives failures', () => {
  const runtime = loadRuntime();
  let dirty = true;
  let failures = 0;
  const tracker = runtime.createPendingCommandTracker({
    timeoutMs: 5_000,
    onSettled: (_entry, status) => {
      if (status === 'confirmed') dirty = false;
      else failures++;
    },
  });

  tracker.begin({ commandId: 'edit-failed', kind: 'edit' });
  tracker.settle({ commandId: 'edit-failed', status: 'expired' });
  assert.equal(dirty, true);
  assert.equal(failures, 1);

  tracker.begin({ commandId: 'edit-confirmed', kind: 'edit' });
  tracker.settle({ commandId: 'edit-confirmed', status: 'confirmed' });
  assert.equal(dirty, false);
});

test('lyrics edit revisions reject stale save confirmations', () => {
  const runtime = loadRuntime();
  const guard = runtime.createEditRevisionGuard();
  guard.selectSong('Song A');
  const saved = guard.snapshot();
  assert.equal(guard.matches(saved), true);

  guard.changed();
  assert.equal(guard.matches(saved), false, 'an edit after save makes its confirmation stale');

  const secondSave = guard.snapshot();
  guard.selectSong('Song B');
  assert.equal(guard.matches(secondSave), false, 'a song switch makes the old confirmation stale');
});

test('disconnect and timeout settle pending commands as failures', () => {
  const runtime = loadRuntime();
  const callbacks = [];
  let timeoutCallback;
  const tracker = runtime.createPendingCommandTracker({
    timeoutMs: 25,
    setTimeoutFn: (callback) => {
      timeoutCallback = callback;
      return 1;
    },
    clearTimeoutFn: () => undefined,
    onSettled: (entry, status) => callbacks.push([entry.commandId, status]),
  });

  tracker.begin({ commandId: 'timeout', kind: 'edit' });
  timeoutCallback();
  tracker.begin({ commandId: 'disconnect', kind: 'sync' });
  tracker.failAll('disconnected');

  assert.deepEqual(callbacks, [
    ['timeout', 'expired'],
    ['disconnect', 'disconnected'],
  ]);
  assert.equal(tracker.size(), 0);
});

test('active class controller toggles only the previous and next elements', () => {
  const runtime = loadRuntime();
  const elements = new Map();
  const makeElement = (selector) => {
    const classes = new Set();
    const element = {
      classList: {
        add: (name) => classes.add(name),
        contains: (name) => classes.has(name),
        remove: (name) => classes.delete(name),
      },
      classes,
      selector,
    };
    elements.set(selector, element);
    return element;
  };
  const song0 = makeElement('.song-item[data-song="0"]');
  const song1 = makeElement('.song-item[data-song="1"]');
  const section00 = makeElement('.section-btn[data-song="0"][data-section="0"]');
  const section11 = makeElement('.section-btn[data-song="1"][data-section="1"]');
  const queries = [];
  const root = {
    querySelector: (selector) => {
      queries.push(selector);
      return elements.get(selector) || null;
    },
  };
  const controller = runtime.createActiveClassController(root);

  controller.update(0, 0);
  assert.equal(song0.classes.has('active'), true);
  assert.equal(section00.classes.has('active'), true);
  controller.update(1, 1);
  assert.equal(song0.classes.has('active'), false);
  assert.equal(section00.classes.has('active'), false);
  assert.equal(song1.classes.has('active'), true);
  assert.equal(section11.classes.has('active'), true);
  assert.equal(queries.length, 4, 'each transition queries only its target song and section');

  controller.update(1, 1);
  assert.equal(queries.length, 4, 'unchanged active state performs no DOM query');
  controller.reset();
  controller.update(0, -1);
  assert.equal(song0.classes.has('active'), true);
});

test('readKeyMappings recovers from corrupt storage and discards malformed entries', () => {
  const runtime = loadRuntime();
  const defaults = { play: null, stop: null, next_song: null, toggle_count_in: null };
  const corruptStorage = { getItem: () => '{not json' };
  assert.deepEqual({ ...runtime.readKeyMappings(corruptStorage, 'mappings', defaults) }, defaults);

  const storage = {
    getItem: () =>
      JSON.stringify({
        play: { key: '1', code: 'Numpad1', ctrlKey: false, altKey: false, shiftKey: false },
        stop: { key: 'bad' }, // missing code
        next_song: null,
        toggle_count_in: {
          key: '2',
          code: 'Numpad2',
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        injected_action: { key: 'x', code: 'KeyX' }, // not in defaults, must be excluded
      }),
  };
  const result = JSON.parse(JSON.stringify(runtime.readKeyMappings(storage, 'mappings', defaults)));
  assert.deepEqual(result, {
    play: { key: '1', code: 'Numpad1', ctrlKey: false, altKey: false, shiftKey: false },
    stop: null, // malformed (missing code) → falls back to default null
    next_song: null, // explicit null is preserved
    toggle_count_in: { key: '2', code: 'Numpad2', ctrlKey: false, altKey: false, shiftKey: false },
  });
  assert.equal(
    'injected_action' in result,
    false,
    'injected action not in defaults must be excluded',
  );
});

const setlistPath = path.join(here, 'setlist.js');
const i18nPath = path.join(here, '..', 'shared', 'i18n.js');

// The setlist page is a browser script, so the shipped source is the unit under test.
function sliceBraced(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error('unterminated block in setlist.js');
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name}() not found in setlist.js`);
  const open = source.indexOf('{', start);
  return source.slice(start, open) + sliceBraced(source, open);
}

function evaluateObjectLiteral(source, name) {
  const start = source.indexOf(`const ${name} = `);
  assert.notEqual(start, -1, `${name} not found in setlist.js`);
  const open = source.indexOf('{', start);
  return vm.runInNewContext(`(${sliceBraced(source, open)})`, {});
}

// One branch of an action handler: from its `action === '...'` test to the next.
function actionBranch(source, action) {
  const start = source.indexOf(`action === '${action}'`);
  assert.notEqual(start, -1, `no branch for action '${action}'`);
  const rest = source.slice(start);
  const next = rest.indexOf('} else if');
  return next === -1 ? rest : rest.slice(0, next);
}

test('saved mappings without the immediate song actions load with the new actions unmapped', () => {
  const runtime = loadRuntime();
  const source = fs.readFileSync(setlistPath, 'utf8');
  const midiDefaults = evaluateObjectLiteral(source, 'midiMappingDefaults');
  const keyDefaults = evaluateObjectLiteral(source, 'keyMappingDefaults');
  for (const defaults of [midiDefaults, keyDefaults]) {
    const keys = Object.keys(defaults).join(',');
    assert.match(keys, /prev_song,next_song_now,prev_song_now,/);
    assert.equal(defaults.next_song_now, null, 'the new action starts unmapped');
    assert.equal(defaults.prev_song_now, null, 'the new action starts unmapped');
  }
  const midiStorage = {
    getItem: () => JSON.stringify({ play: { type: 'note', channel: 1, number: 64 } }),
  };
  const midi = JSON.parse(
    JSON.stringify(runtime.readMidiMappings(midiStorage, 'mappings', midiDefaults)),
  );
  assert.equal(midi.play.number, 64, 'a saved mapping still loads');
  assert.equal(midi.next_song_now, null, 'a saved mapping without it loads unmapped');
  assert.equal(midi.prev_song_now, null, 'a saved mapping without it loads unmapped');
  const keyStorage = {
    getItem: () =>
      JSON.stringify({
        next_song: { key: '1', code: 'Numpad1', ctrlKey: false, altKey: false, shiftKey: false },
      }),
  };
  const keys = JSON.parse(
    JSON.stringify(runtime.readKeyMappings(keyStorage, 'mappings', keyDefaults)),
  );
  assert.equal(keys.next_song.code, 'Numpad1', 'a saved key binding still loads');
  assert.equal(keys.next_song_now, null, 'a saved key binding without it loads unmapped');
  assert.equal(keys.prev_song_now, null, 'a saved key binding without it loads unmapped');
});

test('the immediate song actions jump immediately and the plain ones do not', () => {
  const execute = extractFunction(fs.readFileSync(setlistPath, 'utf8'), 'executeSetlistAction');
  const nextSong = actionBranch(execute, 'next_song');
  assert.match(nextSong, /jumpTo\(nextIdx, null\)/);
  assert.doesNotMatch(nextSong, /immediate/, 'the plain next song must not jump immediately');
  const nextSongNow = actionBranch(execute, 'next_song_now');
  assert.match(nextSongNow, /jumpTo\(nextIdx, null, \{ immediate: true \}\)/);
  const prevSong = actionBranch(execute, 'prev_song');
  assert.match(prevSong, /jumpTo\(prevIdx, null\)/);
  assert.doesNotMatch(prevSong, /immediate/, 'the plain previous song must not jump immediately');
  const prevSongNow = actionBranch(execute, 'prev_song_now');
  assert.match(prevSongNow, /jumpTo\(prevIdx, null, \{ immediate: true \}\)/);
});

test('jumpTo sends the immediate flag only when the action asks for it', () => {
  const sent = [];
  let now = 10_000;
  const context = {
    console,
    Date: { now: () => now },
    isLocked: false,
    showLockWarning: () => assert.fail('a locked panel must not jump'),
    canUseTransport: () => true,
    lastJumpTime: 0,
    lastJumpTarget: { song: -1, section: -1 },
    WebSocket: { OPEN: 1 },
    ws: { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) },
  };
  const jumpSource = extractFunction(fs.readFileSync(setlistPath, 'utf8'), 'jumpTo');
  vm.runInNewContext(jumpSource, context, { filename: 'setlist.js' });
  context.jumpTo(2, null, { immediate: true });
  assert.deepEqual(sent[0], { type: 'jump', songIndex: 2, sectionIndex: null, immediate: true });
  context.jumpTo(3, null);
  assert.deepEqual(sent[1], { type: 'jump', songIndex: 3, sectionIndex: null });
  now = 10_100; // inside the 300 ms duplicate guard window
  context.jumpTo(3, null, { immediate: true });
  assert.equal(sent.length, 2, 'the 300 ms duplicate guard still throttles a repeat jump');
});

test('the immediate song actions are labelled in both mapping tables and the catalog', () => {
  const source = fs.readFileSync(setlistPath, 'utf8');
  assert.match(source, /next_song_now: 'midi\.nextSongNow'/);
  assert.match(source, /prev_song_now: 'midi\.previousSongNow'/);
  assert.match(source, /next_song_now: 'keyboard\.nextSongNow'/);
  assert.match(source, /prev_song_now: 'keyboard\.previousSongNow'/);
  const i18nSource = fs.readFileSync(i18nPath, 'utf8');
  const catalogLiteral = i18nSource.match(/const catalog = Object\.freeze\((\{[\s\S]*?\n {2}\})\)/);
  assert.ok(catalogLiteral, 'i18n.js catalog literal not found');
  const catalog = vm.runInNewContext(`(${catalogLiteral[1]})`, {});
  assert.equal(catalog['midi.nextSongNow'].en, 'Next Song Now');
  assert.equal(catalog['midi.nextSongNow']['pt-BR'], 'Próxima música agora');
  assert.equal(catalog['midi.previousSongNow'].en, 'Previous Song Now');
  assert.equal(catalog['midi.previousSongNow']['pt-BR'], 'Música anterior agora');
  assert.equal(catalog['keyboard.nextSongNow'].en, 'Next Song Now');
  assert.equal(catalog['keyboard.nextSongNow']['pt-BR'], 'Próxima música agora');
  assert.equal(catalog['keyboard.previousSongNow'].en, 'Previous Song Now');
  assert.equal(catalog['keyboard.previousSongNow']['pt-BR'], 'Música anterior agora');
});
