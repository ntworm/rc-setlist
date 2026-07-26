import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { clearExtensionContext, setExtensionContext } from '../src/context.ts';
import {
  getAuthToken,
  getSetlistManager,
  startServer,
  stopServer,
} from '../src/index.ts';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

function nextMessage(ws, predicate) {
  return new Promise((resolve) => {
    const handler = (data) => {
      const message = JSON.parse(String(data));
      if (!predicate(message)) return;
      ws.off('message', handler);
      resolve(message);
    };
    ws.on('message', handler);
  });
}

test('sync_confirm accepts the snapshot issued to the socket after live state advances', async () => {
  const prefix = path.join(os.tmpdir(), 'setlist-sync-race-');
  const storage = fs.mkdtempSync(prefix);
  const port = await getFreePort();
  let ws;
  setExtensionContext({ environment: { storageDirectory: storage } });

  try {
    await startServer({ port, skipOsc: true, skipCerts: true, skipProjectDetector: true });
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${getAuthToken()}`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const ackPromise = nextMessage(ws, (message) => message.type === 'handshake_ack');
    ws.send(JSON.stringify({ type: 'handshake', clientId: 'sync-race-test' }));
    const ack = await ackPromise;
    const manager = getSetlistManager();
    assert.ok(manager);
    const before = manager.getState();
    manager.updateMetronome(!before.metronome);
    assert.notEqual(manager.getState().stateVersion, ack.stateVersion);

    const resultPromise = nextMessage(ws, (message) => (
      message.type === 'preflight_result' || message.code === 'not_synchronized'
    ));
    ws.send(JSON.stringify({ type: 'sync_confirm', stateVersion: ack.stateVersion }));
    ws.send(JSON.stringify({ type: 'preflight_check', commandId: 'preflight-after-sync-race' }));
    const result = await resultPromise;
    assert.equal(result.type, 'preflight_result');
  } finally {
    ws?.close();
    await stopServer();
    clearExtensionContext();
    if (storage.startsWith(prefix)) fs.rmSync(storage, { recursive: true, force: true });
  }
});
