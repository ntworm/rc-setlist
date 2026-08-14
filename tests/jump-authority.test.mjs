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
  countConfirmedTestSessionMarkers,
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

test('scheduled execution applies SDK tempo immediately before the cue jump', () => {
  const harness = installHarness(4, (value, calls) => calls.push(['sdk-tempo', value]));
  try {
    executeJumpCommand({ songIndex: 1, sectionIndex: 1 });
    assert.deepEqual(harness.calls, []);

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
    assert.deepEqual(harness.calls.slice(0, 2), [['sdk-tempo', 105], ['jump', 5]]);
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

test('test-session markers require MCP confirmation or exact Ableton observation', () => {
  const expected = [
    { name: 'A', time: 0 },
    { name: 'B', time: 8 },
    { name: 'C', time: 16 },
    { name: 'D', time: 24 },
  ];
  const mcpResults = [
    { name: 'A', time: 0, confirmed: true },
    { name: 'B', time: 8, confirmed: false },
    { name: 'wrong-name', time: 16, confirmed: true },
  ];
  const observedCues = [
    { name: 'B', time: 8 },
    { name: 'C', time: 16.000001 },
    { name: 'D', time: 25 },
  ];

  assert.equal(
    countConfirmedTestSessionMarkers(expected, mcpResults, observedCues),
    2,
  );
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
