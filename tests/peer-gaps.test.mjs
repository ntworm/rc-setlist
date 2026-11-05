// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import { startServer, stopServer } from '../src/index.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { SetlistWSServer } from '../src/server/ws.ts';
import { createHttpRequestListener } from '../src/server/http.ts';
import {
  relayToPeer,
  resetPeerLinkTiming,
  setPeerLinkTiming,
  startPeerLink,
  stopPeerLink,
} from '../src/runtime/peer-link.ts';
import { writePeerConfig } from '../src/preferences.ts';
import { generatePairingCode, hasActivePairingCode } from '../src/runtime/pairing.ts';
import { resolveJumpTime } from '../src/commands/handlers/peer.ts';
import { peerPanelModel, sanitizePanelAction } from '../src/ui/peer-panel.ts';
import {
  MAIN_CUES,
  PEER_TOKEN,
  createFakeOsc,
  createPeerComputer,
  fingerprintOf,
  makeCommand,
} from './helpers/peer-link-harness.mjs';

let storageDir = '';
let peerComputer = null;
let peerPort = 0;
let linkConfig = null;
const oscCalls = [];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await delay(25);
  }
  return predicate();
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function collect(ws) {
  const messages = [];
  ws.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      // ignore non-json frames
    }
  });
  return messages;
}

async function openSocket(ws) {
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function mainPort() {
  const address = bridgeState.server?.address();
  return address && typeof address === 'object' ? address.port : 0;
}

before(async () => {
  storageDir = path.join(tmpdir(), `rc-gaps-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(storageDir, { recursive: true });
  setExtensionContext({
    environment: { storageDirectory: storageDir },
    application: { song: { handle: { id: 42 }, tempo: 120, cuePoints: MAIN_CUES } },
  });
  peerComputer = await createPeerComputer();
  peerPort = await listen(peerComputer.server);
  linkConfig = {
    host: '127.0.0.1',
    port: peerPort,
    peerToken: PEER_TOKEN,
    fingerprint: fingerprintOf(peerComputer.tls),
  };
  writePeerConfig(linkConfig);
  await startServer({ port: 0, skipOsc: true, skipProjectDetector: true });
  bridgeState.oscClient = createFakeOsc(oscCalls);
  bridgeState.manager.updateCues(MAIN_CUES);
  const connected = await waitFor(() => bridgeState.peerStatus.connected === true, 10000);
  assert.equal(connected, true);
});

after(async () => {
  stopPeerLink();
  await stopServer();
  peerComputer.wsServer.stop();
  await closeServer(peerComputer.server);
  clearExtensionContext();
  try {
    fs.rmSync(storageDir, { recursive: true, force: true });
  } catch {
    // cleanup temp dir
  }
});

test('stop and set_panic are sent when bufferedAmount > 0 and play is dropped', async () => {
  const orig = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'bufferedAmount');
  Object.defineProperty(WebSocket.prototype, 'bufferedAmount', {
    get: () => 1024,
    configurable: true,
  });
  try {
    peerComputer.actions.length = 0;
    relayToPeer(makeCommand('play', 'buf-play'));
    await delay(100);
    assert.equal(peerComputer.actions.length, 0);

    relayToPeer(makeCommand('stop', 'buf-stop'));
    await waitFor(() => peerComputer.actions.length > 0);
    assert.equal(peerComputer.actions[0]?.type, 'stop');

    peerComputer.actions.length = 0;
    relayToPeer(makeCommand('set_panic', 'buf-panic', { type: 'set_panic', active: true }));
    await waitFor(() => peerComputer.actions.length > 0);
    assert.equal(peerComputer.actions[0]?.type, 'set_panic');
  } finally {
    if (orig) Object.defineProperty(WebSocket.prototype, 'bufferedAmount', orig);
    else delete WebSocket.prototype.bufferedAmount;
  }
});

test('pairing again while link is open leaves a single link and updates status', async () => {
  assert.equal(bridgeState.peerStatus.connected, true);

  const peer2 = await createPeerComputer();
  const port2 = await listen(peer2.server);
  const config2 = {
    host: '127.0.0.1',
    port: port2,
    peerToken: PEER_TOKEN,
    fingerprint: fingerprintOf(peer2.tls),
  };

  startPeerLink(config2);
  const connected2 = await waitFor(() => bridgeState.peerStatus.connected === true, 10000);
  assert.equal(connected2, true);

  peerComputer.actions.length = 0;
  peer2.actions.length = 0;
  relayToPeer(makeCommand('play', 'p2-play'));
  await waitFor(() => peer2.actions.length > 0);
  assert.equal(peer2.actions.length, 1);
  assert.equal(peerComputer.actions.length, 0);

  stopPeerLink();
  peer2.wsServer.stop();
  await closeServer(peer2.server);
  startPeerLink(linkConfig);
  await waitFor(() => bridgeState.peerStatus.connected === true, 10000);
});

test('markersMatch is false for differing cues, true when matched, false when fingerprint absent', async () => {
  const localFingerprint = bridgeState.manager.getState().cuesFingerprint;

  peerComputer.wsServer.broadcast({
    type: 'state',
    state: { cuesFingerprint: 'differing-cues-fingerprint' },
  });
  const differs = await waitFor(() => bridgeState.peerStatus.markersMatch === false);
  assert.equal(differs, true);

  peerComputer.wsServer.broadcast({
    type: 'state',
    state: { cuesFingerprint: localFingerprint },
  });
  const matched = await waitFor(() => bridgeState.peerStatus.markersMatch === true);
  assert.equal(matched, true);

  peerComputer.wsServer.broadcast({
    type: 'state',
    state: {},
  });
  const missing = await waitFor(() => bridgeState.peerStatus.markersMatch === false);
  assert.equal(missing, true);

  peerComputer.wsServer.broadcast({
    type: 'state',
    state: { cuesFingerprint: localFingerprint },
  });
  await waitFor(() => bridgeState.peerStatus.markersMatch === true);
});

test('auth frame on isPeer connection is rejected without touching isController', async () => {
  const ws = new WebSocket(`wss://127.0.0.1:${mainPort()}/ws?token=${bridgeState.peerToken}`, {
    rejectUnauthorized: false,
  });
  const messages = collect(ws);
  await openSocket(ws);

  const authStatus = await waitFor(() => messages.find((m) => m.type === 'auth_status'));
  assert.equal(authStatus?.isController, false);

  ws.send(JSON.stringify({ type: 'auth', token: bridgeState.authToken }));
  const authResult = await waitFor(() => messages.find((m) => m.type === 'auth_result'));
  assert.equal(authResult?.success, false);

  ws.send(JSON.stringify({ type: 'handshake', clientId: 'peer-auth-test' }));
  const ack = await waitFor(() => messages.find((m) => m.type === 'handshake_ack'));
  if (ack) ws.send(JSON.stringify({ type: 'sync_confirm', stateVersion: ack.stateVersion }));
  await delay(50);

  ws.send(JSON.stringify({ type: 'reorder', songTitles: ['Song A'], commandId: 'esc-fail' }));
  const error = await waitFor(() => messages.find((m) => m.type === 'error'));
  assert.equal(error?.code, 'unauthorized');
  ws.close();
});

test('HEAD on /peer/pair returns 405 and pairing code remains valid for GET', async () => {
  const code = generatePairingCode();
  assert.equal(hasActivePairingCode(), true);

  const headStatus = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port: mainPort(),
        path: `/peer/pair?code=${code}`,
        method: 'HEAD',
        rejectUnauthorized: false,
      },
      (res) => resolve(res.statusCode),
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(headStatus, 405);
  assert.equal(hasActivePairingCode(), true);

  const getResult = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port: mainPort(),
        path: `/peer/pair?code=${code}`,
        method: 'GET',
        rejectUnauthorized: false,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(getResult.status, 200);
  const parsed = JSON.parse(getResult.body);
  assert.equal(parsed.peerToken, bridgeState.peerToken);
});

test('resolveJumpTime ignores automationOnly section and accepts 120.0049 against 120.0051', () => {
  const state = {
    songs: [
      {
        title: 'Song 1',
        time: 0,
        sections: [
          { name: 'Verse', time: 50, automationOnly: true },
          { name: 'Chorus', time: 120.0051, automationOnly: false },
        ],
      },
      {
        title: 'Song 2',
        time: 50,
        sections: [],
      },
    ],
  };

  const autoResult = resolveJumpTime(state, 50, true);
  assert.deepEqual(autoResult, { songIndex: 1, sectionIndex: null });

  const matched = resolveJumpTime(state, 120.0049, true);
  assert.deepEqual(matched, { songIndex: 0, sectionIndex: 1 });

  const missed = resolveJumpTime(state, 120.02, true);
  assert.equal(missed, null);
});

test('sanitizePanelAction returns peer-pair stripped of code', () => {
  assert.equal(sanitizePanelAction('peer-pair:192.168.1.10:123456'), 'peer-pair');
  assert.equal(sanitizePanelAction('peer-pair:localhost:654321'), 'peer-pair');
  assert.equal(sanitizePanelAction('peer-unpair'), 'peer-unpair');
  assert.equal(sanitizePanelAction('peer-code'), 'peer-code');
});

test('reconnection intervals back off and cap at reconnectMaxMs when the peer refuses TLS', async () => {
  // A listener that drops every connection: each attempt is counted where it
  // lands, so the test measures the link and not a stand-in for it.
  const attempts = [];
  const refusing = net.createServer((socket) => {
    attempts.push(Date.now());
    socket.destroy();
  });
  const closedPort = await new Promise((resolve) => {
    refusing.listen(0, '127.0.0.1', () => resolve(refusing.address().port));
  });

  setPeerLinkTiming({ reconnectBaseMs: 25, reconnectMaxMs: 100, connectTimeoutMs: 50 });

  stopPeerLink();
  startPeerLink({
    host: '127.0.0.1',
    port: closedPort,
    peerToken: 'closed-token',
    fingerprint: 'AA:BB:CC',
  });

  await waitFor(() => attempts.length >= 5, 4000);
  stopPeerLink();
  resetPeerLinkTiming();
  await new Promise((resolve) => refusing.close(resolve));

  assert.ok(attempts.length >= 5, `expected at least 5 attempts, got ${attempts.length}`);
  const intervals = [];
  for (let i = 1; i < attempts.length; i++) {
    intervals.push(attempts[i] - attempts[i - 1]);
  }
  assert.ok(intervals[1] > intervals[0], `interval should grow: ${intervals[1]} > ${intervals[0]}`);
  for (let i = 2; i < intervals.length; i++) {
    assert.ok(intervals[i] <= 250, `interval ${intervals[i]} must cap near reconnectMaxMs (100ms)`);
  }

  startPeerLink(linkConfig);
  await waitFor(() => bridgeState.peerStatus.connected === true, 10000);
});

test('a peer that refuses the confirmation drops the link instead of staying green', async () => {
  const received = [];
  const wsServer = new SetlistWSServer('unsynced-auth', { peerToken: 'unsynced-peer-token' });
  wsServer.init();
  wsServer.on('client_message', (message, ws) => {
    received.push(message);
    if (message.type === 'handshake') {
      ws.send(JSON.stringify({ type: 'handshake_ack', stateVersion: 7, state: {} }));
      return;
    }
    // The confirmation never takes on this side, so every command after it
    // is refused the way the server refuses a client that is not in sync.
    if (message.type === 'sync_confirm') return;
    ws.send(
      JSON.stringify({
        type: 'error',
        code: 'not_synchronized',
        message: 'Client is not synchronized.',
      }),
    );
  });
  const server = https.createServer(peerComputer.tls, createHttpRequestListener());
  server.on('upgrade', (req, socket, head) => {
    wsServer.handleUpgrade(req, socket, head);
  });
  const port = await listen(server);

  stopPeerLink();
  startPeerLink({
    host: '127.0.0.1',
    port,
    peerToken: 'unsynced-peer-token',
    fingerprint: fingerprintOf(peerComputer.tls),
  });
  const connected = await waitFor(() => bridgeState.peerStatus.connected === true, 8000);
  assert.ok(connected, 'the link to the second computer must come up');
  relayToPeer(makeCommand('play', 'refused-by-the-peer'));
  await waitFor(() => received.some((message) => message.type === 'play'), 3000);
  const dropped = await waitFor(() => bridgeState.peerStatus.connected === false, 3000);
  assert.ok(dropped, 'a peer that is not in sync must not be reported as connected');
  stopPeerLink();
  wsServer.stop();
  await closeServer(server);
  startPeerLink(linkConfig);
  await waitFor(() => bridgeState.peerStatus.connected === true, 8000);
});

test('the panel shows the port this computer serves on, not a fixed one', () => {
  const port = mainPort();
  assert.ok(port > 0, 'the server must be listening');
  assert.equal(peerPanelModel({ locale: 'en', localIp: '10.0.0.2' }).port, port);
});

test('a marker exactly a hundredth of a beat away is not the marker of the jump', () => {
  const state = {
    songs: [
      { title: 'Song 1', time: 0, sections: [{ name: 'Intro', time: 0, automationOnly: false }] },
    ],
  };
  assert.equal(resolveJumpTime(state, 0.01, false), null);
  assert.equal(resolveJumpTime(state, 0.01, true), null);
  assert.deepEqual(resolveJumpTime(state, 0.0099, false), { songIndex: 0, sectionIndex: null });
});

test('two markers at the same distance: the first in the displayed order wins', () => {
  // Binary fractions, so both distances are exactly the same number.
  const state = {
    songs: [
      { title: 'Song 1', time: 0.24609375, sections: [] },
      { title: 'Song 2', time: 0.25390625, sections: [] },
    ],
  };
  assert.deepEqual(resolveJumpTime(state, 0.25, false), { songIndex: 0, sectionIndex: null });
});
