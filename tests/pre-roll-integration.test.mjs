import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { executeCommandAction } from '../src/commands/handlers/index.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';

/**
 * The count-in used to live on this side: Play rewound Live's playhead one bar,
 * started the transport there, and switched Live's metronome on to make the
 * count audible. All three were wrong on stage. The bar before a song belongs
 * to the previous song, so the count ran at that song's tempo and its audio
 * played, and the borrowed metronome overrode a click the operator had
 * deliberately switched off.
 *
 * The count is produced in the browser now (static/setlist/count-in.js), and
 * these tests exist to keep the server out of it: whatever `preRollEnabled`
 * says, Play must start the transport where it stands and touch nothing else.
 */

class FakeOsc extends EventEmitter {
  calls = [];

  setMetronome(value) {
    this.calls.push(['metronome', value]);
  }
  setCurrentSongTime(value) {
    this.calls.push(['position', value]);
  }
  continuePlaying() {
    this.calls.push(['continue']);
  }
  startPlaying() {
    this.calls.push(['start']);
  }
  stopPlaying() {
    this.calls.push(['stop']);
  }
  send(address, args) {
    this.calls.push(['send', address, args]);
  }
}

function command(type, payload = {}) {
  return {
    commandId: `${type}-test`,
    type,
    payload,
    sourceClientId: 'test',
    createdAt: 0,
    status: 'sent',
    retryCount: 0,
    maxRetries: 3,
    timeoutMs: 5_000,
  };
}

function installHarness({
  preRollEnabled = true,
  targetBeat = 32,
  isPlaying = false,
  metronome = false,
  signatureNumerator = 4,
  signatureDenominator = 4,
} = {}) {
  const saved = {
    manager: bridgeState.manager,
    oscClient: bridgeState.oscClient,
    wsServer: bridgeState.wsServer,
    scheduler: bridgeState.scheduler,
    commandBus: bridgeState.commandBus,
    mcpFallbackSync: bridgeState.mcpFallbackSync,
    isCreatingTestSession: bridgeState.isCreatingTestSession,
    lastActiveSongTitle: bridgeState.lastActiveSongTitle,
  };
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A [bpm 110]', time: 0 },
    { name: 'Song B [bpm 160]', time: 32 },
  ]);
  manager.updateTransport(targetBeat, isPlaying, 110);
  manager.updateSignature(signatureNumerator, signatureDenominator);
  manager.updateMetronome(metronome);
  manager.setPreRollEnabled(preRollEnabled);

  const osc = new FakeOsc();
  const states = [];
  bridgeState.manager = manager;
  bridgeState.oscClient = osc;
  bridgeState.wsServer = {
    broadcastState: (state) => states.push(state),
    broadcastLog() {},
    broadcast() {},
  };
  bridgeState.scheduler = null;
  bridgeState.commandBus = null;
  bridgeState.mcpFallbackSync = null;
  bridgeState.isCreatingTestSession = false;
  bridgeState.lastActiveSongTitle = 'Song A';

  return {
    manager,
    osc,
    states,
    restore() {
      Object.assign(bridgeState, saved);
    },
  };
}

test('Play never moves the playhead, so the count can never run in the previous song', async () => {
  const harness = installHarness();
  try {
    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [['continue']]);
  } finally {
    harness.restore();
  }
});

test('Play never touches the metronome, so a click switched off stays off', async () => {
  const harness = installHarness({ metronome: false });
  try {
    await executeCommandAction(command('play'));
    const touched = harness.osc.calls.filter(([kind]) => kind === 'metronome');
    assert.deepEqual(touched, [], "the count-in must not borrow Live's click");
    assert.equal(harness.manager.getState().metronome, false);
  } finally {
    harness.restore();
  }
});

test('the count-in toggle changes nothing on this side', async () => {
  for (const preRollEnabled of [true, false]) {
    const harness = installHarness({ preRollEnabled });
    try {
      await executeCommandAction(command('play'));
      assert.deepEqual(harness.osc.calls, [['continue']], `preRollEnabled=${preRollEnabled}`);
    } finally {
      harness.restore();
    }
  }
});

test('Play at the very start of the arrangement is not a special case any more', async () => {
  // With the old rewind this was the "shortened count-in" edge, because there
  // was no bar to move back into. There is nothing to shorten now.
  const harness = installHarness({ targetBeat: 0 });
  try {
    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [['continue']]);
  } finally {
    harness.restore();
  }
});

test('an already-playing transport still just plays', async () => {
  const harness = installHarness({ isPlaying: true });
  try {
    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [['continue']]);
  } finally {
    harness.restore();
  }
});

test('Stop stops, and has no count-in state left to unwind', async () => {
  const harness = installHarness();
  try {
    await executeCommandAction(command('play'));
    await executeCommandAction(command('stop'));
    assert.deepEqual(harness.osc.calls, [['continue'], ['stop']]);
  } finally {
    harness.restore();
  }
});

test('the state carries the tempo the setlist declares at the playhead', async () => {
  // This is what the browser counts at. Live reports 110 here because that is
  // where the previous song left it; the setlist declares 160 for this song,
  // and 160 is the number the count has to use.
  const harness = installHarness({ targetBeat: 32 });
  try {
    const state = harness.manager.getState();
    assert.equal(state.tempo, 110);
    assert.equal(state.declaredTempo, 160);
  } finally {
    harness.restore();
  }
});

test('the declared tempo is null when the setlist declares nothing before the playhead', async () => {
  const harness = installHarness();
  try {
    harness.manager.updateCues([{ name: 'Song A', time: 0 }]);
    harness.manager.updateTransport(8, false, 110);
    assert.equal(harness.manager.getState().declaredTempo, null);
  } finally {
    harness.restore();
  }
});

test('Stop disarms a quantized jump that has not landed yet', async () => {
  // The scheduler fires a pending jump from position samples, and Live's Stop
  // moves the playhead. Left armed, the next sample after Stop carried the
  // transport off to a section the operator had already abandoned — arriving
  // as a jump to a seemingly random part of the set, seconds after Stop.
  const harness = installHarness({ isPlaying: true });
  try {
    let cleared = false;
    const broadcasts = [];
    bridgeState.scheduler = {
      hasPending: () => true,
      clearPending: () => {
        cleared = true;
      },
    };
    bridgeState.wsServer.broadcast = (message) => broadcasts.push(message);

    await executeCommandAction(command('stop'));

    assert.equal(cleared, true, 'the pending jump must be disarmed');
    assert.deepEqual(broadcasts, [{ type: 'jump_cancelled' }]);
    assert.deepEqual(harness.osc.calls, [['stop']], "Stop stays exactly Live's Stop");
  } finally {
    harness.restore();
  }
});

test('Stop with nothing scheduled says nothing and just stops', async () => {
  const harness = installHarness({ isPlaying: true });
  try {
    const broadcasts = [];
    bridgeState.scheduler = {
      hasPending: () => false,
      clearPending() {
        throw new Error('must not clear');
      },
    };
    bridgeState.wsServer.broadcast = (message) => broadcasts.push(message);

    await executeCommandAction(command('stop'));

    assert.deepEqual(broadcasts, []);
    assert.deepEqual(harness.osc.calls, [['stop']]);
  } finally {
    harness.restore();
  }
});

/*
 * Live keeps two positions a Play can start from, and neither is "the playhead":
 *
 * - `continue_playing` resumes where the transport last came to rest. It
 *   ignores anything done to the playhead while stopped — a cue jump, a click
 *   in the Arrangement, a written `current_song_time`.
 * - `start_playing` starts at the start marker, which a cue jump or a click
 *   while stopped does move, but a stop does not.
 *
 * Both were measured on Live 12.4 on 2026-09-12. So Play resumes when the
 * playhead has not moved since the transport stopped, and starts from the
 * start marker when it has — that is the only way "play from where I put the
 * playhead" holds in both the stop-and-resume and the jump-then-play cases.
 */
test('Play resumes where the transport stopped', async () => {
  const harness = installHarness({ targetBeat: 20, isPlaying: true });
  try {
    harness.manager.updateTransport(20.6, false);
    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [['continue']]);
  } finally {
    harness.restore();
  }
});

test('the small forward drift of a stop settling is not a relocation', async () => {
  // is_playing arrives with the last position sample, up to a poll behind; the
  // next samples show where Live actually came to rest.
  const harness = installHarness({ targetBeat: 20, isPlaying: true });
  try {
    harness.manager.updateTransport(20.0, false);
    harness.manager.updateTransport(20.4, false);
    harness.manager.updateTransport(20.4, false);
    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [['continue']]);
  } finally {
    harness.restore();
  }
});

test('Play after a jump while stopped starts from the start marker the jump moved', async () => {
  const harness = installHarness({ targetBeat: 20, isPlaying: true });
  try {
    harness.manager.updateTransport(20.0, false);
    bridgeState.scheduler = {
      clearPending() {},
      hasPending: () => false,
      schedule: () => ({ immediate: true, landingTime: 0, replaced: false }),
    };
    bridgeState.oscClient.jumpToCuePoint = function jumpToCuePoint(target) {
      this.calls.push(['jump', target]);
    };
    const { executeJumpCommand } = await import('../src/commands/handlers/transport.ts');
    executeJumpCommand({ type: 'jump', songIndex: 1, sectionIndex: null });
    harness.manager.updateTransport(32, false);
    harness.osc.calls.length = 0;

    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [['start']]);
  } finally {
    harness.restore();
  }
});

test('a playhead moved backwards while stopped, however little, means start', async () => {
  // Live's own double Stop returns the playhead to the start marker; a Play
  // after that must start there, not resume where the first Stop landed.
  const harness = installHarness({ targetBeat: 20, isPlaying: true });
  try {
    harness.manager.updateTransport(20.4, false);
    harness.manager.updateTransport(20.0, false);
    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [['start']]);
  } finally {
    harness.restore();
  }
});

test('a transport only ever seen stopped resumes unless the playhead moves', async () => {
  // The extension can come up after Live already stopped somewhere. The first
  // stopped position is the reference; a move away from it is a relocation.
  const harness = installHarness({ targetBeat: 20, isPlaying: false });
  try {
    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [['continue']]);
    harness.osc.calls.length = 0;
    harness.manager.updateTransport(64, false);
    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [['start']]);
  } finally {
    harness.restore();
  }
});

test('a tempo report before any position sample does not fix the resting beat at zero', async () => {
  // The SDK reports the tempo every 100ms from the moment the extension
  // starts, before Live's position has been observed. Live is typically
  // stopped wherever the operator left it; that first real sample is the
  // resting beat, and Play must resume there, not start from the start marker.
  const harness = installHarness({ targetBeat: 0, isPlaying: false });
  try {
    const manager = new SetlistManager();
    manager.updateCues([
      { name: 'Song A [bpm 110]', time: 0 },
      { name: 'Song B [bpm 160]', time: 32 },
    ]);
    bridgeState.manager = manager;
    manager.updateTempo(110);
    manager.updateTempo(110);
    manager.updateTransport(1872, false);
    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [['continue']]);
    assert.equal(manager.getState().tempo, 110);
  } finally {
    harness.restore();
  }
});

test('Play on a running transport never restarts it from the start marker', async () => {
  const harness = installHarness({ targetBeat: 20, isPlaying: true });
  try {
    harness.manager.updateTransport(40, true);
    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [['continue']]);
  } finally {
    harness.restore();
  }
});

test('a jump while stopped moves this side to the target, so the count uses its tempo', async () => {
  // Live is only told to jump; where the playhead actually is comes back on the
  // position poll up to half a second later. The count reads the tempo declared
  // at the playhead, so jumping to a section and pressing Play immediately
  // counted at the tempo of wherever the playhead had been.
  const harness = installHarness({ targetBeat: 0, isPlaying: false });
  try {
    bridgeState.scheduler = {
      clearPending() {},
      hasPending: () => false,
      schedule: () => ({ immediate: true, landingTime: 0, replaced: false }),
    };
    bridgeState.oscClient.jumpToCuePoint = function jumpToCuePoint(target) {
      this.calls.push(['jump', target]);
    };

    assert.equal(harness.manager.getState().declaredTempo, 110, 'starts on Song A');

    const { executeJumpCommand } = await import('../src/commands/handlers/transport.ts');
    executeJumpCommand({ type: 'jump', songIndex: 1, sectionIndex: null });

    const state = harness.manager.getState();
    assert.equal(state.currentSongTime, 32, 'the playhead follows the jump immediately');
    assert.equal(state.declaredTempo, 160, 'so the count reads Song B, not Song A');
  } finally {
    harness.restore();
  }
});

test('a jump while playing leaves the position to Live', async () => {
  // Writing the target beat during playback would evaluate the target's
  // automations before the transport has reached it.
  const harness = installHarness({ targetBeat: 0, isPlaying: true });
  try {
    bridgeState.scheduler = {
      clearPending() {},
      hasPending: () => false,
      schedule: () => ({ immediate: true, landingTime: 0, replaced: false }),
    };
    bridgeState.oscClient.jumpToCuePoint = function jumpToCuePoint(target) {
      this.calls.push(['jump', target]);
    };
    harness.manager.updateSignature(4, 4);

    const { executeJumpCommand } = await import('../src/commands/handlers/transport.ts');
    executeJumpCommand({ type: 'jump', songIndex: 1, sectionIndex: null });

    assert.equal(harness.manager.getState().currentSongTime, 0, 'unchanged until Live reports');
  } finally {
    harness.restore();
  }
});
