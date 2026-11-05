import { test, before, after } from 'node:test';
import assert from 'node:assert';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as tls from 'node:tls';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import { startServer, stopServer } from '../src/index.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { SetlistWSServer } from '../src/server/ws.ts';
import { createHttpRequestListener } from '../src/server/http.ts';
import {
  PEER_RELAY_TYPES,
  relayToPeer,
  resetPeerLinkTiming,
  setPeerLinkTiming,
  startPeerLink,
  stopPeerLink,
} from '../src/runtime/peer-link.ts';
import { writePeerConfig } from '../src/preferences.ts';
import {
  MAIN_CUES,
  PEER_TOKEN,
  createFakeOsc,
  createPeerComputer,
  fingerprintOf,
  makeCommand,
  makeTlsOptions,
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
      // a frame that is not JSON is not a frame this test cares about
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

async function waitForMessage(messages, predicate, timeoutMs = 5000) {
  return waitFor(() => messages.find(predicate), timeoutMs);
}

async function connectSynced(port, token) {
  const ws = new WebSocket(`wss://127.0.0.1:${port}/ws?token=${token}`, {
    rejectUnauthorized: false,
  });
  const messages = collect(ws);
  await openSocket(ws);
  ws.send(JSON.stringify({ type: 'handshake', clientId: 'test-client' }));
  const ack = await waitForMessage(messages, (message) => message.type === 'handshake_ack');
  if (ack) ws.send(JSON.stringify({ type: 'sync_confirm', stateVersion: ack.stateVersion }));
  await delay(50);
  return ws;
}

function mainPort() {
  const address = bridgeState.server?.address();
  return address && typeof address === 'object' ? address.port : 0;
}

before(async () => {
  storageDir = path.join(tmpdir(), `rc-setlist-peer-${Math.random().toString(36).slice(2)}`);
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
  assert.ok(connected, 'the link to the second computer must come up');
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
    // a leftover temp directory is not worth failing a test over
  }
});

test('the relay carries the closed list of commands and nothing else', async () => {
  const seen = [];
  for (const type of PEER_RELAY_TYPES) {
    peerComputer.actions.length = 0;
    relayToPeer(makeCommand(type));
    await waitFor(() => peerComputer.actions.length > 0);
    seen.push(peerComputer.actions[0]?.source ?? null);
  }
  assert.deepStrictEqual(seen, [
    'play',
    'stop',
    'jump_time',
    'metronome',
    'set_quantization',
    'trigger_count_in',
    'refresh',
    'set_panic',
  ]);
  peerComputer.actions.length = 0;
  relayToPeer(makeCommand('reorder'));
  await delay(150);
  assert.strictEqual(peerComputer.actions.length, 0);
});

test('the command that reaches the peer carries a hashed id', async () => {
  peerComputer.actions.length = 0;
  relayToPeer(makeCommand('play', 'cmd-42'));
  await waitFor(() => peerComputer.actions.length > 0);
  assert.match(peerComputer.actions[0].id, /^peer-[0-9a-f]{32}$/);
});

test('a jump travels by beat, so another song order lands on the same song', async () => {
  peerComputer.actions.length = 0;
  relayToPeer(makeCommand('jump'));
  await waitFor(() => peerComputer.actions.length > 0);
  const action = peerComputer.actions[0];
  assert.strictEqual(action.source, 'jump_time');
  assert.strictEqual(action.time, 100);
  assert.strictEqual(action.title, 'Song B');
  assert.strictEqual(action.songIndex, 0);
});

test('a beat that differs by less than a hundredth lands on the same marker', async () => {
  const peerSocket = await connectSynced(peerPort, PEER_TOKEN);
  peerComputer.actions.length = 0;
  peerSocket.send(JSON.stringify({ type: 'jump_time', time: 100.004, commandId: 'beat-1' }));
  await waitFor(() => peerComputer.actions.length > 0);
  assert.strictEqual(peerComputer.actions[0].title, 'Song B');
  peerSocket.close();
});

test('a beat without a marker is refused and the main computer says so', async () => {
  const controller = await connectSynced(mainPort(), bridgeState.authToken);
  const messages = collect(controller);
  peerComputer.actions.length = 0;
  controller.send(JSON.stringify({ type: 'jump', songIndex: 2, commandId: 'jump-c' }));
  const warning = await waitForMessage(
    messages,
    (message) => message.type === 'log' && message.level === 'warn',
  );
  assert.ok(warning, 'the main computer must report that the peer had no marker');
  assert.strictEqual(peerComputer.actions.length, 0);
  controller.close();
});

test('a certificate that does not match the pairing stops the link', async () => {
  stopPeerLink();
  startPeerLink({
    ...linkConfig,
    fingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
  });
  await waitFor(() => bridgeState.peerStatus.fingerprintMismatch === true, 8000);
  assert.strictEqual(bridgeState.peerStatus.fingerprintMismatch, true);
  assert.strictEqual(bridgeState.peerStatus.connected, false);
  startPeerLink(linkConfig);
  await waitFor(() => bridgeState.peerStatus.connected === true, 8000);
});

test('a computer with another certificate receives no byte of the link', async () => {
  const received = [];
  const otherTls = await makeTlsOptions();
  const other = tls.createServer(otherTls, (socket) => {
    socket.on('data', (chunk) => received.push(chunk.toString('utf8')));
  });
  const otherPort = await listen(other);
  stopPeerLink();
  // The link was paired with the second computer and now points at another
  // one: the certificate is checked before a byte is said to it.
  startPeerLink({
    host: '127.0.0.1',
    port: otherPort,
    peerToken: PEER_TOKEN,
    fingerprint: fingerprintOf(peerComputer.tls),
  });
  const mismatch = await waitFor(() => bridgeState.peerStatus.fingerprintMismatch === true, 8000);
  assert.ok(mismatch, 'the link must notice the other certificate');
  await delay(300);
  const seen = received.join('');
  assert.strictEqual(seen, '', 'the other computer must not receive a single byte');
  assert.ok(!seen.includes(PEER_TOKEN), 'the credential must never reach it');
  stopPeerLink();
  await closeServer(other);
  startPeerLink(linkConfig);
  await waitFor(() => bridgeState.peerStatus.connected === true, 8000);
});

test('a peer that stops answering pings is dropped, and the next command is discarded', async () => {
  const received = [];
  const wsServer = new SetlistWSServer('pong-auth', { peerToken: 'pong-peer-token' });
  const wss = wsServer.init();
  wss.on('connection', (socket) => {
    // The paired computer is there and no longer answers.
    socket.pong = () => {};
  });
  wsServer.on('client_message', (message, ws) => {
    received.push(message);
    if (message.type === 'handshake') {
      ws.send(JSON.stringify({ type: 'handshake_ack', stateVersion: 0, state: {} }));
    }
  });
  const server = https.createServer(peerComputer.tls, createHttpRequestListener());
  server.on('upgrade', (req, socket, head) => {
    wsServer.handleUpgrade(req, socket, head);
  });
  const port = await listen(server);

  // The timings are injected, so the test need not sit through five seconds.
  setPeerLinkTiming({ pingIntervalMs: 50, pongTimeoutMs: 150 });
  stopPeerLink();
  startPeerLink({
    host: '127.0.0.1',
    port,
    peerToken: 'pong-peer-token',
    fingerprint: fingerprintOf(peerComputer.tls),
  });
  const connected = await waitFor(() => bridgeState.peerStatus.connected === true, 8000);
  assert.ok(connected, 'the link to the second computer must come up');
  const dropped = await waitFor(() => bridgeState.peerStatus.connected === false, 6000);
  assert.ok(dropped, 'a peer that stops answering must be dropped');
  relayToPeer(makeCommand('play', 'after-the-drop'));
  await delay(300);
  assert.strictEqual(received.filter((message) => message.type === 'play').length, 0);
  stopPeerLink();
  resetPeerLinkTiming();
  wsServer.stop();
  await closeServer(server);
  startPeerLink(linkConfig);
  await waitFor(() => bridgeState.peerStatus.connected === true, 8000);
});

test('a jump by beat keeps the level of the target: a section and a song share a beat', async () => {
  const peerSocket = await connectSynced(peerPort, PEER_TOKEN);
  peerComputer.actions.length = 0;
  peerSocket.send(
    JSON.stringify({ type: 'jump_time', time: 100, section: true, commandId: 'beat-section' }),
  );
  await waitFor(() => peerComputer.actions.length > 0);
  assert.strictEqual(peerComputer.actions[0].title, 'Song B');
  assert.strictEqual(peerComputer.actions[0].sectionIndex, 0);

  peerComputer.actions.length = 0;
  peerSocket.send(
    JSON.stringify({ type: 'jump_time', time: 100, section: false, commandId: 'beat-song' }),
  );
  await waitFor(() => peerComputer.actions.length > 0);
  assert.strictEqual(peerComputer.actions[0].title, 'Song B');
  assert.strictEqual(peerComputer.actions[0].sectionIndex, null);
  peerSocket.close();
});

test('a jump to a section travels with its level', async () => {
  peerComputer.messages.length = 0;
  peerComputer.actions.length = 0;
  relayToPeer(makeCommand('jump', 'cmd-section', { type: 'jump', songIndex: 1, sectionIndex: 0 }));
  await waitFor(() => peerComputer.messages.some((message) => message.type === 'jump_time'));
  const jump = peerComputer.messages.find((message) => message.type === 'jump_time');
  assert.strictEqual(jump.time, 100);
  assert.strictEqual(jump.section, true);
  await waitFor(() => peerComputer.actions.length > 0);
  assert.strictEqual(peerComputer.actions[0].sectionIndex, 0);

  peerComputer.messages.length = 0;
  peerComputer.actions.length = 0;
  relayToPeer(makeCommand('jump', 'cmd-song', { type: 'jump', songIndex: 1 }));
  await waitFor(() => peerComputer.messages.some((message) => message.type === 'jump_time'));
  const song = peerComputer.messages.find((message) => message.type === 'jump_time');
  assert.strictEqual(song.time, 100);
  assert.strictEqual(song.section, false);
  await waitFor(() => peerComputer.actions.length > 0);
  assert.strictEqual(peerComputer.actions[0].sectionIndex, null);
});

test('a jump to a section that does not exist does not travel', async () => {
  peerComputer.messages.length = 0;
  relayToPeer(
    makeCommand('jump', 'cmd-no-section', { type: 'jump', songIndex: 1, sectionIndex: 99 }),
  );
  await delay(100);
  assert.strictEqual(
    peerComputer.messages.some((message) => message.type === 'jump_time'),
    false,
  );
});

test('a peer that is out of the air does not hold the local command back', async () => {
  stopPeerLink();
  const before = oscCalls.length;
  const controller = await connectSynced(mainPort(), bridgeState.authToken);
  controller.send(JSON.stringify({ type: 'play', commandId: 'play-local' }));
  await waitFor(() => oscCalls.length > before, 3000);
  assert.ok(oscCalls.some((call) => call === 'startPlaying' || call === 'continuePlaying'));
  controller.close();
});

test('stop runs locally even when the peer is out', async () => {
  stopPeerLink();
  const before = oscCalls.length;
  const controller = await connectSynced(mainPort(), bridgeState.authToken);
  controller.send(JSON.stringify({ type: 'stop', commandId: 'stop-local' }));
  await waitFor(() => oscCalls.length > before, 3000);
  assert.ok(oscCalls.includes('stopPlaying'));
  controller.close();
  startPeerLink(linkConfig);
  await waitFor(() => bridgeState.peerStatus.connected === true, 8000);
});

test('a command that came from a peer is not forwarded again', async () => {
  const peerSocket = await connectSynced(mainPort(), bridgeState.peerToken);
  peerComputer.actions.length = 0;
  const before = oscCalls.length;
  peerSocket.send(JSON.stringify({ type: 'play', commandId: 'peer-play' }));
  await waitFor(() => oscCalls.length > before, 3000);
  await delay(200);
  assert.strictEqual(peerComputer.actions.length, 0);
  peerSocket.close();
});

test('a peer connection is refused outside the list of commands', async () => {
  const peerSocket = await connectSynced(mainPort(), bridgeState.peerToken);
  const messages = collect(peerSocket);
  peerSocket.send(JSON.stringify({ type: 'reorder', songTitles: ['Song B'], commandId: 'r-1' }));
  const error = await waitForMessage(messages, (message) => message.type === 'error');
  assert.strictEqual(error.code, 'unauthorized');
  peerSocket.close();
});

test('a jump by beat from a connection that is not a peer is refused', async () => {
  // The connection handshook, so the only reason left for the refusal is
  // that it is not a peer.
  const socket = await connectSynced(mainPort(), '');
  const messages = collect(socket);
  socket.send(JSON.stringify({ type: 'jump_time', time: 100 }));
  const error = await waitForMessage(messages, (message) => message.type === 'error');
  assert.strictEqual(error.code, 'unauthorized');
  socket.close();
});

test('a command this computer refuses does not go to the peer', async () => {
  const controller = await connectSynced(mainPort(), bridgeState.authToken);
  controller.send(JSON.stringify({ type: 'set_panic', active: true, commandId: 'panic-1' }));
  await waitFor(() => bridgeState.manager.getState().safety.panicActive);
  await delay(200);
  peerComputer.actions.length = 0;
  controller.send(JSON.stringify({ type: 'play', commandId: 'play-panic' }));
  await delay(300);
  assert.strictEqual(peerComputer.actions.length, 0);
  controller.send(JSON.stringify({ type: 'set_panic', active: false, commandId: 'panic-2' }));
  await waitFor(() => !bridgeState.manager.getState().safety.panicActive);
  controller.close();
});

test('a command the full queue of this computer refuses does not go to the peer', async () => {
  await waitFor(() => bridgeState.peerStatus.connected === true, 8000);
  const controller = await connectSynced(mainPort(), bridgeState.authToken);
  const messages = collect(controller);
  const bus = bridgeState.commandBus;
  const capacity = bus.maxQueueSize;
  // A queue with no room refuses every command outside the safety lane the
  // moment it is dispatched, the way a queue that filled up would.
  bus.maxQueueSize = 0;
  try {
    peerComputer.actions.length = 0;
    controller.send(JSON.stringify({ type: 'play', commandId: 'play-full-queue' }));
    const refused = await waitForMessage(
      messages,
      (message) =>
        message.type === 'command_status' &&
        message.commandId === 'play-full-queue' &&
        message.status === 'failed',
    );
    assert.ok(refused, 'this computer must refuse the command');
    await delay(300);
    assert.strictEqual(peerComputer.actions.length, 0);
  } finally {
    bus.maxQueueSize = capacity;
    controller.close();
  }
});

test('the link reconnects without the server rate limiting it', async () => {
  const reconnects = { count: 0 };
  const wsServer = new SetlistWSServer('reconnect-auth', { peerToken: 'reconnect-peer-token' });
  const wss = wsServer.init();
  wss.on('connection', (socket) => {
    reconnects.count += 1;
    socket.close();
  });
  const tls = peerComputer.tls;
  const server = https.createServer(tls, createHttpRequestListener());
  server.on('upgrade', (req, socket, head) => {
    wsServer.handleUpgrade(req, socket, head);
  });
  const port = await listen(server);
  stopPeerLink();
  startPeerLink({
    host: '127.0.0.1',
    port,
    peerToken: 'reconnect-peer-token',
    fingerprint: fingerprintOf(tls),
  });
  await waitFor(() => reconnects.count >= 7, 45000);
  assert.ok(reconnects.count >= 7, `expected seven reconnections, saw ${reconnects.count}`);
  stopPeerLink();
  wsServer.stop();
  await closeServer(server);
});

test('a command that arrives while the peer is down is not queued', async () => {
  stopPeerLink();
  relayToPeer(makeCommand('play', 'queued-1'));
  relayToPeer(makeCommand('stop', 'queued-2'));
  await delay(150);
  startPeerLink(linkConfig);
  await waitFor(() => bridgeState.peerStatus.connected === true, 8000);
  peerComputer.actions.length = 0;
  await delay(250);
  assert.strictEqual(peerComputer.actions.length, 0);
});

test('the relay survives a socket that broke', async () => {
  stopPeerLink();
  startPeerLink({ host: '127.0.0.1', port: 1, peerToken: 'broken', fingerprint: 'broken' });
  await delay(300);
  assert.doesNotThrow(() => relayToPeer(makeCommand('play')));
  stopPeerLink();
  startPeerLink(linkConfig);
  await waitFor(() => bridgeState.peerStatus.connected === true, 8000);
});
