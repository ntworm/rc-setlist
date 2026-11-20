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
  listDiscoveredPeerEntries,
  setDiscoveryProbeForTests,
  setLocalInterfacesForTests,
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
  // The addresses travel only when the machine has one on a network.
  const keys = Object.keys(said).sort();
  const expected = said.hosts
    ? ['app', 'hosts', 'name', 'port', 'v']
    : ['app', 'name', 'port', 'v'];
  assert.deepEqual(keys, expected);
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

/** A probe the test answers: the addresses that answer, and the tries it saw. */
function controlledProbe(answering) {
  const seen = [];
  const pending = [];
  const probe = (host, port) => {
    seen.push(`${host}:${port}`);
    return new Promise((resolve) => pending.push(() => resolve(answering.includes(host))));
  };
  const settle = async () => {
    while (pending.length) pending.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { probe, seen, settle };
}

/** The interface the main computer of the stage had. */
const MASTER_INTERFACES = [{ address: '198.51.100.37', netmask: '255.255.255.0' }];

/** Starts every test of the addresses from a clean list and a fake network. */
function freshAddresses(probe) {
  stopPeerDiscovery();
  setDiscoveryProbeForTests(probe);
  setLocalInterfacesForTests(MASTER_INTERFACES);
}

/** Puts the real network back after the tests of the addresses. */
function realAddresses() {
  stopPeerDiscovery();
  setDiscoveryProbeForTests(null);
  setLocalInterfacesForTests(null);
}

test('the announcement lists the addresses of the computer and stays under the limit', () => {
  const said = buildAnnouncement(4444);
  const size = Buffer.byteLength(JSON.stringify(said), 'utf8');
  assert.ok(size < 512, `the datagram is ${size} bytes`);
  const own = getLanAddresses().filter((address) => !address.startsWith('169.254.'));
  if (own.length > 0) {
    assert.ok(Array.isArray(said.hosts), 'a machine on a network lists its addresses');
    assert.ok(said.hosts.length <= 8);
    for (const host of said.hosts) assert.ok(own.includes(host));
  }
});

test('the stage case: the address that answers wins over the source that does not', async () => {
  const control = controlledProbe(['198.51.100.38']);
  freshAddresses(control.probe);
  const hosts = ['198.51.100.38', '198.51.100.200'];
  handleDiscoveryDatagram(announcement({ hosts }), '198.51.100.200', NOW);
  assert.equal(listDiscoveredPeers(NOW)[0].host, '198.51.100.200', 'before the tries end');
  await control.settle();
  assert.deepEqual(listDiscoveredPeers(NOW), [
    { host: '198.51.100.38', name: 'Studio', port: 4444 },
  ]);
  assert.deepEqual(control.seen.sort(), ['198.51.100.200:4444', '198.51.100.38:4444']);
  realAddresses();
});

test('when no address answers, the source stays as before', async () => {
  const control = controlledProbe([]);
  freshAddresses(control.probe);
  handleDiscoveryDatagram(
    announcement({ hosts: ['198.51.100.38', '198.51.100.200'] }),
    '198.51.100.200',
    NOW,
  );
  await control.settle();
  assert.equal(listDiscoveredPeers(NOW)[0].host, '198.51.100.200');
  realAddresses();
});

test('an address on a network of this computer wins over another that answers too', async () => {
  const control = controlledProbe(['192.0.2.50', '198.51.100.38']);
  freshAddresses(control.probe);
  handleDiscoveryDatagram(
    announcement({ hosts: ['192.0.2.50', '198.51.100.38'] }),
    '192.0.2.50',
    NOW,
  );
  await control.settle();
  assert.equal(listDiscoveredPeers(NOW)[0].host, '198.51.100.38');
  realAddresses();
});

test('the same computer seen from two addresses is one row', async () => {
  const control = controlledProbe(['198.51.100.38']);
  freshAddresses(control.probe);
  const hosts = ['198.51.100.38', '198.51.100.200'];
  handleDiscoveryDatagram(announcement({ hosts }), '198.51.100.200', NOW);
  handleDiscoveryDatagram(announcement({ hosts: [...hosts].reverse() }), '198.51.100.38', NOW + 1);
  await control.settle();
  const entries = listDiscoveredPeerEntries(NOW + 1);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].host, '198.51.100.38');
  assert.deepEqual([...entries[0].addresses].sort(), ['198.51.100.200', '198.51.100.38']);
  // Each address is tried once, not once per datagram.
  assert.equal(control.seen.length, 2);
  realAddresses();
});

test('an announcement of the first version is read as before and tries nothing', async () => {
  const control = controlledProbe(['192.0.2.20']);
  freshAddresses(control.probe);
  handleDiscoveryDatagram(announcement(), '192.0.2.20', NOW);
  await control.settle();
  assert.deepEqual(listDiscoveredPeers(NOW), [{ host: '192.0.2.20', name: 'Studio', port: 4444 }]);
  assert.deepEqual(control.seen, [], 'one address has nothing to choose between');
  realAddresses();
});

test('addresses that cannot be a computer of the network are left out', async () => {
  const control = controlledProbe([]);
  freshAddresses(control.probe);
  handleDiscoveryDatagram(announcement({ hosts: 'not a list' }), '192.0.2.21', NOW);
  const junk = ['999.1.1.1', '127.0.0.1', '169.254.1.1', '224.0.0.1', '0.1.2.3', 42, null, 'x'];
  handleDiscoveryDatagram(announcement({ hosts: junk }), '192.0.2.22', NOW);
  const many = Array.from({ length: 20 }, (_, index) => `192.0.2.${100 + index}`);
  handleDiscoveryDatagram(announcement({ hosts: many }), '192.0.2.23', NOW);
  const entries = listDiscoveredPeerEntries(NOW);
  assert.equal(entries.length, 3, 'no announcement is refused for its addresses');
  const byHost = Object.fromEntries(entries.map((entry) => [entry.host, entry.addresses]));
  assert.deepEqual(byHost['192.0.2.21'], ['192.0.2.21']);
  assert.deepEqual(byHost['192.0.2.22'], ['192.0.2.22']);
  assert.ok(byHost['192.0.2.23'].length <= 9, 'at most eight listed addresses beside the source');
  await control.settle();
  realAddresses();
});

test('a try that ends after the stop changes nothing', async () => {
  const control = controlledProbe(['198.51.100.38']);
  freshAddresses(control.probe);
  handleDiscoveryDatagram(
    announcement({ hosts: ['198.51.100.38', '198.51.100.200'] }),
    '198.51.100.200',
    NOW,
  );
  stopPeerDiscovery();
  await control.settle();
  handleDiscoveryDatagram(
    announcement({ hosts: ['198.51.100.38', '198.51.100.200'] }),
    '198.51.100.200',
    NOW,
  );
  assert.equal(listDiscoveredPeers(NOW)[0].host, '198.51.100.200', 'the old answer is gone');
  await control.settle();
  realAddresses();
});
