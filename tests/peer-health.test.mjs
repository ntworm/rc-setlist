// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PeerHealthTracker,
  computeShownHealth,
  peerHealthTiming,
  resetPeerHealthTiming,
  setPeerHealthTiming,
} from '../src/runtime/peer-health.ts';

function createClock(startMono = 1_000, startWall = 1_700_000_000_000) {
  let mono = startMono;
  let wall = startWall;
  return {
    now: () => mono,
    wallNow: () => wall,
    advance(ms) {
      mono += ms;
      wall += ms;
    },
  };
}

function createTracker(clock, timing) {
  return timing
    ? new PeerHealthTracker({ now: clock.now, wallNow: clock.wallNow, timing })
    : new PeerHealthTracker({ now: clock.now, wallNow: clock.wallNow });
}

function createWarmedTracker(clock) {
  const tracker = createTracker(clock);
  tracker.onSynchronized();
  clock.advance(20_000);
  assert.equal(tracker.localSnapshot().linkHealth, 'ok');
  return tracker;
}

function toPeerView(snap, overrides = {}) {
  return {
    linkHealth: snap.linkHealth,
    canAcknowledge: snap.canAcknowledge,
    oscConnected: true,
    liveReady: true,
    cuesFingerprint: 'fp-1',
    outOfStep: false,
    ...overrides,
  };
}

function makeShownInput(overrides = {}) {
  const local = {
    linkHealth: 'ok',
    linkReason: 'ok',
    canAcknowledge: false,
    rttP95Ms: 10,
    drops5m: 0,
    lastDropAt: null,
    lastSeenAt: 1_700_000_000_000,
  };
  return {
    local,
    localOscConnected: true,
    localLiveReady: true,
    localOutOfStep: false,
    markersMatch: true,
    remoteView: toPeerView(local),
    ...overrides,
  };
}

function assertShown(overrides, health, reason, canAcknowledge = false) {
  assert.deepEqual(computeShownHealth(makeShownInput(overrides)), {
    health,
    reason,
    canAcknowledge,
  });
}

test('peerHealthTiming defaults, overrides, reset, and injectable timing work', () => {
  resetPeerHealthTiming();
  assert.deepEqual(peerHealthTiming(), {
    heartbeatIntervalMs: 500,
    heartbeatLostMs: 1_500,
    heartbeatDownMs: 3_000,
    warmupCleanMs: 20_000,
    unstableCleanMs: 60_000,
    ackCleanMs: 10_000,
    rttWindowMs: 60_000,
    rttP95ThresholdMs: 150,
    dropWindowMs: 300_000,
    penaltyDropsThreshold: 3,
    penaltyHoldMs: 300_000,
  });
  try {
    setPeerHealthTiming({ warmupCleanMs: 5_000, rttP95ThresholdMs: 200 });
    assert.equal(peerHealthTiming().warmupCleanMs, 5_000);
    assert.equal(peerHealthTiming().rttP95ThresholdMs, 200);
    assert.equal(peerHealthTiming().heartbeatIntervalMs, 500);
  } finally {
    resetPeerHealthTiming();
  }
  assert.equal(peerHealthTiming().warmupCleanMs, 20_000);

  const clock = createClock(0);
  const custom = createTracker(clock, () => ({ ...peerHealthTiming(), warmupCleanMs: 2_000 }));
  custom.onSynchronized();
  clock.advance(2_000);
  assert.equal(custom.localSnapshot().linkHealth, 'ok');

  const liveTracker = new PeerHealthTracker();
  assert.equal(liveTracker.localSnapshot().linkHealth, 'down');
  liveTracker.onSynchronized();
  liveTracker.onHeartbeatReceived();
  assert.equal(liveTracker.localSnapshot().linkReason, 'warming_up');
  assert.equal(typeof liveTracker.localSnapshot().lastSeenAt, 'number');
});

test('cold start stays warming_up for 20s, refuses Acknowledge, then becomes ok', () => {
  const clock = createClock(0, 1_700_000_000_000);
  const tracker = createTracker(clock);
  assert.equal(tracker.acknowledge(), false);
  tracker.onSynchronized();

  let snap = tracker.localSnapshot();
  assert.equal(snap.linkHealth, 'unstable');
  assert.equal(snap.linkReason, 'warming_up');
  assert.equal(snap.canAcknowledge, false);
  assert.equal(snap.lastSeenAt, 1_700_000_000_000);
  assert.equal(tracker.acknowledge(), false);

  clock.advance(19_999);
  snap = tracker.localSnapshot();
  assert.equal(snap.linkHealth, 'unstable');
  assert.equal(snap.linkReason, 'warming_up');
  assert.equal(tracker.acknowledge(), false);

  clock.advance(1);
  snap = tracker.localSnapshot();
  assert.equal(snap.linkHealth, 'ok');
  assert.equal(snap.linkReason, 'ok');
  assert.equal(snap.canAcknowledge, false);
  assert.equal(tracker.acknowledge(), false);
});

test('1s drop stays unstable for 60s clean and drops5m ages out after 5m', () => {
  const clock = createClock();
  const tracker = createWarmedTracker(clock);
  const dropWall = clock.wallNow();

  assert.equal(tracker.onDisconnected(true), true);
  assert.equal(tracker.localSnapshot().linkHealth, 'down');
  assert.equal(tracker.localSnapshot().linkReason, 'link_down');

  clock.advance(1_000);
  tracker.onSynchronized();
  let snap = tracker.localSnapshot();
  assert.equal(snap.linkHealth, 'unstable');
  assert.equal(snap.linkReason, 'recent_drop');
  assert.equal(snap.canAcknowledge, true);
  assert.equal(snap.drops5m, 1);
  assert.equal(snap.lastDropAt, dropWall);

  clock.advance(59_999);
  assert.equal(tracker.localSnapshot().linkReason, 'recent_drop');

  clock.advance(1);
  assert.equal(tracker.localSnapshot().linkHealth, 'ok');
  assert.equal(tracker.localSnapshot().linkReason, 'ok');
  assert.equal(tracker.localSnapshot().drops5m, 1);

  clock.advance(239_001);
  assert.equal(tracker.localSnapshot().drops5m, 0);
  assert.equal(tracker.localSnapshot().lastDropAt, dropWall);
  // A 65s outage still requires 60s clean after reconnect (no green flash).
  assert.equal(tracker.onDisconnected(true), true);
  clock.advance(65_000);
  tracker.onSynchronized();
  assert.equal(tracker.localSnapshot().linkReason, 'recent_drop');
  clock.advance(59_999);
  assert.equal(tracker.localSnapshot().linkHealth, 'unstable');
  clock.advance(1);
  assert.equal(tracker.localSnapshot().linkHealth, 'ok');
});

test('21/11 45-min replay with 5-30s drops never reaches ok and enters penalty', () => {
  const clock = createClock(0);
  const tracker = createTracker(clock);
  const intervals = [5_000, 12_000, 30_000, 8_000, 20_000, 15_000, 25_000, 10_000];
  let step = 0;
  let dropCount = 0;
  let sawOscillating = false;

  tracker.onSynchronized();
  while (clock.now() < 2_700_000) {
    clock.advance(intervals[step % intervals.length]);
    step += 1;
    assert.notEqual(tracker.localSnapshot().linkHealth, 'ok');
    assert.equal(tracker.onDisconnected(true), true);
    dropCount += 1;
    clock.advance(1_000);
    tracker.onSynchronized();
    const snap = tracker.localSnapshot();
    assert.notEqual(snap.linkHealth, 'ok');
    if (dropCount >= 3) {
      assert.equal(snap.linkReason, 'link_oscillating');
      assert.equal(snap.canAcknowledge, false);
      assert.equal(tracker.acknowledge(), false);
      sawOscillating = true;
    }
  }
  assert.equal(sawOscillating, true);
  clock.advance(300_000);
  assert.equal(tracker.localSnapshot().linkHealth, 'ok');
});

test('two ends exchanging PeerHealthView both reach ok without feedback latch', () => {
  const clock = createClock(0);
  const master = createTracker(clock);
  const slave = createTracker(clock);
  master.onSynchronized();
  clock.advance(1_000);
  slave.onSynchronized();

  let masterShown = null;
  let slaveShown = null;
  for (let hb = 1; hb <= 42; hb += 1) {
    clock.advance(500);
    const mView = toPeerView(master.localSnapshot());
    const sView = toPeerView(slave.localSnapshot());
    master.onHeartbeatSent(hb, clock.now());
    slave.onHeartbeatReceived();
    master.onHeartbeatAck(hb, clock.now(), 10, 11, clock.now() + 12);
    slave.onHeartbeatSent(hb, clock.now());
    master.onHeartbeatReceived();
    slave.onHeartbeatAck(hb, clock.now(), 10, 11, clock.now() + 12);
    const masterLocal = master.localSnapshot();
    const slaveLocal = slave.localSnapshot();
    masterShown = computeShownHealth(makeShownInput({ local: masterLocal, remoteView: sView }));
    slaveShown = computeShownHealth(makeShownInput({ local: slaveLocal, remoteView: mView }));
  }
  assert.deepEqual(masterShown, { health: 'ok', reason: 'ok', canAcknowledge: false });
  assert.deepEqual(slaveShown, { health: 'ok', reason: 'ok', canAcknowledge: false });
});

test('failed dials before handshake and disconnects while down count 0 drops', () => {
  const clock = createClock();
  const tracker = createTracker(clock);
  for (let i = 0; i < 5; i += 1) {
    clock.advance(1_000);
    assert.equal(tracker.onDisconnected(false), false);
    assert.equal(tracker.onDisconnected(true), false);
  }
  assert.equal(tracker.localSnapshot().drops5m, 0);
  assert.equal(tracker.localSnapshot().lastDropAt, null);

  tracker.onSynchronized();
  clock.advance(20_000);
  assert.equal(tracker.onDisconnected(true), true);
  assert.equal(tracker.localSnapshot().drops5m, 1);

  for (let i = 0; i < 6; i += 1) {
    clock.advance(500);
    assert.equal(tracker.onDisconnected(false), false);
    assert.equal(tracker.onDisconnected(true), false);
  }
  assert.equal(tracker.localSnapshot().drops5m, 1);

  clock.advance(500);
  tracker.onSynchronized();
  assert.equal(tracker.localSnapshot().linkReason, 'recent_drop');
  assert.equal(tracker.localSnapshot().canAcknowledge, true);
});

test('lost heartbeat latches 60s and 3s silence terminates with a single drop', () => {
  const clock = createClock();
  const tracker = createWarmedTracker(clock);
  tracker.onHeartbeatAck(0, 0, 0, 0, 10);
  tracker.onHeartbeatSent(1, clock.now());
  clock.advance(1_499);
  assert.deepEqual(tracker.tick(), { shouldTerminate: false });
  assert.equal(tracker.localSnapshot().linkHealth, 'ok');

  clock.advance(1);
  assert.deepEqual(tracker.tick(), { shouldTerminate: false });
  assert.equal(tracker.localSnapshot().linkReason, 'heartbeat_lost');
  assert.equal(tracker.localSnapshot().canAcknowledge, true);

  clock.advance(500);
  tracker.onHeartbeatAck(2, 100, 200, 201, 111);
  clock.advance(5_000);
  assert.deepEqual(tracker.tick(), { shouldTerminate: true });
  assert.equal(tracker.localSnapshot().linkHealth, 'down');
  assert.equal(tracker.localSnapshot().drops5m, 1);

  assert.equal(tracker.onDisconnected(true), false);
  assert.deepEqual(tracker.tick(), { shouldTerminate: false });
  assert.equal(tracker.localSnapshot().drops5m, 1);
});

test('stale pending heartbeats prune cleanly and heartbeat_lost clears at 60s', () => {
  const clock = createClock();
  const tracker = createWarmedTracker(clock);
  tracker.onHeartbeatAck(0, 0, 0, 0, 10);
  tracker.onHeartbeatSent(1, clock.now());
  clock.advance(1_500);
  assert.deepEqual(tracker.tick(), { shouldTerminate: false });
  assert.equal(tracker.localSnapshot().linkReason, 'heartbeat_lost');

  for (let i = 0; i < 60; i += 1) {
    clock.advance(1_000);
    tracker.onHeartbeatAck(10 + i, 0, 0, 0, 10);
    assert.deepEqual(tracker.tick(), { shouldTerminate: false });
  }
  assert.equal(tracker.localSnapshot().linkHealth, 'ok');
});

test('RTT p95 clamps >= 0, rounds to 10ms, and latches high_rtt above 150ms', () => {
  const clock = createClock();
  const tracker = createWarmedTracker(clock);
  assert.equal(tracker.onHeartbeatAck(1, 100, 500, 505, 145), 40);
  assert.equal(tracker.onHeartbeatAck(2, 100, 500, 560, 140), 0);
  assert.equal(tracker.localSnapshot().rttP95Ms, 40);

  for (let i = 3; i <= 18; i += 1) {
    tracker.onHeartbeatAck(i, 0, 0, 0, 20);
  }
  tracker.onHeartbeatAck(19, 0, 0, 0, 144);
  assert.equal(tracker.localSnapshot().rttP95Ms, 140);
  assert.equal(tracker.localSnapshot().linkHealth, 'ok');

  tracker.onHeartbeatAck(20, 0, 0, 0, 220);
  assert.equal(tracker.localSnapshot().rttP95Ms, 140);
  assert.equal(tracker.localSnapshot().linkHealth, 'ok');

  tracker.onHeartbeatAck(21, 0, 0, 0, 151);
  let snap = tracker.localSnapshot();
  assert.equal(snap.rttP95Ms, 150);
  assert.equal(snap.linkHealth, 'unstable');
  assert.equal(snap.linkReason, 'high_rtt');
  assert.equal(snap.canAcknowledge, true);

  tracker.onHeartbeatAck(22, 0, 0, 0, 156);
  snap = tracker.localSnapshot();
  assert.equal(snap.rttP95Ms, 160);
  assert.equal(snap.linkReason, 'high_rtt');
});

test('Acknowledge recovers in 10s ignoring pre-ack RTT and second click', () => {
  const clock = createClock();
  const tracker = createWarmedTracker(clock);
  tracker.onHeartbeatAck(1, 0, 0, 0, 220);
  assert.equal(tracker.localSnapshot().linkReason, 'high_rtt');
  assert.equal(tracker.acknowledge(), true);
  assert.equal(tracker.localSnapshot().canAcknowledge, false);
  assert.equal(tracker.localSnapshot().rttP95Ms, null);

  clock.advance(3_000);
  assert.equal(tracker.acknowledge(), false);
  tracker.onHeartbeatAck(2, 0, 0, 0, 18);
  assert.equal(tracker.localSnapshot().rttP95Ms, 20);
  assert.equal(tracker.localSnapshot().linkReason, 'high_rtt');

  clock.advance(6_999);
  assert.equal(tracker.localSnapshot().linkHealth, 'unstable');
  clock.advance(1);
  assert.equal(tracker.localSnapshot().linkHealth, 'ok');

  tracker.onHeartbeatAck(3, 0, 0, 0, 210);
  assert.equal(tracker.acknowledge(), true);
  clock.advance(2_000);
  tracker.onHeartbeatAck(4, 0, 0, 0, 210);
  assert.equal(tracker.localSnapshot().canAcknowledge, true);
  clock.advance(10_000);
  assert.equal(tracker.localSnapshot().linkHealth, 'unstable');
});

test('3 drops in 5m lock link_oscillating for 5m; spaced drops do not', () => {
  const clock = createClock();
  const tracker = createWarmedTracker(clock);
  for (let i = 0; i < 2; i += 1) {
    assert.equal(tracker.onDisconnected(true), true);
    clock.advance(1_000);
    tracker.onSynchronized();
    assert.equal(tracker.localSnapshot().linkReason, 'recent_drop');
    assert.equal(tracker.localSnapshot().canAcknowledge, true);
    clock.advance(9_000);
  }
  assert.equal(tracker.onDisconnected(true), true);
  clock.advance(1_000);
  tracker.onSynchronized();
  assert.equal(tracker.localSnapshot().linkReason, 'link_oscillating');
  assert.equal(tracker.localSnapshot().canAcknowledge, false);
  assert.equal(tracker.acknowledge(), false);

  clock.advance(298_999);
  assert.equal(tracker.localSnapshot().linkReason, 'link_oscillating');
  assert.equal(tracker.acknowledge(), false);
  clock.advance(1);
  assert.equal(tracker.localSnapshot().linkHealth, 'ok');

  clock.advance(5_000);
  assert.equal(tracker.onDisconnected(true), true);
  clock.advance(1_000);
  tracker.onSynchronized();
  assert.equal(tracker.localSnapshot().drops5m, 1);
  assert.equal(tracker.localSnapshot().linkReason, 'recent_drop');
});

test('onSuperseded counts drop without leaving down and ignores down state', () => {
  const clock = createClock();
  const tracker = createTracker(clock);
  tracker.onSuperseded();
  assert.equal(tracker.localSnapshot().linkHealth, 'down');
  assert.equal(tracker.localSnapshot().drops5m, 0);

  tracker.onSynchronized();
  clock.advance(20_000);
  tracker.onHeartbeatSent(1, clock.now());
  const dropWall = clock.wallNow();

  tracker.onSuperseded();
  const snap = tracker.localSnapshot();
  assert.equal(snap.linkHealth, 'unstable');
  assert.equal(snap.linkReason, 'recent_drop');
  assert.equal(snap.canAcknowledge, true);
  assert.equal(snap.drops5m, 1);
  assert.equal(snap.lastDropAt, dropWall);

  clock.advance(2_000);
  assert.deepEqual(tracker.tick(), { shouldTerminate: false });
  assert.equal(tracker.localSnapshot().linkReason, 'recent_drop');

  tracker.onSuperseded();
  tracker.onSuperseded();
  assert.equal(tracker.localSnapshot().linkReason, 'link_oscillating');
  assert.equal(tracker.localSnapshot().drops5m, 3);
});

test('computeShownHealth enforces down-tier precedence and symmetry', () => {
  const okLocal = makeShownInput().local;
  const downLocal = { ...okLocal, linkHealth: 'down', linkReason: 'link_down' };

  assertShown({ local: downLocal, localOscConnected: false }, 'down', 'link_down');
  assertShown(
    { localOscConnected: false, remoteView: toPeerView(downLocal) },
    'down',
    'remote_link_down',
  );
  assertShown({ localOscConnected: false }, 'down', 'local_osc_live_unready');
  assertShown(
    { remoteView: toPeerView(okLocal, { oscConnected: false }) },
    'down',
    'remote_osc_live_unready',
  );
  assertShown({ localLiveReady: false, remoteView: null }, 'down', 'local_osc_live_unready');
  assertShown(
    { remoteView: toPeerView(okLocal, { liveReady: false }) },
    'down',
    'remote_osc_live_unready',
  );
});

test('computeShownHealth enforces unstable symmetry and canAcknowledge gating', () => {
  const okLocal = makeShownInput().local;
  const ackableRemote = toPeerView(okLocal, { linkHealth: 'unstable', canAcknowledge: true });
  const unackRemote = toPeerView(okLocal, { linkHealth: 'unstable', canAcknowledge: false });
  const warmingLocal = { ...okLocal, linkHealth: 'unstable', linkReason: 'warming_up' };
  const oscLocal = { ...okLocal, linkHealth: 'unstable', linkReason: 'link_oscillating' };
  const dropLocal = {
    ...okLocal,
    linkHealth: 'unstable',
    linkReason: 'recent_drop',
    canAcknowledge: true,
  };

  assertShown({ localOutOfStep: true }, 'unstable', 'out_of_step', false);
  assertShown(
    { remoteView: toPeerView(okLocal, { outOfStep: true }) },
    'unstable',
    'out_of_step',
    false,
  );
  assertShown({ markersMatch: false }, 'unstable', 'markers_differ', false);
  assertShown({ local: dropLocal }, 'unstable', 'recent_drop', true);
  assertShown({ remoteView: ackableRemote }, 'unstable', 'remote_unstable', true);
  assertShown({ remoteView: unackRemote }, 'unstable', 'remote_unstable', false);
  assertShown({ local: warmingLocal, remoteView: ackableRemote }, 'unstable', 'warming_up', false);
  assertShown(
    { local: oscLocal, remoteView: ackableRemote },
    'unstable',
    'link_oscillating',
    false,
  );
  assertShown({ remoteView: null }, 'ok', 'ok', false);
});
