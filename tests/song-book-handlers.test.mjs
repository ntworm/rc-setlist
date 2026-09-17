import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import { startServer, stopServer } from '../src/index.ts';
import { bridgeState, selectProfile, refreshSongBook } from '../src/runtime/bridge-state.ts';
import { executeCommandAction } from '../src/commands/handlers/index.ts';

/**
 * Colours and notes live in a song book per profile. The book is cached on
 * bridgeState; switching profiles must drop that cache, or the next save
 * writes profile A's colours into profile B's file.
 */

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

function command(type, payload, commandId) {
  return {
    commandId,
    type,
    payload,
    sourceClientId: 'song-book-test',
    createdAt: Date.now(),
    status: 'created',
    retryCount: 0,
  };
}

function readBook(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

test('song colours and notes stay with the profile they were written in', async () => {
  const storage = path.join(tmpdir(), 'setlist-song-book-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(storage, { recursive: true });
  setExtensionContext({ environment: { storageDirectory: storage } });
  const port = await getFreePort();
  const broadcasts = [];

  try {
    await startServer({ port, skipOsc: true, skipCerts: true, skipProjectDetector: true });
    bridgeState.wsServer.broadcastState = (state) => broadcasts.push(state);
    bridgeState.wsServer.broadcastLog = () => {};

    const profiles = bridgeState.profileManager;
    const profileA = profiles.getActive().id;
    const bookA = profiles.getActivePaths().songBook;
    bridgeState.manager.updateCues([
      { name: 'Song A', time: 0 },
      { name: 'Song B', time: 32 },
    ]);
    refreshSongBook();

    await executeCommandAction(command('set_song_color', { time: 0, color: 'red' }, 'c1'));
    await executeCommandAction(
      command('set_song_notes', { time: 32, notes: 'Drop D, drummer counts' }, 'n1'),
    );
    assert.deepEqual(Object.values(readBook(bookA).data), [
      { color: 'red' },
      { notes: 'Drop D, drummer counts' },
    ]);
    assert.deepEqual(broadcasts.at(-1).songColors, { 0: 'red' });
    assert.deepEqual(broadcasts.at(-1).songNotes, { 32: 'Drop D, drummer counts' });

    const profileB = await profiles.create('Second Show');
    await selectProfile(profileB.id);
    const bookB = profiles.getActivePaths().songBook;
    assert.notEqual(bookB, bookA);
    assert.deepEqual(broadcasts.at(-1).songColors, {}, 'the new profile starts without colours');
    assert.deepEqual(broadcasts.at(-1).songNotes, {}, 'the new profile starts without notes');
    const fresh = readBook(bookB);
    assert.deepEqual(fresh ? fresh.data : {}, {}, 'profile B has no side data yet');

    await executeCommandAction(command('set_song_color', { time: 0, color: 'blue' }, 'c2'));
    assert.deepEqual(Object.values(readBook(bookB).data), [{ color: 'blue' }]);
    assert.deepEqual(
      Object.values(readBook(bookA).data),
      [{ color: 'red' }, { notes: 'Drop D, drummer counts' }],
      'profile A is untouched',
    );

    await selectProfile(profileA);
    assert.deepEqual(broadcasts.at(-1).songColors, { 0: 'red' }, 'switching back restores A');
    assert.deepEqual(broadcasts.at(-1).songNotes, { 32: 'Drop D, drummer counts' });

    // Clearing goes through the same path: blank notes remove the field.
    await executeCommandAction(command('set_song_notes', { time: 32, notes: null }, 'n2'));
    assert.deepEqual(Object.values(readBook(bookA).data), [{ color: 'red' }]);
  } finally {
    await stopServer();
    clearExtensionContext();
    fs.rmSync(storage, { recursive: true, force: true });
  }
});
