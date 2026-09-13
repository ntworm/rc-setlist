import { test } from 'node:test';
import assert from 'node:assert';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { MockOSCServer } from './mocks/mock-osc-server.ts';
import { OSCClient } from '../src/integration/osc-client.ts';

test('OSC mock requests an ephemeral port, never the Live command port', async (t) => {
  const requestedPorts = [];
  const bind = dgram.Socket.prototype.bind;
  // Even the failing regression must never bind Live's port. Record what the
  // mock requests, but force the actual socket onto an OS-assigned test port.
  t.mock.method(dgram.Socket.prototype, 'bind', function (port, ...args) {
    requestedPorts.push(port);
    return bind.call(this, 0, ...args);
  });
  const mockServer = new MockOSCServer();
  try {
    await mockServer.start();
    assert.deepStrictEqual(requestedPorts, [0]);
  } finally {
    await mockServer.stop();
  }
});

test('OSC integration: client communicates with mock server', { timeout: 5_000 }, async (t) => {
  const bind = dgram.Socket.prototype.bind;
  t.mock.method(dgram.Socket.prototype, 'bind', function (port, ...args) {
    // Fail before binding if a future edit restores a production port, even
    // when the earlier regression test has already failed in this test run.
    assert.strictEqual(typeof port === 'object' ? port.port : port, 0);
    return bind.call(this, port, ...args);
  });
  const mockServer = new MockOSCServer();
  const client = new OSCClient();
  // A silent socket stands in for a stock AbletonOSC on the bridge port, so the
  // probe times out and the client takes the legacy path — and never sends a
  // byte towards the real bridge port on this machine.
  const silentBridge = dgram.createSocket('udp4');
  silentBridge.bind(0, '127.0.0.1');
  await once(silentBridge, 'listening');
  const socket = dgram.createSocket('udp4');
  const previousSocket = globalThis.abletonOSCSocket;
  const previousListeners = globalThis.abletonOSCListeners;

  try {
    const port = await mockServer.start();
    assert.ok(Number.isInteger(port) && port > 0, 'mock must return its bound port');
    assert.ok(![11000, 11001, 11101, 11201].includes(port));
    client.configureBridge({ bridgePort: silentBridge.address().port, probeTimeoutMs: 100, legacyTargetPort: port });

    // Exercise the existing cooperative socket path with a real test socket;
    // production OSC defaults and Live's sockets are never used by this test.
    const listening = once(socket, 'listening', { signal: AbortSignal.timeout(1_000) });
    socket.bind(0, '127.0.0.1');
    await listening;
    globalThis.abletonOSCSocket = socket;
    globalThis.abletonOSCListeners = new Set();
    socket.on('message', (message) => {
      for (const listener of globalThis.abletonOSCListeners ?? []) listener(message);
    });
    await client.start();
    assert.strictEqual(client.getDebugSnapshot().oscListenPort, socket.address().port);

    // 1. Test getTempo
    const tempoPromise = once(client, 'tempo', { signal: AbortSignal.timeout(1_000) });
    client.getTempo();
    const [bpm] = await tempoPromise;
    assert.strictEqual(bpm, 120);

    // 2. Test getCuePoints
    const cuesPromise = once(client, 'cue_points', { signal: AbortSignal.timeout(1_000) });
    client.getCuePoints();
    const [cues] = await cuesPromise;
    assert.strictEqual(cues.length, 5);
    assert.strictEqual(cues[0]?.name, 'Song A');
    assert.strictEqual(cues[1]?.name, 'Song A > Verse');

    // 3. Test transport controls
    const isPlayingPromise = once(client, 'is_playing', { signal: AbortSignal.timeout(1_000) });
    client.startPlaying();
    const [isPlaying] = await isPlayingPromise;
    assert.strictEqual(isPlaying, true);

    const stoppedPromise = once(client, 'is_playing', { signal: AbortSignal.timeout(1_000) });
    client.stopPlaying();
    const [stopped] = await stoppedPromise;
    assert.strictEqual(stopped, false);

  } finally {
    await client.stop();
    await mockServer.stop();
    try { socket.close(); } catch {}
    try { silentBridge.close(); } catch {}
    if (previousSocket === undefined) delete globalThis.abletonOSCSocket;
    else globalThis.abletonOSCSocket = previousSocket;
    if (previousListeners === undefined) delete globalThis.abletonOSCListeners;
    else globalThis.abletonOSCListeners = previousListeners;
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

test('explicit Count-In acknowledgement queries bypass duplicate position and Click replies once', () => {
  const client = new OSCClient();
  const positions = [];
  const metronomes = [];
  client.send = () => true;
  client.on('current_song_time', (value) => positions.push(value));
  client.on('metronome', (value) => metronomes.push(value));

  const position = {
    oscType: 'message',
    address: '/live/song/get/current_song_time',
    args: [{ value: 28 }],
  };
  const metronome = {
    oscType: 'message',
    address: '/live/song/get/metronome',
    args: [{ value: 1 }],
  };
  client['handleIncoming'](position);
  client['handleIncoming'](metronome);
  client.getCurrentSongTime(true);
  client.getCurrentSongTime(true);
  client.getCurrentSongTime(true);
  client.getMetronome(true);
  client.getMetronome(true);
  client.getMetronome(true);
  client['handleIncoming'](position);
  client['handleIncoming'](metronome);
  client['handleIncoming'](position);
  client['handleIncoming'](metronome);

  assert.deepStrictEqual(positions, [28, 28]);
  assert.deepStrictEqual(metronomes, [true, true]);
});

test('stopping OSC clears pending Count-In confirmation credits', async () => {
  const client = new OSCClient();
  const positions = [];
  client.send = () => true;
  client.on('current_song_time', (value) => positions.push(value));
  const position = {
    oscType: 'message',
    address: '/live/song/get/current_song_time',
    args: [{ value: 28 }],
  };

  client['handleIncoming'](position);
  client.getCurrentSongTime(true);
  await client.stop();
  client['handleIncoming'](position);

  assert.deepStrictEqual(positions, [28]);
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

  // Never probe the real bridge port: with RC Bridge installed on the
  // developer's machine this test would otherwise talk to a running Live.
  const silentBridge = dgram.createSocket('udp4');
  silentBridge.bind(0, '127.0.0.1');
  await once(silentBridge, 'listening');
  client.configureBridge({ bridgePort: silentBridge.address().port, probeTimeoutMs: 100 });

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
    try { silentBridge.close(); } catch {}
    assert.strictEqual(closed, true);
    if (previousSocket === undefined) delete runtime.abletonOSCSocket;
    else runtime.abletonOSCSocket = previousSocket;
    if (previousListeners === undefined) delete runtime.abletonOSCListeners;
    else runtime.abletonOSCListeners = previousListeners;
  }
});
