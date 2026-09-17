import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MockOSCServer } from './mocks/mock-osc-server.ts';
import { OSCClient } from '../src/integration/osc-client.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';
import { JumpScheduler } from '../src/core/next-downbeat-jump.ts';
import { registerOscListeners } from '../src/osc/registration.ts';

/**
 * The transport path a set-up without the Ableton MCP uses: AbletonOSC alone,
 * position polled every 100ms, automations evaluated on each sample in
 * `registerOscListeners`. The owner's own machine runs the MCP and so never
 * exercises this path; it had no end-to-end coverage until a [next] marker was
 * reported as doing nothing on a colleague's machine.
 */
test(
  'OSC-only transport: an end-of-song [next] hands over to the next song at the marker',
  { timeout: 10_000 },
  async (t) => {
    const bind = dgram.Socket.prototype.bind;
    t.mock.method(dgram.Socket.prototype, 'bind', function (port, ...args) {
      // Never AbletonOSC's command port, never the extension's reply ports.
      assert.strictEqual(typeof port === 'object' ? port.port : port, 0);
      return bind.call(this, port, ...args);
    });

    const saved = {
      manager: bridgeState.manager,
      scheduler: bridgeState.scheduler,
      oscClient: bridgeState.oscClient,
      wsServer: bridgeState.wsServer,
      profileManager: bridgeState.profileManager,
      mcpFallbackSync: bridgeState.mcpFallbackSync,
      lastActiveSongTitle: bridgeState.lastActiveSongTitle,
      lastCuesFingerprint: bridgeState.lastCuesFingerprint,
    };
    const previousSocket = globalThis.abletonOSCSocket;
    const previousListeners = globalThis.abletonOSCListeners;
    const profileDir = mkdtempSync(join(tmpdir(), 'rc-setlist-osc-transition-'));

    const mock = new MockOSCServer();
    mock['cues'] = [
      { name: 'MÚSICA 1 [bpm 120]', time: 0 },
      { name: '> VERSO', time: 16 },
      { name: '> FIM [next]', time: 64 },
      { name: 'MÚSICA 2', time: 68 },
    ];
    const client = new OSCClient();
    // A silent socket stands in for a stock AbletonOSC on the bridge port, so the
    // probe times out and the client takes the legacy path — and never sends a
    // byte towards the real bridge port on this machine.
    const silentBridge = dgram.createSocket('udp4');
    silentBridge.bind(0, '127.0.0.1');
    await once(silentBridge, 'listening');
    const socket = dgram.createSocket('udp4');
    const timers = [];
    const logs = [];

    try {
      const port = await mock.start();
      client.configureBridge({
        bridgePort: silentBridge.address().port,
        probeTimeoutMs: 100,
        legacyTargetPort: port,
      });
      const listening = once(socket, 'listening', { signal: AbortSignal.timeout(1_000) });
      socket.bind(0, '127.0.0.1');
      await listening;
      globalThis.abletonOSCSocket = socket;
      globalThis.abletonOSCListeners = new Set();
      socket.on('message', (message) => {
        for (const listener of globalThis.abletonOSCListeners ?? []) listener(message);
      });

      bridgeState.manager = new SetlistManager();
      bridgeState.scheduler = new JumpScheduler();
      bridgeState.oscClient = client;
      bridgeState.mcpFallbackSync = null;
      bridgeState.lastActiveSongTitle = null;
      bridgeState.lastCuesFingerprint = '__init__';
      bridgeState.profileManager = {
        getActivePaths: () => ({
          root: profileDir,
          metadata: join(profileDir, 'profile.json'),
          lyrics: join(profileDir, 'lyrics'),
          customOrder: join(profileDir, 'custom-order.json'),
          songBook: join(profileDir, 'song-book.json'),
          exports: join(profileDir, 'exports'),
          audio: join(profileDir, 'audio'),
        }),
      };
      bridgeState.wsServer = {
        broadcast() {},
        broadcastState() {},
        broadcastLog: (message, level) => logs.push([level, message]),
      };

      await client.start();
      registerOscListeners({});
      client.startPropertyListeners();
      const cuesLoaded = once(client, 'cue_points', { signal: AbortSignal.timeout(2_000) });
      client.getCuePoints();
      await cuesLoaded;
      assert.deepEqual(
        bridgeState.manager.getState().songs.map((s) => s.title),
        ['MÚSICA 1', 'MÚSICA 2'],
      );

      // Live plays from beat 60 at 120 BPM: 0.2 beat per 100ms sample.
      mock['currentSongTime'] = 60;
      const playing = once(client, 'is_playing', { signal: AbortSignal.timeout(2_000) });
      client.startPlaying();
      await playing;
      timers.push(
        setInterval(() => {
          if (mock['isPlaying'])
            mock['currentSongTime'] = Math.round((mock['currentSongTime'] + 0.2) * 100) / 100;
        }, 100),
      );
      timers.push(setInterval(() => client.getCurrentSongTime(), 100));

      const positions = [];
      client.on('current_song_time', (time) => positions.push(time));
      const deadline = Date.now() + 6_000;
      while (Date.now() < deadline) {
        const state = bridgeState.manager.getState();
        if (state.activeSongIndex === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const state = bridgeState.manager.getState();
      assert.equal(
        state.activeSongIndex,
        1,
        `never reached MÚSICA 2; positions: ${positions.join(' ')}`,
      );
      const lastBeforeJump = positions.filter((p) => p < 68).at(-1);
      assert.ok(
        lastBeforeJump >= 64 && lastBeforeJump < 65,
        `crossed the marker at ${lastBeforeJump}`,
      );
      const firstAfterJump = positions.find((p) => p >= 68);
      assert.ok(firstAfterJump < 69, `entered MÚSICA 2 at its first beat, not ${firstAfterJump}`);
      assert.equal(logs.filter(([, message]) => message.includes('NEXT triggered')).length, 1);
    } finally {
      for (const timer of timers) clearInterval(timer);
      await client.stop();
      await mock.stop();
      try {
        socket.close();
      } catch {
        // swallow: nothing to do here on purpose
      }
      try {
        silentBridge.close();
      } catch {
        // swallow: nothing to do here on purpose
      }
      if (previousSocket === undefined) delete globalThis.abletonOSCSocket;
      else globalThis.abletonOSCSocket = previousSocket;
      if (previousListeners === undefined) delete globalThis.abletonOSCListeners;
      else globalThis.abletonOSCListeners = previousListeners;
      Object.assign(bridgeState, saved);
      rmSync(profileDir, { recursive: true, force: true });
    }
  },
);

/**
 * The marker editor's rename used to be MCP-only, which meant nobody but the
 * owner could use it: RC Bridge and AbletonOSC both rename a cue by its index
 * in Live's chronological list, so the OSC path does it too, and reads the
 * list back to confirm.
 */
test(
  'OSC-only transport: edit_locator renames the cue through RC Bridge and confirms it',
  { timeout: 10_000 },
  async (t) => {
    const bind = dgram.Socket.prototype.bind;
    t.mock.method(dgram.Socket.prototype, 'bind', function (port, ...args) {
      assert.strictEqual(typeof port === 'object' ? port.port : port, 0);
      return bind.call(this, port, ...args);
    });
    const { executeCommandAction } = await import('../src/commands/handlers/index.ts');

    const saved = {
      manager: bridgeState.manager,
      scheduler: bridgeState.scheduler,
      oscClient: bridgeState.oscClient,
      wsServer: bridgeState.wsServer,
      profileManager: bridgeState.profileManager,
      mcpClient: bridgeState.mcpClient,
      mcpFallbackSync: bridgeState.mcpFallbackSync,
      lastActiveSongTitle: bridgeState.lastActiveSongTitle,
      lastCuesFingerprint: bridgeState.lastCuesFingerprint,
    };
    const previousSocket = globalThis.abletonOSCSocket;
    const previousListeners = globalThis.abletonOSCListeners;
    delete globalThis.abletonOSCSocket;
    delete globalThis.abletonOSCListeners;

    const mock = new MockOSCServer({ identifyAsBridge: true });
    mock['cues'] = [
      { name: 'MÚSICA 1', time: 0 },
      { name: '> VERSO', time: 16 },
      { name: 'MÚSICA 2', time: 64 },
    ];
    const client = new OSCClient();
    const logs = [];

    try {
      const port = await mock.start();
      client.configureBridge({ bridgePort: port, probeTimeoutMs: 800, legacyListenPorts: [0] });
      bridgeState.manager = new SetlistManager();
      bridgeState.scheduler = new JumpScheduler();
      bridgeState.oscClient = client;
      bridgeState.mcpClient = null;
      bridgeState.mcpFallbackSync = null;
      bridgeState.lastActiveSongTitle = null;
      bridgeState.lastCuesFingerprint = '__init__';
      bridgeState.profileManager = null;
      bridgeState.wsServer = {
        broadcast() {},
        broadcastState() {},
        broadcastLog: (message, level) => logs.push([level, message]),
      };

      await client.start();
      registerOscListeners({});
      const cuesLoaded = once(client, 'cue_points', { signal: AbortSignal.timeout(2_000) });
      client.getCuePoints();
      await cuesLoaded;

      await executeCommandAction({
        commandId: 'rename-1',
        type: 'edit_locator',
        payload: { time: 16, name: '> VERSO [loop 2x]' },
        sourceClientId: 'test',
        createdAt: Date.now(),
        status: 'created',
        retryCount: 0,
      });
      assert.deepEqual(
        mock['cues'].map((c) => c.name),
        ['MÚSICA 1', '> VERSO [loop 2x]', 'MÚSICA 2'],
      );
      assert.ok(
        logs.some(([, message]) => message === 'Locator edited at 16.'),
        `logs: ${JSON.stringify(logs)}`,
      );

      // A cue the manager does not know cannot be renamed, and says so.
      await assert.rejects(
        executeCommandAction({
          commandId: 'rename-2',
          type: 'edit_locator',
          payload: { time: 99, name: 'Nowhere' },
          sourceClientId: 'test',
          createdAt: Date.now(),
          status: 'created',
          retryCount: 0,
        }),
        /No cue point found at time 99/,
      );
    } finally {
      await client.stop();
      await mock.stop();
      if (previousSocket !== undefined) globalThis.abletonOSCSocket = previousSocket;
      if (previousListeners !== undefined) globalThis.abletonOSCListeners = previousListeners;
      Object.assign(bridgeState, saved);
    }
  },
);
