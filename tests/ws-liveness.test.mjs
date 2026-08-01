import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket } from 'ws';
import { SetlistWSServer } from '../src/server/ws.ts';

function fakeClient() {
  const sent = [];
  return {
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

test('heartbeat pings live clients and terminates a client after a missed pong', () => {
  const server = new SetlistWSServer('', { heartbeatIntervalMs: 60_000 });
  server.init();
  const client = fakeClient();
  server['clients'].add(client);

  server['heartbeatTick']();
  assert.equal(client.pingCount, 1);
  assert.equal(client.isAlive, false);
  assert.equal(client.terminated, false);

  server['heartbeatTick']();
  assert.equal(client.terminated, true);
  assert.equal(server['clients'].has(client), false);
  server.stop();
  assert.equal(server['heartbeatInterval'], null);
});

test('heartbeat keeps a client that responds with pong', () => {
  const server = new SetlistWSServer('', { heartbeatIntervalMs: 60_000 });
  server.init();
  const client = fakeClient();
  server['clients'].add(client);

  server['heartbeatTick']();
  client.isAlive = true;
  server['heartbeatTick']();

  assert.equal(client.terminated, false);
  assert.equal(client.pingCount, 2);
  server.stop();
});

test('identical logs are deduplicated by content within a bounded window', () => {
  let now = 1_000;
  const server = new SetlistWSServer('', {
    heartbeatIntervalMs: 60_000,
    logDedupeWindowMs: 500,
    now: () => now,
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
