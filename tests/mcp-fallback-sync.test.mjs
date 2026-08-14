import assert from 'node:assert/strict';
import test from 'node:test';

import { McpFallbackSync } from '../src/integration/mcp-fallback-sync.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';
import { EventEmitter } from 'node:events';
import { bridgeState } from '../src/core/bridge-state.ts';
import { registerOscListeners } from '../src/osc/registration.ts';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('MCP fallback is single-flight and slow polls duration without a backlog', async () => {
  let now = 10_000;
  const firstSession = deferred();
  const calls = [];
  const client = {
    call(type) {
      calls.push(type);
      if (type === 'get_session_info') return firstSession.promise;
      if (type === 'get_song_length') return Promise.resolve({ song_length: 384 });
      throw new Error(`unexpected ${type}`);
    },
  };
  const sessions = [];
  const lengths = [];
  const sync = new McpFallbackSync({
    client,
    now: () => now,
    onSessionInfo: (info) => sessions.push(info),
    onSongLength: (length) => lengths.push(length),
    getProjectMetadataRequestToken: () => null,
  });

  const firstTick = sync.tick();
  assert.equal(await sync.tick(), false);
  assert.deepEqual(calls, ['get_session_info']);

  firstSession.resolve({ current_song_time: 24, is_playing: true, tempo: 120 });
  assert.equal(await firstTick, true);
  assert.deepEqual(calls, ['get_session_info', 'get_song_length']);
  assert.equal(sessions.length, 1);
  assert.deepEqual(lengths, [384]);
  assert.equal(sync.getSnapshot().lastResponseTime, now);

  now += 500;
  client.call = (type) => {
    calls.push(type);
    return Promise.resolve({ current_song_time: 25, is_playing: true, tempo: 120 });
  };
  assert.equal(await sync.tick(), true);
  assert.equal(calls.filter((type) => type === 'get_song_length').length, 1);
});

test('MCP song length populates total duration when OSC never replies', async () => {
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A [bpm 120]', time: 0 },
    { name: 'Song B [bpm 120]', time: 64 },
  ]);
  const client = {
    async call(type) {
      if (type === 'get_session_info') {
        return { current_song_time: 0, is_playing: false, tempo: 120 };
      }
      if (type === 'get_song_length') return { song_length: 128 };
      throw new Error(`unexpected ${type}`);
    },
  };
  const sync = new McpFallbackSync({
    client,
    now: () => 20_000,
    onSessionInfo: () => {},
    onSongLength: (length) => manager.updateArrangementEndTime(length),
    getProjectMetadataRequestToken: () => null,
  });

  await sync.tick();
  const state = manager.getState();
  assert.equal(state.arrangementEndTime, 128);
  assert.equal(state.totalDurationSeconds, 64);
});

test('MCP metadata snapshots its request token and continues polling while authorized', async () => {
  let requestToken = 'session-a:scope-a';
  let now = 30_000;
  const calls = [];
  const metadata = [];
  const client = {
    async call(type) {
      calls.push(type);
      if (type === 'get_session_info') return { current_song_time: 0, is_playing: false, tempo: 120 };
      if (type === 'get_song_length') return { song_length: 128 };
      if (type === 'get_project_metadata') {
        return { song_name: 'Show', file_path: 'C:\\Shows\\Show\\Show.als' };
      }
      throw new Error(`unexpected ${type}`);
    },
  };
  const sync = new McpFallbackSync({
    client,
    now: () => now,
    onSessionInfo: () => {},
    onSongLength: () => {},
    getProjectMetadataRequestToken: () => requestToken,
    onProjectMetadata: (value, token) => {
      metadata.push({ value, token });
    },
  });

  await sync.tick();
  assert.equal(metadata.length, 1);
  assert.equal(metadata[0].token, 'session-a:scope-a');
  requestToken = 'session-b:scope-b';
  now += 5_000;
  await sync.tick();
  assert.equal(calls.filter((type) => type === 'get_project_metadata').length, 2);
  assert.equal(metadata[1].token, 'session-b:scope-b');
});

test('MCP metadata callback receives the token captured before a deferred response', async () => {
  let requestToken = 'session-a:scope-a';
  const response = deferred();
  let receivedToken = null;
  const sync = new McpFallbackSync({
    client: {
      call(type) {
        if (type === 'get_session_info') return Promise.resolve({ current_song_time: 0, is_playing: false, tempo: 120 });
        if (type === 'get_song_length') return Promise.resolve({ song_length: 128 });
        if (type === 'get_project_metadata') return response.promise;
        throw new Error(`unexpected ${type}`);
      },
    },
    now: () => 50_000,
    onSessionInfo: () => {},
    onSongLength: () => {},
    getProjectMetadataRequestToken: () => requestToken,
    onProjectMetadata: (_metadata, token) => { receivedToken = token; },
  });

  const tick = sync.tick();
  await new Promise((resolve) => setImmediate(resolve));
  requestToken = 'session-b:scope-b';
  response.resolve({ song_name: 'Show', file_path: 'C:\\Shows\\Show\\Show.als' });
  await tick;
  assert.equal(receivedToken, 'session-a:scope-a');
});

test('slow MCP calls do not make an old transport sample look fresh', async () => {
  let now = 35_000;
  const sync = new McpFallbackSync({
    client: {
      async call(type) {
        if (type === 'get_session_info') {
          return { current_song_time: 12, is_playing: true, tempo: 120 };
        }
        if (type === 'get_song_length') {
          now += 800;
          return { song_length: 128 };
        }
        throw new Error(`unexpected ${type}`);
      },
    },
    now: () => now,
    onSessionInfo: () => {},
    onSongLength: () => {},
    getProjectMetadataRequestToken: () => null,
  });

  await sync.tick();
  const snapshot = sync.getSnapshot();
  assert.equal(snapshot.timeSinceLastResponseMs, 0);
  assert.equal(snapshot.timeSinceLastSessionInfoMs, 800);
});

test('MCP fallback backs off after a connection failure instead of reconnecting every timer tick', async () => {
  let now = 40_000;
  let calls = 0;
  const sync = new McpFallbackSync({
    client: {
      async call() {
        calls++;
        throw new Error('bridge unavailable');
      },
    },
    now: () => now,
    retryIntervalMs: 1_000,
    onSessionInfo: () => {},
    onSongLength: () => {},
    getProjectMetadataRequestToken: () => null,
  });

  await assert.rejects(sync.tick(), /bridge unavailable/);
  now += 100;
  assert.equal(await sync.tick(), false);
  assert.equal(calls, 1);

  now += 900;
  await assert.rejects(sync.tick(), /bridge unavailable/);
  assert.equal(calls, 2);
});

test('fresh MCP transport observation suppresses an older OSC playhead sample', () => {
  const saved = {
    manager: bridgeState.manager,
    scheduler: bridgeState.scheduler,
    oscClient: bridgeState.oscClient,
    wsServer: bridgeState.wsServer,
    mcpFallbackSync: bridgeState.mcpFallbackSync,
    isCreatingTestSession: bridgeState.isCreatingTestSession,
  };
  const manager = new SetlistManager();
  manager.updateTransport(48, true, 120);
  const osc = new EventEmitter();
  const schedulerTicks = [];
  let responseAgeMs = 100;

  bridgeState.manager = manager;
  bridgeState.scheduler = { tick: (time) => schedulerTicks.push(time) };
  bridgeState.oscClient = osc;
  bridgeState.wsServer = null;
  bridgeState.isCreatingTestSession = false;
  bridgeState.mcpFallbackSync = {
    getSnapshot: () => ({
      inFlight: false,
      lastResponseTime: 1,
      timeSinceLastResponseMs: responseAgeMs,
      lastSessionInfoTime: 1,
      timeSinceLastSessionInfoMs: responseAgeMs,
    }),
  };

  try {
    registerOscListeners();
    osc.emit('current_song_time', 47.75);
    assert.equal(manager.getState().currentSongTime, 48);
    assert.deepEqual(schedulerTicks, []);

    responseAgeMs = 600;
    osc.emit('current_song_time', 49);
    assert.equal(manager.getState().currentSongTime, 49);
    assert.deepEqual(schedulerTicks, [49]);
  } finally {
    bridgeState.manager = saved.manager;
    bridgeState.scheduler = saved.scheduler;
    bridgeState.oscClient = saved.oscClient;
    bridgeState.wsServer = saved.wsServer;
    bridgeState.mcpFallbackSync = saved.mcpFallbackSync;
    bridgeState.isCreatingTestSession = saved.isCreatingTestSession;
  }
});
