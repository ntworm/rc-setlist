// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SLAVE_COMMAND_CACHE_CAPACITY,
  SLAVE_COMMAND_CACHE_TTL_MS,
  SlaveCommandTracker,
  onPeerHandshakeSession,
  receivePeerCommand,
  resetSlaveCommandState,
} from '../src/runtime/peer-slave-commands.ts';

function createClock(startMs = 0) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance(ms) {
      nowMs += ms;
    },
  };
}

function createFakeSocket(readyState = 1) {
  const sent = [];
  return {
    readyState,
    sent,
    send(raw) {
      sent.push(JSON.parse(raw));
    },
  };
}

function makeEnvelope(commandId, overrides = {}) {
  const command = overrides.command ?? { type: 'play' };
  return {
    type: 'peer_command',
    commandId,
    ttlMs: 1_000,
    transportSeq: 1,
    command,
    ...overrides,
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('SlaveCommandTracker deduplicates in-flight retries and honours 10m settled TTL', async () => {
  assert.equal(SLAVE_COMMAND_CACHE_CAPACITY, 512);
  assert.equal(SLAVE_COMMAND_CACHE_TTL_MS, 600_000);

  const clock = createClock(10_000);
  const noted = [];
  const tracker = new SlaveCommandTracker({
    now: clock.now,
    getTransportSnapshot: () => ({ isPlaying: true, beat: 24 }),
    noteCommand: (type) => noted.push(type),
    adoptEcho: (msg) => msg,
  });

  const ws1 = createFakeSocket(1);
  const ws2 = createFakeSocket(1);
  const gate = createDeferred();
  let runs = 0;
  const firstRun = tracker.receiveCommand(ws1, makeEnvelope('cmd-a'), async () => {
    runs += 1;
    return gate.promise;
  });
  const dup = await tracker.receiveCommand(ws2, makeEnvelope('cmd-a'), () => {
    runs += 1;
    return { result: 'confirmed' };
  });
  assert.equal(dup, null);
  assert.equal(runs, 1);

  gate.resolve({ result: 'confirmed' });
  const ack = await firstRun;
  assert.deepEqual(ack, {
    type: 'peer_ack',
    commandId: 'cmd-a',
    result: 'confirmed',
    reason: '',
    isPlaying: true,
    beat: 24,
  });
  assert.equal(ws1.sent.length, 0);
  assert.equal(ws2.sent.length, 1);
  assert.deepEqual(noted, ['play']);

  clock.advance(SLAVE_COMMAND_CACHE_TTL_MS - 1);
  await tracker.receiveCommand(ws1, makeEnvelope('cmd-a'), () => {
    runs += 1;
    return { result: 'confirmed' };
  });
  assert.equal(runs, 1);
  assert.equal(ws1.sent.length, 1);

  clock.advance(1);
  await tracker.receiveCommand(ws1, makeEnvelope('cmd-a'), () => {
    runs += 1;
    return { result: 'confirmed' };
  });
  assert.equal(runs, 2);
});

test('SlaveCommandTracker enforces 512-entry LRU cache eviction order', async () => {
  const clock = createClock(1_000);
  const tracker = new SlaveCommandTracker({
    now: clock.now,
    getTransportSnapshot: () => ({ isPlaying: false, beat: 0 }),
    noteCommand: () => {},
    adoptEcho: (msg) => msg,
  });
  const ws = createFakeSocket(1);
  let runs = 0;
  const okExec = () => {
    runs += 1;
    return { result: 'confirmed' };
  };

  for (let i = 1; i <= SLAVE_COMMAND_CACHE_CAPACITY; i += 1) {
    await tracker.receiveCommand(
      ws,
      makeEnvelope(`k-${i}`, { transportSeq: null, command: { type: 'refresh' } }),
      okExec,
    );
  }
  assert.equal(tracker.getSessionState().cacheSize, SLAVE_COMMAND_CACHE_CAPACITY);

  // Touch k-1 so k-2 becomes least-recently used and gets evicted on k-513.
  await tracker.receiveCommand(
    ws,
    makeEnvelope('k-1', { transportSeq: null, command: { type: 'refresh' } }),
    okExec,
  );
  await tracker.receiveCommand(
    ws,
    makeEnvelope('k-513', { transportSeq: null, command: { type: 'refresh' } }),
    okExec,
  );
  assert.equal(runs, SLAVE_COMMAND_CACHE_CAPACITY + 1);

  await tracker.receiveCommand(
    ws,
    makeEnvelope('k-1', { transportSeq: null, command: { type: 'refresh' } }),
    okExec,
  );
  assert.equal(runs, SLAVE_COMMAND_CACHE_CAPACITY + 1);
  await tracker.receiveCommand(
    ws,
    makeEnvelope('k-2', { transportSeq: null, command: { type: 'refresh' } }),
    okExec,
  );
  assert.equal(runs, SLAVE_COMMAND_CACHE_CAPACITY + 2);
});

test('SlaveCommandTracker enforces transportSeq supersede, null bypass, and TTL expiry', async () => {
  const clock = createClock(1_000);
  const tracker = new SlaveCommandTracker({
    now: clock.now,
    getTransportSnapshot: () => ({ isPlaying: false, beat: 8 }),
    noteCommand: () => {},
    adoptEcho: (msg) => msg,
  });
  const ws = createFakeSocket(1);
  const executed = [];
  const exec = (inner) => {
    executed.push(inner.commandId);
    return { result: 'confirmed' };
  };

  tracker.onHandshakeSession('sess-1');
  await tracker.receiveCommand(
    ws,
    makeEnvelope('stop-5', { transportSeq: 5, ttlMs: null, command: { type: 'stop' } }),
    exec,
  );
  assert.equal(tracker.getSessionState().lastExecutedTransportSeq, 5);

  const sup = await tracker.receiveCommand(ws, makeEnvelope('play-3', { transportSeq: 3 }), exec);
  assert.equal(sup.result, 'superseded');
  assert.deepEqual(executed, ['stop-5']);

  await tracker.receiveCommand(
    ws,
    makeEnvelope('metro-1', {
      transportSeq: null,
      command: { type: 'metronome', value: true },
    }),
    exec,
  );
  assert.deepEqual(executed, ['stop-5', 'metro-1']);

  const exp = await tracker.receiveCommand(
    ws,
    makeEnvelope('exp-1', { transportSeq: 6, ttlMs: 0 }),
    exec,
  );
  assert.equal(exp.result, 'expired');
  assert.equal(tracker.getSessionState().lastExecutedTransportSeq, 5);

  const queueExp = await tracker.receiveCommand(
    ws,
    makeEnvelope('exp-queued', { transportSeq: 6, ttlMs: 100 }),
    (_inner, meta) => {
      assert.equal(meta.isExpired(), false);
      clock.advance(100);
      assert.equal(meta.isExpired(), true);
      return { result: 'expired' };
    },
  );
  assert.equal(queueExp.result, 'expired');
  assert.equal(queueExp.reason, 'expired');
});

test('SlaveCommandTracker resets sequence on new sessionId and handles executor failures', async () => {
  const clock = createClock(1_000);
  const tracker = new SlaveCommandTracker({
    now: clock.now,
    getTransportSnapshot: () => ({ isPlaying: false, beat: 8 }),
    noteCommand: () => {},
    adoptEcho: (msg) => msg,
  });
  const ws = createFakeSocket(1);

  tracker.onHandshakeSession('sess-1');
  await tracker.receiveCommand(ws, makeEnvelope('s-5', { transportSeq: 5 }), () => ({
    result: 'confirmed',
  }));
  tracker.onHandshakeSession('sess-1');
  tracker.onHandshakeSession(undefined);
  assert.equal(tracker.getSessionState().lastExecutedTransportSeq, 5);

  tracker.onHandshakeSession('sess-2');
  assert.equal(tracker.getSessionState().lastExecutedTransportSeq, 0);
  const afterReset = await tracker.receiveCommand(
    ws,
    makeEnvelope('play-new-1', { transportSeq: 1 }),
    () => ({ result: 'confirmed' }),
  );
  assert.equal(afterReset.result, 'confirmed');

  const errAck = await tracker.receiveCommand(
    ws,
    makeEnvelope('boom-1', { transportSeq: null, command: { type: 'refresh' } }),
    () => {
      throw new Error('boom');
    },
  );
  assert.equal(errAck.result, 'failed');
  assert.equal(errAck.reason, 'execution_failed');

  resetSlaveCommandState();
  onPeerHandshakeSession('default-sess');
  const closedWs = createFakeSocket(3);
  const defAck = await receivePeerCommand(
    closedWs,
    makeEnvelope('def-1', { transportSeq: 1, command: { type: 'play' } }),
    () => ({ result: 'confirmed' }),
  );
  assert.equal(defAck.result, 'confirmed');
  assert.equal(closedWs.sent.length, 0);
  resetSlaveCommandState();
});
