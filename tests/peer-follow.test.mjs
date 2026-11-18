import { test } from 'node:test';
import assert from 'node:assert';
import {
  PeerFollower,
  SETTLE_AFTER_COMMAND_MS,
  SETTLE_AFTER_CORRECTION_MS,
  STABLE_CLOCKS,
  assessPeerClock,
  movesTransport,
} from '../src/runtime/peer-follow.ts';
import { decodeClientMessage } from '../src/server/client-message.ts';
import { peerCommandRejection } from '../src/commands/handlers/peer.ts';

function remote(overrides = {}) {
  return {
    isPlaying: true,
    songTime: 64,
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
    ...overrides,
  };
}

function harness() {
  let clock = 0;
  const calls = [];
  const follower = new PeerFollower(
    {
      moveTo: (beat) => calls.push(['moveTo', beat]),
      startAt: (beat) => calls.push(['startAt', beat]),
      stop: () => calls.push(['stop']),
      report: (message) => calls.push(['report', message]),
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

test('two computers on the same beat need nothing', () => {
  assert.deepStrictEqual(assessPeerClock(remote(), local({ songTime: 64.2 })), { kind: 'none' });
});

test('a launch one bar late is a shift of four beats forward', () => {
  assert.deepStrictEqual(assessPeerClock(remote({ songTime: 68.1 }), local()), {
    kind: 'shift',
    beats: 4,
    to: 68,
  });
});

test('a second computer ahead is shifted back', () => {
  assert.deepStrictEqual(assessPeerClock(remote(), local({ songTime: 68 })), {
    kind: 'shift',
    beats: -4,
    to: 64,
  });
});

test('a gap that is not whole beats is a phase mismatch, never a shift', () => {
  const action = assessPeerClock(remote({ songTime: 65.5 }), local());
  assert.strictEqual(action.kind, 'phase_mismatch');
});

test('nothing moves while a jump waits for its grid on either side', () => {
  assert.deepStrictEqual(assessPeerClock(remote({ songTime: 68, jumpPending: true }), local()), {
    kind: 'none',
  });
  assert.deepStrictEqual(assessPeerClock(remote({ songTime: 68 }), local({ jumpPending: true })), {
    kind: 'none',
  });
});

test('nothing moves while a loop holds either playhead, or the tempos differ', () => {
  assert.strictEqual(
    assessPeerClock(remote({ songTime: 68, loopActive: true }), local()).kind,
    'none',
  );
  assert.strictEqual(
    assessPeerClock(remote({ songTime: 68 }), local({ loopActive: true })).kind,
    'none',
  );
  assert.strictEqual(assessPeerClock(remote({ songTime: 68, tempo: 124 }), local()).kind, 'none');
});

test('a stopped second computer starts on the next bar line of the main one', () => {
  assert.deepStrictEqual(assessPeerClock(remote({ songTime: 65.3 }), local({ isPlaying: false })), {
    kind: 'start',
    at: 68,
  });
  assert.deepStrictEqual(
    assessPeerClock(remote({ songTime: 64 }), local({ isPlaying: false, beatsPerBar: 3 })),
    { kind: 'start', at: 66 },
  );
});

test('panic or a lock keeps the second computer from starting', () => {
  assert.strictEqual(
    assessPeerClock(remote(), local({ isPlaying: false, transportLocked: true })).kind,
    'none',
  );
});

test('a main computer that stopped stops the second one, even under a lock', () => {
  assert.deepStrictEqual(
    assessPeerClock(remote({ isPlaying: false }), local({ transportLocked: true })),
    { kind: 'stop' },
  );
  assert.deepStrictEqual(
    assessPeerClock(remote({ isPlaying: false }), local({ isPlaying: false })),
    {
      kind: 'none',
    },
  );
});

// Clocks half a second apart at 120 BPM: both playheads move one beat each.
function feed(h, gap, count = 1, remoteOverrides = {}, localOverrides = {}) {
  let last = { kind: 'none' };
  for (let i = 0; i < count; i += 1) {
    h.advance(500);
    const base = 64 + h.elapsed() / 500;
    last = h.follower.onClock(
      remote({ songTime: base + gap, ...remoteOverrides }),
      local({ songTime: base, ...localOverrides }),
    );
  }
  return last;
}

const moves = (h) => h.calls.filter((c) => c[0] === 'moveTo');

test('a shift happens only after the same gap holds for several clocks', () => {
  const h = harness();
  // The first clock has nothing to compare its movement with.
  assert.strictEqual(feed(h, 4, STABLE_CLOCKS).kind, 'none');
  assert.strictEqual(feed(h, 4).kind, 'shift');
  assert.strictEqual(moves(h).length, 1);
  assert.strictEqual(h.calls[1][0], 'report');
});

test('a gap that changes between clocks starts the count again', () => {
  const h = harness();
  feed(h, 4, 3);
  // The clock where the gap changes is a jump of the playhead: it counts
  // for nothing, and the new gap starts counting on the next one.
  feed(h, 8, STABLE_CLOCKS);
  assert.deepStrictEqual(h.calls, []);
  feed(h, 8);
  assert.strictEqual(moves(h).length, 1);
});

test('one clock in sync in between clears what was counted', () => {
  const h = harness();
  feed(h, 4, 3);
  feed(h, 0);
  feed(h, 4, STABLE_CLOCKS - 1);
  assert.deepStrictEqual(h.calls, []);
});

test('a main computer whose playhead froze is never corrected against', () => {
  const h = harness();
  // Live stopped answering over there: the clock keeps the last beat while
  // this side plays on. At 40 BPM the gap would pass whole beats slowly.
  for (let i = 0; i < 20; i += 1) {
    h.advance(500);
    const localTime = 64 + (h.elapsed() / 60_000) * 40;
    h.follower.onClock(
      remote({ songTime: 64, tempo: 40 }),
      local({ songTime: localTime, tempo: 40 }),
    );
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
    frozen.follower.onClock(remote({ songTime: 64 }), local({ isPlaying: false }));
  }
  assert.deepStrictEqual(frozen.calls, []);
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

test('a phase mismatch is reported once and never moves the playhead', () => {
  const h = harness();
  feed(h, 1.5, STABLE_CLOCKS * 3);
  assert.strictEqual(moves(h).length, 0);
  assert.strictEqual(h.calls.filter((c) => c[0] === 'report').length, 1);
  assert.match(h.calls[0][1], /Link/);
});

test('a peer clock decodes, and only a peer may send one', () => {
  const decoded = decodeClientMessage({
    type: 'peer_clock',
    isPlaying: true,
    songTime: 12.5,
    tempo: 128,
    jumpPending: false,
    loopActive: false,
  });
  assert.strictEqual(decoded.ok, true);
  assert.strictEqual(decoded.message.type, 'peer_clock');
  assert.strictEqual(peerCommandRejection(decoded.message, true), null);
  assert.strictEqual(peerCommandRejection(decoded.message, false)?.code, 'unauthorized');
  assert.strictEqual(
    decodeClientMessage({ type: 'peer_clock', isPlaying: 'yes', songTime: 1, tempo: 120 }).ok,
    false,
  );
  assert.strictEqual(
    decodeClientMessage({
      type: 'peer_clock',
      isPlaying: true,
      songTime: -1,
      tempo: 120,
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
  // Three seconds without a clock: the next one does not finish the count.
  h.advance(3000);
  feed(h, 4);
  assert.strictEqual(moves(h).length, 0);
});
