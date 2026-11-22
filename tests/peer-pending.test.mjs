// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PEER_RELAY_TYPES, STALLED_SOCKET_BYTES } from '../src/runtime/peer-message.ts';
import {
  EXTENSION_VERSION,
  LINK_PROTOCOL_VERSION,
  computeCommandDeadline,
  createMasterSessionId,
  isSafetyStopCommand,
  isTransportCommandType,
} from '../src/runtime/peer-protocol.ts';
import {
  MAX_PENDING_ENTRIES,
  RECENTLY_EXPIRED_TTL_MS,
  RETRY_INTERVAL_MS,
  SAFETY_STOP_ALERT_MS,
  PeerPendingTable,
  buildPeerCommandStatusEvent,
} from '../src/runtime/peer-pending.ts';

function createClock(startMs = 0) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance(ms) {
      nowMs += ms;
    },
  };
}

function makeShowCommand(type, payload = { type }) {
  return {
    commandId: `orig-${type}`,
    type,
    payload,
    sourceClientId: 'phone-1',
    createdAt: 0,
    status: 'created',
    retryCount: 0,
    maxRetries: 0,
    timeoutMs: 5_000,
  };
}

function makeState(overrides = {}) {
  return {
    songs: [],
    hidden: [],
    activeSongIndex: 0,
    activeSectionIndex: 0,
    isPlaying: true,
    tempo: 120,
    currentSongTime: 4,
    metronome: false,
    preRollEnabled: false,
    signatureNumerator: 4,
    signatureDenominator: 4,
    loopActive: false,
    loopCount: null,
    currentLoopIteration: 0,
    clipTriggerQuantization: 4,
    stateVersion: 1,
    connection: { ableton: 'synced', osc: 'synced' },
    transport: { isPlaying: true, position: 4, tempo: 120 },
    pendingCommands: [],
    mode: 'show',
    safety: { panicActive: false, criticalCommandsLocked: false },
    ...overrides,
  };
}

function makePendingInput(id, overrides = {}) {
  const commandType = overrides.commandType ?? 'play';
  const wireCommand = overrides.wireCommand ?? { type: commandType, commandId: id };
  return {
    commandId: id,
    originalCommandId: `orig-${id}`,
    commandType,
    wireCommand,
    transportSeq: 1,
    safetyStop: false,
    deadlineAt: 1_000,
    ...overrides,
  };
}

function makeAck(commandId, result = 'confirmed', overrides = {}) {
  return {
    type: 'peer_ack',
    commandId,
    result,
    reason: result === 'confirmed' ? '' : result,
    isPlaying: true,
    beat: 12,
    ...overrides,
  };
}

test('peer-protocol exports protocol version, extension version, session ids, and classifiers', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(LINK_PROTOCOL_VERSION, 2);
  assert.equal(EXTENSION_VERSION, pkg.version);

  const sessionA = createMasterSessionId();
  const sessionB = createMasterSessionId();
  assert.notEqual(sessionA, sessionB);
  assert.match(sessionA, /^[A-Za-z0-9._:-]+$/);

  for (const type of ['play', 'stop', 'jump_time', 'trigger_count_in']) {
    assert.equal(isTransportCommandType({ type }), true);
  }
  assert.equal(isTransportCommandType({ type: 'set_panic', active: true }), true);
  assert.equal(isTransportCommandType({ type: 'set_panic', active: false }), false);
  assert.equal(isTransportCommandType({ type: 'set_panic' }), false);
  for (const type of ['metronome', 'set_quantization', 'refresh', 'reorder']) {
    assert.equal(isTransportCommandType({ type }), false);
  }

  assert.equal(isSafetyStopCommand({ type: 'stop' }), true);
  assert.equal(isSafetyStopCommand({ type: 'set_panic', active: true }), true);
  assert.equal(isSafetyStopCommand({ type: 'set_panic', active: false }), false);
  assert.equal(isSafetyStopCommand({ type: 'play' }), false);
  assert.equal(isSafetyStopCommand({ type: 'jump_time' }), false);
});

test('computeCommandDeadline covers all 8 PEER_RELAY_TYPES', () => {
  const now = 10_000;
  const playing = makeState({ currentSongTime: 4, tempo: 120, clipTriggerQuantization: 4 });
  const covered = new Set(['stop', 'set_panic', 'play', 'jump']);

  assert.deepEqual(computeCommandDeadline(makeShowCommand('stop'), playing, now), {
    deadlineAt: null,
    safetyStop: true,
  });
  assert.deepEqual(
    computeCommandDeadline(
      makeShowCommand('set_panic', { type: 'set_panic', active: true }),
      playing,
      now,
    ),
    { deadlineAt: null, safetyStop: true },
  );
  assert.deepEqual(
    computeCommandDeadline(
      makeShowCommand('set_panic', { type: 'set_panic', active: false }),
      playing,
      now,
    ),
    { deadlineAt: now + 1_000, safetyStop: false },
  );

  for (const type of ['metronome', 'set_quantization', 'trigger_count_in', 'refresh']) {
    covered.add(type);
    assert.deepEqual(computeCommandDeadline(makeShowCommand(type), playing, now), {
      deadlineAt: now + 1_000,
      safetyStop: false,
    });
  }
  assert.deepEqual([...covered].sort(), [...PEER_RELAY_TYPES].sort());
});

test('computeCommandDeadline computes quantized play/jump windows and fallbacks', () => {
  const now = 10_000;
  const playing = makeState({ currentSongTime: 4, tempo: 120, clipTriggerQuantization: 4 });
  assert.deepEqual(computeCommandDeadline(makeShowCommand('play'), playing, now), {
    deadlineAt: now + 2_000,
    safetyStop: false,
  });
  assert.deepEqual(
    computeCommandDeadline(makeShowCommand('jump', { type: 'jump', songIndex: 1 }), playing, now),
    { deadlineAt: now + 2_000, safetyStop: false },
  );

  const nearEdge = makeState({ currentSongTime: 3.95, tempo: 120, clipTriggerQuantization: 4 });
  assert.deepEqual(computeCommandDeadline(makeShowCommand('jump'), nearEdge, now), {
    deadlineAt: now + 100,
    safetyStop: false,
  });

  const immJump = makeShowCommand('jump', { type: 'jump', songIndex: 0, immediate: true });
  assert.deepEqual(computeCommandDeadline(immJump, playing, now), {
    deadlineAt: now + 1_000,
    safetyStop: false,
  });
  assert.deepEqual(
    computeCommandDeadline(makeShowCommand('play'), makeState({ isPlaying: false }), now),
    { deadlineAt: now + 1_000, safetyStop: false },
  );
  assert.deepEqual(computeCommandDeadline(makeShowCommand('play'), null, now), {
    deadlineAt: now + 1_000,
    safetyStop: false,
  });
  assert.deepEqual(
    computeCommandDeadline(makeShowCommand('jump'), makeState({ clipTriggerQuantization: 0 }), now),
    { deadlineAt: now + 1_000, safetyStop: false },
  );
  assert.deepEqual(computeCommandDeadline(makeShowCommand('jump'), makeState({ tempo: 0 }), now), {
    deadlineAt: now + 1_000,
    safetyStop: false,
  });
});

test('PeerPendingTable enforces 150ms retry cadence, dynamic ttlMs, and reconnect', () => {
  assert.equal(MAX_PENDING_ENTRIES, 64);
  assert.equal(RETRY_INTERVAL_MS, 150);
  assert.equal(SAFETY_STOP_ALERT_MS, 1_000);
  assert.equal(RECENTLY_EXPIRED_TTL_MS, 60_000);

  const clock = createClock(0);
  const table = new PeerPendingTable({ now: clock.now });
  const base = {
    synchronized: true,
    rttMs: 40,
    bufferedAmount: 0,
    masterIsStopped: false,
    masterIsPanicked: false,
  };

  table.enqueue(makePendingInput('c1', { deadlineAt: 1_000 }));
  assert.equal(table.size(), 1);
  assert.equal(table.has('c1'), true);

  let tick = table.collectDueSends(base);
  assert.equal(tick.toSend.length, 1);
  assert.equal(tick.toSend[0].ttlMs, 980);

  clock.advance(149);
  assert.equal(table.collectDueSends(base).toSend.length, 0);

  clock.advance(1);
  tick = table.collectDueSends({ ...base, rttMs: 60 });
  assert.equal(tick.toSend.length, 1);
  assert.equal(tick.toSend[0].ttlMs, 820);

  clock.advance(10);
  table.onReconnect();
  tick = table.collectDueSends({ ...base, rttMs: 20 });
  assert.equal(tick.toSend.length, 1);
  assert.equal(tick.toSend[0].ttlMs, 830);
});

test('PeerPendingTable expires when dynamic ttlMs <= 0 and upgrades late confirmed ack', () => {
  const clock = createClock(0);
  const table = new PeerPendingTable({ now: clock.now });
  const base = {
    synchronized: true,
    rttMs: 40,
    bufferedAmount: 0,
    masterIsStopped: false,
    masterIsPanicked: false,
  };

  table.enqueue(makePendingInput('c1', { deadlineAt: 1_000 }));
  clock.advance(990);
  const tick = table.collectDueSends(base);
  assert.equal(tick.toSend.length, 0);
  assert.equal(tick.expired.length, 1);
  assert.equal(tick.expired[0].commandId, 'c1');
  assert.equal(table.size(), 0);

  assert.equal(table.onAck(makeAck('c1', 'confirmed')).kind, 'late_confirmed');
  assert.equal(table.onAck(makeAck('c1', 'confirmed')).kind, 'unknown');

  table.enqueue(makePendingInput('c2', { deadlineAt: clock.now() + 500 }));
  assert.equal(table.onAck(makeAck('c2', 'confirmed')).kind, 'settled');
  assert.equal(table.size(), 0);

  table.enqueue(makePendingInput('c3', { deadlineAt: clock.now() + 100 }));
  clock.advance(100);
  assert.equal(table.collectDueSends({ ...base, synchronized: false }).expired.length, 1);
  clock.advance(RECENTLY_EXPIRED_TTL_MS);
  assert.equal(table.onAck(makeAck('c3', 'confirmed')).kind, 'unknown');
});

test('PeerPendingTable 64-entry cap drops oldest non-safety and preserves safety stops', () => {
  const clock = createClock(1_000);
  const expiredAlerts = [];
  const table = new PeerPendingTable({
    now: clock.now,
    onExpired: (entry) => expiredAlerts.push(entry.commandId),
  });

  table.enqueue(
    makePendingInput('stop-0', {
      commandType: 'stop',
      wireCommand: { type: 'stop', commandId: 'stop-0' },
      transportSeq: 1,
      safetyStop: true,
      deadlineAt: null,
    }),
  );
  for (let i = 1; i < MAX_PENDING_ENTRIES; i += 1) {
    table.enqueue(
      makePendingInput(`cmd-${i}`, {
        commandType: 'metronome',
        transportSeq: null,
        deadlineAt: clock.now() + 5_000,
      }),
    );
  }

  const res = table.enqueue(
    makePendingInput('cmd-64', {
      commandType: 'refresh',
      transportSeq: null,
      deadlineAt: clock.now() + 5_000,
    }),
  );
  assert.equal(table.size(), MAX_PENDING_ENTRIES);
  assert.equal(res.evicted?.commandId, 'cmd-1');
  assert.deepEqual(expiredAlerts, ['cmd-1']);
  assert.equal(table.has('stop-0'), true);
  assert.equal(table.onAck(makeAck('cmd-1', 'confirmed')).kind, 'late_confirmed');
});

test('PeerPendingTable rejects non-safety command when all 64 slots hold safety stops', () => {
  const clock = createClock(1_000);
  const table = new PeerPendingTable({ now: clock.now });
  for (let i = 0; i < MAX_PENDING_ENTRIES; i += 1) {
    table.enqueue(
      makePendingInput(`s-${i}`, {
        commandType: 'stop',
        transportSeq: i + 1,
        safetyStop: true,
        deadlineAt: null,
      }),
    );
  }
  const rejected = table.enqueue(
    makePendingInput('non-safety', {
      commandType: 'refresh',
      transportSeq: null,
      deadlineAt: clock.now() + 1_000,
    }),
  );
  assert.equal(rejected.evicted?.commandId, 'non-safety');
  assert.equal(table.has('non-safety'), false);
  assert.equal(table.size(), MAX_PENDING_ENTRIES);
  table.clear();
  assert.equal(table.size(), 0);
});

test('PeerPendingTable handles backpressure and 1s stop_unacked alert', () => {
  const clock = createClock(5_000);
  const table = new PeerPendingTable({ now: clock.now });
  table.enqueue(
    makePendingInput('m1', {
      commandType: 'metronome',
      transportSeq: null,
      deadlineAt: clock.now() + 5_000,
    }),
  );
  table.enqueue(
    makePendingInput('stop-1', {
      commandType: 'stop',
      transportSeq: 2,
      safetyStop: true,
      deadlineAt: null,
    }),
  );
  table.enqueue(
    makePendingInput('panic-1', {
      commandType: 'set_panic',
      wireCommand: { type: 'set_panic', active: true, commandId: 'panic-1' },
      transportSeq: 3,
      safetyStop: true,
      deadlineAt: null,
    }),
  );

  const bpOpts = {
    synchronized: true,
    rttMs: 10,
    bufferedAmount: STALLED_SOCKET_BYTES,
    masterIsStopped: true,
    masterIsPanicked: true,
  };
  const firstBp = table.collectDueSends(bpOpts);
  assert.deepEqual(
    firstBp.toSend.map((m) => m.commandId),
    ['stop-1'],
  );
  assert.equal(firstBp.toSend[0].ttlMs, null);
  assert.deepEqual(
    table.collectDueSends(bpOpts).toSend.map((m) => m.commandId),
    ['panic-1'],
  );

  clock.advance(999);
  assert.equal(table.collectDueSends({ ...bpOpts, synchronized: false }).stopAlerts.length, 0);
  clock.advance(1);
  assert.deepEqual(
    table.collectDueSends({ ...bpOpts, synchronized: false }).stopAlerts.map((e) => e.commandId),
    ['stop-1', 'panic-1'],
  );
  clock.advance(200);
  assert.equal(table.collectDueSends({ ...bpOpts, synchronized: false }).stopAlerts.length, 0);
});

test('PeerPendingTable cancels superseded safety stops and builds status events', () => {
  const clock = createClock(5_000);
  const table = new PeerPendingTable({ now: clock.now });
  table.enqueue(
    makePendingInput('stop-1', {
      commandType: 'stop',
      transportSeq: 2,
      safetyStop: true,
      deadlineAt: null,
    }),
  );
  table.enqueue(
    makePendingInput('panic-1', {
      commandType: 'set_panic',
      wireCommand: { type: 'set_panic', active: true, commandId: 'panic-1' },
      transportSeq: 3,
      safetyStop: true,
      deadlineAt: null,
    }),
  );

  const playRes = table.enqueue(
    makePendingInput('play-4', { commandType: 'play', transportSeq: 4, deadlineAt: 6_000 }),
  );
  assert.deepEqual(
    playRes.cancelled.map((e) => e.commandId),
    ['stop-1'],
  );
  const releaseRes = table.enqueue(
    makePendingInput('panic-off', {
      commandType: 'set_panic',
      wireCommand: { type: 'set_panic', active: false, commandId: 'panic-off' },
      transportSeq: null,
      deadlineAt: 6_000,
    }),
  );
  assert.deepEqual(
    releaseRes.cancelled.map((e) => e.commandId),
    ['panic-1'],
  );

  const ev = buildPeerCommandStatusEvent({
    peerKey: '10.0.0.2:4444',
    host: '10.0.0.2',
    port: 4444,
    entry: playRes.entry,
    status: 'stop_unacked',
    reason: 'timeout',
  });
  assert.equal(ev.type, 'peer_command_status');
  assert.equal(ev.commandId, 'orig-play-4');
  assert.equal(ev.status, 'stop_unacked');
});

test('PeerPendingTable drops safety stops silently once master is no longer stopped/panicked', () => {
  const clock = createClock(1_000);
  const table = new PeerPendingTable({ now: clock.now });
  table.enqueue(
    makePendingInput('s-1', {
      commandType: 'stop',
      transportSeq: 1,
      safetyStop: true,
      deadlineAt: null,
    }),
  );
  table.enqueue(
    makePendingInput('p-1', {
      commandType: 'set_panic',
      wireCommand: { type: 'set_panic', active: true, commandId: 'p-1' },
      transportSeq: 2,
      safetyStop: true,
      deadlineAt: null,
    }),
  );
  clock.advance(2_000);
  const res = table.collectDueSends({
    synchronized: true,
    rttMs: 10,
    bufferedAmount: 0,
    masterIsStopped: false,
    masterIsPanicked: false,
  });
  assert.equal(res.toSend.length, 0);
  assert.equal(res.expired.length, 0);
  assert.equal(res.stopAlerts.length, 0);
  assert.equal(table.size(), 0);
});
