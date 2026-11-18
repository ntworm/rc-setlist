// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The immediate jump: the flag that asks for it, the refusal that stops it
// while another jump waits for the grid, and the relay that carries it to
// the paired computer.

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { clearExtensionContext, getExtensionContext, setExtensionContext } from '../src/context.ts';
import { JumpScheduler } from '../src/core/next-downbeat-jump.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';
import { executeJumpCommand, immediateJumpRefused } from '../src/commands/handlers/transport.ts';
import { resolvePeerJump } from '../src/commands/handlers/peer.ts';
import { relayToPeer, stopPeerLink } from '../src/runtime/peer-link.ts';
import { writePeerConfig } from '../src/preferences.ts';
import { startServer, stopServer } from '../src/index.ts';
import {
  MAIN_CUES,
  PEER_TOKEN,
  createFakeOsc,
  createPeerComputer,
  fingerprintOf,
  makeCommand,
} from './helpers/peer-link-harness.mjs';

// The transport the immediate jump acts on: the setlist it lands on, the
// scheduler that holds a jump waiting for the grid, and the calls the jump
// makes to the transport.
function installHarness(initialQuantization = 0) {
  const saved = {
    manager: bridgeState.manager,
    scheduler: bridgeState.scheduler,
    oscClient: bridgeState.oscClient,
    wsServer: bridgeState.wsServer,
    extensionContext: getExtensionContext(),
  };
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A', time: 0 },
    { name: 'Song A > Verse', time: 16 },
    { name: 'Song A > Chorus [loop 2x]', time: 32 },
    { name: 'Song B [bpm 90]', time: 64 },
    { name: 'Song B > Verse', time: 80 },
    { name: 'Song B > Chorus [bpm 105]', time: 96 },
  ]);
  manager.updateTransport(20, true, 120);
  manager.updateQuantization(initialQuantization);
  const calls = [];
  const payloads = [];
  bridgeState.manager = manager;
  bridgeState.scheduler = new JumpScheduler();
  bridgeState.oscClient = {
    jumpToCuePoint: (value) => calls.push(['jump', value]),
    setCurrentSongTime: (value) => calls.push(['current-time', value]),
    send: (address, args) => calls.push(['send', address, args]),
    setClipTriggerQuantization: (value) => calls.push(['quantization', value]),
    setMetronome: (value) => calls.push(['metronome', value]),
  };
  bridgeState.wsServer = {
    broadcast: (payload) => payloads.push(payload),
    broadcastState: () => {},
  };
  clearExtensionContext();
  return {
    manager,
    calls,
    payloads,
    restore() {
      bridgeState.manager = saved.manager;
      bridgeState.scheduler = saved.scheduler;
      bridgeState.oscClient = saved.oscClient;
      bridgeState.wsServer = saved.wsServer;
      if (saved.extensionContext) setExtensionContext(saved.extensionContext);
      else clearExtensionContext();
    },
  };
}

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

async function waitForMessage(messages, predicate, timeoutMs = 5000) {
  return waitFor(() => messages.find(predicate), timeoutMs);
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

async function connectSynced(port, token) {
  const ws = new WebSocket(`wss://127.0.0.1:${port}/ws?token=${token}`, {
    rejectUnauthorized: false,
  });
  const messages = collect(ws);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'handshake', clientId: 'test-client' }));
  const ack = await waitFor(() => messages.find((message) => message.type === 'handshake_ack'));
  if (ack) ws.send(JSON.stringify({ type: 'sync_confirm', stateVersion: ack.stateVersion }));
  await delay(50);
  return ws;
}

function mainPort() {
  const address = bridgeState.server?.address();
  return address && typeof address === 'object' ? address.port : 0;
}

before(async () => {
  storageDir = path.join(tmpdir(), `rc-setlist-immediate-${Math.random().toString(36).slice(2)}`);
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
  const osc = createFakeOsc(oscCalls);
  // An immediate jump moves the playhead with it; the fake transport must know it.
  osc.setCurrentSongTime = (value) => oscCalls.push(`setCurrentSongTime:${value}`);
  bridgeState.oscClient = osc;
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

test('an immediate jump while playing moves the playhead now, without a cue jump', () => {
  const harness = installHarness(4);
  try {
    const waited = executeJumpCommand({ songIndex: 1, sectionIndex: 1, immediate: true });
    assert.equal(waited, 0, 'the jump lands now, so there is nothing to wait for');
    assert.equal(
      harness.calls.some(([k]) => k === 'jump'),
      false,
      'no cue jump goes out',
    );
    assert.deepEqual(
      harness.calls.filter(([k]) => k === 'current-time'),
      [['current-time', 96]],
    );
    assert.equal(bridgeState.scheduler.hasPending(), false, 'nothing waits for the grid');
    assert.equal(harness.manager.getState().currentSongTime, 20, 'the poll catches up');
    assert.deepEqual(harness.payloads.at(-1), {
      type: 'jump_executed',
      songIndex: 1,
      sectionIndex: 1,
    });
  } finally {
    harness.restore();
  }
});

test('an immediate jump is refused while a jump waits for the grid', () => {
  const harness = installHarness(4);
  try {
    executeJumpCommand({ songIndex: 1, sectionIndex: 1 });
    assert.equal(bridgeState.scheduler.hasPending(), true, 'the first jump waits');
    const now = () => executeJumpCommand({ songIndex: 1, sectionIndex: 0, immediate: true });
    assert.throws(now, /grid/);
    assert.equal(
      harness.calls.some(([k]) => k === 'current-time'),
      false,
      'nothing moved',
    );
  } finally {
    harness.restore();
  }
});

test('the refusal of an immediate jump is decided in one place', () => {
  // The relay to the paired computer asks the same question the command
  // asks: one rule decides both.
  const harness = installHarness(4);
  try {
    const immediate = { songIndex: 1, sectionIndex: 1, immediate: true };
    const plain = { songIndex: 1, sectionIndex: 1 };
    assert.equal(immediateJumpRefused(immediate), false, 'nothing waits for the grid yet');

    // A quantized jump arms the grid, and Live keeps its cue jump.
    executeJumpCommand({ songIndex: 1, sectionIndex: 1 });
    assert.equal(bridgeState.scheduler.hasPending(), true, 'the jump waits for the grid');
    assert.equal(immediateJumpRefused(immediate), true, 'the immediate jump is refused');
    assert.throws(() => executeJumpCommand(immediate), /waiting for the grid/);
    assert.equal(immediateJumpRefused(plain), false, 'without the flag, nothing is refused');

    // A stopped transport and a transport with no grid jump at once anyway.
    harness.manager.updateTransport(20, false, 120);
    assert.equal(immediateJumpRefused(immediate), false, 'a stopped transport jumps at once');
    harness.manager.updateTransport(20, true, 120);
    harness.manager.updateQuantization(0);
    assert.equal(immediateJumpRefused(immediate), false, 'no grid, nothing to wait for');
  } finally {
    harness.restore();
  }
});

test('a jump at quantization zero is a cue jump, flag or no flag', () => {
  const harness = installHarness(0);
  try {
    executeJumpCommand({ songIndex: 1, sectionIndex: 1, immediate: true });
    assert.equal(
      harness.calls.some(([k]) => k === 'jump'),
      true,
      'the cue jump goes out',
    );
    assert.equal(
      harness.calls.some(([k]) => k === 'current-time'),
      false,
      'no handover',
    );
    assert.equal(bridgeState.scheduler.hasPending(), false);
  } finally {
    harness.restore();
  }
});

test('an immediate jump travels to the peer with the flag', async () => {
  peerComputer.messages.length = 0;
  relayToPeer(
    makeCommand('jump', 'cmd-immediate', { type: 'jump', songIndex: 1, immediate: true }),
  );
  await waitFor(() => peerComputer.messages.some((message) => message.type === 'jump_time'));
  const jump = peerComputer.messages.find((message) => message.type === 'jump_time');
  assert.strictEqual(jump.immediate, true, 'the paired computer lands it at once too');
  const resolved = resolvePeerJump(jump, bridgeState.manager.getState());
  assert.strictEqual(resolved.message?.immediate, true, 'the conversion keeps the flag');
});

test('an immediate jump this computer refuses does not travel to the peer', async () => {
  // The relay runs before the command, so the refusal is asked before the
  // command answers it: the paired computer must not jump now.
  const controller = await connectSynced(mainPort(), bridgeState.authToken);
  const was = bridgeState.manager.getState();
  try {
    bridgeState.manager.updateTransport(21, true, 120);
    executeJumpCommand({ songIndex: 1, sectionIndex: null });
    assert.equal(bridgeState.scheduler.hasPending(), true, 'the jump waits for the grid');

    peerComputer.messages.length = 0;
    controller.send(
      JSON.stringify({ type: 'jump', songIndex: 1, immediate: true, commandId: 'jump-refused' }),
    );
    await delay(300);
    assert.strictEqual(
      peerComputer.messages.some((message) => message.type === 'jump_time'),
      false,
      'the paired computer must not jump now while this one refuses',
    );

    // Without a jump waiting for the grid, the immediate jump travels.
    bridgeState.scheduler.clearPending();
    peerComputer.messages.length = 0;
    controller.send(
      JSON.stringify({ type: 'jump', songIndex: 1, immediate: true, commandId: 'jump-now' }),
    );
    const jump = await waitForMessage(
      peerComputer.messages,
      (message) => message.type === 'jump_time',
    );
    assert.ok(jump, 'the immediate jump travels when nothing waits for the grid');
    assert.strictEqual(jump.immediate, true, 'the flag travels with it');
  } finally {
    bridgeState.scheduler.clearPending();
    bridgeState.manager.updateTransport(was.currentSongTime, was.isPlaying, was.tempo);
    controller.close();
  }
});
