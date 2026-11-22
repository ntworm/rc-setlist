// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Two-process integration tests for Delivery 2 peer_target reconciliation and outOfStep (A7).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { clearExtensionContext } from '../src/context.ts';
import { stopServer } from '../src/index.ts';
import { getPeerAutoCorrect, writePeerConfigs } from '../src/preferences.ts';
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
  connectSyncedWs,
  createWsTlsProxy,
  delay,
  ipcRequest,
  readLogCalls,
  setupMasterNode,
  spawnPeerChild,
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
};

function getChildStatus() {
  return ipcRequest(ctx.child, { type: 'get_peer_status' }, 'peer_status');
}

async function waitBothOk(timeoutMs = 3000) {
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
  bridgeState.scheduler?.clearPending();
  bridgeState.manager?.clearLoop();
  bridgeState.manager?.updateTransport(0, false);
  await ipcRequest(ctx.child, { type: 'set_transport', songTime: 0, isPlaying: false });
  await waitBothOk(3000);
}

async function drivePlayingMismatch(durationMs, masterStart, childStart) {
  const startedAt = Date.now();
  const tempo = bridgeState.manager.getState().tempo;
  const tick = () => {
    const beats = ((Date.now() - startedAt) / 60_000) * tempo;
    bridgeState.manager.updateTransport(masterStart + beats, true);
    ctx.child.send({ type: 'set_transport', songTime: childStart + beats, isPlaying: true });
  };
  tick();
  const timer = setInterval(tick, 100);
  try {
    await delay(durationMs);
  } finally {
    clearInterval(timer);
  }
}

async function assertStoppedConvergence(beat, expectedCall, forbiddenPrefix) {
  ctx.proxy.setPaused(true);
  const dropped = await waitFor(() => bridgeState.peerStatus.connected === false, 2000);
  assert.equal(dropped, true, 'link must drop while proxy paused');
  bridgeState.manager.updateTransport(beat, false);

  const beforeCalls = readLogCalls(ctx.childLog).length;
  const reconnectAt = performance.now();
  ctx.proxy.setPaused(false);

  const converged = await waitFor(async () => {
    const calls = readLogCalls(ctx.childLog).slice(beforeCalls);
    if (!calls.includes(expectedCall)) return null;
    const slave = await getChildStatus();
    return slave.currentSongTime === beat ? slave : null;
  }, 2000);
  const elapsed = performance.now() - reconnectAt;
  assert.ok(converged, `expected ${expectedCall} and beat ${beat} within 2s`);
  assert.ok(elapsed <= 2000, `stopped convergence took ${elapsed}ms, expected <= 2000ms`);
  const calls = readLogCalls(ctx.childLog).slice(beforeCalls);
  assert.equal(
    calls.some((line) => line.startsWith(forbiddenPrefix)),
    false,
    `did not expect ${forbiddenPrefix} for ${expectedCall}`,
  );
}

const isOutOfStepStatus = (s) => s.health === 'unstable' && s.reason === 'out_of_step';

async function assertOutOfStepBothWithin600ms() {
  const first = await waitFor(async () => {
    if (bridgeState.peerStatus.reason === 'out_of_step') return 'master';
    const s = await getChildStatus();
    return s.peerStatus.reason === 'out_of_step' ? 'slave' : null;
  }, 3000);
  assert.ok(first, 'at least one end must detect out_of_step');
  const t0 = performance.now();
  const both = await waitFor(async () => {
    if (!isOutOfStepStatus(bridgeState.peerStatus)) return null;
    const s = await getChildStatus();
    return isOutOfStepStatus(s.peerStatus) ? s : null;
  }, 600);
  assert.ok(both, 'both master and slave must show unstable (out_of_step) within 600ms');
  assert.ok(performance.now() - t0 <= 600);
}

before(async () => {
  const id = Math.random().toString(36).slice(2);
  ctx.mainDir = path.join(tmpdir(), `rc-rec-main-${id}`);
  ctx.childDir = path.join(tmpdir(), `rc-rec-child-${id}`);
  fs.mkdirSync(ctx.mainDir, { recursive: true });
  fs.mkdirSync(ctx.childDir, { recursive: true });
  ctx.childLog = path.join(ctx.childDir, 'osc.log');

  const peer = spawnPeerChild(ctx.childLog, ctx.childDir);
  ctx.child = peer.child;
  ctx.childReady = await peer.readyPromise;
  await ipcRequest(ctx.child, { type: 'update_cues', cues: MAIN_CUES });

  const healthTiming = {
    heartbeatIntervalMs: 150,
    heartbeatLostMs: 1000,
    heartbeatDownMs: 3000,
    warmupCleanMs: 200,
    unstableCleanMs: 300,
    ackCleanMs: 200,
  };
  setPeerHealthTiming(healthTiming);
  await ipcRequest(ctx.child, { type: 'set_health_timing', timing: healthTiming });
  await ipcRequest(ctx.child, { type: 'set_follow_timing', timing: { outOfStepMs: 400 } });
  setPeerFollowTiming({ outOfStepMs: 400 });
  setPeerLinkTiming({ reconnectBaseMs: 40, reconnectMaxMs: 120 });

  await setupMasterNode(ctx.mainDir, ctx.oscCalls);
  const paired = await pair('127.0.0.1', ctx.childReady.pairingCode, ctx.childReady.port);
  assert.equal(paired.ok, true);
  ctx.proxy = await createWsTlsProxy(ctx.childReady.port, (_dir, text, destWs) => {
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

test('A7.1: stopped jump lost while down converges within 2s on marker and between markers', async () => {
  await resetBothStoppedAtZero();
  assert.equal(getPeerAutoCorrect(), true);
  await assertStoppedConvergence(120, 'jumpToCuePoint:2', 'setCurrentSongTime:');
  await assertStoppedConvergence(150, 'setCurrentSongTime:150', 'jumpToCuePoint:');
  await resetBothStoppedAtZero();
});

test('A7.2: sustained playing mismatch shows out_of_step on slave and master within 600ms', async () => {
  await resetBothStoppedAtZero();
  const startedAt = Date.now();
  const tempo = bridgeState.manager.getState().tempo;
  let offset = 1.5;
  const tick = () => {
    const beats = ((Date.now() - startedAt) / 60_000) * tempo;
    bridgeState.manager.updateTransport(64 + beats, true);
    ctx.child.send({ type: 'set_transport', songTime: 64 + beats + offset, isPlaying: true });
  };
  tick();
  const timer = setInterval(tick, 100);
  try {
    await assertOutOfStepBothWithin600ms();
    offset = 0;
    const firstOk = await waitFor(async () => {
      if (bridgeState.peerStatus.reason === 'ok') return 'master';
      const s = await getChildStatus();
      return s.peerStatus.reason === 'ok' ? 'slave' : null;
    }, 2000);
    assert.ok(firstOk, 'at least one end must clear out_of_step on sync');
    const tRecover = performance.now();
    await waitBothOk(600);
    assert.ok(performance.now() - tRecover <= 600);
  } finally {
    clearInterval(timer);
    await resetBothStoppedAtZero();
  }
});

test('A7.3: no divergence flagged during pending quantized jump or active loop', async () => {
  await resetBothStoppedAtZero();
  bridgeState.scheduler.schedule(
    0,
    null,
    'Song A',
    0,
    {
      tempo: 120,
      isPlaying: true,
      signatureNumerator: 4,
      currentSongTime: 64,
      clipTriggerQuantization: 4,
    },
    0,
  );
  await drivePlayingMismatch(900, 64, 65.5);
  assert.notEqual(bridgeState.peerStatus.reason, 'out_of_step');
  const duringPending = await getChildStatus();
  assert.equal(duringPending.outOfStep, false);
  assert.notEqual(duringPending.peerStatus.reason, 'out_of_step');
  await resetBothStoppedAtZero();

  bridgeState.manager.updateTransport(120, true);
  bridgeState.manager.checkAutomations();
  assert.equal(bridgeState.manager.getState().loopActive, true);
  await drivePlayingMismatch(900, 120, 121.5);
  assert.notEqual(bridgeState.peerStatus.reason, 'out_of_step');
  const duringLoop = await getChildStatus();
  assert.equal(duringLoop.outOfStep, false);
  assert.notEqual(duringLoop.peerStatus.reason, 'out_of_step');
  await resetBothStoppedAtZero();
});

test('A7.4: peer-auto-correct off alerts without moving slave playhead', async () => {
  await resetBothStoppedAtZero();
  const slaveCtrl = await connectSyncedWs(
    ctx.childReady.port,
    ctx.childReady.authToken,
    'a7-slave-ctrl',
  );
  const slaveMessages = collectJson(slaveCtrl);
  const isWarn = (m) => m.type === 'log' && m.level === 'warn' && /auto-correct/i.test(m.message);
  try {
    await ipcRequest(ctx.child, { type: 'set_peer_auto_correct', enabled: false });
    assert.equal((await getChildStatus()).autoCorrect, false);
    const beforeCalls = readLogCalls(ctx.childLog).length;
    bridgeState.manager.updateTransport(150, false);

    const warned = await waitFor(() => slaveMessages.find(isWarn), 3000);
    assert.ok(warned, 'slave must emit warning log when auto-correct is off');
    await assertOutOfStepBothWithin600ms();
    await delay(600);

    const calls = readLogCalls(ctx.childLog).slice(beforeCalls);
    assert.equal(
      calls.some((l) => l.startsWith('jumpToCuePoint:') || l.startsWith('setCurrentSongTime:')),
      false,
      'slave playhead must not move when auto-correct is off',
    );
    assert.equal((await getChildStatus()).currentSongTime, 0);

    await ipcRequest(ctx.child, { type: 'set_peer_auto_correct', enabled: true });
    assert.equal((await getChildStatus()).autoCorrect, true);
    await waitFor(async () => (await getChildStatus()).currentSongTime === 150, 3000);
    await waitBothOk(2000);
  } finally {
    slaveCtrl.close();
    await resetBothStoppedAtZero();
  }
});
