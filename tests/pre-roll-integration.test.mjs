import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { executeCommandAction } from '../src/commands/handlers.ts';
import { bridgeState } from '../src/core/bridge-state.ts';
import { PreRollCoordinator } from '../src/core/pre-roll-coordinator.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';
import { registerOscListeners } from '../src/osc/registration.ts';
import { syncFromMcpInfo } from '../src/sync/mcp-sync.ts';

class FakeOsc extends EventEmitter {
  calls = [];

  setMetronome(value) { this.calls.push(['metronome', value]); }
  setCurrentSongTime(value) { this.calls.push(['position', value]); }
  getMetronome() { this.calls.push(['get_metronome']); }
  getCurrentSongTime() { this.calls.push(['get_position']); }
  startPlaying() { this.calls.push(['play']); }
  stopPlaying() { this.calls.push(['stop']); }
  send(address, args) { this.calls.push(['send', address, args]); }
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
  cues,
  targetBeat = 32,
  isPlaying = false,
  metronome = false,
  signatureNumerator = 4,
  signatureDenominator = 4,
} = {}) {
  const saved = {
    manager: bridgeState.manager,
    preRollCoordinator: bridgeState.preRollCoordinator,
    oscClient: bridgeState.oscClient,
    wsServer: bridgeState.wsServer,
    scheduler: bridgeState.scheduler,
    commandBus: bridgeState.commandBus,
    mcpFallbackSync: bridgeState.mcpFallbackSync,
    isCreatingTestSession: bridgeState.isCreatingTestSession,
    lastActiveSongTitle: bridgeState.lastActiveSongTitle,
  };
  const manager = new SetlistManager();
  manager.updateCues(cues ?? [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Target', time: 32 },
  ]);
  manager.updateTransport(targetBeat, isPlaying, 120);
  manager.updateSignature(signatureNumerator, signatureDenominator);
  manager.updateMetronome(metronome);
  manager.setPreRollEnabled(true);
  const osc = new FakeOsc();
  const states = [];
  const logs = [];
  bridgeState.manager = manager;
  bridgeState.preRollCoordinator = new PreRollCoordinator();
  bridgeState.oscClient = osc;
  bridgeState.wsServer = {
    broadcastState: (state) => states.push(state),
    broadcastLog: (message, level) => logs.push([message, level]),
    broadcast() {},
  };
  bridgeState.scheduler = null;
  bridgeState.commandBus = null;
  bridgeState.mcpFallbackSync = null;
  bridgeState.isCreatingTestSession = false;
  bridgeState.lastActiveSongTitle = 'Song A';

  return {
    logs,
    manager,
    osc,
    states,
    restore() {
      Object.assign(bridgeState, saved);
    },
  };
}

test('stopped Play sends Click, position and Play in one burst', async () => {
  const harness = installHarness();
  try {
    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [
      ['metronome', true],
      ['play'],
      ['position', 28],
    ]);
    assert.equal(bridgeState.preRollCoordinator.hasPending(), true);
    assert.doesNotMatch(JSON.stringify(harness.osc.calls), /record|arm/i);
  } finally {
    harness.restore();
  }
});

test('stopped Play uses the denominator-aware Count-In distance', async () => {
  const harness = installHarness({ signatureNumerator: 6, signatureDenominator: 8 });
  try {
    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [
      ['metronome', true],
      ['play'],
      ['position', 29],
    ]);
  } finally {
    harness.restore();
  }
});

test('an already-enabled Click is borrowed instead of re-sent', async () => {
  const harness = installHarness({ metronome: true });
  try {
    await executeCommandAction(command('play'));
    assert.deepEqual(harness.osc.calls, [
      ['play'],
      ['position', 28],
    ]);
  } finally {
    harness.restore();
  }
});

test('disabled mode and already-playing transport preserve the existing Play path', async () => {
  const disabled = installHarness();
  try {
    disabled.manager.setPreRollEnabled(false);
    await executeCommandAction(command('play'));
    assert.deepEqual(disabled.osc.calls, [['play']]);
    assert.equal(bridgeState.preRollCoordinator.hasPending(), false);
  } finally {
    disabled.restore();
  }

  const playing = installHarness({ isPlaying: true });
  try {
    await executeCommandAction(command('play'));
    assert.deepEqual(playing.osc.calls, [['play']]);
    assert.equal(bridgeState.preRollCoordinator.hasPending(), false);
  } finally {
    playing.restore();
  }
});

test('a second Play supersedes the armed pre-roll instead of being swallowed', async () => {
  const harness = installHarness();
  try {
    await executeCommandAction(command('play'));
    await executeCommandAction(command('play'));

    assert.deepEqual(harness.osc.calls, [
      ['metronome', true],
      ['play'],
      ['position', 28],
      ['play'],
      ['position', 28],
    ]);
  } finally {
    harness.restore();
  }
});

test('disabling the toggle during playback does not interrupt the active pre-roll', async () => {
  const harness = installHarness();
  try {
    await executeCommandAction(command('play'));
    harness.manager.updateTransport(29, true);
    await executeCommandAction(command('set_pre_roll', { value: false }));
    await executeCommandAction(command('play'));

    assert.equal(bridgeState.preRollCoordinator.hasPending(), true);
    assert.deepEqual(harness.osc.calls.at(-1), ['play']);
  } finally {
    harness.restore();
  }
});

test('set_pre_roll is local and broadcasts only server-owned state', async () => {
  const harness = installHarness();
  try {
    await executeCommandAction(command('set_pre_roll', { value: false }));
    assert.deepEqual(harness.osc.calls, []);
    assert.equal(harness.states.at(-1).preRollEnabled, false);
  } finally {
    harness.restore();
  }
});

test('explicit Stop cancels and restores the temporary Click before stopping', async () => {
  const harness = installHarness();
  try {
    await executeCommandAction(command('play'));
    await executeCommandAction(command('stop'));

    assert.deepEqual(harness.osc.calls.slice(-2), [
      ['metronome', false],
      ['stop'],
    ]);
    assert.equal(bridgeState.preRollCoordinator.hasPending(), false);
  } finally {
    harness.restore();
  }
});

test('Panic clears the armed pre-roll and hands the borrowed Click back', async () => {
  const harness = installHarness();
  try {
    await executeCommandAction(command('play'));
    await executeCommandAction(command('set_panic', { active: true }));

    assert.deepEqual(harness.osc.calls.slice(-2), [
      ['metronome', false],
      ['stop'],
    ]);
    assert.equal(bridgeState.preRollCoordinator.hasPending(), false);
  } finally {
    harness.restore();
  }
});

test('the count-in completes on position samples alone, with no metronome reply', async () => {
  const harness = installHarness();
  try {
    registerOscListeners();
    await executeCommandAction(command('play'));

    harness.osc.emit('current_song_time', 28);
    assert.equal(bridgeState.preRollCoordinator.hasPending(), true);
    harness.osc.emit('current_song_time', 32);

    assert.deepEqual(harness.osc.calls.at(-1), ['metronome', false]);
    assert.equal(bridgeState.preRollCoordinator.hasPending(), false);
  } finally {
    harness.restore();
  }
});

test('a stale target sample cannot restore Click before the count-in is observed', async () => {
  const harness = installHarness();
  try {
    registerOscListeners();
    await executeCommandAction(command('play'));

    harness.osc.emit('current_song_time', 32);
    harness.osc.emit('current_song_time', 40);
    assert.equal(bridgeState.preRollCoordinator.hasPending(), true);
    assert.deepEqual(harness.osc.calls.at(-1), ['position', 28]);
  } finally {
    harness.restore();
  }
});

test('a manual Click command during the count-in keeps the operator Click on', async () => {
  const harness = installHarness();
  try {
    registerOscListeners();
    await executeCommandAction(command('play'));
    harness.osc.emit('current_song_time', 28);
    await executeCommandAction(command('metronome', { value: true }));
    harness.osc.emit('current_song_time', 32);

    assert.deepEqual(harness.osc.calls.at(-1), ['metronome', true]);
    assert.equal(bridgeState.preRollCoordinator.hasPending(), false);
  } finally {
    harness.restore();
  }
});

test('a stopped transport observed from Live clears the armed pre-roll', async () => {
  const harness = installHarness();
  try {
    registerOscListeners();
    await executeCommandAction(command('play'));

    harness.osc.emit('is_playing_sample', false);

    assert.deepEqual(harness.osc.calls.at(-1), ['metronome', false]);
    assert.equal(bridgeState.preRollCoordinator.hasPending(), false);
  } finally {
    harness.restore();
  }
});

test('OSC observations restore temporary Click before target locator automation', async () => {
  const harness = installHarness({
    cues: [
      { name: 'Song A', time: 0 },
      { name: 'Song A > Target [click]', time: 32 },
    ],
  });
  try {
    registerOscListeners();
    await executeCommandAction(command('play'));

    harness.osc.emit('current_song_time', 28);
    harness.osc.emit('is_playing', true);
    harness.osc.emit('current_song_time', 32);

    assert.deepEqual(harness.osc.calls.slice(-2), [
      ['metronome', false],
      ['metronome', true],
    ]);
  } finally {
    harness.restore();
  }
});

test('MCP transport observations can complete and restore a pre-roll', async () => {
  const harness = installHarness();
  try {
    await executeCommandAction(command('play'));
    syncFromMcpInfo({
      tempo: 120,
      signature_numerator: 4,
      signature_denominator: 4,
      is_playing: true,
      current_song_time: 28,
    });
    syncFromMcpInfo({
      tempo: 120,
      signature_numerator: 4,
      signature_denominator: 4,
      is_playing: true,
      current_song_time: 32,
    });

    assert.deepEqual(harness.osc.calls.at(-1), ['metronome', false]);
    assert.equal(bridgeState.preRollCoordinator.hasPending(), false);
  } finally {
    harness.restore();
  }
});
