import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { once } from 'node:events';
import test from 'node:test';
import { MockOSCServer } from './mocks/mock-osc-server.ts';
import { OSCClient } from '../src/integration/osc-client.ts';

/**
 * RC Bridge is the bundled fork of AbletonOSC. It listens on its own port and
 * replies to whichever socket asked, so the extension needs no fixed reply
 * port and no socket shared with other extensions. The client probes for it
 * first and only falls back to a stock AbletonOSC (fixed reply port 11001)
 * when nothing answers.
 */

function forbidProductionPorts(t) {
  const bind = dgram.Socket.prototype.bind;
  t.mock.method(dgram.Socket.prototype, 'bind', function (port, ...args) {
    const requested = typeof port === 'object' ? port.port : port;
    assert.ok(![11000, 11001, 11020, 11021, 11101, 11201].includes(requested), `must not bind production port ${requested}`);
    return bind.call(this, port, ...args);
  });
}

test('the client finds RC Bridge and talks to it over its own socket', { timeout: 5_000 }, async (t) => {
  forbidProductionPorts(t);
  const previousSocket = globalThis.abletonOSCSocket;
  const previousListeners = globalThis.abletonOSCListeners;
  delete globalThis.abletonOSCSocket;
  delete globalThis.abletonOSCListeners;
  const bridge = new MockOSCServer({ identifyAsBridge: true });
  const client = new OSCClient();
  try {
    const port = await bridge.start();
    client.configureBridge({ bridgePort: port, probeTimeoutMs: 800, legacyListenPorts: [0] });
    await client.start();

    const snapshot = client.getDebugSnapshot();
    assert.equal(snapshot.oscBridge, 'rcbridge');
    assert.equal(snapshot.oscBridgeVersion, 'RC Bridge 1.0.0');
    assert.equal(snapshot.oscTargetPort, port);
    assert.ok(snapshot.oscListenPort > 0 && snapshot.oscListenPort !== 11001, 'an ephemeral port of its own');
    assert.equal(globalThis.abletonOSCSocket, undefined, 'no socket is shared through globalThis in bridge mode');

    const tempo = once(client, 'tempo', { signal: AbortSignal.timeout(1_000) });
    client.getTempo();
    assert.equal((await tempo)[0], 120);
  } finally {
    await client.stop();
    await bridge.stop();
    if (previousSocket !== undefined) globalThis.abletonOSCSocket = previousSocket;
    if (previousListeners !== undefined) globalThis.abletonOSCListeners = previousListeners;
  }
});

test('without RC Bridge the client falls back to the stock AbletonOSC path', { timeout: 5_000 }, async (t) => {
  forbidProductionPorts(t);
  const previousSocket = globalThis.abletonOSCSocket;
  const previousListeners = globalThis.abletonOSCListeners;
  delete globalThis.abletonOSCSocket;
  delete globalThis.abletonOSCListeners;
  // A stock mock: answers on its port, does not identify as the bridge.
  const stock = new MockOSCServer();
  const client = new OSCClient();
  const probeSink = dgram.createSocket('udp4');
  try {
    const stockPort = await stock.start();
    // Nothing answers the bridge probe on this port.
    probeSink.bind(0, '127.0.0.1');
    await once(probeSink, 'listening');
    client.configureBridge({
      bridgePort: probeSink.address().port,
      probeTimeoutMs: 300,
      legacyTargetPort: stockPort,
      legacyListenPorts: [0],
    });
    const started = Date.now();
    await client.start();
    assert.ok(Date.now() - started >= 250, 'the probe waited for its timeout before falling back');

    const snapshot = client.getDebugSnapshot();
    assert.equal(snapshot.oscBridge, 'abletonosc');
    assert.equal(snapshot.oscBridgeVersion, null);
    assert.equal(snapshot.oscTargetPort, stockPort);
    assert.ok(globalThis.abletonOSCSocket, 'the legacy path shares its reply socket through globalThis');

    const tempo = once(client, 'tempo', { signal: AbortSignal.timeout(1_000) });
    client.getTempo();
    assert.equal((await tempo)[0], 120);
  } finally {
    await client.stop();
    await stock.stop();
    try { probeSink.close(); } catch {}
    if (previousSocket === undefined) delete globalThis.abletonOSCSocket;
    else globalThis.abletonOSCSocket = previousSocket;
    if (previousListeners === undefined) delete globalThis.abletonOSCListeners;
    else globalThis.abletonOSCListeners = previousListeners;
  }
});

test("'connect' fires only once the bridge socket can send, so the connect handler's requests go out", { timeout: 5_000 }, async (t) => {
  // server-lifecycle registers listeners and asks for the initial state from
  // its 'connect' handler. When the probe emitted 'connect' before start()
  // had adopted the socket, every one of those sends was dropped and the
  // page lived on the 500 ms poll alone.
  forbidProductionPorts(t);
  const previousSocket = globalThis.abletonOSCSocket;
  const previousListeners = globalThis.abletonOSCListeners;
  delete globalThis.abletonOSCSocket;
  delete globalThis.abletonOSCListeners;
  const bridge = new MockOSCServer({ identifyAsBridge: true });
  const client = new OSCClient();
  try {
    const port = await bridge.start();
    client.configureBridge({ bridgePort: port, probeTimeoutMs: 800, legacyListenPorts: [0] });
    let sentFromConnect = null;
    let bridgeAtConnect = null;
    const tempo = once(client, 'tempo', { signal: AbortSignal.timeout(2_000) });
    client.on('connect', () => {
      bridgeAtConnect = client.getDebugSnapshot().oscBridge;
      sentFromConnect = client.send('/live/song/get/tempo');
    });
    await client.start();
    assert.equal(bridgeAtConnect, 'rcbridge', 'the snapshot already names the bridge inside the connect handler');
    assert.equal(sentFromConnect, true, 'a send from the connect handler reaches the socket');
    assert.equal((await tempo)[0], 120, 'and Live answers it');
  } finally {
    await client.stop();
    await bridge.stop();
    if (previousSocket !== undefined) globalThis.abletonOSCSocket = previousSocket;
    if (previousListeners !== undefined) globalThis.abletonOSCListeners = previousListeners;
  }
});

test('stop() during the probe discards the answer instead of adopting a socket after shutdown', { timeout: 5_000 }, async (t) => {
  forbidProductionPorts(t);
  const previousSocket = globalThis.abletonOSCSocket;
  const previousListeners = globalThis.abletonOSCListeners;
  delete globalThis.abletonOSCSocket;
  delete globalThis.abletonOSCListeners;
  const bridge = new MockOSCServer({ identifyAsBridge: true });
  const client = new OSCClient();
  try {
    const port = await bridge.start();
    client.configureBridge({ bridgePort: port, probeTimeoutMs: 800, legacyListenPorts: [0] });
    let connected = false;
    client.on('connect', () => { connected = true; });
    const starting = client.start();
    await client.stop();
    await starting;
    assert.equal(connected, false, 'no connect after stop');
    assert.equal(client.getDebugSnapshot().oscBridge, null);
    assert.equal(client.send('/live/song/get/tempo'), false, 'no socket was kept');
  } finally {
    await client.stop();
    await bridge.stop();
    if (previousSocket !== undefined) globalThis.abletonOSCSocket = previousSocket;
    if (previousListeners !== undefined) globalThis.abletonOSCListeners = previousListeners;
  }
});
