import { test } from 'node:test';
import assert from 'node:assert';
import { MockOSCServer } from './mocks/mock-osc-server.ts';
import { OSCClient } from '../src/integration/osc-client.ts';

test('OSC integration: client communicates with mock server', async () => {
  const mockServer = new MockOSCServer();
  const client = new OSCClient();

  try {
    try {
      await mockServer.start();
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') {
        console.warn('[Test] Skipping OSC integration test: Port 11000 is in use (Ableton Live is likely open).');
        return;
      }
      throw err;
    }
    try {
      await client.start();
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') {
        console.warn('[Test] Skipping OSC integration test: Port 11001 is in use (another instance of the bridge is likely running).');
        return;
      }
      throw err;
    }
    // 1. Test getTempo
    const tempoPromise = new Promise((resolve) => {
      client.once('tempo', (bpm) => {
        resolve(bpm);
      });
    });
    client.getTempo();
    const bpm = await tempoPromise;
    assert.strictEqual(bpm, 120);

    // 2. Test getCuePoints
    const cuesPromise = new Promise((resolve) => {
      client.once('cue_points', (cues) => {
        resolve(cues);
      });
    });
    client.getCuePoints();
    const cues = await cuesPromise;
    assert.strictEqual(cues.length, 5);
    assert.strictEqual(cues[0]?.name, 'Song A');
    assert.strictEqual(cues[1]?.name, 'Song A > Verse');

    // 3. Test transport controls
    const isPlayingPromise = new Promise((resolve) => {
      client.once('is_playing', (isPlaying) => {
        resolve(isPlaying);
      });
    });
    client.startPlaying();
    const isPlaying = await isPlayingPromise;
    assert.strictEqual(isPlaying, true);

  } finally {
    await client.stop();
    await mockServer.stop();
  }
});

test('OSC integration: tracks connection status', () => {
  const client = new OSCClient();
  
  // Initially disconnected
  assert.strictEqual(client.isConnected, false);
  
  // Mock incoming message
  let connectEmitted = false;
  client.on('connect', () => {
    connectEmitted = true;
  });
  
  // Trigger handleIncoming manually
  client['handleIncoming']({ oscType: 'message', address: '/live/song/get/tempo', args: [{ value: 120 }] });
  
  assert.strictEqual(client.isConnected, true);
  assert.strictEqual(connectEmitted, true);
  
  // Test disconnect detection
  let disconnectEmitted = false;
  client.on('disconnect', () => {
    disconnectEmitted = true;
  });
  
  // Manually force lastMessageTime to 4 seconds ago
  client['lastMessageTime'] = Date.now() - 4000;
  
  // Call private checkConnection
  client['checkConnection']();
  
  assert.strictEqual(client.isConnected, false);
  assert.strictEqual(disconnectEmitted, true);
});

test('OSC polling fallback requests is_playing', async () => {
  const client = new OSCClient();
  const requestedAddresses = [];
  client.send = (address) => requestedAddresses.push(address);

  client.startPolling();
  try {
    await new Promise((resolve) => setTimeout(resolve, 650));
  } finally {
    client.stopPolling();
  }

  assert.ok(requestedAddresses.includes('/live/song/get/is_playing'));
});

test('OSC parses and requests Arrangement last_event_time', () => {
  const client = new OSCClient();
  const received = [];
  const sent = [];
  client.on('last_event_time', (value) => received.push(value));
  client.send = (address) => sent.push(address);

  client.getLastEventTime();
  client['handleIncoming']({
    oscType: 'message',
    address: '/live/song/get/last_event_time',
    args: [{ value: 384 }],
  });

  assert.deepStrictEqual(sent, ['/live/song/get/last_event_time']);
  assert.deepStrictEqual(received, [384]);
});

test('OSC sets current song time with a float beat value', () => {
  const client = new OSCClient();
  const sent = [];
  client.send = (address, args) => sent.push([address, args]);

  client.setCurrentSongTime(28);

  assert.deepStrictEqual(sent, [[
    '/live/song/set/current_song_time',
    [{ type: 'float', value: 28 }],
  ]]);
});

test('OSC exposes every is_playing sample while deduplicating public transport changes', () => {
  const client = new OSCClient();
  const samples = [];
  const changes = [];
  client.on('is_playing_sample', (value) => samples.push(value));
  client.on('is_playing', (value) => changes.push(value));

  const stopped = {
    oscType: 'message',
    address: '/live/song/get/is_playing',
    args: [{ value: 0 }],
  };
  client['handleIncoming'](stopped);
  client['handleIncoming'](stopped);

  assert.deepStrictEqual(samples, [false, false]);
  assert.deepStrictEqual(changes, [false]);
});

test('OSC encoding works when Ableton embedded runtime has no global TextEncoder', () => {
  const originalTextEncoder = globalThis.TextEncoder;
  const originalTextDecoder = globalThis.TextDecoder;
  const errors = [];
  const client = new OSCClient();
  client.on('error', (error) => errors.push(error));

  try {
    globalThis.TextEncoder = undefined;
    globalThis.TextDecoder = undefined;
    assert.doesNotThrow(() => client.startPlaying());
    assert.deepStrictEqual(errors, []);
  } finally {
    globalThis.TextEncoder = originalTextEncoder;
    globalThis.TextDecoder = originalTextDecoder;
  }
});

test('OSC send reports whether a bound socket accepted the packet', async () => {
  const client = new OSCClient();
  assert.strictEqual(client.send('/live/song/get/tempo'), false);

  const runtime = globalThis;
  const previousSocket = runtime.abletonOSCSocket;
  const previousListeners = runtime.abletonOSCListeners;
  const sends = [];
  let closed = false;
  runtime.abletonOSCSocket = {
    address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 11101 }),
    send: (...args) => { sends.push(args); },
    close: () => { closed = true; },
  };
  delete runtime.abletonOSCListeners;

  try {
    await client.start();
    assert.strictEqual(client.getDebugSnapshot().oscListenPort, 11101);
    assert.strictEqual(client.send('/live/song/get/tempo'), true);
    assert.strictEqual(sends.length, 1);
    assert.ok(runtime.abletonOSCListeners instanceof Set);
  } finally {
    await client.stop();
    assert.strictEqual(closed, true);
    if (previousSocket === undefined) delete runtime.abletonOSCSocket;
    else runtime.abletonOSCSocket = previousSocket;
    if (previousListeners === undefined) delete runtime.abletonOSCListeners;
    else runtime.abletonOSCListeners = previousListeners;
  }
});
