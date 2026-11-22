import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { clearExtensionContext, setExtensionContext } from '../src/context.ts';
import { getPeerAutoCorrect, setPeerAutoCorrect } from '../src/preferences.ts';
import {
  OUT_OF_STEP_MS,
  PeerFollower,
  SETTLE_AFTER_COMMAND_MS,
  SETTLE_AFTER_CORRECTION_MS,
  STABLE_CLOCKS,
  STOPPED_BEAT_TOLERANCE,
  assessPeerTarget,
  movesTransport,
  peerFollowTiming,
  resetPeerFollowTiming,
  setPeerFollowTiming,
} from '../src/runtime/peer-follow.ts';
import { decodeClientMessage } from '../src/server/client-message.ts';
import { peerCommandRejection } from '../src/commands/handlers/peer.ts';

function remote(overrides = {}) {
  return {
    transportSeq: 0,
    beat: 64,
    section: false,
    isPlaying: true,
    tempo: 120,
    jumpPending: false,
    loopActive: false,
    ...overrides,
  };
}

function local(overrides = {}) {
  return {
    isPlaying: true,
    songTime: 64,
    tempo: 120,
    jumpPending: false,
    loopActive: false,
    beatsPerBar: 4,
    transportLocked: false,
    autoCorrect: true,
    ...overrides,
  };
}

function harness() {
  let clock = 0;
  const calls = [];
  const follower = new PeerFollower(
    {
      moveTo: (beat) => calls.push(['moveTo', beat]),
      seekStopped: (beat, section) => calls.push(['seekStopped', beat, section]),
      startAt: (beat) => calls.push(['startAt', beat]),
      stop: () => calls.push(['stop']),
      report: (message) => calls.push(['report', message]),
      onOutOfStepChange: (outOfStep) => calls.push(['outOfStep', outOfStep]),
    },
    () => clock,
  );
  return {
    follower,
    calls,
    advance(ms) {
      clock += ms;
    },
    elapsed() {
      return clock;
    },
  };
}

// Targets half a second apart at 120 BPM: both playheads move one beat each.
function feed(h, gap, count = 1, remoteOverrides = {}, localOverrides = {}) {
  let last = { kind: 'none' };
  for (let i = 0; i < count; i += 1) {
    h.advance(500);
    const base = 64 + h.elapsed() / 500;
    last = h.follower.onTarget(
      remote({ beat: base + gap, ...remoteOverrides }),
      local({ songTime: base, ...localOverrides }),
    );
  }
  return last;
}

const moves = (h) => h.calls.filter((c) => c[0] === 'moveTo');
const stoppedSeeks = (h) => h.calls.filter((c) => c[0] === 'seekStopped');

test('two computers on the same beat need nothing', () => {
  assert.deepStrictEqual(assessPeerTarget(remote(), local({ songTime: 64.2 })), { kind: 'none' });
});

test('a launch one bar late is a shift of four beats forward', () => {
  assert.deepStrictEqual(assessPeerTarget(remote({ beat: 68.1 }), local()), {
    kind: 'shift',
    beats: 4,
    to: 68,
  });
});

test('a second computer ahead is shifted back', () => {
  assert.deepStrictEqual(assessPeerTarget(remote(), local({ songTime: 68 })), {
    kind: 'shift',
    beats: -4,
    to: 64,
  });
});

test('a gap that is not whole beats is a phase mismatch, never a shift', () => {
  const action = assessPeerTarget(remote({ beat: 65.5 }), local());
  assert.strictEqual(action.kind, 'phase_mismatch');
});

test('nothing moves while a jump waits for its grid on either side', () => {
  assert.deepStrictEqual(assessPeerTarget(remote({ beat: 68, jumpPending: true }), local()), {
    kind: 'none',
  });
  assert.deepStrictEqual(assessPeerTarget(remote({ beat: 68 }), local({ jumpPending: true })), {
    kind: 'none',
  });
});

test('nothing moves while a loop holds either playhead, or the tempos differ', () => {
  assert.strictEqual(
    assessPeerTarget(remote({ beat: 68, loopActive: true }), local()).kind,
    'none',
  );
  assert.strictEqual(
    assessPeerTarget(remote({ beat: 68 }), local({ loopActive: true })).kind,
    'none',
  );
  assert.strictEqual(assessPeerTarget(remote({ beat: 68, tempo: 124 }), local()).kind, 'none');
});

test('a stopped second computer starts on the next bar line of the main one', () => {
  assert.deepStrictEqual(assessPeerTarget(remote({ beat: 65.3 }), local({ isPlaying: false })), {
    kind: 'start',
    at: 68,
  });
  assert.deepStrictEqual(
    assessPeerTarget(remote({ beat: 64 }), local({ isPlaying: false, beatsPerBar: 3 })),
    { kind: 'start', at: 66 },
  );
});

test('panic or a lock keeps the second computer from starting', () => {
  assert.strictEqual(
    assessPeerTarget(remote(), local({ isPlaying: false, transportLocked: true })).kind,
    'none',
  );
});

test('a main computer that stopped stops the second one, even under a lock', () => {
  assert.deepStrictEqual(
    assessPeerTarget(remote({ isPlaying: false }), local({ transportLocked: true })),
    { kind: 'stop' },
  );
});

test('both stopped beyond tolerance seeks to remote beat and section flag', () => {
  const stoppedRemote = remote({ isPlaying: false, beat: 120, section: true });
  const stoppedLocal = local({ isPlaying: false, songTime: 100 });
  assert.deepStrictEqual(assessPeerTarget(stoppedRemote, stoppedLocal), {
    kind: 'seek_stopped',
    beat: 120,
    section: true,
  });
  assert.deepStrictEqual(
    assessPeerTarget(
      remote({ isPlaying: false, beat: 100 + STOPPED_BEAT_TOLERANCE }),
      local({ isPlaying: false, songTime: 100 }),
    ),
    { kind: 'none' },
  );
  const locked = local({ isPlaying: false, songTime: 100, transportLocked: true });
  assert.deepStrictEqual(assessPeerTarget(stoppedRemote, locked), { kind: 'none' });
  assert.deepStrictEqual(
    assessPeerTarget(
      remote({ isPlaying: false, beat: 120, jumpPending: true }),
      local({ isPlaying: false, songTime: 100 }),
    ),
    { kind: 'none' },
  );
});

test('stopped convergence runs seekStopped after three matching targets when autoCorrect is on', () => {
  const h = harness();
  const r = remote({ isPlaying: false, beat: 120, section: true });
  const l = local({ isPlaying: false, songTime: 0 });
  assert.strictEqual(h.follower.onTarget(r, l).kind, 'none');
  h.advance(500);
  assert.strictEqual(h.follower.onTarget(r, l).kind, 'none');
  h.advance(500);
  assert.deepStrictEqual(h.follower.onTarget(r, l), {
    kind: 'seek_stopped',
    beat: 120,
    section: true,
  });
  assert.deepStrictEqual(stoppedSeeks(h), [['seekStopped', 120, true]]);
});

test('stopped mismatch with autoCorrect off alerts once without moving playhead', () => {
  const h = harness();
  const r = remote({ isPlaying: false, beat: 150, section: false });
  const l = local({ isPlaying: false, songTime: 0, autoCorrect: false });
  for (let i = 0; i <= STABLE_CLOCKS * 2; i += 1) {
    h.follower.onTarget(r, l);
    h.advance(500);
  }
  assert.strictEqual(stoppedSeeks(h).length, 0);
  assert.strictEqual(moves(h).length, 0);
  assert.strictEqual(h.calls.filter((c) => c[0] === 'report').length, 1);
  assert.strictEqual(h.follower.isOutOfStep(), true);
});

test('a shift happens only after the same gap holds for several targets', () => {
  const h = harness();
  assert.strictEqual(feed(h, 4, STABLE_CLOCKS).kind, 'none');
  assert.strictEqual(feed(h, 4).kind, 'shift');
  assert.strictEqual(moves(h).length, 1);
  assert.strictEqual(h.calls[1][0], 'report');
});

test('a gap that changes between targets starts the count again', () => {
  const h = harness();
  feed(h, 4, 3);
  feed(h, 8, STABLE_CLOCKS);
  assert.deepStrictEqual(h.calls, []);
  feed(h, 8);
  assert.strictEqual(moves(h).length, 1);
});

test('one target in sync in between clears what was counted', () => {
  const h = harness();
  feed(h, 4, 3);
  feed(h, 0);
  feed(h, 4, STABLE_CLOCKS - 1);
  assert.deepStrictEqual(h.calls, []);
});

test('a main computer whose playhead froze is never corrected against', () => {
  const h = harness();
  for (let i = 0; i < 20; i += 1) {
    h.advance(500);
    const localTime = 64 + (h.elapsed() / 60_000) * 40;
    h.follower.onTarget(remote({ beat: 64, tempo: 40 }), local({ songTime: localTime, tempo: 40 }));
  }
  assert.strictEqual(moves(h).length, 0);
});

test('a stopped second computer starts only while the main one really plays', () => {
  const h = harness();
  feed(h, 0, STABLE_CLOCKS + 1, {}, { isPlaying: false });
  assert.strictEqual(h.calls[0][0], 'startAt');
  const frozen = harness();
  for (let i = 0; i < 10; i += 1) {
    frozen.advance(500);
    frozen.follower.onTarget(remote({ beat: 64 }), local({ isPlaying: false }));
  }
  assert.strictEqual(frozen.calls.filter((c) => c[0] === 'startAt').length, 0);
});

test('the follower keeps still right after a relayed command', () => {
  const h = harness();
  h.follower.noteCommand();
  feed(h, 0, 4, { isPlaying: false });
  assert.deepStrictEqual(h.calls, []);
  assert.ok(4 * 500 < SETTLE_AFTER_COMMAND_MS);
  feed(h, 0, 1 + STABLE_CLOCKS, { isPlaying: false });
  assert.deepStrictEqual(h.calls[0], ['stop']);
});

test('after a correction the follower waits before it corrects again', () => {
  const h = harness();
  feed(h, 4, STABLE_CLOCKS + 1);
  assert.strictEqual(moves(h).length, 1);
  feed(h, 4, (SETTLE_AFTER_CORRECTION_MS - 500) / 500);
  assert.strictEqual(moves(h).length, 1);
  feed(h, 4, STABLE_CLOCKS + 1);
  assert.strictEqual(moves(h).length, 2);
});

test('a phase mismatch is reported once, latches outOfStep at 3s, and clears on sync', () => {
  const h = harness();
  feed(h, 1.5, 6);
  assert.strictEqual(h.follower.isOutOfStep(), false);
  feed(h, 1.5, 1);
  assert.strictEqual(moves(h).length, 0);
  assert.strictEqual(h.calls.filter((c) => c[0] === 'report').length, 1);
  assert.match(h.calls[0][1], /Link/);
  assert.strictEqual(h.elapsed() - 500, OUT_OF_STEP_MS);
  assert.strictEqual(h.follower.isOutOfStep(), true);
  feed(h, 0, 1);
  assert.strictEqual(h.follower.isOutOfStep(), false);
  const outEvents = h.calls.filter((c) => c[0] === 'outOfStep');
  assert.deepStrictEqual(outEvents, [
    ['outOfStep', true],
    ['outOfStep', false],
  ]);
});

test('outOfStep is suppressed during jumpPending, loopActive, and SETTLE_AFTER_COMMAND_MS', () => {
  const h = harness();
  feed(h, 1.5, 7);
  assert.strictEqual(h.follower.isOutOfStep(), true);
  feed(h, 1.5, 1, { jumpPending: true });
  assert.strictEqual(h.follower.isOutOfStep(), false);
  feed(h, 1.5, 8, {}, { loopActive: true });
  assert.strictEqual(h.follower.isOutOfStep(), false);
  h.follower.noteCommand();
  feed(h, 1.5, 4);
  assert.strictEqual(h.follower.isOutOfStep(), false);
});

test('setPeerFollowTiming and resetPeerFollowTiming override and restore thresholds', () => {
  resetPeerFollowTiming();
  assert.strictEqual(peerFollowTiming().outOfStepMs, OUT_OF_STEP_MS);
  setPeerFollowTiming({ outOfStepMs: 400 });
  assert.strictEqual(peerFollowTiming().outOfStepMs, 400);
  const h = harness();
  feed(h, 1.5, 2);
  assert.strictEqual(h.follower.isOutOfStep(), true);
  resetPeerFollowTiming();
  assert.strictEqual(peerFollowTiming().outOfStepMs, OUT_OF_STEP_MS);
});

test('peer_target decodes, only a peer may send it, and peer_clock is rejected', () => {
  const decoded = decodeClientMessage({
    type: 'peer_target',
    transportSeq: 3,
    beat: 12.5,
    section: true,
    isPlaying: true,
    tempo: 128,
    jumpPending: false,
    loopActive: false,
  });
  assert.strictEqual(decoded.ok, true);
  assert.strictEqual(decoded.message.type, 'peer_target');
  assert.strictEqual(peerCommandRejection(decoded.message, true), null);
  assert.strictEqual(peerCommandRejection(decoded.message, false)?.code, 'unauthorized');
  assert.strictEqual(
    decodeClientMessage({
      type: 'peer_clock',
      isPlaying: true,
      songTime: 12.5,
      tempo: 128,
      jumpPending: false,
      loopActive: false,
    }).ok,
    false,
  );
});

test('only a relayed command that moves the transport holds the follower back', () => {
  for (const type of ['play', 'stop', 'jump_time', 'trigger_count_in']) {
    assert.strictEqual(movesTransport(type), true, type);
  }
  for (const type of ['metronome', 'set_quantization', 'refresh', 'set_panic']) {
    assert.strictEqual(movesTransport(type), false, type);
  }
});

test('a link that was quiet for a while counts again from nothing', () => {
  const h = harness();
  feed(h, 4, STABLE_CLOCKS);
  assert.strictEqual(moves(h).length, 0);
  h.advance(3000);
  feed(h, 4);
  assert.strictEqual(moves(h).length, 0);
});

test('peer-auto-correct preference defaults to true and persists false/true', () => {
  const storageDir = fs.mkdtempSync(path.join(tmpdir(), 'rc-peer-autocorrect-'));
  setExtensionContext({ environment: { storageDirectory: storageDir } });
  try {
    assert.strictEqual(getPeerAutoCorrect(), true);
    assert.strictEqual(setPeerAutoCorrect(false), true);
    assert.strictEqual(getPeerAutoCorrect(), false);
    assert.strictEqual(setPeerAutoCorrect(true), true);
    assert.strictEqual(getPeerAutoCorrect(), true);
  } finally {
    clearExtensionContext();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
});
