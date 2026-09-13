import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeState } from '../src/core/bridge-state.ts';
import {
  clearExtensionContext,
  getExtensionContext,
  setExtensionContext,
} from '../src/context.ts';
import { JumpScheduler } from '../src/core/next-downbeat-jump.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';
import { CommandBus } from '../src/core/command-bus.ts';
import {
  executeCommandAction,
  executeJumpCommand,
} from '../src/commands/handlers.ts';
import { handleJumpSchedulerEvent } from '../src/server-lifecycle.ts';

function installHarness(initialQuantization = 0, sdkTempoSetter = null) {
  const saved = {
    manager: bridgeState.manager,
    scheduler: bridgeState.scheduler,
    oscClient: bridgeState.oscClient,
    wsServer: bridgeState.wsServer,
    commandBus: bridgeState.commandBus,
    extensionContext: getExtensionContext(),
  };
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A', time: 0 },
    { name: 'Song A > Verse', time: 16 },
    { name: 'Song A > Chorus [loop 2x]', time: 32 },
    { name: 'Song B [bpm 90]', time: 64 },
    { name: 'Song B > Verse', time: 80 },
    { name: 'Song B > Chorus [bpm 105]', time: 96 },
  ]);
  manager.updateTransport(20, true, 120);
  manager.updateQuantization(initialQuantization);
  const calls = [];
  const payloads = [];
  const stateBroadcasts = [];
  bridgeState.manager = manager;
  bridgeState.scheduler = new JumpScheduler();
  bridgeState.oscClient = {
    jumpToCuePoint: (value) => calls.push(['jump', value]),
    send: (address, args) => calls.push(
      address === '/live/song/set/tempo'
        ? ['osc-tempo', args[0]?.value]
        : ['send', address, args],
    ),
    setClipTriggerQuantization: (value) => calls.push(['quantization', value]),
    setMetronome: (value) => calls.push(['metronome', value]),
  };
  bridgeState.wsServer = {
    broadcast: (payload) => payloads.push(payload),
    broadcastState: (state) => stateBroadcasts.push(state),
  };
  // These tests assert the tempo-write path itself, which ships disabled.
  bridgeState.writeTempoOnJump = true;
  clearExtensionContext();
  if (sdkTempoSetter) {
    setExtensionContext({ application: { song: { set tempo(value) { sdkTempoSetter(value, calls); } } } });
  }
  return {
    manager,
    calls,
    oscCalls: calls,
    payloads,
    restore() {
      bridgeState.writeTempoOnJump = false;
      bridgeState.manager = saved.manager;
      bridgeState.scheduler = saved.scheduler;
      bridgeState.oscClient = saved.oscClient;
      bridgeState.wsServer = saved.wsServer;
      bridgeState.commandBus = saved.commandBus;
      if (saved.extensionContext) setExtensionContext(saved.extensionContext);
      else clearExtensionContext();
    },
    stateBroadcasts,
  };
}

test('immediate jumps resolve the destination section BPM before its cue jump', () => {
  const harness = installHarness(0, (value, calls) => calls.push(['sdk-tempo', value]));
  try {
    executeJumpCommand({ songIndex: 1, sectionIndex: null });
    assert.deepEqual(harness.calls.slice(0, 2), [['sdk-tempo', 90], ['jump', 3]]);

    harness.calls.length = 0;
    executeJumpCommand({ songIndex: 1, sectionIndex: 0 });
    assert.deepEqual(harness.calls.slice(0, 2), [['sdk-tempo', 90], ['jump', 4]]);

    harness.calls.length = 0;
    executeJumpCommand({ songIndex: 1, sectionIndex: 1 });
    assert.deepEqual(harness.calls.slice(0, 2), [['sdk-tempo', 105], ['jump', 5]]);
  } finally {
    harness.restore();
  }
});

test('an untagged destination does not send pre-jump tempo', () => {
  const harness = installHarness(0, (value, calls) => calls.push(['sdk-tempo', value]));
  try {
    executeJumpCommand({ songIndex: 0, sectionIndex: 0 });
    assert.equal(harness.calls.some(([kind]) => kind === 'sdk-tempo' || kind === 'osc-tempo'), false);
    assert.deepEqual(harness.calls.at(0), ['jump', 1]);
  } finally {
    harness.restore();
  }
});

test('a quantized jump is handed to Live when it is requested, not on the landing sample', () => {
  // Live quantizes a cue jump requested while playing to its next grid line.
  // The request used to be sent when this side's clock passed the landing
  // beat — just past the grid line — so Live landed it a full quantization
  // period after the beat the page had announced. Owner's set, 2026-09-08:
  // a jump requested at 872.3 landed at 876.0; one requested at 876.x lands
  // at 880.
  const harness = installHarness(4);
  try {
    executeJumpCommand({ songIndex: 1, sectionIndex: 1 });
    assert.deepEqual(harness.calls, [['jump', 5]]);
    assert.equal(bridgeState.scheduler.hasPending(), true, 'the landing is still tracked for the page');

    handleJumpSchedulerEvent({
      type: 'executed',
      pending: bridgeState.scheduler.getPending(),
    });
    assert.deepEqual(harness.calls.filter((call) => call[0] === 'jump'), [['jump', 5]], 'the landing sends no second jump');
    assert.deepEqual(harness.payloads.at(-1), { type: 'jump_executed', songIndex: 1, sectionIndex: 1 });
  } finally {
    harness.restore();
  }
});

test('the landing of a quantized jump writes the destination tempo, after the cue jump already went out', () => {
  const harness = installHarness(4, (value, calls) => calls.push(['sdk-tempo', value]));
  try {
    executeJumpCommand({ songIndex: 1, sectionIndex: 1 });
    assert.deepEqual(harness.calls, [['jump', 5]]);

    handleJumpSchedulerEvent({
      type: 'executed',
      pending: {
        songIndex: 1,
        sectionIndex: 1,
        cueName: 'Song B > Chorus',
        cueIndex: 5,
        targetTime: 96,
        landingTime: 24,
        scheduledAt: 0,
      },
    });
    assert.deepEqual(harness.calls.slice(0, 2), [['jump', 5], ['sdk-tempo', 105]]);
    assert.equal(harness.calls.filter((call) => call[0] === 'jump').length, 1);
  } finally {
    harness.restore();
  }
});

test('a replaced scheduled jump sends no pre-jump tempo', () => {
  const harness = installHarness(4, (value, calls) => calls.push(['sdk-tempo', value]));
  try {
    handleJumpSchedulerEvent({
      type: 'replaced',
      pending: {
        songIndex: 1,
        sectionIndex: 1,
        cueName: 'Song B > Chorus',
        cueIndex: 5,
        targetTime: 96,
        landingTime: 24,
        scheduledAt: 0,
      },
    });
    assert.deepEqual(harness.calls, []);
  } finally {
    harness.restore();
  }
});

test('unavailable or throwing SDK tempo setters fall back to OSC before the cue jump', () => {
  const unavailable = installHarness();
  try {
    executeJumpCommand({ songIndex: 1, sectionIndex: null });
    assert.deepEqual(unavailable.calls.slice(0, 2), [['osc-tempo', 90], ['jump', 3]]);
  } finally {
    unavailable.restore();
  }

  const throwing = installHarness(0, () => { throw new Error('SDK unavailable'); });
  try {
    executeJumpCommand({ songIndex: 1, sectionIndex: null });
    assert.deepEqual(throwing.calls.slice(0, 2), [['osc-tempo', 90], ['jump', 3]]);
  } finally {
    throwing.restore();
  }
});

test('quantization request becomes local scheduler authority without an OSC reply', async () => {
  const harness = installHarness(4);
  try {
    await executeCommandAction({
      commandId: 'quantization-none',
      type: 'set_quantization',
      payload: { value: 0 },
      sourceClientId: 'test',
      createdAt: Date.now(),
      status: 'sent',
      retryCount: 0,
      maxRetries: 3,
      timeoutMs: 3000,
    });

    assert.deepEqual(harness.oscCalls.at(-1), ['quantization', 0]);
    assert.equal(harness.manager.getState().clipTriggerQuantization, 0);
    assert.equal(harness.stateBroadcasts.at(-1)?.clipTriggerQuantization, 0);

    executeJumpCommand({ songIndex: 0, sectionIndex: 1 });
    assert.equal(harness.manager.getState().clipTriggerQuantization, 0);
    assert.equal(bridgeState.scheduler.hasPending(), false);
    assert.equal(harness.oscCalls.some(([kind]) => kind === 'jump'), true);
  } finally {
    harness.restore();
  }
});

test('quantization command confirms through optimistic observable state', async () => {
  const harness = installHarness(4);
  const bus = new CommandBus(harness.manager, { log() {} });
  bridgeState.commandBus = bus;
  try {
    const command = bus.registerCommand('quantization-confirmed', 'set_quantization', { value: 0 }, 'test');
    const settled = new Promise((resolve) => bus.once('command_settled', resolve));
    bus.dispatch(command, () => executeCommandAction(command));
    const result = await settled;

    assert.equal(result.status, 'confirmed');
    assert.equal(bus.getPending().length, 0);
    assert.equal(harness.manager.getState().clipTriggerQuantization, 0);
  } finally {
    bus.stop();
    harness.restore();
  }
});

test('immediate jump waits for observed Ableton transport before changing active state', () => {
  const harness = installHarness();
  try {
    executeJumpCommand({ songIndex: 0, sectionIndex: 1 });
    assert.equal(harness.manager.getState().currentSongTime, 20);
    assert.equal(harness.manager.getState().activeSectionIndex, 0);
    assert.equal(harness.stateBroadcasts.length, 0);
    assert.deepEqual(harness.payloads.at(-1), { type: 'jump_executed', songIndex: 0, sectionIndex: 1 });
    assert.equal(harness.oscCalls.some(([kind]) => kind === 'jump'), true);
    assert.equal(harness.oscCalls.some((call) => call[1] === '/live/song/set/loop_start'), true);
  } finally {
    harness.restore();
  }
});

test('scheduled execution waits for observed Ableton transport before changing active state', () => {
  const harness = installHarness();
  try {
    handleJumpSchedulerEvent({
      type: 'executed',
      pending: {
        songIndex: 0,
        sectionIndex: 1,
        cueName: 'Song A > Chorus',
        cueIndex: 2,
        targetTime: 32,
        landingTime: 24,
        scheduledAt: 0,
      },
    });
    assert.equal(harness.manager.getState().currentSongTime, 20);
    assert.equal(harness.manager.getState().activeSectionIndex, 0);
    assert.equal(harness.stateBroadcasts.length, 0);
    assert.deepEqual(harness.payloads.at(-1), { type: 'jump_executed', songIndex: 0, sectionIndex: 1 });
    assert.equal(harness.oscCalls.some((call) => call[1] === '/live/song/set/loop_start'), true);
  } finally {
    harness.restore();
  }
});

test('metronome toggle request becomes local authority without an OSC reply', async () => {
  const harness = installHarness(4);
  try {
    await executeCommandAction({
      commandId: 'metronome-toggle',
      type: 'metronome',
      payload: { value: true },
      sourceClientId: 'test',
      createdAt: Date.now(),
      status: 'sent',
      retryCount: 0,
      maxRetries: 3,
      timeoutMs: 3000,
    });

    assert.deepEqual(harness.oscCalls.at(-1), ['metronome', true]);
    assert.equal(harness.manager.getState().metronome, true);
    assert.equal(harness.stateBroadcasts.at(-1)?.metronome, true);
  } finally {
    harness.restore();
  }
});

test('metronome command confirms through optimistic observable state', async () => {
  const harness = installHarness(4);
  const bus = new CommandBus(harness.manager, { log() {} });
  bridgeState.commandBus = bus;
  try {
    const command = bus.registerCommand('metronome-confirmed', 'metronome', { value: true }, 'test');
    const settled = new Promise((resolve) => bus.once('command_settled', resolve));
    bus.dispatch(command, () => executeCommandAction(command));
    const result = await settled;

    assert.equal(result.status, 'confirmed');
    assert.equal(bus.getPending().length, 0);
    assert.equal(harness.manager.getState().metronome, true);
  } finally {
    bus.stop();
    harness.restore();
  }
});

test('a jump writes no tempo by default, because writing overrides Live automation', () => {
  const harness = installHarness(0, (value, calls) => calls.push(['sdk-tempo', value]));
  try {
    // installHarness opts in for the tests that exercise the write path.
    // Ship default is off; assert that default here.
    bridgeState.writeTempoOnJump = false;
    bridgeState.manager.updateCues([
      { name: 'A [bpm 120]', time: 0 },
      { name: 'B [bpm 90]', time: 120 },
    ]);
    bridgeState.manager.updateArrangementEndTime(240);
    harness.calls.length = 0;
    executeJumpCommand({ songIndex: 1, sectionIndex: null });
    const tempoWrites = harness.calls.filter(([kind]) => kind === 'sdk-tempo');
    assert.deepEqual(tempoWrites, [], 'no tempo may be written while the setting is off');
    assert.equal(harness.calls.some(([kind]) => kind === 'jump'), true, 'the jump itself must still happen');
  } finally {
    harness.restore();
  }
});

test('a jump writes no tempo once tempo automation is suspected, even when opted in', () => {
  const harness = installHarness(0, (value, calls) => calls.push(['sdk-tempo', value]));
  try {
    bridgeState.manager.updateCues([
      { name: 'A [bpm 120]', time: 0 },
      { name: 'B [bpm 90]', time: 120 },
    ]);
    bridgeState.manager.updateArrangementEndTime(240);

    // Live reports a tempo the tag does not declare: the arrangement owns it.
    bridgeState.manager.updateTransport(10, true, 154);
    assert.equal(bridgeState.manager.isTempoAutomationSuspected(), true);

    harness.calls.length = 0;
    executeJumpCommand({ songIndex: 1, sectionIndex: null });
    const tempoWrites = harness.calls.filter(([kind]) => kind === 'sdk-tempo');
    assert.deepEqual(tempoWrites, [], 'an opted-in write must still yield to observed automation');
    assert.equal(harness.calls.some(([kind]) => kind === 'jump'), true, 'the jump itself must still happen');
  } finally {
    harness.restore();
  }
});
