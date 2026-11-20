// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import { startServer, stopServer } from '../src/index.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { startPeerLink, stopPeerLink } from '../src/runtime/peer-link.ts';
import { pair } from '../src/runtime/pairing.ts';
import { readPeerConfigs } from '../src/preferences.ts';
import { createFakeOsc } from './helpers/peer-link-harness.mjs';
import { MAIN_CUES, readLogCalls, spawnPeerChild } from './helpers/peer-e2e-node.mjs';

let mainStorageDir = '';
let childStorageDir = '';
let childLogFile = '';
let childProcess = null;
let childPort = 0;
let childCode = '';
let childToken = '';
let controller = null;
const mainOscCalls = [];

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

async function waitForChildCall(logFile, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const calls = readLogCalls(logFile);
    const match = calls.find(predicate);
    if (match) return match;
    await delay(25);
  }
  return readLogCalls(logFile).find(predicate);
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

async function connectSynced(port, token) {
  const ws = new WebSocket(`wss://127.0.0.1:${port}/ws?token=${token}`, {
    rejectUnauthorized: false,
  });
  const messages = collect(ws);
  await openSocket(ws);
  ws.send(JSON.stringify({ type: 'handshake', clientId: 'test-controller' }));
  const ack = await waitFor(() => messages.find((m) => m.type === 'handshake_ack'), 5000);
  if (ack) ws.send(JSON.stringify({ type: 'sync_confirm', stateVersion: ack.stateVersion }));
  await delay(50);
  return ws;
}

function mainPort() {
  const address = bridgeState.server?.address();
  return address && typeof address === 'object' ? address.port : 0;
}

before(async () => {
  mainStorageDir = path.join(tmpdir(), `rc-main-${Math.random().toString(36).slice(2)}`);
  childStorageDir = path.join(tmpdir(), `rc-child-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(mainStorageDir, { recursive: true });
  fs.mkdirSync(childStorageDir, { recursive: true });
  childLogFile = path.join(childStorageDir, 'child-osc.log');

  const peer = spawnPeerChild(childLogFile, childStorageDir);
  childProcess = peer.child;
  const ready = await peer.readyPromise;
  childPort = ready.port;
  childCode = ready.pairingCode;
  childToken = ready.authToken;

  setExtensionContext({
    environment: { storageDirectory: mainStorageDir },
    application: { song: { handle: { id: 42 }, tempo: 120, cuePoints: MAIN_CUES } },
  });

  await startServer({ port: 0, skipOsc: true, skipProjectDetector: true });
  bridgeState.oscClient = createFakeOsc(mainOscCalls);
  bridgeState.manager.updateCues(MAIN_CUES);
});

after(async () => {
  if (childProcess && !childProcess.killed) {
    try {
      childProcess.kill('SIGKILL');
    } catch {
      // process already dead
    }
  }
  controller?.close();
  stopPeerLink();
  await stopServer();
  clearExtensionContext();
  try {
    fs.rmSync(mainStorageDir, { recursive: true, force: true });
    fs.rmSync(childStorageDir, { recursive: true, force: true });
  } catch {
    // cleanup temp dirs
  }
});

test('pair with wrong code fails and correct code establishes link', async () => {
  const bad = await pair('127.0.0.1', '000000', childPort);
  assert.equal(bad.ok, false);

  const good = await pair('127.0.0.1', childCode, childPort);
  assert.equal(good.ok, true);
  assert.ok(good.config);

  startPeerLink(good.config);
  const connected = await waitFor(() => bridgeState.peerStatus.connected === true, 10000);
  assert.equal(connected, true);

  controller = await connectSynced(mainPort(), bridgeState.authToken);
  assert.ok(controller);
});

test('jump lands on matching cue point on peer with different order and 0.002 offset', async () => {
  controller.send(JSON.stringify({ type: 'jump', songIndex: 1, commandId: 'jump-song-b' }));
  const call = await waitForChildCall(childLogFile, (l) => l.startsWith('jumpToCuePoint:'));
  assert.equal(call, 'jumpToCuePoint:2');
});

test('jump to section activates loop on the peer', async () => {
  controller.send(
    JSON.stringify({ type: 'jump', songIndex: 1, sectionIndex: 0, commandId: 'jump-chorus' }),
  );
  const jumpCall = await waitForChildCall(childLogFile, (l) => l === 'jumpToCuePoint:3');
  assert.equal(jumpCall, 'jumpToCuePoint:3');

  const loopCall = await waitForChildCall(
    childLogFile,
    (l) => l.includes('/live/song/set/loop:') && l.includes('"value":1'),
  );
  assert.ok(loopCall, 'section loop must activate loop on the peer');
});

test('play, stop, metronome, and set_quantization arrive on the peer', async () => {
  controller.send(JSON.stringify({ type: 'play', commandId: 'cmd-play' }));
  const play = await waitForChildCall(
    childLogFile,
    (l) => l === 'startPlaying' || l === 'continuePlaying',
  );
  assert.ok(play);

  controller.send(JSON.stringify({ type: 'stop', commandId: 'cmd-stop' }));
  const stop = await waitForChildCall(childLogFile, (l) => l === 'stopPlaying');
  assert.ok(stop);

  controller.send(JSON.stringify({ type: 'metronome', value: true, commandId: 'cmd-metro' }));
  const metro = await waitForChildCall(childLogFile, (l) => l === 'setMetronome:true');
  assert.ok(metro);

  controller.send(JSON.stringify({ type: 'set_quantization', value: 4, commandId: 'cmd-quant' }));
  const quant = await waitForChildCall(childLogFile, (l) =>
    l.startsWith('setClipTriggerQuantization:4'),
  );
  assert.ok(quant);
});

test('reorder, set_mode, and set_pre_roll do not travel to the peer', async () => {
  const beforeCount = readLogCalls(childLogFile).length;
  controller.send(
    JSON.stringify({
      type: 'reorder',
      songTitles: ['Song B', 'Song A'],
      commandId: 'cmd-reorder',
    }),
  );
  controller.send(JSON.stringify({ type: 'set_mode', mode: 'show', commandId: 'cmd-mode' }));
  controller.send(JSON.stringify({ type: 'set_pre_roll', value: true, commandId: 'cmd-preroll' }));
  await delay(200);
  const newCalls = readLogCalls(childLogFile).slice(beforeCount);
  assert.equal(newCalls.length, 0);
});

test('critical lock prevents jump from being relayed to peer', async () => {
  bridgeState.manager.setCriticalCommandsLocked(true);
  const beforeCount = readLogCalls(childLogFile).length;
  controller.send(JSON.stringify({ type: 'jump', songIndex: 1, commandId: 'cmd-locked-jump' }));
  await delay(200);
  const newCalls = readLogCalls(childLogFile).slice(beforeCount);
  assert.equal(
    newCalls.filter((c) => c.startsWith('jumpToCuePoint')).length,
    0,
    'critical lock must block jump relay',
  );
  bridgeState.manager.setCriticalCommandsLocked(false);
});

/** How many times a call shows up in a list of calls. */
function countOf(calls, line) {
  return calls.filter((call) => call === line).length;
}

test('a phone on the second computer drives the main one, and each computer runs it once', async () => {
  const phone = await connectSynced(childPort, childToken);
  const phoneMessages = collect(phone);
  try {
    const mainBefore = mainOscCalls.length;
    const childBefore = readLogCalls(childLogFile).length;
    phone.send(JSON.stringify({ type: 'metronome', value: false, commandId: 'phone-metro' }));
    const onMain = await waitFor(
      () => mainOscCalls.slice(mainBefore).includes('setMetronome:false'),
      3000,
    );
    assert.equal(onMain, true, 'the main computer runs the command of the phone');
    const onChild = await waitForChildCall(childLogFile, (l) => l === 'setMetronome:false');
    assert.ok(onChild, 'the command comes back down to the second computer');
    // No echo and no loop: wait, then count again.
    await delay(500);
    assert.equal(countOf(mainOscCalls.slice(mainBefore), 'setMetronome:false'), 1);
    assert.equal(countOf(readLogCalls(childLogFile).slice(childBefore), 'setMetronome:false'), 1);
    const statuses = phoneMessages.filter(
      (m) => m.type === 'command_status' && m.commandId === 'phone-metro',
    );
    assert.ok(
      statuses.some((m) => m.status === 'sent'),
      'the phone learns the command went up',
    );
    assert.ok(
      statuses.some((m) => m.status !== 'sent' && m.status !== 'failed'),
      'the phone sees its own command settle on the second computer',
    );
  } finally {
    phone.close();
  }
});

test('a jump of a phone on the second computer goes up by beat and lands once on each', async () => {
  const phone = await connectSynced(childPort, childToken);
  try {
    // The songs sit in another order here, so the jump goes up by beat.
    const jumpMainBefore = mainOscCalls.length;
    const jumpChildBefore = readLogCalls(childLogFile).length;
    phone.send(JSON.stringify({ type: 'jump', songIndex: 0, commandId: 'phone-jump' }));
    const mainJump = await waitFor(
      () => mainOscCalls.slice(jumpMainBefore).some((c) => c.startsWith('jumpToCuePoint:')),
      3000,
    );
    assert.equal(mainJump, true, 'the main computer jumps');
    const childJump = await waitFor(
      () =>
        readLogCalls(childLogFile)
          .slice(jumpChildBefore)
          .some((c) => c === 'jumpToCuePoint:2'),
      3000,
    );
    assert.equal(childJump, true, 'the second computer lands on the same song');
    await delay(500);
    assert.equal(
      mainOscCalls.slice(jumpMainBefore).filter((c) => c.startsWith('jumpToCuePoint:')).length,
      1,
    );
    assert.equal(
      readLogCalls(childLogFile)
        .slice(jumpChildBefore)
        .filter((c) => c.startsWith('jumpToCuePoint:')).length,
      1,
    );
  } finally {
    phone.close();
  }
});

test('with the main computer gone, a phone on the second computer drives it alone', async () => {
  stopPeerLink();
  const gone = await waitFor(() => bridgeState.peerStatus.connected === false, 5000);
  assert.equal(gone, true);
  await delay(200);
  const phone = await connectSynced(childPort, childToken);
  const phoneMessages = collect(phone);
  try {
    const mainBefore = mainOscCalls.length;
    const childBefore = readLogCalls(childLogFile).length;
    phone.send(JSON.stringify({ type: 'metronome', value: true, commandId: 'phone-alone' }));
    const onChild = await waitFor(
      () => readLogCalls(childLogFile).slice(childBefore).includes('setMetronome:true'),
      3000,
    );
    assert.equal(onChild, true, 'the second computer runs the command itself');
    await delay(300);
    assert.equal(
      countOf(mainOscCalls.slice(mainBefore), 'setMetronome:true'),
      0,
      'nothing reaches the main computer',
    );
    const told = phoneMessages.some(
      (m) => m.type === 'log' && /ran on this computer only/.test(m.message),
    );
    assert.equal(told, true, 'the phone is told the command ran here alone');
  } finally {
    phone.close();
  }
  // The link comes back for the tests that follow.
  startPeerLink(readPeerConfigs()[0]);
  const back = await waitFor(() => bridgeState.peerStatus.connected === true, 10000);
  assert.equal(back, true);
});

test('a second computer left stopped while the main one plays starts on the next bar', async () => {
  const beforeCount = readLogCalls(childLogFile).length;
  // The main computer plays at its tempo: the follower trusts only a
  // playhead that moves.
  const startedAt = Date.now();
  const tempo = bridgeState.manager.getState().tempo;
  const advance = () =>
    bridgeState.manager.updateTransport(64 + ((Date.now() - startedAt) / 60_000) * tempo, true);
  advance();
  const timer = setInterval(advance, 100);
  try {
    const started = await waitFor(() => {
      const calls = readLogCalls(childLogFile).slice(beforeCount);
      const at = calls.findIndex((c) => c.startsWith('setCurrentSongTime:'));
      if (at < 0) return false;
      const beat = Number(calls[at].split(':')[1]);
      return beat % 4 === 0 && calls.slice(at + 1).includes('startPlaying');
    }, 10000);
    assert.equal(started, true, 'the follower must move to a bar line and start');
  } finally {
    clearInterval(timer);
    bridgeState.manager.updateTransport(64, false);
  }
});

test('killing the peer child marks connected false and local stop executes in < 500ms', async () => {
  childProcess.kill('SIGTERM');
  const disconnected = await waitFor(() => bridgeState.peerStatus.connected === false, 5000);
  assert.equal(disconnected, true);

  const oscBefore = mainOscCalls.length;
  const t0 = performance.now();
  controller.send(JSON.stringify({ type: 'stop', commandId: 'cmd-stop-after-kill' }));
  const stopRecorded = await waitFor(
    () => mainOscCalls.slice(oscBefore).includes('stopPlaying'),
    1000,
  );
  const elapsed = performance.now() - t0;
  assert.equal(stopRecorded, true);
  assert.ok(elapsed < 500, `local stop took ${elapsed}ms, expected < 500ms`);
});
