import { test } from 'node:test';
import assert from 'node:assert';
import * as net from 'node:net';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import { startServer, stopServer, isServerRunning } from '../src/index.ts';
import { bridgeState } from '../src/core/bridge-state.ts';
import { closeHttpServer } from '../src/server-lifecycle.ts';

// Helper to find a free port
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

test('Server Lifecycle: starts graceful close before forcing lingering connections closed', async () => {
  const calls = [];
  const server = {
    close(callback) {
      calls.push('close');
      callback();
    },
    closeAllConnections() {
      calls.push('closeAllConnections');
    },
  };

  await closeHttpServer(server);
  assert.deepStrictEqual(calls, ['close', 'closeAllConnections']);
});

test('Server Lifecycle: start, stop, port collision handling', async () => {
  // Set up a clean storage directory to prevent polluting local config
  const testStorageDir = path.join(tmpdir(), 'setlist-test-' + Math.random().toString(36).substring(7));
  fs.mkdirSync(testStorageDir, { recursive: true });

  setExtensionContext({
    environment: {
      storageDirectory: testStorageDir
    },
    application: {
      song: {
        handle: { id: 42 },
        tempo: 120,
        cuePoints: [{ name: 'Lifecycle Song', time: 0 }]
      }
    }
  });

  const testPort = await getFreePort();

  try {
    // 1. Initially stopped
    assert.strictEqual(isServerRunning(), false);

    // 2. Start successfully
    await startServer({
      port: testPort,
      skipOsc: true,
      skipCerts: true,
      skipProjectDetector: true
    });
    assert.strictEqual(isServerRunning(), true);

    // Keep server open to ensure pollInterval/timers are stable and don't crash
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(isServerRunning(), true);
    assert.deepStrictEqual(bridgeState.manager.getState().songs.map(({ title }) => title), ['Lifecycle Song']);
    const firstSessionKey = bridgeState.projectIdentity.key;
    await bridgeState.profileManager.create('Second Setlist');

    // 3. Stop successfully
    await stopServer();
    assert.strictEqual(isServerRunning(), false);

    // Restarting RC Setlist inside the same Live session must reopen the same
    // temporary scope instead of hiding a profile created moments earlier.
    await startServer({
      port: testPort,
      skipOsc: true,
      skipCerts: true,
      skipProjectDetector: true
    });
    assert.strictEqual(bridgeState.projectIdentity.key, firstSessionKey);
    assert.deepStrictEqual(
      bridgeState.profileManager.list().map(({ name }) => name),
      ['Main Setlist', 'Second Setlist']
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepStrictEqual(bridgeState.manager.getState().songs.map(({ title }) => title), ['Lifecycle Song']);
    await stopServer();

    // 4. Start a dummy TCP server on our test port to force collision (omitting host so Node uses the same default wildcard binding family)
    const dummyServer = net.createServer();
    await new Promise((resolve) => dummyServer.listen(testPort, resolve));

    try {
      // 5. Try starting the server - should reject with EADDRINUSE
      await assert.rejects(async () => {
        await startServer({
          port: testPort,
          skipOsc: true,
          skipCerts: true,
          skipProjectDetector: true
        });
      }, (err) => {
        return err.code === 'EADDRINUSE';
      });

      // 6. Verify server is NOT marked as running and is cleaned up
      assert.strictEqual(isServerRunning(), false);
    } finally {
      // Close dummy server
      await new Promise((resolve) => dummyServer.close(resolve));
    }

    // 7. Verify setlist server can start again after dummy server is closed
    await startServer({
      port: testPort,
      skipOsc: true,
      skipCerts: true,
      skipProjectDetector: true
    });
    assert.strictEqual(isServerRunning(), true);

    await stopServer();
    assert.strictEqual(isServerRunning(), false);

  } finally {
    clearExtensionContext();
    // Cleanup the temporary directory
    try {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    } catch {}
  }
});
