import assert from 'node:assert/strict';
import test from 'node:test';
import { PreRollCoordinator } from '../src/core/pre-roll-coordinator.ts';

function stoppedInput(overrides = {}) {
  return {
    enabled: true,
    isPlaying: false,
    targetBeat: 32,
    signatureNumerator: 4,
    metronome: false,
    ...overrides,
  };
}

test('disabled and already-playing Play pass through without pending state', () => {
  const coordinator = new PreRollCoordinator();

  assert.deepEqual(
    coordinator.start(stoppedInput({ enabled: false })),
    { kind: 'passthrough', shortened: false, reason: 'disabled' },
  );
  assert.equal(coordinator.hasPending(), false);

  assert.deepEqual(
    coordinator.start(stoppedInput({ isPlaying: true })),
    { kind: 'passthrough', shortened: false, reason: 'playing' },
  );
  assert.equal(coordinator.hasPending(), false);
});

test('stopped Play schedules one numerator-sized bar and temporary Click', () => {
  const coordinator = new PreRollCoordinator();

  assert.deepEqual(coordinator.start(stoppedInput({ signatureNumerator: 3 })), {
    kind: 'pre_roll',
    targetBeat: 32,
    startBeat: 29,
    enableMetronome: true,
    shortened: false,
  });
  assert.equal(coordinator.hasPending(), true);
});

test('beat-zero clamp reports a shortened pre-roll', () => {
  const coordinator = new PreRollCoordinator();

  assert.deepEqual(coordinator.start(stoppedInput({ targetBeat: 2 })), {
    kind: 'pre_roll',
    targetBeat: 2,
    startBeat: 0,
    enableMetronome: true,
    shortened: true,
  });
});

test('zero-length and invalid pre-roll inputs safely pass through', () => {
  const coordinator = new PreRollCoordinator();

  assert.deepEqual(coordinator.start(stoppedInput({ targetBeat: 0 })), {
    kind: 'passthrough',
    shortened: true,
    reason: 'no_room',
  });
  assert.deepEqual(coordinator.start(stoppedInput({ targetBeat: Number.NaN })), {
    kind: 'passthrough',
    shortened: false,
    reason: 'invalid',
  });
  assert.deepEqual(coordinator.start(stoppedInput({ signatureNumerator: 0 })), {
    kind: 'passthrough',
    shortened: false,
    reason: 'invalid',
  });
  assert.equal(coordinator.hasPending(), false);
});

test('a stale target sample cannot complete before the rewind is observed', () => {
  const coordinator = new PreRollCoordinator();
  coordinator.start(stoppedInput());

  assert.equal(coordinator.observePosition(32), null);
  assert.equal(coordinator.hasPending(), true);
  assert.equal(coordinator.observePosition(28), null);
  assert.equal(coordinator.hasPending(), true);
  assert.deepEqual(coordinator.observePosition(32), { restoreMetronome: true });
  assert.equal(coordinator.hasPending(), false);
});

test('arrival at target restores only the Click enabled by the pre-roll', () => {
  const coordinator = new PreRollCoordinator();
  coordinator.start(stoppedInput({ metronome: true }));

  coordinator.observePosition(28);
  assert.deepEqual(coordinator.observePosition(32.1), { restoreMetronome: false });
});

test('explicit Stop cancels and restores the temporary Click', () => {
  const coordinator = new PreRollCoordinator();
  coordinator.start(stoppedInput());

  assert.deepEqual(coordinator.cancel(), { restoreMetronome: true });
  assert.equal(coordinator.hasPending(), false);
  assert.equal(coordinator.cancel(), null);
});

test('manual Click override prevents automatic restoration', () => {
  const coordinator = new PreRollCoordinator();
  coordinator.start(stoppedInput());

  coordinator.markMetronomeOverridden();
  coordinator.observePosition(28);
  assert.deepEqual(coordinator.observePosition(32), { restoreMetronome: false });
});

test('observed stopped transport cancels only after the pre-roll has begun', () => {
  const coordinator = new PreRollCoordinator();
  coordinator.start(stoppedInput());

  assert.equal(coordinator.observeTransport(false), null);
  assert.equal(coordinator.hasPending(), true);
  assert.equal(coordinator.observeTransport(true), null);
  assert.deepEqual(coordinator.observeTransport(false), { restoreMetronome: true });
  assert.equal(coordinator.hasPending(), false);
});
