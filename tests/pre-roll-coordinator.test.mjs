import assert from 'node:assert/strict';
import test from 'node:test';
import { PreRollCoordinator } from '../src/core/pre-roll-coordinator.ts';

function stoppedInput(overrides = {}) {
  return {
    enabled: true,
    isPlaying: false,
    targetBeat: 32,
    signatureNumerator: 4,
    signatureDenominator: 4,
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

test('stopped Play schedules one denominator-aware bar in quarter-note beats', () => {
  const coordinator = new PreRollCoordinator();

  assert.deepEqual(coordinator.start(stoppedInput({ signatureNumerator: 6, signatureDenominator: 8 })), {
    kind: 'pre_roll',
    targetBeat: 32,
    startBeat: 29,
    enableMetronome: true,
    shortened: false,
  });
  const secondCoordinator = new PreRollCoordinator();
  assert.deepEqual(secondCoordinator.start(stoppedInput({ signatureNumerator: 3, signatureDenominator: 8 })), {
    kind: 'pre_roll',
    targetBeat: 32,
    startBeat: 30.5,
    enableMetronome: true,
    shortened: false,
  });
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

test('explicit Stop cancels the pre-roll and hands the borrowed Click back', () => {
  const coordinator = new PreRollCoordinator();
  coordinator.start(stoppedInput());

  assert.deepEqual(coordinator.cancel(), { restoreMetronome: true });
  assert.equal(coordinator.hasPending(), false);
  assert.equal(coordinator.cancel(), null);
});

// --- Fire-and-forget contract -------------------------------------------------
// The OSC reply channel is one-way whenever another RC extension owns
// AbletonOSC's fixed return port, so the pre-roll must never wait for an
// acknowledgement before playback and must never gate on a metronome reply.

test('Play is never withheld and a second Play supersedes the armed pre-roll', () => {
  const coordinator = new PreRollCoordinator();

  assert.deepEqual(coordinator.start(stoppedInput()), {
    kind: 'pre_roll',
    targetBeat: 32,
    startBeat: 28,
    enableMetronome: true,
    shortened: false,
  });
  assert.deepEqual(coordinator.start(stoppedInput({ targetBeat: 64 })), {
    kind: 'pre_roll',
    targetBeat: 64,
    startBeat: 60,
    enableMetronome: true,
    shortened: false,
  });
});

test('the pre-roll restores Click from position samples alone, with no metronome reply', () => {
  const coordinator = new PreRollCoordinator();
  coordinator.start(stoppedInput());

  assert.equal(coordinator.observePosition(28), null);
  assert.equal(coordinator.observePosition(30), null);
  assert.deepEqual(coordinator.observePosition(32), { restoreMetronome: true });
  assert.equal(coordinator.hasPending(), false);
});

test('a stale sample at the target cannot restore Click before the pre-roll is observed', () => {
  const coordinator = new PreRollCoordinator();
  coordinator.start(stoppedInput());

  assert.equal(coordinator.observePosition(32), null);
  assert.equal(coordinator.observePosition(40), null);
  assert.equal(coordinator.hasPending(), true);

  coordinator.observePosition(28);
  assert.deepEqual(coordinator.observePosition(32), { restoreMetronome: true });
});

test('a Click the operator already had on is never restored off', () => {
  const coordinator = new PreRollCoordinator();
  coordinator.start(stoppedInput({ metronome: true }));

  coordinator.observePosition(28);
  assert.deepEqual(coordinator.observePosition(32), { restoreMetronome: false });
});

test('a manual Click change during the pre-roll cancels restoration', () => {
  const coordinator = new PreRollCoordinator();
  coordinator.start(stoppedInput());
  coordinator.observePosition(28);

  coordinator.markMetronomeOverridden();
  assert.deepEqual(coordinator.observePosition(32), { restoreMetronome: false });
});

test('a stopped transport observed from Live clears the pre-roll and restores Click', () => {
  const coordinator = new PreRollCoordinator();
  coordinator.start(stoppedInput());
  coordinator.observePosition(28);

  assert.deepEqual(coordinator.observeTransport(false), { restoreMetronome: true });
  assert.equal(coordinator.hasPending(), false);
  assert.equal(coordinator.observeTransport(false), null);
});

test('a stopped transport before the pre-roll is observed still clears the armed state', () => {
  const coordinator = new PreRollCoordinator();
  coordinator.start(stoppedInput());

  assert.deepEqual(coordinator.observeTransport(false), { restoreMetronome: true });
  assert.equal(coordinator.hasPending(), false);
});

test('the coordinator exposes no metronome acknowledgement entry point', () => {
  const coordinator = new PreRollCoordinator();
  assert.equal(typeof coordinator.observeMetronome, 'undefined');
});
