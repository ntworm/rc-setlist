import assert from 'node:assert/strict';
import test from 'node:test';
import { executeAutomationActions } from '../src/automation/executor.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';

/**
 * How a [next] or [skip] marker hands playback over.
 *
 * These used to go through `/live/song/cue_point/jump`, which Live
 * launch-quantizes: with the global quantization at one bar, the jump was
 * executed on the bar line *after* the marker. Measured on the owner's set on
 * 2026-09-08 — NEXT fired at beat 872.3, Live jumped at 876.0. A [next] on the
 * last marker of a song, followed by a one-bar gap, therefore did nothing
 * visible: by the time Live jumped, the playhead was already where the next
 * song starts.
 *
 * The transition now relocates the playhead directly, which Live does at once
 * (the only delay is the position poll and AbletonOSC's 100ms tick, both of
 * which can only make it late, never early).
 */

function installHarness() {
  const saved = {
    manager: bridgeState.manager,
    oscClient: bridgeState.oscClient,
    wsServer: bridgeState.wsServer,
  };
  const manager = new SetlistManager();
  const calls = [];
  bridgeState.manager = manager;
  bridgeState.oscClient = {
    send: (address, args) => calls.push(['send', address, args.map((a) => a.value)]),
    setCurrentSongTime: (value) => calls.push(['position', value]),
    jumpToCuePoint: (target) => calls.push(['cue-jump', target]),
    stopPlaying: () => calls.push(['stop']),
    setMetronome: (value) => calls.push(['metronome', value]),
  };
  bridgeState.wsServer = { broadcast() {}, broadcastLog() {}, broadcastState() {} };
  return { manager, calls, restore: () => Object.assign(bridgeState, saved) };
}

test('[next] relocates the playhead to the next song and never asks Live for a quantized cue jump', () => {
  const harness = installHarness();
  try {
    harness.manager.updateCues([
      { name: 'MÚSICA 1', time: 0 },
      { name: '> FIM [next]', time: 64 },
      { name: 'MÚSICA 2', time: 80 },
    ]);
    executeAutomationActions([{ type: 'next', nextSongIndex: 1, targetTime: 80 }], 64.2);
    assert.deepEqual(harness.calls, [
      ['send', '/live/song/set/loop', [0]],
      ['position', 80],
    ]);
  } finally {
    harness.restore();
  }
});

test('[skip] relocates to the section after it the same way', () => {
  const harness = installHarness();
  try {
    executeAutomationActions([{ type: 'skip', targetCue: 'A > Chorus', targetTime: 30 }], 10.3);
    assert.deepEqual(harness.calls, [
      ['send', '/live/song/set/loop', [0]],
      ['position', 30],
    ]);
  } finally {
    harness.restore();
  }
});

test('an active loop is released before the transition, on both sides', () => {
  const harness = installHarness();
  try {
    harness.manager.updateCues([
      { name: 'A', time: 0 },
      { name: 'A > Riff [loop]', time: 8 },
      { name: 'A > Out [next]', time: 16 },
      { name: 'B', time: 32 },
    ]);
    harness.manager.updateTransport(8, true, 120);
    executeAutomationActions(harness.manager.checkAutomations(), 8);
    assert.equal(harness.manager.isLoopActive(), true);
    harness.calls.length = 0;

    executeAutomationActions([{ type: 'next', nextSongIndex: 1, targetTime: 32 }], 16.1);
    assert.equal(harness.manager.isLoopActive(), false);
    assert.deepEqual(harness.calls[0], ['send', '/live/song/set/loop', [0]]);
    assert.deepEqual(harness.calls.at(-1), ['position', 32]);
  } finally {
    harness.restore();
  }
});

test('crossing an end-of-song [next] at poll rate writes the position exactly once', () => {
  // The colleague's set-up: the last marker of a song carries [next], a short
  // empty gap follows, then the next song. Sampled every 0.2 beat like a 100ms
  // poll at 120 BPM.
  const harness = installHarness();
  try {
    harness.manager.updateCues([
      { name: 'MÚSICA 1 [bpm 120]', time: 0 },
      { name: '> VERSO', time: 16 },
      { name: '> FIM [next]', time: 64 },
      { name: 'MÚSICA 2', time: 68 },
    ]);
    harness.manager.updateTransport(60, true, 120);
    for (let beat = 60; beat <= 66; beat = Math.round((beat + 0.2) * 100) / 100) {
      harness.manager.updateTransport(beat, true);
      executeAutomationActions(harness.manager.checkAutomations(), beat);
    }
    const positions = harness.calls.filter((c) => c[0] === 'position');
    assert.deepEqual(positions, [['position', 68]]);
    assert.equal(
      harness.calls.some((c) => c[0] === 'cue-jump'),
      false,
    );
  } finally {
    harness.restore();
  }
});

test('[next] on the last song stops instead of relocating', () => {
  const harness = installHarness();
  try {
    harness.manager.updateCues([
      { name: 'ÚLTIMA', time: 0 },
      { name: '> FIM [next]', time: 64 },
    ]);
    harness.manager.updateTransport(64.1, true, 120);
    const actions = harness.manager.checkAutomations();
    assert.deepEqual(actions, [{ type: 'stop' }]);
    executeAutomationActions(actions, 64.1);
    assert.deepEqual(harness.calls, [['stop']]);
  } finally {
    harness.restore();
  }
});

test('[jump NAME] hands over to the named marker the same way', () => {
  const harness = installHarness();
  try {
    harness.manager.updateCues([
      { name: 'A', time: 0 },
      { name: 'A > Verse [jump Chorus]', time: 8 },
      { name: 'A > Chorus', time: 16 },
    ]);
    harness.manager.updateTransport(8.2, true, 120);
    const actions = harness.manager.checkAutomations();
    assert.deepEqual(actions, [{ type: 'jump_to', targetCue: 'A > Chorus', targetTime: 16 }]);
    executeAutomationActions(actions, 8.2);
    assert.deepEqual(harness.calls, [
      ['send', '/live/song/set/loop', [0]],
      ['position', 16],
    ]);
  } finally {
    harness.restore();
  }
});
