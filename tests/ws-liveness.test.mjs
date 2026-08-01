import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket } from 'ws';
import { SetlistWSServer } from '../src/server/ws.ts';

function fakeClient(bufferedAmount = 0) {
  const sent = [];
  return {
    bufferedAmount,
    isAlive: true,
    pingCount: 0,
    readyState: WebSocket.OPEN,
    sent,
    terminated: false,
    close() {},
    ping() { this.pingCount++; },
    removeAllListeners() {},
    send(message) { sent.push(JSON.parse(message)); },
    terminate() { this.terminated = true; },
  };
}

function createInjectedInterval() {
  let callback = null;
  let cleared = false;
  const handle = { unref() {} };
  return {
    clearIntervalFn(value) {
      assert.equal(value, handle);
      cleared = true;
    },
    get callback() { return callback; },
    get cleared() { return cleared; },
    setIntervalFn(nextCallback, delay) {
      assert.equal(delay, 60_000);
      callback = nextCallback;
      return handle;
    },
  };
}

test('heartbeat pings live clients and terminates a client after a missed pong', () => {
  const interval = createInjectedInterval();
  const server = new SetlistWSServer('', {
    heartbeatIntervalMs: 60_000,
    setIntervalFn: interval.setIntervalFn,
    clearIntervalFn: interval.clearIntervalFn,
  });
  server.init();
  const client = fakeClient();
  server['clients'].add(client);

  interval.callback();
  assert.equal(client.pingCount, 1);
  assert.equal(client.isAlive, false);
  assert.equal(client.terminated, false);

  interval.callback();
  assert.equal(client.terminated, true);
  assert.equal(server['clients'].has(client), false);
  server.stop();
  assert.equal(interval.cleared, true);
  assert.equal(server['heartbeatInterval'], null);
});

test('heartbeat keeps a client that responds with pong', () => {
  const interval = createInjectedInterval();
  const server = new SetlistWSServer('', {
    heartbeatIntervalMs: 60_000,
    setIntervalFn: interval.setIntervalFn,
    clearIntervalFn: interval.clearIntervalFn,
  });
  server.init();
  const client = fakeClient();
  server['clients'].add(client);

  interval.callback();
  client.isAlive = true;
  interval.callback();

  assert.equal(client.terminated, false);
  assert.equal(client.pingCount, 2);
  server.stop();
});

test('identical logs are deduplicated by stable content within a bounded window', () => {
  let now = 1_000;
  const interval = createInjectedInterval();
  const server = new SetlistWSServer('', {
    heartbeatIntervalMs: 60_000,
    logDedupeWindowMs: 500,
    now: () => now,
    setIntervalFn: interval.setIntervalFn,
    clearIntervalFn: interval.clearIntervalFn,
  });
  server.init();
  const client = fakeClient();
  server['clients'].add(client);

  server.broadcastLog('same content', 'warn');
  now += 10;
  server.broadcastLog('same content', 'warn');
  assert.equal(client.sent.length, 1);

  now += 501;
  server.broadcastLog('same content', 'warn');
  assert.equal(client.sent.length, 2);
  assert.equal(client.sent[1].timestamp, now);
  server.stop();
});

test('backpressure drops above 512 KiB and disconnects above 2 MiB', () => {
  const interval = createInjectedInterval();
  const server = new SetlistWSServer('', {
    heartbeatIntervalMs: 60_000,
    setIntervalFn: interval.setIntervalFn,
    clearIntervalFn: interval.clearIntervalFn,
  });
  server.init();

  const slow = fakeClient(524_289);
  server['clients'].add(slow);
  server.broadcast({ type: 'telemetry' });
  assert.equal(slow.sent.length, 0);
  assert.equal(slow.terminated, false);
  assert.equal(server['clients'].has(slow), true);

  const stalled = fakeClient(2_097_153);
  stalled.remoteAddress = 'test-client';
  server['clients'].add(stalled);
  server.broadcast({ type: 'telemetry' });
  assert.equal(stalled.sent.length, 0);
  assert.equal(stalled.terminated, true);
  assert.equal(server['clients'].has(stalled), false);
  server.stop();
});
