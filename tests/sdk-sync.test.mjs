import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';
import { syncFromSdkContext } from '../src/sync/sdk-sync.ts';

const originalCues = [
  { name: 'Previous Set Song [bpm 120]', time: 0 },
  { name: '> Verse', time: 16 },
];

function harness(t) {
  const saved = { ...bridgeState };
  const states = [];
  const manager = new SetlistManager();
  Object.assign(bridgeState, {
    manager,
    wsServer: { broadcastState: (state) => states.push(state) },
    profileManager: null,
    commandBus: null,
    songBook: null,
    lastCuesFingerprint: '__init__',
  });
  t.after(() => Object.assign(bridgeState, saved));
  const context = { application: { song: { cuePoints: originalCues } } };
  syncFromSdkContext(context);
  assert.equal(manager.getState().songs.length, 1);
  states.length = 0;
  return { context, manager, states };
}

test('SDK empty Set replaces the previous songs and publishes no jump targets', (t) => {
  const { context, manager, states } = harness(t);
  context.application.song = { tempo: 136, cuePoints: [] };

  syncFromSdkContext(context);

  assert.deepEqual(manager.getRawCues(), []);
  const state = manager.getState();
  assert.deepEqual(state.songs, []);
  assert.equal(state.activeSongIndex, -1);
  assert.equal(state.activeSectionIndex, -1);
  assert.equal(state.declaredTempo, null);
  assert.equal(states.length, 1);
  assert.deepEqual(states[0].songs, []);
});

test('SDK deleting the last locator in the same Set also clears the list', (t) => {
  const { context, manager } = harness(t);
  context.application.song.cuePoints = [];
  syncFromSdkContext(context);
  assert.deepEqual(manager.getState().songs, []);
});

test('SDK empty Set is stable across repeated polls and can reload the previous songs', (t) => {
  const { context, manager, states } = harness(t);
  context.application.song.cuePoints = [];
  syncFromSdkContext(context);
  assert.deepEqual(manager.getRawCues(), []);
  const emptyVersion = manager.getState().stateVersion;
  states.length = 0;

  for (let i = 0; i < 30; i++) syncFromSdkContext(context);
  assert.equal(manager.getState().stateVersion, emptyVersion);
  assert.equal(states.length, 0);

  context.application.song.cuePoints = originalCues;
  syncFromSdkContext(context);
  assert.equal(manager.getState().songs[0].title, 'Previous Set Song');
  assert.equal(states.length, 1);
});

test('SDK unavailable cue data preserves the last valid snapshot', (t) => {
  const { context, manager, states } = harness(t);
  const version = manager.getState().stateVersion;
  for (const cuePoints of [undefined, null]) {
    context.application.song.cuePoints = cuePoints;
    syncFromSdkContext(context);
  }
  assert.equal(manager.getState().songs[0].title, 'Previous Set Song');
  assert.equal(manager.getState().stateVersion, version);
  assert.equal(states.length, 0);
});

test('SDK read errors do not erase the last valid snapshot', (t) => {
  const { context, manager, states } = harness(t);
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  Object.defineProperty(context.application.song, 'cuePoints', {
    get() {
      throw new Error('document temporarily unavailable');
    },
  });
  syncFromSdkContext(context);
  assert.equal(manager.getState().songs[0].title, 'Previous Set Song');
  assert.equal(states.length, 0);
  assert.equal(errors.length, 1);
});
