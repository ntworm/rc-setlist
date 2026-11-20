// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The commands a second computer hands up to the main one, and the probe
// that tells which address of a computer answers.

import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test, afterEach } from 'node:test';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { peerCommandId } from '../src/runtime/peer-message.ts';
import {
  adoptUpstreamEcho,
  forwardToMaster,
  handleUpstreamRefusal,
  resetPeerUpstream,
} from '../src/runtime/peer-upstream.ts';
import { probeTcp } from '../src/runtime/peer-discovery-probe.ts';

/** A server of pages that records what it says, with the link of a main computer or none. */
function fakeServer({ masterInSync = true } = {}) {
  const sent = [];
  const broadcasts = [];
  const logs = [];
  const master = {
    synchronized: masterInSync,
    bufferedAmount: 0,
    send: (text) => sent.push(JSON.parse(text)),
  };
  return {
    sent,
    broadcasts,
    logs,
    peerSockets: () => [master],
    broadcast: (message) => broadcasts.push(message),
    broadcastLog: (message, level) => logs.push({ message, level }),
  };
}

const saved = { wsServer: bridgeState.wsServer, commandBus: bridgeState.commandBus };

afterEach(() => {
  resetPeerUpstream();
  bridgeState.wsServer = saved.wsServer;
  bridgeState.commandBus = saved.commandBus;
});

test('a command goes up to a main computer in sync, under the id of the phone', () => {
  const server = fakeServer();
  bridgeState.wsServer = server;
  bridgeState.commandBus = null;
  assert.equal(forwardToMaster({ type: 'play' }, 'phone-play'), true);
  assert.deepEqual(server.sent, [
    { type: 'peer_upstream', command: { type: 'play', commandId: 'phone-play' } },
  ]);
  assert.deepEqual(server.broadcasts, [
    { type: 'command_status', commandId: 'phone-play', status: 'sent' },
  ]);
  // A retry waits for the first one and sends nothing more.
  assert.equal(forwardToMaster({ type: 'play' }, 'phone-play'), true);
  assert.equal(server.sent.length, 1);
  // The command that comes back down takes the id of the phone again.
  const echo = adoptUpstreamEcho({ type: 'play', commandId: peerCommandId('phone-play') });
  assert.equal(echo.commandId, 'phone-play');
  // Only once: a second echo is a command of its own.
  const again = adoptUpstreamEcho({ type: 'play', commandId: peerCommandId('phone-play') });
  assert.equal(again.commandId, peerCommandId('phone-play'));
});

test('without a main computer in sync, or for a command that stays here, nothing goes up', () => {
  const server = fakeServer({ masterInSync: false });
  bridgeState.wsServer = server;
  assert.equal(forwardToMaster({ type: 'play' }, 'phone-alone'), false);
  bridgeState.wsServer = fakeServer();
  assert.equal(forwardToMaster({ type: 'reorder', songTitles: [] }, 'phone-reorder'), false);
  assert.deepEqual(server.sent, []);
});

test('a refusal of the main computer settles the command of the phone as failed', () => {
  const server = fakeServer();
  bridgeState.wsServer = server;
  bridgeState.commandBus = null;
  assert.equal(forwardToMaster({ type: 'stop' }, 'phone-stop'), true);
  handleUpstreamRefusal({ commandId: 'phone-stop', reason: 'panic_active' });
  const failed = server.broadcasts.find((m) => m.status === 'failed');
  assert.equal(failed.commandId, 'phone-stop');
  assert.equal(failed.reason, 'execution_failed');
  assert.match(server.logs[0].message, /refused the command \(panic_active\)/);
  // A refusal of a command that is not waiting changes nothing.
  handleUpstreamRefusal({ commandId: 'never-sent', reason: 'invalid' });
  assert.equal(server.broadcasts.filter((m) => m.status === 'failed').length, 1);
});

test('a command the main computer never sends back fails after three seconds', async () => {
  const server = fakeServer();
  bridgeState.wsServer = server;
  bridgeState.commandBus = null;
  assert.equal(forwardToMaster({ type: 'refresh' }, 'phone-lost'), true);
  await new Promise((resolve) => setTimeout(resolve, 3200));
  const failed = server.broadcasts.find((m) => m.status === 'failed');
  assert.equal(failed?.commandId, 'phone-lost');
  assert.equal(failed?.reason, 'timeout');
  assert.match(server.logs[0].message, /did not answer/);
});

test('the probe tells an address that answers from one that does not', async () => {
  const listener = createServer((socket) => socket.destroy());
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  try {
    assert.equal(await probeTcp('127.0.0.1', port, 800), true);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
  assert.equal(await probeTcp('127.0.0.1', port, 800), false, 'a closed port does not answer');
});
