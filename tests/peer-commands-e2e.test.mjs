// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Two-process integration tests for Delivery 2 reliable peer commands (A5 and A6).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { clearExtensionContext } from '../src/context.ts';
import { stopServer } from '../src/index.ts';
import { peerKey, writePeerConfigs } from '../src/preferences.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { pair } from '../src/runtime/pairing.ts';
import { resetPeerHealthTiming, setPeerHealthTiming } from '../src/runtime/peer-health.ts';
import {
  resetPeerLinkTiming,
  setPeerLinkTiming,
  startPeerLink,
  stopPeerLink,
} from '../src/runtime/peer-link.ts';
import { peerCommandId } from '../src/runtime/peer-message.ts';
import { fingerprintOf } from './helpers/peer-link-harness.mjs';
import {
  MAIN_CUES,
  connectSyncedWs,
  createWsTlsProxy,
  delay,
  ipcRequest,
  readLogCalls,
  serverPort,
  setupMasterNode,
  spawnPeerChild,
  tryParseJson,
  waitFor,
} from './helpers/peer-e2e-node.mjs';

const TERMINAL_STATUSES = new Set([
  'confirmed',
  'expired',
  'late_confirmed',
  'superseded',
  'failed',
]);
const A51_TERMINAL_STATUSES = new Set(['confirmed', 'expired', 'late_confirmed']);
const NON_TRANSPORT_BYPASS = new Set(['metronome', 'set_quantization', 'refresh']);

function createSeededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isHandshakeFrame(msg) {
  const t = msg?.type;
  return t === 'handshake' || t === 'handshake_ack' || t === 'sync_confirm';
}

function shouldHoldFrame(msg, state) {
  if (!state.holdPredicate || !state.holdPredicate(msg)) return false;
  const key = typeof msg.commandId === 'string' ? msg.commandId : `held-${state.held.size}`;
  if (!state.held.has(key)) state.held.set(key, JSON.stringify(msg));
  return true;
}

function shouldDropFrame(dir, state) {
  if (state.dropRate <= 0 || state.rng() >= state.dropRate) return false;
  state.stats[dir === 'c2s' ? 'droppedC2S' : 'droppedS2C'] += 1;
  return true;
}

function forwardFrame(dir, text, destWs, state) {
  const msg = tryParseJson(text);
  if (dir === 'c2s' && msg?.type === 'handshake') state.stats.handshakes.push(msg);
  if (isHandshakeFrame(msg)) {
    destWs.send(text);
    return;
  }
  if (dir === 'c2s' && shouldHoldFrame(msg, state)) return;
  if (shouldDropFrame(dir, state)) return;
  destWs.send(text);
}

async function createMitmProxy(targetPort) {
  const state = {
    dropRate: 0,
    rng: createSeededRng(0x5e71157),
    holdPredicate: null,
    held: new Map(),
    stats: { droppedC2S: 0, droppedS2C: 0, handshakes: [] },
  };
  const base = await createWsTlsProxy(targetPort, (dir, text, destWs) => {
    forwardFrame(dir, text, destWs, state);
  });
  return {
    port: base.port,
    tls: base.tls,
    stats: state.stats,
    heldCount: () => state.held.size,
    setDropRate: (rate) => {
      state.dropRate = rate;
    },
    setHoldPredicate: (fn) => {
      state.holdPredicate = fn;
    },
    releaseHeld: () => {
      state.holdPredicate = null;
      for (const frame of state.held.values()) base.sendUpstream(frame);
      state.held.clear();
    },
    setPaused: base.setPaused,
    close: async () => {
      state.held.clear();
      await base.close();
    },
  };
}

function createStatusTracker(ws) {
  const sentAt = new Map();
  const terminal = new Map();
  const events = new Map();
  ws.on('message', (data) => {
    const msg = tryParseJson(data.toString('utf8'));
    if (msg?.type !== 'peer_command_status') return;
    const list = events.get(msg.commandId) ?? [];
    list.push({ status: msg.status, at: performance.now(), peerCommandId: msg.peerCommandId });
    events.set(msg.commandId, list);
    if (TERMINAL_STATUSES.has(msg.status)) {
      terminal.set(msg.commandId, {
        status: msg.status,
        settledAt: performance.now(),
        peerCommandId: msg.peerCommandId,
      });
    }
  });
  return {
    send(command) {
      sentAt.set(command.commandId, performance.now());
      ws.send(JSON.stringify(command));
    },
    sentTime: (id) => sentAt.get(id),
    terminal: (id) => terminal.get(id),
    unsettledCount: () => sentAt.size - terminal.size,
    settledCount: () => terminal.size,
    waitTerminal: (id, timeoutMs = 4000) => waitFor(() => terminal.get(id), timeoutMs, 15),
    waitEvent: (id, status, timeoutMs = 4000) =>
      waitFor(() => events.get(id)?.find((e) => e.status === status), timeoutMs, 15),
  };
}

function transportForWave(wave, commandId) {
  const mod = wave % 4;
  if (mod === 0) return { type: 'play', commandId };
  if (mod === 1) return { type: 'jump', songIndex: 0, immediate: true, commandId };
  if (mod === 2) return { type: 'jump', songIndex: 1, immediate: true, commandId };
  return { type: 'stop', commandId };
}

function nonTransportForIndex(index, commandId) {
  const mod = index % 4;
  if (mod === 0) return { type: 'metronome', value: index % 8 === 0, commandId };
  if (mod === 1) return { type: 'set_quantization', value: (index % 3) + 1, commandId };
  if (mod === 2) return { type: 'refresh', commandId };
  return { type: 'set_panic', active: false, commandId };
}

function buildA51Waves() {
  const waves = [];
  for (let w = 0; w < 20; w += 1) {
    const items = [transportForWave(w, `a51-t-${w}`)];
    for (let k = 0; k < 4; k += 1) {
      items.push(nonTransportForIndex(w * 4 + k, `a51-nt-${w}-${k}`));
    }
    waves.push(items);
  }
  return waves;
}

async function runA51Waves(waves, tracker) {
  for (const wave of waves) {
    for (const cmd of wave) tracker.send(cmd);
    const transportDone = await tracker.waitTerminal(wave[0].commandId, 5000);
    assert.ok(transportDone, `transport ${wave[0].commandId} must reach a terminal state`);
    const room = await waitFor(() => tracker.unsettledCount() < 45, 4000);
    assert.equal(room, true, 'pending queue must stay bounded under 30% drop');
  }
  const allDone = await waitFor(() => tracker.settledCount() === 100, 6000);
  assert.equal(allDone, true, 'all 100 commands must settle without silent loss');
}

function assertSingleCommandOutcome(cmd, tracker, execCounts) {
  const outcome = tracker.terminal(cmd.commandId);
  assert.ok(outcome, `missing terminal status for ${cmd.commandId}`);
  assert.equal(A51_TERMINAL_STATUSES.has(outcome.status), true, `unexpected ${outcome.status}`);
  const elapsed = outcome.settledAt - tracker.sentTime(cmd.commandId);
  if (cmd.type !== 'stop') {
    const limit = outcome.status === 'expired' ? 1300 : 1200;
    assert.ok(elapsed <= limit, `${cmd.commandId} (${outcome.status}) took ${elapsed}ms`);
  }
  const count = execCounts.get(peerCommandId(cmd.commandId)) ?? 0;
  assert.ok(count <= 1, `duplicate execution for ${cmd.commandId}: ${count}`);
  if (outcome.status === 'confirmed' || outcome.status === 'late_confirmed') {
    assert.equal(count, 1, `confirmed ${cmd.commandId} must execute once on slave`);
  }
  if (count === 0) assert.equal(outcome.status, 'expired', `${cmd.commandId} lost silently`);
}

function countExecutedIds(executed) {
  const counts = new Map();
  for (const entry of executed) {
    counts.set(entry.commandId, (counts.get(entry.commandId) ?? 0) + 1);
  }
  return counts;
}

async function waitBothHealthy() {
  const masterUp = await waitFor(
    () => bridgeState.peerStatus.connected === true && bridgeState.peerStatus.rttP95Ms !== null,
    8000,
  );
  assert.equal(masterUp, true, 'master must connect and finish first heartbeat');
  const slaveUp = await waitFor(async () => {
    const s = await ipcRequest(ctx.child, { type: 'get_peer_status' }, 'peer_status');
    return s.peerStatus.connected === true && s.peerStatus.rttP95Ms !== null ? s : null;
  }, 8000);
  assert.ok(slaveUp, 'slave must connect and finish first heartbeat');
}

function waitChildCall(beforeCalls, predicate) {
  return waitFor(() => readLogCalls(ctx.childLog).slice(beforeCalls).some(predicate));
}

const ctx = {
  mainDir: '',
  childDir: '',
  childLog: '',
  child: null,
  proxy: null,
  proxyConfig: null,
  controller: null,
  tracker: null,
  oscCalls: [],
};

before(async () => {
  const id = Math.random().toString(36).slice(2);
  ctx.mainDir = path.join(tmpdir(), `rc-cmd-main-${id}`);
  ctx.childDir = path.join(tmpdir(), `rc-cmd-child-${id}`);
  fs.mkdirSync(ctx.mainDir, { recursive: true });
  fs.mkdirSync(ctx.childDir, { recursive: true });
  ctx.childLog = path.join(ctx.childDir, 'osc.log');

  const peer = spawnPeerChild(ctx.childLog, ctx.childDir);
  ctx.child = peer.child;
  const ready = await peer.readyPromise;
  await ipcRequest(ctx.child, { type: 'update_cues', cues: MAIN_CUES });
  const healthTiming = { heartbeatIntervalMs: 250, heartbeatLostMs: 1500, heartbeatDownMs: 4000 };
  setPeerHealthTiming(healthTiming);
  await ipcRequest(ctx.child, { type: 'set_health_timing', timing: healthTiming });
  setPeerLinkTiming({ reconnectBaseMs: 50, reconnectMaxMs: 150 });

  await setupMasterNode(ctx.mainDir, ctx.oscCalls);
  const paired = await pair('127.0.0.1', ready.pairingCode, ready.port);
  assert.equal(paired.ok, true);
  ctx.proxy = await createMitmProxy(ready.port);
  ctx.proxyConfig = {
    host: '127.0.0.1',
    port: ctx.proxy.port,
    peerToken: paired.config.peerToken,
    fingerprint: fingerprintOf(ctx.proxy.tls),
  };
  writePeerConfigs([ctx.proxyConfig]);
  startPeerLink(ctx.proxyConfig);
  await waitBothHealthy();
  ctx.controller = await connectSyncedWs(serverPort(), bridgeState.authToken, 'a5-ctrl');
  ctx.tracker = createStatusTracker(ctx.controller);
});

after(async () => {
  ctx.controller?.close();
  if (ctx.child && !ctx.child.killed) ctx.child.kill('SIGKILL');
  stopPeerLink();
  resetPeerHealthTiming();
  resetPeerLinkTiming();
  await stopServer();
  await ctx.proxy?.close();
  clearExtensionContext();
  fs.rmSync(ctx.mainDir, { recursive: true, force: true });
  fs.rmSync(ctx.childDir, { recursive: true, force: true });
});

test('A5.1: 100 commands over 30% drop have zero duplicates and zero losses', async () => {
  const waves = buildA51Waves();
  const commands = waves.flat();
  ctx.proxy.setDropRate(0.3);
  try {
    await runA51Waves(waves, ctx.tracker);
  } finally {
    ctx.proxy.setDropRate(0);
  }
  assert.ok(ctx.proxy.stats.droppedC2S >= 10, 'proxy must drop master->slave frames');
  assert.ok(ctx.proxy.stats.droppedS2C >= 10, 'proxy must drop slave->master frames');
  const res = await ipcRequest(ctx.child, { type: 'get_executed_commands' }, 'executed_commands');
  const execCounts = countExecutedIds(res.commands);
  for (const cmd of commands) assertSingleCommandOutcome(cmd, ctx.tracker, execCounts);
});

test('A5.2: down-link queued command executes on reconnect within 1s deadline', async () => {
  const beforeCalls = readLogCalls(ctx.childLog).length;
  ctx.proxy.setPaused(true);
  const down = await waitFor(() => bridgeState.peerStatus.connected === false, 2000);
  assert.equal(down, true, 'link must drop while paused');

  const cmd = { type: 'metronome', value: true, commandId: 'a52-down-metro' };
  ctx.tracker.send(cmd);
  await delay(250);
  ctx.proxy.setPaused(false);

  const settled = await ctx.tracker.waitTerminal(cmd.commandId, 3000);
  assert.equal(settled?.status, 'confirmed', 'queued command must confirm after reconnect');
  assert.ok(settled.settledAt - ctx.tracker.sentTime(cmd.commandId) <= 1200);
  assert.equal(await waitChildCall(beforeCalls, (l) => l === 'setMetronome:true'), true);
});

async function assertPlaySupersededBehind(blockerCmd, playId) {
  const beforeCalls = readLogCalls(ctx.childLog).length;
  ctx.proxy.setHoldPredicate((msg) => msg.type === 'peer_command' && msg.command?.type === 'play');
  ctx.tracker.send({ type: 'play', commandId: playId });
  const held = await waitFor(() => ctx.proxy.heldCount() === 1, 2000);
  assert.equal(held, true, 'proxy must hold delayed play frame');

  ctx.tracker.send(blockerCmd);
  const blockerDone = await ctx.tracker.waitTerminal(blockerCmd.commandId, 3000);
  assert.equal(blockerDone?.status, 'confirmed', `${blockerCmd.type} must confirm first`);

  ctx.proxy.releaseHeld();
  const playDone = await ctx.tracker.waitTerminal(playId, 3000);
  assert.equal(playDone?.status, 'superseded', `delayed play behind ${blockerCmd.type} superseded`);
  const calls = readLogCalls(ctx.childLog).slice(beforeCalls);
  assert.equal(
    calls.some((line) => line === 'startPlaying' || line === 'continuePlaying'),
    false,
    'superseded play must never execute on slave',
  );
}

async function assertNonTransportBypass() {
  const isTarget = (msg) =>
    msg.type === 'peer_command' &&
    (NON_TRANSPORT_BYPASS.has(msg.command?.type) ||
      (msg.command?.type === 'set_panic' && msg.command?.active === false));
  ctx.proxy.setHoldPredicate(isTarget);
  const items = [
    { type: 'metronome', value: false, commandId: 'a53-nt-metro' },
    { type: 'set_quantization', value: 2, commandId: 'a53-nt-quant' },
    { type: 'refresh', commandId: 'a53-nt-refresh' },
    { type: 'set_panic', active: false, commandId: 'a53-nt-panic-off' },
  ];
  for (const item of items) ctx.tracker.send(item);
  assert.equal(await waitFor(() => ctx.proxy.heldCount() === 4, 2000), true);

  ctx.tracker.send({ type: 'play', commandId: 'a53-nt-play' });
  assert.equal((await ctx.tracker.waitTerminal('a53-nt-play', 3000))?.status, 'confirmed');
  ctx.tracker.send({ type: 'stop', commandId: 'a53-nt-stop' });
  assert.equal((await ctx.tracker.waitTerminal('a53-nt-stop', 3000))?.status, 'confirmed');

  ctx.proxy.releaseHeld();
  for (const item of items) {
    const done = await ctx.tracker.waitTerminal(item.commandId, 3000);
    assert.equal(done?.status, 'confirmed', `${item.type} must confirm, never superseded`);
  }
  const exec = await ipcRequest(ctx.child, { type: 'get_executed_commands' }, 'executed_commands');
  const ranIds = new Set(exec.commands.map((entry) => entry.commandId));
  for (const item of items) {
    assert.equal(ranIds.has(peerCommandId(item.commandId)), true, `${item.type} ran on slave`);
  }
}

async function assertSessionResetOnMasterRestart() {
  const prevSeq = bridgeState.masterTransportSeq;
  const oldSessionId = ctx.proxy.stats.handshakes.at(-1)?.sessionId;
  assert.ok(prevSeq >= 4 && oldSessionId, 'pre-restart transportSeq and sessionId must exist');

  ctx.controller.close();
  stopPeerLink();
  await stopServer();
  await setupMasterNode(ctx.mainDir, ctx.oscCalls);
  await waitBothHealthy();

  ctx.controller = await connectSyncedWs(serverPort(), bridgeState.authToken, 'a5-ctrl-restarted');
  ctx.tracker = createStatusTracker(ctx.controller);
  const nextSessionId = ctx.proxy.stats.handshakes.at(-1)?.sessionId;
  assert.ok(nextSessionId && nextSessionId !== oldSessionId, 'master must rotate sessionId');

  const beforeCalls = readLogCalls(ctx.childLog).length;
  ctx.tracker.send({ type: 'play', commandId: 'a53-restart-play' });
  const playDone = await ctx.tracker.waitTerminal('a53-restart-play', 3000);
  assert.equal(bridgeState.masterTransportSeq, 1, 'transportSeq must restart at 1');
  assert.equal(playDone?.status, 'confirmed', 'new sessionId must reset slave sequence');
  const played = await waitChildCall(
    beforeCalls,
    (l) => l === 'startPlaying' || l === 'continuePlaying',
  );
  assert.equal(played, true);
  ctx.tracker.send({ type: 'stop', commandId: 'a53-restart-stop' });
  assert.equal((await ctx.tracker.waitTerminal('a53-restart-stop', 3000))?.status, 'confirmed');
}

test('A5.3: delayed play supersedes, non-transport bypasses, restart resets seq', async () => {
  await assertPlaySupersededBehind({ type: 'stop', commandId: 'a53-stop-1' }, 'a53-play-1');
  await assertPlaySupersededBehind(
    { type: 'set_panic', active: true, commandId: 'a53-panic-on' },
    'a53-play-2',
  );
  ctx.tracker.send({ type: 'set_panic', active: false, commandId: 'a53-panic-off' });
  assert.equal((await ctx.tracker.waitTerminal('a53-panic-off', 3000))?.status, 'confirmed');

  await assertNonTransportBypass();
  await assertSessionResetOnMasterRestart();
});

test('A6: unreachable stop raises stop_unacked after 1s and executes on reconnect', async () => {
  assert.equal(bridgeState.manager.getState().isPlaying, false, 'master must start stopped');
  const beforeCalls = readLogCalls(ctx.childLog).length;
  ctx.proxy.setPaused(true);
  assert.equal(await waitFor(() => bridgeState.peerStatus.connected === false, 2000), true);

  const stopCmd = { type: 'stop', commandId: 'a6-safety-stop' };
  ctx.tracker.send(stopCmd);
  const unacked = await ctx.tracker.waitEvent(stopCmd.commandId, 'stop_unacked', 2500);
  assert.ok(unacked, 'stop_unacked alert must emit when slave unreachable >= 1s');
  const unackedMs = unacked.at - ctx.tracker.sentTime(stopCmd.commandId);
  assert.ok(unackedMs >= 900 && unackedMs <= 1450, `stop_unacked fired at ${unackedMs}ms`);
  const key = peerKey(ctx.proxyConfig);
  assert.equal(bridgeState.peerAlerts[key]?.status, 'stop_unacked');

  const remaining = 1600 - (performance.now() - ctx.tracker.sentTime(stopCmd.commandId));
  if (remaining > 0) await delay(remaining);
  const restoreAt = performance.now();
  ctx.proxy.setPaused(false);

  const done = await ctx.tracker.waitTerminal(stopCmd.commandId, 3000);
  assert.equal(done?.status, 'confirmed', 'stop must execute and confirm on reconnect');
  assert.ok(done.settledAt - restoreAt <= 1000, 'stop must resend immediately on reconnect');
  assert.equal(bridgeState.peerAlerts[key], undefined, 'stop_unacked alert must clear');
  assert.equal(await waitChildCall(beforeCalls, (l) => l === 'stopPlaying'), true);
});
