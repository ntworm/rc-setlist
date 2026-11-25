// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Two-process loopback E2E tests for slave follow modes (follow, transport, independent)
// and slave Stage Control navigation lock.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { clearExtensionContext } from '../src/context.ts';
import { stopServer } from '../src/index.ts';
import { writePeerConfigs } from '../src/preferences.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { pair } from '../src/runtime/pairing.ts';
import { resetPeerFollowTiming, setPeerFollowTiming } from '../src/runtime/peer-follow-runtime.ts';
import { resetPeerHealthTiming, setPeerHealthTiming } from '../src/runtime/peer-health.ts';
import {
  resetPeerLinkTiming,
  setPeerLinkTiming,
  startPeerLink,
  stopPeerLink,
} from '../src/runtime/peer-link.ts';
import { fingerprintOf } from './helpers/peer-link-harness.mjs';
import {
  MAIN_CUES,
  collectJson,
  createWsTlsProxy,
  delay,
  ipcRequest,
  openSocket,
  readLogCalls,
  serverPort,
  setupMasterNode,
  spawnPeerChild,
  tryParseJson,
  waitFor,
} from './helpers/peer-e2e-node.mjs';

const ctx = {
  mainDir: '',
  childDir: '',
  childLog: '',
  child: null,
  childReady: null,
  proxy: null,
  oscCalls: [],
  dropSlaveAcks: false,
  c2sFrames: [],
  s2cFrames: [],
};

function getChildStatus() {
  return ipcRequest(ctx.child, { type: 'get_peer_status' }, 'peer_status');
}

async function setSlaveMode(mode) {
  await ipcRequest(ctx.child, { type: 'set_peer_follow_mode', mode });
  const observed = await waitFor(() => bridgeState.peerStatuses[0]?.followMode === mode, 3000);
  assert.equal(observed, true, `master must observe slave followMode=${mode}`);
}

async function connectBrowser(port, token, clientId) {
  const ws = new WebSocket(`wss://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`, {
    rejectUnauthorized: false,
  });
  const messages = collectJson(ws);
  await openSocket(ws);
  ws.send(JSON.stringify({ type: 'handshake', clientId }));
  const handshakeAck = await waitFor(() => messages.find((m) => m.type === 'handshake_ack'), 5000);
  assert.ok(handshakeAck, 'handshake_ack must arrive');
  ws.send(JSON.stringify({ type: 'sync_confirm', stateVersion: handshakeAck.stateVersion }));
  await delay(30);
  return { ws, messages, handshakeAck };
}

async function waitBothOk(timeoutMs = 4000) {
  const ok = await waitFor(async () => {
    if (bridgeState.peerStatus.health !== 'ok' || bridgeState.peerStatus.reason !== 'ok') {
      return null;
    }
    const slave = await getChildStatus();
    return slave.peerStatus.health === 'ok' && slave.peerStatus.reason === 'ok' ? slave : null;
  }, timeoutMs);
  assert.ok(ok, 'both master and slave must reach health=ok');
}

async function resetBothStoppedAtZero() {
  ctx.dropSlaveAcks = false;
  bridgeState.scheduler?.clearPending();
  bridgeState.manager?.clearLoop();
  bridgeState.manager?.updateTransport(0, false);
  await ipcRequest(ctx.child, { type: 'set_transport', songTime: 0, isPlaying: false });
  await setSlaveMode('follow');
  await waitBothOk(4000);
}

before(async () => {
  const id = Math.random().toString(36).slice(2);
  ctx.mainDir = path.join(tmpdir(), `rc-fm-main-${id}`);
  ctx.childDir = path.join(tmpdir(), `rc-fm-child-${id}`);
  fs.mkdirSync(ctx.mainDir, { recursive: true });
  fs.mkdirSync(ctx.childDir, { recursive: true });
  ctx.childLog = path.join(ctx.childDir, 'osc.log');

  const peer = spawnPeerChild(ctx.childLog, ctx.childDir);
  ctx.child = peer.child;
  ctx.childReady = await peer.readyPromise;
  await ipcRequest(ctx.child, { type: 'update_cues', cues: MAIN_CUES });

  const healthTiming = {
    heartbeatIntervalMs: 120,
    heartbeatLostMs: 1000,
    heartbeatDownMs: 3000,
    warmupCleanMs: 150,
    unstableCleanMs: 250,
    ackCleanMs: 150,
  };
  setPeerHealthTiming(healthTiming);
  await ipcRequest(ctx.child, { type: 'set_health_timing', timing: healthTiming });
  await ipcRequest(ctx.child, { type: 'set_follow_timing', timing: { outOfStepMs: 350 } });
  setPeerFollowTiming({ outOfStepMs: 350 });
  setPeerLinkTiming({ reconnectBaseMs: 40, reconnectMaxMs: 120 });

  await setupMasterNode(ctx.mainDir, ctx.oscCalls);
  const paired = await pair('127.0.0.1', ctx.childReady.pairingCode, ctx.childReady.port);
  assert.equal(paired.ok, true);

  ctx.proxy = await createWsTlsProxy(ctx.childReady.port, (dir, text, destWs) => {
    const parsed = tryParseJson(text);
    if (dir === 'c2s') ctx.c2sFrames.push(parsed);
    else ctx.s2cFrames.push(parsed);
    if (dir === 's2c' && ctx.dropSlaveAcks && parsed?.type === 'peer_ack') return;
    destWs.send(text);
  });
  const proxyConfig = {
    host: '127.0.0.1',
    port: ctx.proxy.port,
    peerToken: paired.config.peerToken,
    fingerprint: fingerprintOf(ctx.proxy.tls),
  };
  writePeerConfigs([proxyConfig]);
  startPeerLink(proxyConfig);
  await waitBothOk(8000);
});

after(async () => {
  if (ctx.child && !ctx.child.killed) ctx.child.kill('SIGKILL');
  stopPeerLink();
  resetPeerHealthTiming();
  resetPeerFollowTiming();
  resetPeerLinkTiming();
  await stopServer();
  await ctx.proxy?.close();
  clearExtensionContext();
  fs.rmSync(ctx.mainDir, { recursive: true, force: true });
  fs.rmSync(ctx.childDir, { recursive: true, force: true });
});

/** Sends each locked command from the slave browser and expects slave_locked with no OSC on either side. */
async function assertLockedCommandsRefused(slave) {
  const beforeMasterOsc = ctx.oscCalls.length;
  const beforeSlaveOsc = readLogCalls(ctx.childLog).length;
  const lockedPayloads = [
    { type: 'play', commandId: 'lk-play' },
    { type: 'jump', songIndex: 1, commandId: 'lk-jump' },
    { type: 'trigger_count_in', sendPlayOffsetMs: 0, commandId: 'lk-count' },
    { type: 'metronome', value: true, commandId: 'lk-metro' },
    { type: 'set_quantization', value: 4, commandId: 'lk-quant' },
    { type: 'set_pre_roll', value: true, commandId: 'lk-preroll' },
  ];
  for (const payload of lockedPayloads) {
    slave.ws.send(JSON.stringify(payload));
    const status = await waitFor(
      () =>
        slave.messages.find(
          (m) => m.type === 'command_status' && m.commandId === payload.commandId,
        ),
      2000,
    );
    assert.equal(status?.status, 'failed', payload.type);
    assert.equal(status?.reason, 'slave_locked', payload.type);
  }
  assert.equal(ctx.oscCalls.length, beforeMasterOsc);
  assert.equal(readLogCalls(ctx.childLog).length, beforeSlaveOsc);
  return { beforeMasterOsc, beforeSlaveOsc };
}

/** Stop, set_panic, and refresh stay allowed on a locked slave and reach the master. */
async function assertAllowedCommandsPassThrough(slave, beforeMasterOsc, beforeSlaveOsc) {
  // Stop, set_panic, and refresh remain allowed and go upstream to master.
  slave.ws.send(JSON.stringify({ type: 'stop', commandId: 'allow-stop' }));
  const masterStopped = await waitFor(
    () => ctx.oscCalls.slice(beforeMasterOsc).includes('stopPlaying'),
    3000,
  );
  assert.equal(masterStopped, true);
  const slaveStopped = await waitFor(
    () => readLogCalls(ctx.childLog).slice(beforeSlaveOsc).includes('stopPlaying'),
    3000,
  );
  assert.equal(slaveStopped, true);

  slave.ws.send(JSON.stringify({ type: 'refresh', commandId: 'allow-refresh' }));
  const masterRefreshed = await waitFor(
    () => ctx.oscCalls.slice(beforeMasterOsc).includes('getCuePoints'),
    3000,
  );
  assert.equal(masterRefreshed, true);

  slave.ws.send(JSON.stringify({ type: 'set_panic', active: true, commandId: 'allow-panic-on' }));
  const panicOn = await waitFor(() => bridgeState.manager?.getState().safety.panicActive, 3000);
  assert.equal(panicOn, true);
  slave.ws.send(JSON.stringify({ type: 'set_panic', active: false, commandId: 'allow-panic-off' }));
  const panicOff = await waitFor(
    () => bridgeState.manager?.getState().safety.panicActive === false,
    3000,
  );
  assert.equal(panicOff, true);
}

/** Pausing the link unlocks the slave Stage Control; reconnecting locks it again. */
async function assertLockFollowsLink(slave) {
  // Pausing link unlocks slave Stage Control via broadcast, reconnecting locks again.
  const beforeDrop = slave.messages.length;
  ctx.proxy.setPaused(true);
  const unlocked = await waitFor(
    () =>
      slave.messages
        .slice(beforeDrop)
        .some((m) => m.type === 'state' && m.state?.slaveLock === false),
    3000,
  );
  assert.equal(unlocked, true);

  const beforeReconnect = slave.messages.length;
  ctx.proxy.setPaused(false);
  const relocked = await waitFor(
    () =>
      slave.messages
        .slice(beforeReconnect)
        .some((m) => m.type === 'state' && m.state?.slaveLock === true),
    4000,
  );
  assert.equal(relocked, true);
}

/** Switches the slave to independent and expects the unlock broadcast with health ok. */
async function switchSlaveToIndependent(slaveBrowser) {
  const beforeSwitchMsgs = slaveBrowser.messages.length;
  await setSlaveMode('independent');
  const broadcastUnlocked = await waitFor(
    () =>
      slaveBrowser.messages
        .slice(beforeSwitchMsgs)
        .some((m) => m.type === 'state' && m.state?.slaveLock === false),
    2000,
  );
  assert.equal(broadcastUnlocked, true);
  assert.equal(bridgeState.peerStatus.health, 'ok');
  assert.equal(bridgeState.peerStatuses[0]?.followMode, 'independent');
}

/** Master commands are never sent to an independent slave and produce no alert. */
async function assertMasterSkipsIndependentSlave(masterBrowser) {
  // Master commands are never sent to an independent slave and produce no alert.
  const c2sBefore = ctx.c2sFrames.length;
  const slaveOscBefore = readLogCalls(ctx.childLog).length;
  masterBrowser.ws.send(JSON.stringify({ type: 'play', commandId: 'm-ind-play' }));
  masterBrowser.ws.send(JSON.stringify({ type: 'stop', commandId: 'm-ind-stop' }));
  await delay(250);
  assert.equal(
    ctx.c2sFrames.slice(c2sBefore).some((f) => f?.type === 'peer_command'),
    false,
  );
  assert.equal(readLogCalls(ctx.childLog).length, slaveOscBefore);
  assert.deepEqual(bridgeState.peerAlerts, {});
  return slaveOscBefore;
}

/** Slave browser commands run locally without reaching master or logging the no-master warning. */
async function assertSlaveRunsLocally(slaveBrowser, slaveOscBefore) {
  // Slave browser commands run locally without reaching master or logging no-master warning.
  const masterOscBefore = ctx.oscCalls.length;
  const slaveMsgsBeforeLocal = slaveBrowser.messages.length;
  slaveBrowser.ws.send(JSON.stringify({ type: 'play', commandId: 's-ind-play' }));
  // A transport resting where it stopped resumes with continuePlaying; a relocated one
  // starts with startPlaying. Either one proves the play ran on the slave's own Live.
  const localPlayed = await waitFor(
    () =>
      readLogCalls(ctx.childLog)
        .slice(slaveOscBefore)
        .some((l) => l === 'startPlaying' || l === 'continuePlaying'),
    2000,
  );
  assert.equal(localPlayed, true);
  await delay(150);
  assert.equal(ctx.oscCalls.length, masterOscBefore);
  assert.equal(
    slaveBrowser.messages
      .slice(slaveMsgsBeforeLocal)
      .some((m) => m.type === 'log' && /not connected/i.test(m.message)),
    false,
  );
}

/** Slave refuses raced peer_command and raw peer frames, preserving peer_health_ack. */
async function assertSlaveDefendsPeerFrames() {
  // Slave defends against direct/raced peer_command and raw peer frames, preserving peer_health_ack.
  const s2cBefore = ctx.s2cFrames.length;
  const slaveOscBeforeDef = readLogCalls(ctx.childLog).length;
  const ackCountBefore = (await getChildStatus()).peerHealthAckCount;
  ctx.proxy.sendUpstream(
    JSON.stringify({
      type: 'peer_command',
      commandId: 'peer-indep-stop',
      ttlMs: null,
      transportSeq: 50,
      command: { type: 'stop' },
    }),
  );
  ctx.proxy.sendUpstream(JSON.stringify({ type: 'play', commandId: 'raw-indep-play' }));
  ctx.proxy.sendUpstream(JSON.stringify({ type: 'peer_health_ack' }));

  const indepAck = await waitFor(
    () =>
      ctx.s2cFrames
        .slice(s2cBefore)
        .find((f) => f?.type === 'peer_ack' && f.commandId === 'peer-indep-stop'),
    2000,
  );
  assert.equal(indepAck?.result, 'failed');
  assert.equal(indepAck?.reason, 'independent');
  const healthAcked = await waitFor(
    async () => (await getChildStatus()).peerHealthAckCount > ackCountBefore,
    2000,
  );
  assert.equal(healthAcked, true);
  assert.equal(readLogCalls(ctx.childLog).length, slaveOscBeforeDef);
}

test('slave lock rejects navigation/play commands, allows stop/panic/refresh, and tracks link state', async () => {
  await resetBothStoppedAtZero();
  const slave = await connectBrowser(ctx.childReady.port, ctx.childReady.authToken, 'fm-slave-1');
  try {
    assert.equal(slave.handshakeAck.state.slaveLock, true);
    const { beforeMasterOsc, beforeSlaveOsc } = await assertLockedCommandsRefused(slave);
    await assertAllowedCommandsPassThrough(slave, beforeMasterOsc, beforeSlaveOsc);
    await assertLockFollowsLink(slave);
  } finally {
    slave.ws.close();
  }
});

test('independent mode isolates master and slave, defends against peer frames, and keeps health ok', async () => {
  await resetBothStoppedAtZero();
  const masterBrowser = await connectBrowser(serverPort(), bridgeState.authToken, 'fm-master-ind');
  const slaveBrowser = await connectBrowser(
    ctx.childReady.port,
    ctx.childReady.authToken,
    'fm-slave-ind',
  );
  try {
    await switchSlaveToIndependent(slaveBrowser);
    const slaveOscBefore = await assertMasterSkipsIndependentSlave(masterBrowser);
    await assertSlaveRunsLocally(slaveBrowser, slaveOscBefore);
    await assertSlaveDefendsPeerFrames();

    // Beat divergence in independent mode never raises out_of_step.
    bridgeState.manager.updateTransport(200, false);
    await delay(700);
    assert.notEqual(bridgeState.peerStatus.reason, 'out_of_step');
    assert.equal((await getChildStatus()).outOfStep, false);
  } finally {
    masterBrowser.ws.close();
    slaveBrowser.ws.close();
    await resetBothStoppedAtZero();
  }
});

test('transport alerts stopped and converges playing; switching to independent clears pending alerts', async () => {
  await resetBothStoppedAtZero();
  const masterBrowser = await connectBrowser(serverPort(), bridgeState.authToken, 'fm-master-tr');
  try {
    await setSlaveMode('transport');
    const oscBeforeStop = readLogCalls(ctx.childLog).length;
    bridgeState.manager.updateTransport(150, false);
    const outOfStep = await waitFor(() => bridgeState.peerStatus.reason === 'out_of_step', 3000);
    assert.equal(outOfStep, true);
    assert.equal(readLogCalls(ctx.childLog).length, oscBeforeStop);

    // Playing gap in transport mode converges via shift.
    const startedAt = Date.now();
    const tick = () => {
      const beats = ((Date.now() - startedAt) / 60_000) * 120;
      bridgeState.manager.updateTransport(68 + beats, true);
      ctx.child.send({ type: 'set_transport', songTime: 64 + beats, isPlaying: true });
    };
    tick();
    const timer = setInterval(tick, 100);
    let shifted = false;
    try {
      shifted = await waitFor(
        () =>
          readLogCalls(ctx.childLog)
            .slice(oscBeforeStop)
            .some((l) => l.startsWith('setCurrentSongTime:')),
        3500,
      );
    } finally {
      clearInterval(timer);
    }
    assert.equal(shifted, true);

    // Switching to independent clears pending commands and alerts on master without new alerts.
    await resetBothStoppedAtZero();
    ctx.dropSlaveAcks = true;
    masterBrowser.ws.send(JSON.stringify({ type: 'stop', commandId: 'm-clear-stop' }));
    const alertAppeared = await waitFor(
      () => Object.values(bridgeState.peerAlerts).some((a) => a.status === 'stop_unacked'),
      3000,
    );
    assert.equal(alertAppeared, true);

    const masterMsgsBefore = masterBrowser.messages.length;
    await setSlaveMode('independent');
    const cleared = await waitFor(() => Object.keys(bridgeState.peerAlerts).length === 0, 2000);
    assert.equal(cleared, true);
    assert.equal(
      masterBrowser.messages
        .slice(masterMsgsBefore)
        .some((m) => m.type === 'peer_command_status' && m.status === 'failed'),
      false,
    );
  } finally {
    masterBrowser.ws.close();
    await resetBothStoppedAtZero();
  }
});
