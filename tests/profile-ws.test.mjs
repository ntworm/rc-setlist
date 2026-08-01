import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import { startServer, stopServer, getAuthToken, isServerRunning } from '../src/index.ts';
import { bridgeState } from '../src/core/bridge-state.ts';
import { executeCommandAction } from '../src/commands/handlers.ts';

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

function waitForMessage(ws, predicate) {
  return new Promise((resolve) => {
    const handler = (data) => {
      const message = JSON.parse(data.toString());
      if (predicate(message)) {
        ws.off('message', handler);
        resolve(message);
      }
    };
    ws.on('message', handler);
  });
}

test('WebSocket profile and reliability core protocol', async () => {
  const testStorageDir = path.join(tmpdir(), 'setlist-test-ws-' + Math.random().toString(36).substring(7));
  fs.mkdirSync(testStorageDir, { recursive: true });

  setExtensionContext({
    environment: {
      storageDirectory: testStorageDir
    }
  });

  const port = await getFreePort();

  try {
    await startServer({
      port: port,
      skipOsc: true,
      skipCerts: true,
      skipProjectDetector: true
    });
    assert.strictEqual(isServerRunning(), true);
    assert.strictEqual(bridgeState.mcpClient, null, 'isolated test mode must not connect to the live MCP bridge');

    const token = getAuthToken();

    // 1. Connect without synchronization (handshake) and send command - should be rejected with not_synchronized
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);

    const connectionPromise = new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    await connectionPromise;

    // Send a play command immediately - must fail because we haven't handshaked
    ws.send(JSON.stringify({ type: 'play', commandId: 'cmd-test-1' }));

    const notSyncError = await new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error' && msg.code === 'not_synchronized') {
          resolve(msg);
        }
      });
    });
    assert.ok(notSyncError);

    // 2. Perform handshake
    ws.send(JSON.stringify({ type: 'handshake', clientId: 'test-client-1' }));

    const handshakeAck = await new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'handshake_ack') {
          resolve(msg);
        }
      });
    });
    assert.ok(handshakeAck);
    assert.strictEqual(typeof handshakeAck.stateVersion, 'number');

    // Confirm synchronization
    ws.send(JSON.stringify({ type: 'sync_confirm', stateVersion: handshakeAck.stateVersion }));

    // Give server a tiny bit to process the sync_confirm
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 3. Command deduplication
    // Send duplicate commands
    const commandId = 'dup-cmd-123';
    ws.send(JSON.stringify({ type: 'set_panic', active: true, commandId }));
    ws.send(JSON.stringify({ type: 'set_panic', active: true, commandId }));

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Invalid or failed reorder persistence must not mutate or publish the active order.
    bridgeState.manager.updateCues([
      { name: 'Song A', time: 0 },
      { name: 'Song B', time: 32 },
    ]);
    const stateMessages = [];
    const captureStateMessages = (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'state') stateMessages.push(message);
    };
    ws.on('message', captureStateMessages);

    const invalidReorderStatus = waitForMessage(
      ws,
      (msg) => msg.type === 'command_status' && msg.commandId === 'invalid-reorder'
    );
    ws.send(JSON.stringify({
      type: 'reorder',
      songTitles: ['Song A'],
      commandId: 'invalid-reorder',
    }));
    assert.deepEqual(await invalidReorderStatus, {
      type: 'command_status',
      commandId: 'invalid-reorder',
      status: 'failed',
      reason: 'execution_failed',
    });
    assert.deepEqual(bridgeState.manager.getState().songs.map(({ title }) => title), ['Song A', 'Song B']);
    assert.equal(stateMessages.length, 0);

    const orderPath = bridgeState.profileManager.getActivePaths().customOrder;
    fs.mkdirSync(orderPath, { recursive: true });
    const failedReorderStatus = waitForMessage(
      ws,
      (msg) => msg.type === 'command_status' && msg.commandId === 'failed-reorder'
    );
    ws.send(JSON.stringify({
      type: 'reorder',
      songTitles: ['Song B', 'Song A'],
      commandId: 'failed-reorder',
    }));
    assert.deepEqual(await failedReorderStatus, {
      type: 'command_status',
      commandId: 'failed-reorder',
      status: 'failed',
      reason: 'execution_failed',
    });
    assert.deepEqual(bridgeState.manager.getState().songs.map(({ title }) => title), ['Song A', 'Song B']);
    assert.equal(stateMessages.length, 0);
    fs.rmSync(orderPath, { recursive: true, force: true });

    // A lyrics command remains pending until persistence settles, then fails safely.
    const lyricsPath = path.join(bridgeState.profileManager.getActivePaths().lyrics, 'Song A.lrc');
    fs.mkdirSync(lyricsPath, { recursive: true });
    const lyricsStatus = waitForMessage(
      ws,
      (msg) => msg.type === 'command_status' && msg.commandId === 'failed-lyrics-write'
    );
    ws.send(JSON.stringify({
      type: 'save_lyrics',
      song: 'Song A',
      text: '[00:00.00]must not be confirmed',
      commandId: 'failed-lyrics-write',
    }));
    assert.deepEqual(await lyricsStatus, {
      type: 'command_status',
      commandId: 'failed-lyrics-write',
      status: 'failed',
      reason: 'execution_failed',
    });
    fs.rmSync(lyricsPath, { recursive: true, force: true });
    ws.off('message', captureStateMessages);

    // 4. Mutation tests: Profiles API over WS
    // Fetch profiles state
    ws.send(JSON.stringify({ type: 'profiles_get' }));
    const profilesState = await new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'profiles_state') {
          resolve(msg);
        }
      });
    });
    assert.ok(profilesState);
    assert.ok(Array.isArray(profilesState.profiles));
    assert.strictEqual(profilesState.version, 2);
    assert.ok(Array.isArray(profilesState.deletedProfiles));
    const originalProfileId = profilesState.activeProfileId;

    // Create a new profile over WS
    const newProfileName = 'WS Test Profile';
    ws.send(JSON.stringify({ type: 'profile_create', name: newProfileName, commandId: 'create-p1' }));

    // Wait for the profiles state change broadcast
    const updatedProfilesState = await new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'profiles_state' && msg.profiles.some(p => p.name === newProfileName)) {
          ws.off('message', handler);
          resolve(msg);
        }
      };
      ws.on('message', handler);
    });
    assert.ok(updatedProfilesState);
    const createdProfile = updatedProfilesState.profiles.find(p => p.name === newProfileName);
    assert.ok(createdProfile);

    // Rename the profile
    const renamedProfileName = 'WS Test Profile Renamed';
    ws.send(JSON.stringify({
      type: 'profile_rename',
      id: createdProfile.id,
      name: renamedProfileName,
      commandId: 'rename-p1'
    }));

    const renamedProfilesState = await new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'profiles_state' && msg.profiles.some(p => p.name === renamedProfileName)) {
          ws.off('message', handler);
          resolve(msg);
        }
      };
      ws.on('message', handler);
    });
    assert.ok(renamedProfilesState);

    // Select the original profile so the renamed profile can be safely removed.
    const selectedOriginal = waitForMessage(
      ws,
      (msg) => msg.type === 'profiles_state' && msg.activeProfileId === originalProfileId
    );
    ws.send(JSON.stringify({
      type: 'profile_select',
      id: originalProfileId,
      commandId: 'select-original'
    }));
    await selectedOriginal;

    // Profile removal is blocked while Ableton transport is playing.
    bridgeState.manager.updateTransport(0, true);
    const playingDeleteFailure = waitForMessage(
      ws,
      (msg) => msg.type === 'command_status' && msg.commandId === 'delete-while-playing'
    );
    ws.send(JSON.stringify({
      type: 'profile_delete',
      id: createdProfile.id,
      confirmationName: renamedProfileName,
      commandId: 'delete-while-playing'
    }));
    assert.strictEqual((await playingDeleteFailure).status, 'failed');
    bridgeState.manager.updateTransport(0, false);

    // Remove to recoverable trash.
    const deletedStatePromise = waitForMessage(
      ws,
      (msg) => msg.type === 'profiles_state' &&
        !msg.profiles.some((profile) => profile.id === createdProfile.id) &&
        msg.deletedProfiles?.some((profile) => profile.id === createdProfile.id)
    );
    ws.send(JSON.stringify({
      type: 'profile_delete',
      id: createdProfile.id,
      confirmationName: renamedProfileName,
      commandId: 'delete-p1'
    }));
    const deletedState = await deletedStatePromise;
    assert.strictEqual(deletedState.version, 2);

    // Restore returns the same stable UUID and leaves the original profile active.
    const restoredStatePromise = waitForMessage(
      ws,
      (msg) => msg.type === 'profiles_state' &&
        msg.profiles.some((profile) => profile.id === createdProfile.id) &&
        !msg.deletedProfiles?.some((profile) => profile.id === createdProfile.id)
    );
    ws.send(JSON.stringify({
      type: 'profile_restore',
      id: createdProfile.id,
      commandId: 'restore-p1'
    }));
    const restoredState = await restoredStatePromise;
    assert.strictEqual(restoredState.activeProfileId, originalProfileId);

    // Read-only clients cannot remove or restore profiles.
    const readOnlyWs = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve, reject) => {
      readOnlyWs.on('open', resolve);
      readOnlyWs.on('error', reject);
    });
    const readOnlyHandshake = waitForMessage(readOnlyWs, (msg) => msg.type === 'handshake_ack');
    readOnlyWs.send(JSON.stringify({ type: 'handshake', clientId: 'read-only-client' }));
    const readOnlyAck = await readOnlyHandshake;
    readOnlyWs.send(JSON.stringify({ type: 'sync_confirm', stateVersion: readOnlyAck.stateVersion }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    for (const message of [
      { type: 'profile_delete', id: createdProfile.id, confirmationName: renamedProfileName },
      { type: 'profile_restore', id: createdProfile.id }
    ]) {
      const unauthorized = waitForMessage(
        readOnlyWs,
        (msg) => msg.type === 'error' && msg.code === 'unauthorized'
      );
      readOnlyWs.send(JSON.stringify(message));
      assert.strictEqual((await unauthorized).code, 'unauthorized');
    }
    readOnlyWs.close();

    // 5. Preflight check over WS
    ws.send(JSON.stringify({ type: 'preflight_check' }));
    const preflightRes = await new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'preflight_result') {
          resolve(msg);
        }
      });
    });
    assert.ok(preflightRes);
    assert.ok(preflightRes.status);
    assert.ok(Array.isArray(preflightRes.reports));

    // 6. Operational mode & Safety Lock (Show Mode vs Rehearsal)
    // Set mode to 'show'
    ws.send(JSON.stringify({ type: 'set_mode', mode: 'show', commandId: 'cmd-set-mode-show' }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Try saving lyrics in Show mode - must fail
    ws.send(JSON.stringify({ type: 'save_lyrics', song: 'Song A', text: 'forbidden text update', commandId: 'cmd-save-lyrics-show' }));
    const lyricsFailStatus = await new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'command_status' && msg.commandId === 'cmd-save-lyrics-show') {
          resolve(msg);
        }
      });
    });
    assert.strictEqual(lyricsFailStatus.status, 'failed');

    // 7. Panic Mode test
    ws.send(JSON.stringify({ type: 'set_panic', active: true, commandId: 'cmd-set-panic' }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Try sending play command while panic is active - must fail
    ws.send(JSON.stringify({ type: 'play', commandId: 'cmd-play-panic' }));
    const playPanicFailStatus = await new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'command_status' && msg.commandId === 'cmd-play-panic') {
          resolve(msg);
        }
      });
    });
    assert.strictEqual(playPanicFailStatus.status, 'failed');

    ws.close();
  } finally {
    await stopServer();
    clearExtensionContext();
    try {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    } catch {}
  }
});

function command(type, payload, commandId) {
  return {
    commandId,
    type,
    payload,
    sourceClientId: 'scope-race-test',
    createdAt: Date.now(),
    status: 'created',
    retryCount: 0,
    maxRetries: 0,
    timeoutMs: 5_000,
  };
}

function deferredPersistence() {
  let release;
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  return {
    started,
    release,
    dependencies: {
      writeFile: async (file) => {
        startedResolve(file);
        await blocked;
      },
    },
  };
}

async function waitForPersistenceStart(started) {
  return Promise.race([
    started,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('command did not use the delayed persistence dependency')),
      500,
    )),
  ]);
}

test('persisted commands reject stale completion after an active profile scope change', async () => {
  const testStorageDir = path.join(tmpdir(), `setlist-scope-race-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(testStorageDir, { recursive: true });
  setExtensionContext({ environment: { storageDirectory: testStorageDir } });
  const port = await getFreePort();
  let realWsServer;

  try {
    await startServer({ port, skipOsc: true, skipCerts: true, skipProjectDetector: true });
    const profileManager = bridgeState.profileManager;
    const manager = bridgeState.manager;
    const originalProfileId = profileManager.getActive().id;
    const originalPaths = profileManager.getActivePaths();
    const otherProfile = await profileManager.create('Concurrent Scope');
    manager.updateCues([
      { name: 'Song A', time: 0 },
      { name: 'Song B', time: 32 },
    ]);

    const events = [];
    realWsServer = bridgeState.wsServer;
    bridgeState.wsServer = {
      broadcastState: (state) => events.push({ type: 'state', state }),
      broadcast: (message) => events.push(message),
      broadcastLog: (message, level) => events.push({ type: 'log', message, level }),
    };

    const reorderPersistence = deferredPersistence();
    const reorderPromise = executeCommandAction(
      command('reorder', { songTitles: ['Song B', 'Song A'] }, 'stale-reorder'),
      undefined,
      reorderPersistence.dependencies,
    );
    assert.equal(await waitForPersistenceStart(reorderPersistence.started), originalPaths.customOrder);
    await profileManager.select(otherProfile.id);
    reorderPersistence.release();
    await assert.rejects(reorderPromise, /profile scope changed/i);
    assert.deepEqual(manager.getState().songs.map(({ title }) => title), ['Song A', 'Song B']);
    assert.deepEqual(manager.getCustomOrder(), []);
    assert.equal(events.some(({ type }) => type === 'state'), false);
    assert.equal(events.some(({ message }) => /saved/i.test(message ?? '')), false);

    await profileManager.select(originalProfileId);
    events.length = 0;
    const previewPersistence = deferredPersistence();
    const sent = [];
    const client = { readyState: WebSocket.OPEN, send: (value) => sent.push(JSON.parse(value)) };
    const previewPromise = executeCommandAction(
      command('click_preview', { bpm: 120, beats: 1 }, 'stale-preview'),
      client,
      previewPersistence.dependencies,
    );
    assert.ok((await waitForPersistenceStart(previewPersistence.started)).startsWith(originalPaths.audio));
    await profileManager.select(otherProfile.id);
    previewPersistence.release();
    await assert.rejects(previewPromise, /profile scope changed/i);
    assert.deepEqual(sent, []);
    assert.equal(events.some(({ message }) => /wrote preview|preview ready/i.test(message ?? '')), false);

    await profileManager.select(originalProfileId);
  } finally {
    if (realWsServer) bridgeState.wsServer = realWsServer;
    await stopServer();
    clearExtensionContext();
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  }
});

test('tracklist CSV exports active setlist, sections, automations and lyrics without placeholders', async () => {
  const testStorageDir = path.join(tmpdir(), `setlist-csv-details-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(testStorageDir, { recursive: true });
  setExtensionContext({ environment: { storageDirectory: testStorageDir } });
  const port = await getFreePort();

  try {
    await startServer({ port, skipOsc: true, skipCerts: true, skipProjectDetector: true });
    const profileManager = bridgeState.profileManager;
    const manager = bridgeState.manager;
    const active = profileManager.getActive();
    await profileManager.rename(active.id, 'Tour Set');

    manager.updateCues([
      { name: 'EM SEU COLO [bpm 111.11] [click]', time: 0 },
      { name: '> Intro [loop 2x]', time: 8 },
      { name: '> [stop]', time: 32 },
      { name: '> Finale [next] [click off] [skip]', time: 48 },
      { name: 'ELA', time: 64 },
      { name: '> Verse', time: 80 },
    ]);

    const lyricsPath = path.join(profileManager.getActivePaths().lyrics, 'EM SEU COLO.lrc');
    fs.mkdirSync(path.dirname(lyricsPath), { recursive: true });
    fs.writeFileSync(lyricsPath, '[00:01.00]Line one\n[00:02.00]Line two\n', 'utf8');

    const events = [];
    const writes = [];
    const sent = [];
    await executeCommandAction(
      command('export_csv', {}, 'csv-details'),
      {
        readyState: WebSocket.OPEN,
        send: (value) => {
          events.push('send');
          sent.push(JSON.parse(value));
        },
      },
      {
        writeFile: async (file, value) => {
          events.push('write');
          writes.push({ file, value: String(value) });
        },
      },
    );

    assert.deepEqual(events, ['write', 'send']);
    assert.equal(writes.length, 1);
    assert.match(writes[0].file, /tracklist-\d{8}-\d{6}\.csv$/);
    assert.match(
      writes[0].value,
      /^﻿#;setlist;title;start_beat;bpm;duration_sec;duration;sections_count;sections;automations;lyric_lines\r\n/,
    );
    assert.match(writes[0].value, /Tour Set;EM SEU COLO;0;111\.11;35;0:35;2;Intro \| Finale;/);
    assert.match(
      writes[0].value,
      /song \[bpm 111\.11\] \[click\] \| Intro \[loop 2x\] \| @32 \[stop\] \| Finale \[next\] \[click off\] \[skip\];2/,
    );
    assert.doesNotMatch(writes[0].value, /last_played_at|;plays;/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'csv_ready');
    assert.equal(sent[0].count, 2);
    assert.equal(sent[0].fileName, path.basename(writes[0].file));
  } finally {
    await stopServer();
    clearExtensionContext();
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  }
});
