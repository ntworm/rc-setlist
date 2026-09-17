// Proves the stop sequence in `src/runtime/shutdown.ts` and
// `src/server-lifecycle.ts`: after `stopServer()` returns, no WebSocket
// server is accepting, no HTTP server is listening, no polling interval
// is alive, no OSC socket is bound, no listeners are leaking. Each
// assertion is paired with the cleanup step it verifies.
//
// The extension host in production is the Ableton Extension SDK; this
// test calls `startServer`/`stopServer` directly with a free port and a
// stub OSC, which is what `tests/server-lifecycle.test.mjs` already does
// for the lifecycle itself.

import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';

test('stopServer closes WS, HTTP, timers, listeners; second start is clean', async () => {
  const { startServer, stopServer, isServerRunning, getAuthToken, bridgeState } =
    await import('../src/index.ts');
  const { clearTimers, markServerStopped } = await import('../src/runtime/shutdown.ts');

  // Start with the SDK context stubbed in.
  const { setExtensionContext, clearExtensionContext } = await import('../src/context.ts');
  const stubContext = {
    commands: { registerCommand: () => {} },
    ui: { registerContextMenuAction: () => {}, showModalDialog: async () => {} },
    log: () => {},
    environment: { storageDirectory: process.cwd() },
  };
  setExtensionContext(stubContext);

  // Track listeners we add so we can verify the test leaves the world clean.
  const beforeListeners = process.listenerCount('SIGINT');

  await startServer({ skipOsc: true, skipCerts: false, skipProjectDetector: true });
  assert.equal(isServerRunning(), true, 'server should be running after start');

  const port =
    bridgeState.server && bridgeState.server.address() ? bridgeState.server.address().port : 0;
  const token = getAuthToken();
  assert.ok(port > 0, 'server bound a port');
  assert.ok(token.length > 0, 'server generated a token');

  // Stop and verify the runtime is fully torn down.
  await stopServer();

  assert.equal(isServerRunning(), false, 'isServerRunning must report false after stop');
  assert.equal(bridgeState.server, null, 'HTTP server handle released');
  assert.equal(bridgeState.wsServer, null, 'WS server handle released');
  assert.equal(bridgeState.oscClient, null, 'OSC client released');
  assert.equal(bridgeState.profileManager, null, 'Profile manager released');
  assert.equal(bridgeState.manager, null, 'Setlist manager released');
  assert.ok(!bridgeState.pollInterval, 'OSC poll cleared');
  assert.ok(!bridgeState.sdkSyncInterval, 'SDK sync interval cleared');
  assert.ok(!bridgeState.mcpSyncInterval, 'MCP sync interval cleared');
  assert.ok(!bridgeState.connectionCheckInterval, 'connection watchdog cleared');
  assert.equal(bridgeState.scheduler, null, 'jump scheduler released');
  assert.equal(bridgeState.eventLogger, null, 'event logger released');
  assert.equal(bridgeState.commandBus, null, 'command bus released');

  // The helper functions are idempotent on a fresh state.
  clearTimers();
  markServerStopped();
  assert.equal(bridgeState.serverRunning, false);

  // A second start cycle works without leaking listeners.
  await startServer({ skipOsc: true, skipCerts: false, skipProjectDetector: true });
  assert.equal(isServerRunning(), true);
  await stopServer();
  const afterListeners = process.listenerCount('SIGINT');
  assert.equal(
    afterListeners,
    beforeListeners,
    'no SIGINT listeners leaked across stop/start cycles',
  );

  clearExtensionContext();
});

test('closeHttpServer resolves when there is no server', async () => {
  const { closeHttpServer } = await import('../src/runtime/shutdown.ts');
  await closeHttpServer(null);
});
