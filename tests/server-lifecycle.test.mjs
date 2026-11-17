import { test } from 'node:test';
import assert from 'node:assert';
import * as net from 'node:net';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import { startServer, stopServer, isServerRunning, getAuthToken } from '../src/index.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { closeHttpServer, getProjectMetadataRequestToken } from '../src/server-lifecycle.ts';

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

test('Server Lifecycle: drains the event log after stopping command intake', async () => {
  const calls = [];
  bridgeState.commandBus = {
    stop() {
      calls.push('commandBus.stop');
    },
  };
  bridgeState.eventLogger = {
    async flush() {
      calls.push('eventLogger.flush');
    },
  };
  bridgeState.promotionBlockedProjectSessionId = 'blocked-session';

  await stopServer();

  assert.deepStrictEqual(calls, ['commandBus.stop', 'eventLogger.flush']);
  assert.strictEqual(bridgeState.commandBus, null);
  assert.strictEqual(bridgeState.eventLogger, null);
  assert.strictEqual(bridgeState.promotionBlockedProjectSessionId, '');
});

test('Server Lifecycle: project metadata token fails closed for a blocked Song session', () => {
  const previous = {
    projectIdentity: bridgeState.projectIdentity,
    projectSessionId: bridgeState.projectSessionId,
    promotionBlockedProjectSessionId: bridgeState.promotionBlockedProjectSessionId,
  };
  bridgeState.projectIdentity = {
    key: 'scope-a',
    displayName: 'Current Live Set',
    filePath: null,
    source: 'session',
    persistent: false,
    legacyProjectKey: null,
  };
  bridgeState.projectSessionId = 'session-a';
  bridgeState.promotionBlockedProjectSessionId = '';

  try {
    assert.equal(getProjectMetadataRequestToken(), 'session-a:scope-a');
    bridgeState.promotionBlockedProjectSessionId = 'session-a';
    assert.equal(getProjectMetadataRequestToken(), null);
  } finally {
    bridgeState.projectIdentity = previous.projectIdentity;
    bridgeState.projectSessionId = previous.projectSessionId;
    bridgeState.promotionBlockedProjectSessionId = previous.promotionBlockedProjectSessionId;
  }
});

test('Server Lifecycle: shutdown no longer writes to the metronome it used to borrow', async () => {
  // The count-in used to switch Live's metronome on and hand it back on the way
  // out. It is produced in the browser now, so shutdown has nothing to unwind
  // and must leave the operator's click exactly as they set it.
  const calls = [];
  bridgeState.oscClient = {
    setMetronome(value) {
      calls.push(['metronome', value]);
    },
    stopPropertyListeners() {
      calls.push(['stop-listeners']);
    },
    async stop() {
      calls.push(['stop-osc']);
    },
  };

  await stopServer();

  assert.deepStrictEqual(calls, [['stop-listeners'], ['stop-osc']]);
});

test('Server Lifecycle: start, stop, port collision handling', async () => {
  // Set up a clean storage directory to prevent polluting local config
  const testStorageDir = path.join(
    tmpdir(),
    'setlist-test-' + Math.random().toString(36).substring(7),
  );
  fs.mkdirSync(testStorageDir, { recursive: true });

  setExtensionContext({
    environment: {
      storageDirectory: testStorageDir,
    },
    application: {
      song: {
        handle: { id: 42 },
        tempo: 120,
        cuePoints: [{ name: 'Lifecycle Song', time: 0 }],
      },
    },
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
      skipProjectDetector: true,
    });
    assert.strictEqual(isServerRunning(), true);

    // Keep server open to ensure pollInterval/timers are stable and don't crash
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(isServerRunning(), true);
    assert.deepStrictEqual(
      bridgeState.manager.getState().songs.map(({ title }) => title),
      ['Lifecycle Song'],
    );
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
      skipProjectDetector: true,
    });
    assert.strictEqual(bridgeState.projectIdentity.key, firstSessionKey);
    assert.deepStrictEqual(
      bridgeState.profileManager.list().map(({ name }) => name),
      ['Main Setlist', 'Second Setlist'],
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepStrictEqual(
      bridgeState.manager.getState().songs.map(({ title }) => title),
      ['Lifecycle Song'],
    );
    await stopServer();

    // 4. Start a dummy TCP server on our test port to force collision (omitting host so Node uses the same default wildcard binding family)
    const dummyServer = net.createServer();
    await new Promise((resolve) => dummyServer.listen(testPort, resolve));

    try {
      // 5. Try starting the server - should reject with EADDRINUSE
      await assert.rejects(
        async () => {
          await startServer({
            port: testPort,
            skipOsc: true,
            skipCerts: true,
            skipProjectDetector: true,
          });
        },
        (err) => {
          return err.code === 'EADDRINUSE';
        },
      );

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
      skipProjectDetector: true,
    });
    assert.strictEqual(isServerRunning(), true);

    await stopServer();
    assert.strictEqual(isServerRunning(), false);
  } finally {
    clearExtensionContext();
    // Cleanup the temporary directory
    try {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    } catch {
      // swallow: nothing to do here on purpose
    }
  }
});

test(
  'Server Lifecycle: new token files are readable by their owner only',
  { skip: process.platform === 'win32' ? 'Windows does not apply POSIX file modes' : false },
  async () => {
    const testStorageDir = fs.mkdtempSync(path.join(tmpdir(), 'setlist-test-mode-'));
    setExtensionContext({ environment: { storageDirectory: testStorageDir } });
    try {
      await startServer({
        port: await getFreePort(),
        skipOsc: true,
        skipCerts: true,
        skipProjectDetector: true,
      });
      for (const name of ['token', 'peer-token']) {
        const mode = fs.statSync(path.join(testStorageDir, name)).mode & 0o777;
        assert.strictEqual(mode, 0o600, `${name} must be readable by its owner only`);
      }
    } finally {
      await stopServer();
      clearExtensionContext();
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  },
);

test(
  'Server Lifecycle: token files replaced over an old readable file end owner-only',
  { skip: process.platform === 'win32' ? 'Windows does not apply POSIX file modes' : false },
  async () => {
    // Empty files are replaced; a peer token equal to the auth token is too.
    for (const [tokenContent, peerContent] of [
      ['', ''],
      ['kept-auth-token', 'kept-auth-token'],
    ]) {
      const testStorageDir = fs.mkdtempSync(path.join(tmpdir(), 'setlist-test-replace-'));
      const tokenFile = path.join(testStorageDir, 'token');
      const peerFile = path.join(testStorageDir, 'peer-token');
      for (const [file, content] of [
        [tokenFile, tokenContent],
        [peerFile, peerContent],
      ]) {
        fs.writeFileSync(file, content);
        fs.chmodSync(file, 0o644);
      }
      setExtensionContext({ environment: { storageDirectory: testStorageDir } });
      try {
        await startServer({
          port: await getFreePort(),
          skipOsc: true,
          skipCerts: true,
          skipProjectDetector: true,
        });
        const token = fs.readFileSync(tokenFile, 'utf8').trim();
        const peer = fs.readFileSync(peerFile, 'utf8').trim();
        assert.ok(token, 'the auth token is written');
        if (tokenContent) assert.strictEqual(token, tokenContent, 'an existing auth token is kept');
        assert.ok(
          peer && peer !== token,
          'the peer token is replaced and differs from the auth token',
        );
        for (const file of [tokenFile, peerFile]) {
          assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, `${file} must be owner-only`);
        }
      } finally {
        await stopServer();
        clearExtensionContext();
        fs.rmSync(testStorageDir, { recursive: true, force: true });
      }
    }
  },
);

function nextMessage(ws, predicate) {
  return new Promise((resolve) => {
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (predicate(msg)) {
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

test('Server Lifecycle: a settled duplicate commandId answers its sender with the saved status', async () => {
  const testStorageDir = fs.mkdtempSync(path.join(tmpdir(), 'setlist-test-dup-'));
  setExtensionContext({ environment: { storageDirectory: testStorageDir } });
  const port = await getFreePort();
  let ws;
  try {
    await startServer({ port, skipOsc: true, skipCerts: true, skipProjectDetector: true });

    let dispatches = 0;
    const bus = bridgeState.commandBus;
    const dispatch = bus.dispatch.bind(bus);
    bus.dispatch = (...args) => {
      dispatches++;
      return dispatch(...args);
    };

    ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${getAuthToken()}`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    const ack = nextMessage(ws, (msg) => msg.type === 'handshake_ack');
    ws.send(JSON.stringify({ type: 'handshake', clientId: 'dup-client' }));
    ws.send(JSON.stringify({ type: 'sync_confirm', stateVersion: (await ack).stateVersion }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const command = { type: 'set_mode', mode: 'show', commandId: 'dup-settled' };
    const isStatus = (msg) => msg.type === 'command_status' && msg.commandId === 'dup-settled';
    const first = nextMessage(ws, isStatus);
    ws.send(JSON.stringify(command));
    const broadcast = await first;

    const second = nextMessage(ws, isStatus);
    ws.send(JSON.stringify(command));
    assert.deepStrictEqual(await second, broadcast);
    assert.strictEqual(dispatches, 1, 'the duplicate must not run again');
  } finally {
    ws?.close();
    await stopServer();
    clearExtensionContext();
    // Cleanup the temporary directory
    try {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    } catch {
      // swallow: nothing to do here on purpose
    }
  }
});
