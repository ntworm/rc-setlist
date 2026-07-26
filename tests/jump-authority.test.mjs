import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeState } from '../src/core/bridge-state.ts';
import { JumpScheduler } from '../src/core/next-downbeat-jump.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';
import { executeJumpCommand } from '../src/commands/handlers.ts';
import { handleJumpSchedulerEvent } from '../src/server-lifecycle.ts';

function installHarness() {
  const saved = {
    manager: bridgeState.manager,
    scheduler: bridgeState.scheduler,
    oscClient: bridgeState.oscClient,
    wsServer: bridgeState.wsServer,
  };
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A', time: 0 },
    { name: 'Song A > Verse', time: 16 },
    { name: 'Song A > Chorus [loop 2x]', time: 32 },
    { name: 'Song B', time: 64 },
  ]);
  manager.updateTransport(20, true, 120);
  manager.updateQuantization(0);
  const oscCalls = [];
  const payloads = [];
  const stateBroadcasts = [];
  bridgeState.manager = manager;
  bridgeState.scheduler = new JumpScheduler();
  bridgeState.oscClient = {
    jumpToCuePoint: (value) => oscCalls.push(['jump', value]),
    send: (address, args) => oscCalls.push(['send', address, args]),
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
    },
    stateBroadcasts,
  };
}

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
