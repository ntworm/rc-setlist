import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanAddress, resolveLanSnapshot } from '../src/server/lan-address.js';

// The studio machine: the lighting cable has a fixed address and no gateway,
// and Windows lists it before the Wi-Fi that the phone is actually on.
const STUDIO = {
  Ethernet: [
    {
      address: '192.168.0.10',
      netmask: '255.255.255.0',
      family: 'IPv4',
      mac: '3c:7c:3f:11:22:33',
      internal: false,
      cidr: '192.168.0.10/24',
    },
    {
      address: '192.168.100.200',
      netmask: '255.255.255.0',
      family: 'IPv4',
      mac: '3c:7c:3f:11:22:33',
      internal: false,
      cidr: '192.168.100.200/24',
    },
  ],
  'Wi-Fi': [
    {
      address: '192.168.1.50',
      netmask: '255.255.255.0',
      family: 'IPv4',
      mac: 'a4:5e:60:44:55:66',
      internal: false,
      cidr: '192.168.1.50/24',
    },
  ],
  'Loopback Pseudo-Interface 1': [
    {
      address: '127.0.0.1',
      netmask: '255.0.0.0',
      family: 'IPv4',
      mac: '00:00:00:00:00:00',
      internal: true,
      cidr: '127.0.0.1/8',
    },
  ],
};

test('the address the system routes through wins over the lighting cable listed first', async () => {
  const result = await resolveLanAddress({
    interfaces: STUDIO,
    probe: async () => '192.168.1.50',
    routes: async () => ({ gateways: ['192.168.1.1'], routeChecked: true }),
  });
  assert.equal(result.primary, '192.168.1.50');
  assert.ok(result.others.includes('192.168.0.10'));
  assert.ok(!result.others.includes('192.168.1.50'));
});

test('a gateway alone is enough when the probe cannot answer', async () => {
  const result = await resolveLanAddress({
    interfaces: STUDIO,
    probe: async () => null,
    routes: async () => ({ gateways: ['192.168.1.1'], routeChecked: true }),
  });
  assert.equal(result.primary, '192.168.1.50');
});

test('with no signal at all the old private-address pick still gives an address', async () => {
  const result = await resolveLanAddress({
    interfaces: STUDIO,
    probe: async () => null,
    routes: async () => ({ gateways: [], routeChecked: false }),
  });
  assert.match(result.primary, /^192\.168\./);
});

test('a probe or a route reading that throws or hangs never blocks the panel', async () => {
  const started = Date.now();
  const result = await resolveLanAddress({
    interfaces: STUDIO,
    probe: () => new Promise(() => {}),
    routes: async () => {
      throw new Error('route is not available');
    },
    timeoutMs: 200,
  });
  assert.ok(Date.now() - started < 2000);
  assert.match(result.primary, /^192\.168\./);
});

test('a machine with only a loopback answers 127.0.0.1', async () => {
  const result = await resolveLanAddress({
    interfaces: { lo: STUDIO['Loopback Pseudo-Interface 1'] },
    probe: async () => null,
    routes: async () => ({ gateways: [], routeChecked: false }),
  });
  assert.equal(result.primary, '127.0.0.1');
  assert.deepEqual(result.others, []);
});

test('the snapshot names the address the panel announces and the rest', async () => {
  const snapshot = await resolveLanSnapshot({
    interfaces: STUDIO,
    probe: async () => '192.168.1.50',
    routes: async () => ({ gateways: ['192.168.1.1'], routeChecked: true }),
  });
  assert.equal(snapshot.primaryIp, '192.168.1.50');
  assert.ok(snapshot.selected);
  assert.equal(snapshot.selected.ip, '192.168.1.50');
  assert.equal(snapshot.mode, 'auto');
  assert.equal(snapshot.pinMissing, false);
  assert.ok(snapshot.candidates.length >= 3);
  assert.ok(snapshot.otherIps.includes('192.168.0.10'));
  assert.ok(!snapshot.otherIps.includes('192.168.1.50'));
});

test('the snapshot of a machine without a network still answers one address', async () => {
  const snapshot = await resolveLanSnapshot({
    interfaces: { lo: STUDIO['Loopback Pseudo-Interface 1'] },
    probe: async () => null,
    routes: async () => ({ gateways: [], routeChecked: false }),
  });
  assert.equal(snapshot.primaryIp, '127.0.0.1');
  assert.deepEqual(snapshot.otherIps, []);
});
