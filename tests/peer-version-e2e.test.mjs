// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Integration E2E tests for Delivery 2 peer link protocol version mismatch (A8b).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { clearExtensionContext, setExtensionContext } from '../src/context.ts';
import { stopServer } from '../src/index.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { pair } from '../src/runtime/pairing.ts';
import { relayToPeer, startPeerLink, stopPeerLink } from '../src/runtime/peer-link.ts';
import { createHttpRequestListener } from '../src/server/http.ts';
import { SetlistWSServer } from '../src/server/ws.ts';
import { fingerprintOf, makeCommand, makeTlsOptions } from './helpers/peer-link-harness.mjs';
import {
  MAIN_CUES,
  collectJson,
  connectSyncedWs,
  delay,
  ipcRequest,
  openSocket,
  readLogCalls,
  serverPort,
  setupMasterNode,
  spawnPeerChild,
  waitFor,
} from './helpers/peer-e2e-node.mjs';

function hasMismatchState(msg) {
  return msg.type === 'state' && msg.state?.peerStatus?.versionMismatch === true;
}

async function createProto1SlaveMock(ackExtra) {
  const tls = await makeTlsOptions();
  const wsServer = new SetlistWSServer('mock-auth', { peerToken: 'mock-peer-token' });
  const wss = wsServer.init();
  const frames = [];
  let connections = 0;
  wss.on('connection', () => {
    connections += 1;
  });
  wsServer.on('client_message', (msg, ws) => {
    frames.push(msg);
    if (msg.type === 'handshake') {
      ws.send(JSON.stringify({ type: 'handshake_ack', stateVersion: 0, state: {}, ...ackExtra }));
    }
  });
  const server = https.createServer(tls, createHttpRequestListener());
  server.on('upgrade', (req, socket, head) => wsServer.handleUpgrade(req, socket, head));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    port: addr && typeof addr === 'object' ? addr.port : 0,
    tls,
    frames,
    connections: () => connections,
    openCount: () => wss.clients.size,
    close: async () => {
      wsServer.stop();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

async function assertMasterRejectsProto1Slave(ackExtra, label) {
  const mainDir = path.join(tmpdir(), `rc-ver-master-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(mainDir, { recursive: true });
  const mock = await createProto1SlaveMock(ackExtra);
  let controller = null;
  try {
    await setupMasterNode(mainDir);
    controller = await connectSyncedWs(serverPort(), bridgeState.authToken, 'ver-ctrl');
    const ctrlMsgs = collectJson(controller);
    startPeerLink({
      host: '127.0.0.1',
      port: mock.port,
      peerToken: 'mock-peer-token',
      fingerprint: fingerprintOf(mock.tls),
    });
    const rejected = await waitFor(
      () => bridgeState.peerStatus.versionMismatch === true && !bridgeState.peerStatus.connected,
      5000,
    );
    assert.equal(rejected, true, `${label}: master must set versionMismatch above down`);
    assert.equal(bridgeState.peerStatus.health, 'down');
    assert.equal(bridgeState.peerStatuses[0]?.versionMismatch, true);
    assert.equal(bridgeState.peerStatuses[0]?.health, 'down');

    assert.equal(await waitFor(() => mock.openCount() === 0, 3000), true);
    await delay(250);
    assert.equal(bridgeState.peerStatus.versionMismatch, true, 'mismatch persists after close');
    assert.equal(bridgeState.peerStatus.health, 'down');
    assert.equal(mock.connections(), 1, 'master must not reconnect after versionMismatch');
    assert.ok(ctrlMsgs.some(hasMismatchState));

    assert.equal(relayToPeer(makeCommand('play', 'ver-play')), false);
    controller.send(JSON.stringify({ type: 'play', commandId: 'ver-ctrl-play' }));
    controller.send(JSON.stringify({ type: 'stop', commandId: 'ver-ctrl-stop' }));
    await delay(250);
    assert.equal(
      mock.frames.filter((f) => f.type !== 'handshake').length,
      0,
      `${label}: zero commands may relay to incompatible slave`,
    );
  } finally {
    controller?.close();
    stopPeerLink();
    await stopServer();
    await mock.close();
    clearExtensionContext();
    fs.rmSync(mainDir, { recursive: true, force: true });
  }
}

async function connectProto1Master(port, peerToken, handshakeMsg) {
  const ws = new WebSocket(`wss://127.0.0.1:${port}/ws?token=${encodeURIComponent(peerToken)}`, {
    rejectUnauthorized: false,
  });
  const messages = collectJson(ws);
  const closePromise = new Promise((resolve) => {
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') }));
  });
  await openSocket(ws);
  ws.send(JSON.stringify(handshakeMsg));
  ws.send(JSON.stringify({ type: 'play', commandId: 'proto1-blocked-play' }));
  ws.send(
    JSON.stringify({
      type: 'peer_command',
      commandId: 'proto1-blocked-pc',
      ttlMs: 1000,
      transportSeq: 1,
      command: { type: 'play' },
    }),
  );
  const err = await waitFor(() => messages.find((m) => m.type === 'error'), 3000);
  const closed = await closePromise;
  return { err, closed };
}

async function assertSlaveRejectsProto1(child, logFile, port, peerToken, handshakeMsg, label) {
  const { err, closed } = await connectProto1Master(port, peerToken, handshakeMsg);
  assert.equal(err?.code, 'version_mismatch', `${label}: expected version_mismatch error`);
  assert.equal(err?.linkProtocol, 2, `${label}: expected linkProtocol 2`);
  assert.equal(closed.code, 4002, `${label}: expected close code 4002`);
  assert.equal(closed.reason, 'version_mismatch');

  await delay(250);
  const status = await ipcRequest(child, { type: 'get_peer_status' }, 'peer_status');
  assert.equal(status.peerStatus.versionMismatch, true, 'mismatch must persist after close');
  assert.equal(status.peerStatus.health, 'down');
  assert.equal(status.peerStatus.connected, false);
  assert.equal(status.peerStatuses[0]?.key, 'inbound:master');
  assert.equal(status.peerStatuses[0]?.versionMismatch, true);
  assert.equal(status.peerStatuses[0]?.health, 'down');

  const execRes = await ipcRequest(child, { type: 'get_executed_commands' }, 'executed_commands');
  assert.equal(execRes.commands.length, 0, `${label}: zero commands may execute`);
  assert.equal(readLogCalls(logFile).length, 0, `${label}: zero OSC calls allowed`);
}

test('A8b.1: master rejects protocol-1 and omitted linkProtocol slave above down', async () => {
  await assertMasterRejectsProto1Slave({}, 'omitted linkProtocol');
  await assertMasterRejectsProto1Slave({ linkProtocol: 1 }, 'linkProtocol: 1');
});

test('A8b.2: protocol-2 slave rejects protocol-1 and omitted linkProtocol master', async () => {
  const id = Math.random().toString(36).slice(2);
  const mainDir = path.join(tmpdir(), `rc-ver-pair-${id}`);
  const childDir = path.join(tmpdir(), `rc-ver-slave-${id}`);
  const logFile = path.join(childDir, 'osc.log');
  fs.mkdirSync(mainDir, { recursive: true });
  fs.mkdirSync(childDir, { recursive: true });
  const peer = spawnPeerChild(logFile, childDir);
  try {
    const ready = await peer.readyPromise;
    setExtensionContext({
      environment: { storageDirectory: mainDir },
      application: { song: { handle: { id: 42 }, tempo: 120, cuePoints: MAIN_CUES } },
    });
    const paired = await pair('127.0.0.1', ready.pairingCode, ready.port);
    assert.equal(paired.ok, true);
    const token = paired.config.peerToken;
    await assertSlaveRejectsProto1(
      peer.child,
      logFile,
      ready.port,
      token,
      { type: 'handshake', clientId: 'proto1-master-omitted' },
      'omitted linkProtocol',
    );
    await assertSlaveRejectsProto1(
      peer.child,
      logFile,
      ready.port,
      token,
      { type: 'handshake', clientId: 'proto1-master-v1', linkProtocol: 1 },
      'linkProtocol: 1',
    );
  } finally {
    if (!peer.child.killed) peer.child.kill('SIGKILL');
    clearExtensionContext();
    fs.rmSync(mainDir, { recursive: true, force: true });
    fs.rmSync(childDir, { recursive: true, force: true });
  }
});
