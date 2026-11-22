// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Two-process integration tests for Delivery 1 peer health (A2 and A3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import { startServer, stopServer } from '../src/index.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { pair } from '../src/runtime/pairing.ts';
import { resetPeerHealthTiming, setPeerHealthTiming } from '../src/runtime/peer-health.ts';
import {
  resetPeerLinkTiming,
  setPeerLinkTiming,
  startPeerLink,
  stopPeerLink,
} from '../src/runtime/peer-link.ts';
import { createFakeOsc } from './helpers/peer-link-harness.mjs';
import { MAIN_CUES, PEER_CUES, spawnPeerChild } from './helpers/peer-e2e-node.mjs';

let nextIpcId = 0;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 5000, stepMs = 20) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(stepMs);
  }
  return predicate();
}

function ipcRequest(child, payload, expectedType = 'ack', timeoutMs = 5000) {
  const requestId = ++nextIpcId;
  return new Promise((resolve, reject) => {
    const onMessage = (msg) => {
      if (!msg || msg.type !== expectedType || msg.requestId !== requestId) return;
      clearTimeout(timer);
      child.off('message', onMessage);
      resolve(msg);
    };
    const timer = setTimeout(() => {
      child.off('message', onMessage);
      reject(new Error(`IPC ${payload.type} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    child.on('message', onMessage);
    child.send({ ...payload, requestId });
  });
}

function getChildPeerStatus(child) {
  return ipcRequest(child, { type: 'get_peer_status' }, 'peer_status');
}

function collectJson(ws) {
  const messages = [];
  ws.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      // ignore non-JSON frames
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

async function connectSyncedWs(port, token, clientId = 'health-test-client') {
  const ws = new WebSocket(`wss://127.0.0.1:${port}/ws?token=${token}`, {
    rejectUnauthorized: false,
  });
  const messages = collectJson(ws);
  await openSocket(ws);
  ws.send(JSON.stringify({ type: 'handshake', clientId }));
  const ack = await waitFor(() => messages.find((m) => m.type === 'handshake_ack'), 5000);
  assert.ok(ack, 'handshake_ack must arrive');
  ws.send(JSON.stringify({ type: 'sync_confirm', stateVersion: ack.stateVersion }));
  await delay(30);
  return { ws, messages, ack };
}

function readPeerHealthEvents(storageDir) {
  const logPath = path.join(storageDir, 'events.log');
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'peer_health');
}

function mainPort() {
  const address = bridgeState.server?.address();
  return address && typeof address === 'object' ? address.port : 0;
}

async function setupMaster(mainDir) {
  const oscCalls = [];
  setExtensionContext({
    environment: { storageDirectory: mainDir },
    application: { song: { handle: { id: 42 }, tempo: 120, cuePoints: MAIN_CUES } },
  });
  await startServer({ port: 0, skipOsc: true, skipProjectDetector: true });
  bridgeState.oscClient = createFakeOsc(oscCalls);
  bridgeState.manager.updateCues(MAIN_CUES);
}

async function cleanupNodes(child, mainDir, childDir) {
  if (child && !child.killed) {
    try {
      child.kill('SIGKILL');
    } catch {
      // process already exited
    }
  }
  stopPeerLink();
  resetPeerHealthTiming();
  resetPeerLinkTiming();
  await stopServer();
  clearExtensionContext();
  try {
    fs.rmSync(mainDir, { recursive: true, force: true });
    fs.rmSync(childDir, { recursive: true, force: true });
  } catch {
    // temp dir cleanup best effort
  }
}

async function withPairedNodes(run, opts = {}) {
  const id = Math.random().toString(36).slice(2);
  const mainDir = path.join(tmpdir(), `rc-health-main-${id}`);
  const childDir = path.join(tmpdir(), `rc-health-child-${id}`);
  fs.mkdirSync(mainDir, { recursive: true });
  fs.mkdirSync(childDir, { recursive: true });
  const peer = spawnPeerChild(path.join(childDir, 'osc.log'), childDir);
  try {
    const ready = await peer.readyPromise;
    await ipcRequest(peer.child, { type: 'update_cues', cues: MAIN_CUES });
    if (opts.healthTiming) {
      setPeerHealthTiming(opts.healthTiming);
      await ipcRequest(peer.child, { type: 'set_health_timing', timing: opts.healthTiming });
    }
    if (opts.linkTiming) setPeerLinkTiming(opts.linkTiming);
    await setupMaster(mainDir);
    const paired = await pair('127.0.0.1', ready.pairingCode, ready.port);
    assert.equal(paired.ok, true, 'pairing must succeed');
    startPeerLink(paired.config);
    const masterUp = await waitFor(
      () => bridgeState.peerStatus.connected === true && bridgeState.peerStatus.rttP95Ms !== null,
      8000,
    );
    assert.equal(masterUp, true, 'master must synchronize and complete first heartbeat');
    const slaveUp = await waitFor(async () => {
      const s = await getChildPeerStatus(peer.child);
      return s.peerStatus.connected === true && s.peerStatus.rttP95Ms !== null ? s : null;
    }, 8000);
    assert.ok(slaveUp, 'slave must synchronize and complete first heartbeat');
    await run({ child: peer.child, ready, config: paired.config, mainDir, childDir });
  } finally {
    await cleanupNodes(peer.child, mainDir, childDir);
  }
}

async function waitBoth(child, masterPred, slavePred, timeoutMs = 1500) {
  return waitFor(async () => {
    if (!masterPred(bridgeState.peerStatus)) return null;
    const slave = await getChildPeerStatus(child);
    return slavePred(slave.peerStatus) ? slave : null;
  }, timeoutMs);
}

async function assertWarmupToOk(child) {
  const firstOk = await waitFor(async () => {
    if (bridgeState.peerStatus.health === 'ok') return 'master';
    const s = await getChildPeerStatus(child);
    return s.peerStatus.health === 'ok' ? 'slave' : null;
  }, 3000);
  assert.ok(firstOk, 'at least one side must leave warmup and reach ok');
  const t0 = performance.now();
  const converged = await waitBoth(
    child,
    (m) => m.health === 'ok' && m.reason === 'ok',
    (s) => s.health === 'ok' && s.reason === 'ok',
    600,
  );
  const elapsed = performance.now() - t0;
  assert.ok(converged, 'both ends must converge to ok after warmup');
  assert.ok(elapsed <= 600, `warmup convergence took ${elapsed}ms, expected <= 600ms`);
}

async function assertOscFlipConvergence(child) {
  const tDown = performance.now();
  await ipcRequest(child, { type: 'set_osc_connected', connected: false });
  const bothDown = await waitBoth(
    child,
    (m) => m.health === 'down' && m.reason === 'remote_osc_live_unready',
    (s) => s.health === 'down' && s.reason === 'local_osc_live_unready',
    600,
  );
  assert.ok(bothDown, 'both ends must show down on slave OSC disconnect');
  assert.ok(performance.now() - tDown <= 600, 'OSC disconnect must converge within 600ms');

  const tUp = performance.now();
  await ipcRequest(child, { type: 'set_osc_connected', connected: true });
  const bothOk = await waitBoth(
    child,
    (m) => m.health === 'ok',
    (s) => s.health === 'ok',
    600,
  );
  assert.ok(bothOk, 'both ends must return to ok on slave OSC reconnect');
  assert.ok(performance.now() - tUp <= 600, 'OSC reconnect must converge within 600ms');
}

async function assertMarkersMismatchConvergence(child) {
  const tDiff = performance.now();
  await ipcRequest(child, { type: 'update_cues', cues: PEER_CUES });
  const bothMismatch = await waitBoth(
    child,
    (m) => m.health === 'unstable' && m.reason === 'markers_differ' && m.markersMatch === false,
    (s) => s.health === 'unstable' && s.reason === 'markers_differ' && s.markersMatch === false,
    600,
  );
  assert.ok(bothMismatch, 'both ends must show unstable (markers_differ) on cue mismatch');
  assert.ok(performance.now() - tDiff <= 600, 'markers mismatch must converge within 600ms');

  const tMatch = performance.now();
  await ipcRequest(child, { type: 'update_cues', cues: MAIN_CUES });
  const bothRestored = await waitBoth(
    child,
    (m) => m.health === 'ok' && m.markersMatch === true,
    (s) => s.health === 'ok' && s.markersMatch === true,
    600,
  );
  assert.ok(bothRestored, 'both ends must return to ok when cues match again');
  assert.ok(performance.now() - tMatch <= 600, 'markers match recovery must converge within 600ms');
}

async function assertNonControllerAckRefused(port) {
  const { ws, messages, ack } = await connectSyncedWs(port, '', 'viewer-only');
  try {
    assert.ok(Array.isArray(ack.state.peerStatuses), 'handshake_ack must include peerStatuses');
    ws.send(JSON.stringify({ type: 'peer_health_ack' }));
    const err = await waitFor(() => messages.find((m) => m.type === 'error'), 2000);
    assert.equal(err?.code, 'unauthorized', 'non-controller must be refused peer_health_ack');
  } finally {
    ws.close();
  }
}

async function assertAckForwardingAndAuth(child) {
  await ipcRequest(child, { type: 'drop_peer_sockets' });
  const bothUnstable = await waitBoth(
    child,
    (m) => m.connected === true && m.health === 'unstable' && m.canAcknowledge === true,
    (s) => s.connected === true && s.health === 'unstable' && s.canAcknowledge === true,
    5000,
  );
  assert.ok(bothUnstable, 'both ends must become acknowledgeable unstable after drop + reconnect');

  await assertNonControllerAckRefused(mainPort());
  assert.equal(bridgeState.peerStatus.canAcknowledge, true);

  const { ws: controller } = await connectSyncedWs(mainPort(), bridgeState.authToken, 'ctrl-ack');
  try {
    const tAck = performance.now();
    controller.send(JSON.stringify({ type: 'peer_health_ack' }));
    const acked = await waitBoth(
      child,
      (m) => m.canAcknowledge === false,
      (s) => s.canAcknowledge === false,
      600,
    );
    assert.ok(acked, 'peer_health_ack must clear canAcknowledge on both ends');
    assert.ok(performance.now() - tAck <= 600, 'ack forwarding must converge within 600ms');

    const recovered = await waitBoth(
      child,
      (m) => m.health === 'ok',
      (s) => s.health === 'ok',
      2000,
    );
    assert.ok(recovered, 'both ends must recover to ok after shortened ack window');
    await delay(250);
    const afterStatus = await getChildPeerStatus(child);
    assert.equal(afterStatus.peerHealthAckCount, 1, 'peer_health_ack must forward once');
  } finally {
    controller.close();
  }
}

function assertValidHealthLogEntries(entries, expectedPeer) {
  assert.ok(entries.length > 0, `expected peer_health log entries for ${expectedPeer}`);
  const tiers = new Set(entries.map((e) => e.health));
  assert.ok(tiers.has('ok'), `expected ok transition in events.log for ${expectedPeer}`);
  assert.ok(
    tiers.has('unstable'),
    `expected unstable transition in events.log for ${expectedPeer}`,
  );
  assert.ok(tiers.has('down'), `expected down transition in events.log for ${expectedPeer}`);
  for (const entry of entries) {
    assert.equal(entry.peer, expectedPeer, 'peer label must not be redacted');
    assert.equal(typeof entry.reason, 'string');
    assert.ok('rttP95Ms' in entry);
    assert.equal(typeof entry.drops5m, 'number');
  }
}

function attachPeerHbResponder(ws, cuesFingerprint) {
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type !== 'peer_hb') return;
      const t1 = performance.now();
      const view = {
        linkHealth: 'ok',
        canAcknowledge: false,
        oscConnected: true,
        liveReady: true,
        cuesFingerprint,
        outOfStep: false,
      };
      ws.send(
        JSON.stringify({
          type: 'peer_hb_ack',
          hbId: msg.hbId,
          t0: msg.t0,
          t1,
          t2: performance.now(),
          view,
        }),
      );
    } catch {
      // ignore non-JSON frames
    }
  });
}

test('A2.1: SIGKILL on slave marks master down within 3.5s', async () => {
  await withPairedNodes(async ({ child }) => {
    const t0 = performance.now();
    child.kill('SIGKILL');
    const down = await waitFor(
      () => bridgeState.peerStatus.health === 'down' && bridgeState.peerStatus.connected === false,
      3500,
    );
    const elapsed = performance.now() - t0;
    assert.equal(down, true, 'master must mark peer down after slave SIGKILL');
    assert.ok(elapsed <= 3500, `master down detection took ${elapsed}ms, expected <= 3500ms`);
    assert.equal(bridgeState.peerStatus.reason, 'link_down');
  });
});

test('A2.2: frozen slave event loop marks master down within 3.5s', async () => {
  await withPairedNodes(async ({ child }) => {
    const t0 = performance.now();
    child.send({ type: 'freeze', ms: 3600 });
    const down = await waitFor(
      () => bridgeState.peerStatus.health === 'down' && bridgeState.peerStatus.connected === false,
      3500,
    );
    const elapsed = performance.now() - t0;
    assert.equal(down, true, 'master must mark peer down when slave event loop freezes');
    assert.ok(elapsed <= 3500, `frozen slave detection took ${elapsed}ms, expected <= 3500ms`);
    assert.equal(bridgeState.peerStatus.reason, 'link_down');
    assert.ok(bridgeState.peerStatus.drops5m >= 1, 'silence timeout must count a drop');
  });
});

test('A2.3: master down keeps slave paired:true until clearSlaveRole', async () => {
  await withPairedNodes(async ({ child }) => {
    const initial = await getChildPeerStatus(child);
    assert.equal(initial.peerStatus.paired, true);
    assert.equal(initial.peerStatuses[0]?.key, 'inbound:master');
    assert.equal(initial.peerStatuses[0]?.role, 'inbound');

    const t0 = performance.now();
    stopPeerLink();
    const down = await waitFor(async () => {
      const s = await getChildPeerStatus(child);
      return s.peerStatus.health === 'down' && s.peerStatus.connected === false ? s : null;
    }, 3500);
    const elapsed = performance.now() - t0;
    assert.ok(down, 'slave must detect master termination');
    assert.ok(elapsed <= 3500, `slave down detection took ${elapsed}ms, expected <= 3500ms`);
    assert.equal(down.peerStatus.paired, true);
    assert.equal(down.peerStatuses.length, 1);

    await delay(200);
    const persisted = await getChildPeerStatus(child);
    assert.equal(persisted.peerStatus.paired, true);
    assert.equal(persisted.peerStatus.health, 'down');

    await ipcRequest(child, { type: 'clear_slave_role' });
    const cleared = await getChildPeerStatus(child);
    assert.equal(cleared.peerStatus.paired, false);
    assert.deepEqual(cleared.peerStatuses, []);
  });
});

test('A3.1: symmetric health converges in 600ms, ack forwards once, events log', async () => {
  await withPairedNodes(
    async ({ child, config, mainDir, childDir }) => {
      await assertWarmupToOk(child);
      await assertOscFlipConvergence(child);
      await assertMarkersMismatchConvergence(child);
      await assertAckForwardingAndAuth(child);

      await bridgeState.eventLogger?.flush();
      await ipcRequest(child, { type: 'flush_events' });
      const masterEntries = readPeerHealthEvents(mainDir);
      const slaveEntries = readPeerHealthEvents(childDir);
      assertValidHealthLogEntries(masterEntries, `${config.host}:${config.port}`);
      assertValidHealthLogEntries(slaveEntries, 'inbound:master');
    },
    {
      healthTiming: { warmupCleanMs: 300, unstableCleanMs: 10_000, ackCleanMs: 300 },
      linkTiming: { reconnectBaseMs: 50, reconnectMaxMs: 200 },
    },
  );
});

test('A3.2: superseded inbound socket adds a drop and its close keeps live link up', async () => {
  await withPairedNodes(async ({ child, ready, config }) => {
    const before = await getChildPeerStatus(child);
    const dropsBefore = before.peerStatus.drops5m;
    const cuesFingerprint = bridgeState.manager.getState().cuesFingerprint ?? '';
    const replacement = new WebSocket(
      `wss://127.0.0.1:${ready.port}/ws?token=${encodeURIComponent(config.peerToken)}`,
      { rejectUnauthorized: false },
    );
    const messages = collectJson(replacement);
    attachPeerHbResponder(replacement, cuesFingerprint);
    try {
      await openSocket(replacement);
      replacement.send(
        JSON.stringify({
          type: 'handshake',
          clientId: 'superseding-peer',
          linkProtocol: 2,
          extensionVersion: '1.2.1',
        }),
      );
      const ack = await waitFor(() => messages.find((m) => m.type === 'handshake_ack'), 5000);
      assert.ok(ack, 'replacement peer handshake_ack must arrive');
      replacement.send(JSON.stringify({ type: 'sync_confirm', stateVersion: ack.stateVersion }));

      const superseded = await waitFor(async () => {
        const s = await getChildPeerStatus(child);
        return s.peerStatus.drops5m === dropsBefore + 1 ? s : null;
      }, 3000);
      assert.ok(superseded, 'superseding a synchronized socket must increment drops5m');
      assert.equal(superseded.peerStatus.connected, true);
      assert.notEqual(superseded.peerStatus.health, 'down');

      stopPeerLink();
      await delay(300);
      const afterOldClose = await getChildPeerStatus(child);
      assert.equal(afterOldClose.peerStatus.connected, true);
      assert.notEqual(afterOldClose.peerStatus.health, 'down');
      assert.equal(afterOldClose.peerStatus.drops5m, dropsBefore + 1);
    } finally {
      replacement.close();
    }
  });
});
