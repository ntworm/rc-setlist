// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The main computer, paired with more than one computer at a time.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import { startServer, stopServer } from '../src/index.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { relayToPeer, stopPeerLink } from '../src/runtime/peer-link.ts';
import { aggregatePeerStatus } from '../src/runtime/peer-status-list.ts';
import { writePeerConfigs } from '../src/preferences.ts';
import {
  MAIN_CUES,
  PEER_TOKEN,
  createFakeOsc,
  createPeerComputer,
  fingerprintOf,
  makeCommand,
} from './helpers/peer-link-harness.mjs';

let storageDir = '';
let peerOne = null;
let peerTwo = null;
let portOne = 0;
let portTwo = 0;
const oscCalls = [];
const closedComputers = new Set();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await delay(25);
  }
  return predicate();
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/** Takes a computer down for good, the way a machine that is turned off does. */
async function closePeerComputer(computer) {
  if (closedComputers.has(computer)) return;
  closedComputers.add(computer);
  computer.wsServer.stop();
  computer.server.closeAllConnections?.();
  await closeServer(computer.server);
}

/** The row of one computer in the list of the paired computers. */
function rowOf(port) {
  return bridgeState.peerStatuses.find((row) => row.port === port);
}

function configOf(computer, port) {
  return {
    host: '127.0.0.1',
    port,
    peerToken: PEER_TOKEN,
    fingerprint: fingerprintOf(computer.tls),
  };
}

before(async () => {
  storageDir = path.join(tmpdir(), `rc-multi-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(storageDir, { recursive: true });
  setExtensionContext({
    environment: { storageDirectory: storageDir },
    application: { song: { handle: { id: 42 }, tempo: 120, cuePoints: MAIN_CUES } },
  });

  peerOne = await createPeerComputer();
  peerTwo = await createPeerComputer();
  portOne = await listen(peerOne.server);
  portTwo = await listen(peerTwo.server);
  // The main computer is paired with both computers at once.
  writePeerConfigs([configOf(peerOne, portOne), configOf(peerTwo, portTwo)]);
  await startServer({ port: 0, skipOsc: true, skipProjectDetector: true });
  bridgeState.oscClient = createFakeOsc(oscCalls);
  bridgeState.manager.updateCues(MAIN_CUES);
  const both = await waitFor(
    () => bridgeState.peerStatuses.length === 2 && bridgeState.peerStatus.connected === true,
    15000,
  );
  assert.equal(both, true, 'both links must come up');
});

after(async () => {
  stopPeerLink();
  await stopServer();
  await closePeerComputer(peerOne);
  await closePeerComputer(peerTwo);
  clearExtensionContext();
  try {
    fs.rmSync(storageDir, { recursive: true, force: true });
  } catch {
    // a leftover temp directory is not worth failing a test over
  }
});

test('both computers are linked at once', () => {
  assert.equal(bridgeState.peerStatuses.length, 2);
  assert.equal(bridgeState.peerStatus.paired, true);
  assert.equal(bridgeState.peerStatus.connected, true);
  assert.equal(rowOf(portOne).connected, true);
  assert.equal(rowOf(portTwo).connected, true);
  assert.equal(rowOf(portOne).host, '127.0.0.1');
  assert.equal(rowOf(portTwo).host, '127.0.0.1');
});

test('a relayed play reaches both computers', async () => {
  peerOne.actions.length = 0;
  peerTwo.actions.length = 0;
  relayToPeer(makeCommand('play', 'multi-play'));
  await waitFor(() => peerOne.actions.length > 0 && peerTwo.actions.length > 0);
  assert.equal(peerOne.actions[0].source, 'play');
  assert.equal(peerTwo.actions[0].source, 'play');
});

test('one computer going down does not touch the other', async () => {
  await closePeerComputer(peerOne);
  const down = await waitFor(() => bridgeState.peerStatus.connected === false, 8000);
  assert.equal(down, true);
  assert.equal(
    bridgeState.peerStatuses.length,
    2,
    'the computer that went down stays in the list',
  );
  assert.equal(rowOf(portOne).connected, false);
  assert.equal(rowOf(portTwo).connected, true);

  peerTwo.actions.length = 0;
  relayToPeer(makeCommand('play', 'after-one-went-down'));
  await waitFor(() => peerTwo.actions.length > 0);
  assert.equal(peerTwo.actions[0].source, 'play');
});

test('stopping the links leaves no computer behind', () => {
  stopPeerLink();
  assert.deepEqual(bridgeState.peerStatuses, []);
  assert.equal(bridgeState.peerStatus.paired, false);
  assert.equal(bridgeState.peerStatus.connected, false);
});

test('the state of the link is what the computers add up to', () => {
  const row = (host, connected, markersMatch, fingerprintMismatch) => ({
    host,
    port: 4444,
    connected,
    markersMatch,
    fingerprintMismatch,
  });
  const up = row('10.0.0.2', true, true, false);
  const down = row('10.0.0.3', false, true, false);
  const other = row('10.0.0.4', true, false, false);
  const changed = row('10.0.0.5', false, true, true);
  // What the link says when no computer is paired at all.
  const expected = (status) => ({
    paired: false,
    connected: false,
    markersMatch: true,
    fingerprintMismatch: false,
    ...status,
  });

  assert.deepEqual(aggregatePeerStatus([]), expected({}));
  assert.deepEqual(aggregatePeerStatus([up]), expected({ paired: true, connected: true }));
  assert.deepEqual(aggregatePeerStatus([up, down]), expected({ paired: true, connected: false }));
  assert.deepEqual(
    aggregatePeerStatus([up, other]),
    expected({ paired: true, connected: true, markersMatch: false }),
  );
  assert.deepEqual(
    aggregatePeerStatus([up, changed]),
    expected({ paired: true, connected: false, fingerprintMismatch: true }),
  );
});
