// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The computers of the network, found without an address to type.
//
// The addresses of the tests come from the ranges that documentation uses
// (192.0.2.0 and 198.51.100.0): a test that collides with the machine it
// runs on proves nothing.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DISCOVERY_PORT,
  buildAnnouncement,
  handleDiscoveryDatagram,
  listDiscoveredPeers,
  startPeerDiscovery,
  stopPeerDiscovery,
} from '../src/runtime/peer-discovery.ts';
import { generatePairingCode, resetPairingState } from '../src/runtime/pairing.ts';
import { getLanAddresses } from '../src/util/helpers.ts';

/** The moment the tests of the list pretend to be at. */
const NOW = 1_700_000_000_000;

/** The datagram a computer of the network sends. */
function announcement(overrides = {}) {
  return Buffer.from(
    JSON.stringify({ app: 'rc-setlist', v: 1, name: 'Studio', port: 4444, ...overrides }),
    'utf8',
  );
}

test('the announcement names the computer and the port, and carries no secret', () => {
  resetPairingState();
  const code = generatePairingCode();
  const said = buildAnnouncement(4444);
  assert.equal(said.app, 'rc-setlist');
  assert.equal(said.v, 1);
  assert.equal(said.port, 4444);
  assert.ok(said.name.length >= 1 && said.name.length <= 63);
  assert.deepEqual(Object.keys(said).sort(), ['app', 'name', 'port', 'v']);
  assert.doesNotMatch(JSON.stringify(said), new RegExp(code), 'the code must not travel');
  assert.ok(!Object.values(said).includes(code));
  assert.equal(DISCOVERY_PORT, 4447);
  resetPairingState();
});

test('a datagram of a computer of the network is accepted', () => {
  stopPeerDiscovery();
  handleDiscoveryDatagram(announcement(), '192.0.2.10', NOW);
  const peers = listDiscoveredPeers(NOW);
  assert.equal(peers.length, 1);
  assert.deepEqual(peers[0], { host: '192.0.2.10', name: 'Studio', port: 4444 });
  // The prefix a dual stack socket adds is not part of the address.
  handleDiscoveryDatagram(announcement(), '::ffff:192.0.2.11', NOW);
  const both = listDiscoveredPeers(NOW);
  assert.equal(both.length, 2);
  assert.equal(both[1].host, '192.0.2.11');
});

test('a datagram that is not an announcement is refused', () => {
  stopPeerDiscovery();
  const refused = [
    Buffer.from('not json at all', 'utf8'),
    announcement({ app: 'other-app' }),
    announcement({ v: 2 }),
    announcement({ name: '' }),
    announcement({ name: 'x'.repeat(64) }),
    announcement({ port: 0 }),
    announcement({ port: 65536 }),
    announcement({ name: undefined }),
    Buffer.from(JSON.stringify([1, 2, 3]), 'utf8'),
  ];
  for (const datagram of refused) {
    handleDiscoveryDatagram(datagram, '192.0.2.12', NOW);
  }
  assert.deepEqual(listDiscoveredPeers(NOW), [], 'no malformed datagram is remembered');
});

test('a datagram of five hundred and twelve bytes or more is refused', () => {
  stopPeerDiscovery();
  const text = JSON.stringify({ app: 'rc-setlist', v: 1, name: 'Studio', port: 4444 });
  const tooBig = Buffer.from(text + ' '.repeat(512 - text.length), 'utf8');
  assert.equal(tooBig.length, 512);
  handleDiscoveryDatagram(tooBig, '192.0.2.13', NOW);
  assert.deepEqual(listDiscoveredPeers(NOW), [], 'a datagram that is too big is refused');
  const justRight = Buffer.from(text + ' '.repeat(511 - text.length), 'utf8');
  handleDiscoveryDatagram(justRight, '192.0.2.14', NOW);
  assert.equal(listDiscoveredPeers(NOW).length, 1, 'a datagram under the limit is accepted');
});

test('a datagram from this very computer is refused', () => {
  stopPeerDiscovery();
  handleDiscoveryDatagram(announcement(), '127.0.0.1', NOW);
  const own = getLanAddresses()[0];
  if (own) handleDiscoveryDatagram(announcement(), own, NOW);
  assert.deepEqual(listDiscoveredPeers(NOW), [], 'the computer does not find itself');
});

test('a computer that stopped saying hello is forgotten', () => {
  stopPeerDiscovery();
  handleDiscoveryDatagram(announcement(), '192.0.2.15', NOW);
  assert.equal(listDiscoveredPeers(NOW + 4000).length, 1, 'the computer is still there');
  assert.deepEqual(listDiscoveredPeers(NOW + 5000), [], 'five seconds later it is gone');
});

test('the list holds at most thirty-two computers', () => {
  stopPeerDiscovery();
  for (let index = 0; index < 40; index += 1) {
    handleDiscoveryDatagram(announcement(), `198.51.100.${index}`, NOW + index);
  }
  const peers = listDiscoveredPeers(NOW + 40);
  assert.equal(peers.length, 32, 'the list does not grow without a limit');
  assert.equal(peers[0].host, '198.51.100.39', 'the freshest computer stays');
  assert.equal(peers[peers.length - 1].host, '198.51.100.8', 'the oldest ones are gone');
});

test('the discovery starts and stops without breaking anything', () => {
  stopPeerDiscovery();
  startPeerDiscovery(
    () => 4444,
    () => false,
  );
  stopPeerDiscovery();
  assert.deepEqual(listDiscoveredPeers(NOW), [], 'the list is empty after the stop');
});
