import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import { McpTcpClient } from '../src/integration/mcp-client.ts';

async function reserveThenReleasePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('concurrent MCP callers share a failed connection attempt and all settle', async () => {
  const port = await reserveThenReleasePort();
  const client = new McpTcpClient({ port, connectionTimeoutMs: 100 });

  const result = await Promise.race([
    Promise.allSettled([
      client.call('get_session_info'),
      client.call('get_song_length'),
    ]),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 750)),
  ]);

  client.stop();
  assert.notEqual(result, 'timeout');
  assert.equal(result.length, 2);
  assert.equal(result.every((entry) => entry.status === 'rejected'), true);
});

test('an MCP server that accepts but never replies times out the request and releases the connection', async () => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const client = new McpTcpClient({ port, connectionTimeoutMs: 100, requestTimeoutMs: 75 });

  const result = await Promise.race([
    client.call('get_session_info').then(
      () => 'resolved',
      (error) => error instanceof Error ? error.message : String(error),
    ),
    new Promise((resolve) => setTimeout(() => resolve('test timeout'), 500)),
  ]);

  client.stop();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  assert.match(result, /request timeout/i);
});
