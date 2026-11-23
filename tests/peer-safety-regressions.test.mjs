// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Regression tests for the R2 delivery review: warm-up and safety stop retries.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommandBus } from '../src/core/command-bus.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';
import { PeerHealthTracker } from '../src/runtime/peer-health.ts';
import { PeerPendingTable } from '../src/runtime/peer-pending.ts';

function createClock(startMono = 0, startWall = 1_700_000_000_000) {
  let mono = startMono;
  return {
    now: () => mono,
    wallNow: () => startWall + mono,
    advance(ms) {
      mono += ms;
    },
  };
}

function createTracker(clock) {
  return new PeerHealthTracker({ now: clock.now, wallNow: clock.wallNow });
}

function makePendingInput(id, overrides = {}) {
  return {
    commandId: id,
    originalCommandId: `orig-${id}`,
    commandType: 'play',
    wireCommand: { type: 'play', commandId: id },
    transportSeq: 1,
    safetyStop: false,
    deadlineAt: 1_000,
    ...overrides,
  };
}

function makeAck(commandId, result) {
  return {
    type: 'peer_ack',
    commandId,
    result,
    reason: result === 'confirmed' ? '' : result,
    isPlaying: true,
    beat: 12,
  };
}
test('a bad event during cold start never shortens the 20s warm-up, even with Acknowledge', () => {
  const clock = createClock(0, 1_700_000_000_000);
  const tracker = createTracker(clock);
  tracker.onSynchronized();
  clock.advance(1_000);
  tracker.onHeartbeatSent(1, clock.now());
  tracker.onHeartbeatAck(1, clock.now() - 400, 0, 0, clock.now());
  assert.equal(tracker.acknowledge(), false);
  clock.advance(500);
  assert.equal(tracker.acknowledge(), false);
  clock.advance(10_000);
  assert.equal(tracker.localSnapshot().linkReason, 'warming_up');
  clock.advance(8_499);
  assert.equal(tracker.localSnapshot().linkReason, 'warming_up');
});

test('PeerPendingTable keeps a safety stop queued when the slave answers failed or expired', () => {
  const clock = createClock(1_000);
  const table = new PeerPendingTable({ now: clock.now });
  table.enqueue(
    makePendingInput('stop-r', {
      commandType: 'stop',
      transportSeq: 1,
      safetyStop: true,
      deadlineAt: null,
    }),
  );
  assert.equal(table.onAck(makeAck('stop-r', 'failed')).kind, 'safety_retry');
  assert.equal(table.has('stop-r'), true);
  assert.equal(table.onAck(makeAck('stop-r', 'expired')).kind, 'safety_retry');
  assert.equal(table.onAck(makeAck('stop-r', 'confirmed')).kind, 'settled');
  assert.equal(table.has('stop-r'), false);
});

test('CommandBus.releaseFailedRetry lets a failed safety stop re-execute without releasing confirmed ids', async () => {
  const manager = new SetlistManager();
  manager.updateTransport(10, true);
  const logger = { log: () => {} };
  const bus = new CommandBus(manager, logger);
  try {
    const cmd1 = bus.registerCommand('peer:stop-retry', 'stop', { type: 'stop' }, 'peer');
    await new Promise((resolve) => {
      bus.once('command_settled', resolve);
      bus.dispatch(cmd1, () => {
        throw new Error('OSC down');
      });
    });
    assert.equal(bus.getStatus('peer:stop-retry')?.status, 'failed');
    assert.equal(bus.isDuplicate('peer:stop-retry'), true);
    assert.equal(bus.releaseFailedRetry('peer:stop-retry'), true);
    assert.equal(bus.isDuplicate('peer:stop-retry'), false);

    const cmd2 = bus.registerCommand('peer:stop-retry', 'stop', { type: 'stop' }, 'peer');
    await new Promise((resolve) => {
      bus.once('command_settled', resolve);
      bus.dispatch(cmd2, () => {
        manager.updateTransport(10, false);
        bus.resolveObservableConfirmations();
      });
    });
    assert.equal(bus.getStatus('peer:stop-retry')?.status, 'confirmed');
    assert.equal(bus.releaseFailedRetry('peer:stop-retry'), false);
  } finally {
    bus.stop();
  }
});
