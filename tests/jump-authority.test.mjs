import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeState } from '../src/core/bridge-state.ts';
import { JumpScheduler } from '../src/core/next-downbeat-jump.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';
import { CommandBus } from '../src/core/command-bus.ts';
import {
  countConfirmedTestSessionMarkers,
  executeCommandAction,
  executeJumpCommand,
} from '../src/commands/handlers.ts';
import { handleJumpSchedulerEvent } from '../src/server-lifecycle.ts';

function installHarness(initialQuantization = 0) {
  const saved = {
    manager: bridgeState.manager,
    scheduler: bridgeState.scheduler,
    oscClient: bridgeState.oscClient,
    wsServer: bridgeState.wsServer,
    commandBus: bridgeState.commandBus,
  };
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A', time: 0 },
    { name: 'Song A > Verse', time: 16 },
    { name: 'Song A > Chorus [loop 2x]', time: 32 },
    { name: 'Song B', time: 64 },
  ]);
  manager.updateTransport(20, true, 120);
  manager.updateQuantization(initialQuantization);
  const oscCalls = [];
  const payloads = [];
  const stateBroadcasts = [];
  bridgeState.manager = manager;
  bridgeState.scheduler = new JumpScheduler();
  bridgeState.oscClient = {
    jumpToCuePoint: (value) => oscCalls.push(['jump', value]),
    send: (address, args) => oscCalls.push(['send', address, args]),
    setClipTriggerQuantization: (value) => oscCalls.push(['quantization', value]),
  };
  bridgeState.wsServer = {
    broadcast: (payload) => payloads.push(payload),
    broadcastState: (state) => stateBroadcasts.push(state),
  };
  return {
    manager,
    oscCalls,
    payloads,
    restore() {
      bridgeState.manager = saved.manager;
      bridgeState.scheduler = saved.scheduler;
      bridgeState.oscClient = saved.oscClient;
      bridgeState.wsServer = saved.wsServer;
      bridgeState.commandBus = saved.commandBus;
    },
    stateBroadcasts,
  };
}

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
