import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'controller-runtime.js'), 'utf8');

function loadRuntime() {
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
    getItem: () => JSON.stringify({
      play: { type: 'note', channel: 1, number: 64 },
      stop: { type: 'cc', channel: 17, number: 1 },
      toggle_click: 'bad',
      injected_action: { type: 'note', channel: 1, number: 1 },
    }),
  };
  const sanitized = JSON.parse(JSON.stringify(runtime.readMidiMappings(storage, 'mappings', defaults)));
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
    storageRef: { getItem: () => 'stored-token', setItem: () => assert.fail('must not store invalid token') },
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

test('disconnect and timeout settle pending commands as failures', () => {
  const runtime = loadRuntime();
  const callbacks = [];
  let timeoutCallback;
  const tracker = runtime.createPendingCommandTracker({
    timeoutMs: 25,
    setTimeoutFn: (callback) => { timeoutCallback = callback; return 1; },
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
