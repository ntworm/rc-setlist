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

    // A persistence failure must not publish an order that was never saved.
    bridgeState.manager.updateCues([
      { name: 'Song A', time: 0 },
      { name: 'Song B', time: 32 },
    ]);
    const remoteLogs = [];
    const captureRemoteLogs = (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'log') remoteLogs.push(message);
    };
    ws.on('message', captureRemoteLogs);
    const orderPath = bridgeState.profileManager.getActivePaths().customOrder;
    fs.mkdirSync(orderPath, { recursive: true });
    const reorderStatusPromise = waitForMessage(
      ws,
      (msg) => msg.type === 'command_status' && msg.commandId === 'reorder-disk-failure'
    );
    ws.send(JSON.stringify({
      type: 'reorder',
      songTitles: ['Song B', 'Song A'],
      commandId: 'reorder-disk-failure',
    }));
    const reorderStatus = await reorderStatusPromise;
    assert.equal(reorderStatus.status, 'failed');
    assert.equal(reorderStatus.reason, 'execution_failed');
    assert.doesNotMatch(JSON.stringify(reorderStatus), /setlist-test-ws-/);
    ws.off('message', captureRemoteLogs);
    assert.equal(
      remoteLogs.some((entry) => JSON.stringify(entry).includes(path.basename(testStorageDir))),
      false,
    );
    assert.deepEqual(bridgeState.manager.getState().songs.map(({ title }) => title), ['Song A', 'Song B']);
    fs.rmSync(orderPath, { recursive: true, force: true });

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
