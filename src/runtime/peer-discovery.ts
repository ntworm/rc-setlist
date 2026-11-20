// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The computers of the network, found without an address to type.
//
// The second computer says hello: while it holds a pairing code it sends a
// datagram every second and a half, and the main computer listens for it.
// The datagram carries the name, the port and the addresses of the computer,
// and nothing else: the code that opens the door never travels over the
// network.
//
// A computer with two interfaces on the same network may say hello from the
// one that cannot be reached, so the main computer tries the addresses the
// announcement lists and keeps the first one that answers.

import { createSocket, type Socket } from 'node:dgram';
import { hostname, networkInterfaces } from 'node:os';
import { DEFAULT_PEER_PORT, hasActivePairingCode } from './pairing.js';
import { getLanAddresses } from '../util/helpers.js';
import { log } from '../util/log.js';
import { DEFAULT_PROBE_TIMEOUT_MS, probeTcp } from './peer-discovery-probe.js';

/** The port the computers of the network talk on. */
export const DISCOVERY_PORT = 4447;

/** How often the announcement travels, and how long a computer stays in the list. */
const ANNOUNCE_INTERVAL_MS = 1500;
const PEER_TTL_MS = 5000;

/** What a datagram may carry, and how many computers the list holds. */
const MAX_DATAGRAM_BYTES = 512;
const MAX_PEERS = 32;
const MAX_NAME_LENGTH = 63;
const MAX_HOSTS = 8;

/** How often one address is tried again, and how many tries run at once. */
const PROBE_INTERVAL_MS = 10_000;
const MAX_PROBES_IN_FLIGHT = 8;
const MAX_PROBE_RECORDS = 256;

/** The name and the version of this application, and the address of the world. */
const APP_NAME = 'rc-setlist';
const APP_VERSION = 1;
const GLOBAL_BROADCAST = '255.255.255.255';

/** The options of the socket, and the ones it listens with. */
const SOCKET_OPTIONS = { type: 'udp4', reuseAddr: true } as const;
const LISTEN_OPTIONS = { port: DISCOVERY_PORT, address: '0.0.0.0', reuseAddr: true };

/** One computer that answered on the network. */
export type DiscoveredPeer = { host: string; name: string; port: number };

/** What a computer says about itself. The addresses are optional: a reader
 *  of the first version ignores them and keeps the address of the datagram. */
export type DiscoveryAnnouncement = {
  app: string;
  v: number;
  name: string;
  port: number;
  hosts?: string[];
};

/** One computer that said hello, with every address it may be reached at. */
type PeerEntry = {
  key: string;
  /** The address the datagram came from. */
  source: string;
  name: string;
  port: number;
  /** The source first, then the addresses the announcement listed. */
  candidates: string[];
  seenAt: number;
};

/** One interface of this computer, as the subnet test needs it. */
export type LocalInterface = { address: string; netmask: string };

/** How a probe is made; the tests hand in one of their own. */
export type DiscoveryProbe = (host: string, port: number, timeoutMs: number) => Promise<boolean>;

/** The computers that said hello, by the addresses they list or the one they said it from. */
const peers = new Map<string, PeerEntry>();

/** What the last try of each address and port found, and when it started. */
const probes = new Map<string, { answered: boolean | null; pending: boolean; at: number }>();
let probesInFlight = 0;
/** Bumped on stop, so a try that ends after it writes nothing. */
let probeGeneration = 0;
let probeOverride: DiscoveryProbe | null = null;
let interfacesOverride: LocalInterface[] | null = null;

/** The socket that listens and announces, and whether it may send. */
let socket: Socket | null = null;
let listening = false;

/** The timer that announces this computer, and what the server tells it. */
let announceTimer: NodeJS.Timeout | null = null;
let portOf: (() => number) | null = null;
let tlsOf: (() => boolean) | null = null;

/** Whether the failure of the socket was already told. */
let socketErrorTold = false;

/**
 * The announcement this computer makes: its name and the port it serves on.
 *
 * The pairing code and the token are not part of it: a datagram is read by
 * anybody who is on the same wire.
 */
export function buildAnnouncement(port?: number): DiscoveryAnnouncement {
  const announcement: DiscoveryAnnouncement = {
    app: APP_NAME,
    v: APP_VERSION,
    name: hostname().slice(0, MAX_NAME_LENGTH),
    port: port ?? portOf?.() ?? DEFAULT_PEER_PORT,
  };
  const hosts: string[] = [];
  for (const address of getLanAddresses()) {
    const usable = usableHost(address);
    if (usable && !hosts.includes(usable)) hosts.push(usable);
    if (hosts.length >= MAX_HOSTS) break;
  }
  // The datagram has a size it may not reach: the last addresses go first.
  while (hosts.length > 0) {
    const sized = { ...announcement, hosts };
    if (Buffer.byteLength(JSON.stringify(sized), 'utf8') < MAX_DATAGRAM_BYTES) return sized;
    hosts.pop();
  }
  return announcement;
}

/** The four bytes of an IPv4 address, or null when it is not one. */
function ipv4Bytes(address: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!match) return null;
  const bytes = match.slice(1).map((part) => Number(part));
  if (bytes.some((byte) => byte > 255)) return null;
  return bytes;
}
/**
 * The address written the one way, when it is one another computer could be
 * reached at: not the network itself, not this machine, not a link without a
 * server, not a group nor the reserved range above it.
 */
function usableHost(address: string): string | null {
  const bytes = ipv4Bytes(address);
  if (!bytes) return null;
  const [first = 0, second = 0] = bytes;
  if (first === 0 || first === 127 || first >= 224) return null;
  if (first === 169 && second === 254) return null;
  return bytes.join('.');
}
/** Whether an address sits on the network one interface of this computer is on. */
function sameSubnet(address: string, local: LocalInterface): boolean {
  const host = ipv4Bytes(address);
  const other = ipv4Bytes(local.address);
  const mask = ipv4Bytes(local.netmask);
  if (!host || !other || !mask) return false;
  return host.every((byte, index) => {
    const bits = mask[index] ?? 0;
    return (byte & bits) === ((other[index] ?? 0) & bits);
  });
}
/** Whether an address sits on a network of this computer, and is not its broadcast. */
function onLocalSubnet(address: string): boolean {
  return localInterfaces().some(
    (local) =>
      sameSubnet(address, local) && broadcastAddress(local.address, local.netmask) !== address,
  );
}
/** The interfaces of this computer that face a network. */
function localInterfaces(): LocalInterface[] {
  if (interfacesOverride) return interfacesOverride;
  const out: LocalInterface[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        out.push({ address: addr.address, netmask: addr.netmask });
      }
    }
  }
  return out;
}
/** The broadcast address of one interface: the network with the mask turned off. */
function broadcastAddress(address: string, netmask: string): string | null {
  const host = ipv4Bytes(address);
  const mask = ipv4Bytes(netmask);
  if (!host || !mask) return null;
  return host.map((byte, index) => byte | (~(mask[index] ?? 255) & 255)).join('.');
}
/** The addresses the announcement travels to: every network of the machine. */
function broadcastTargets(): string[] {
  const targets = new Set<string>([GLOBAL_BROADCAST]);
  for (const addrs of Object.values(networkInterfaces())) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const broadcast = broadcastAddress(addr.address, addr.netmask);
      if (broadcast) targets.add(broadcast);
    }
  }
  return [...targets];
}
/** Whether a name is one a computer may call itself. */
function isPrintableName(name: string): boolean {
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) return false;
  return /^[\x20-\x7e]+$/.test(name);
}
/** The record a datagram carries, or null when it is not one. */
function parseDatagram(buffer: Buffer): Record<string, unknown> | null {
  if (buffer.length >= MAX_DATAGRAM_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(buffer.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
/** The port a computer serves on, or null when the number is not a port. */
function readPort(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 1 || value > 65535) return null;
  return value;
}
/** The announcement a datagram carries, or null when it is not one. */
function readAnnouncement(buffer: Buffer): DiscoveryAnnouncement | null {
  const record = parseDatagram(buffer);
  if (!record) return null;
  if (record.app !== APP_NAME || record.v !== APP_VERSION) return null;
  const name = record.name;
  if (typeof name !== 'string' || !isPrintableName(name)) return null;
  const port = readPort(record.port);
  if (port === null) return null;
  const hosts = readHosts(record.hosts);
  return { app: APP_NAME, v: APP_VERSION, name, port, ...(hosts.length ? { hosts } : {}) };
}
/**
 * The addresses an announcement lists, the ones that cannot be a computer of
 * the network left out. A list that is not one is no list: the announcement
 * still counts, with the address of its datagram alone.
 */
function readHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const own = getLanAddresses();
  const hosts: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const usable = usableHost(entry);
    if (!usable || own.includes(usable) || hosts.includes(usable)) continue;
    // Only an address on a network of this computer is tried: a datagram
    // nobody signed must not send this computer knocking elsewhere.
    if (!onLocalSubnet(usable)) continue;
    hosts.push(usable);
    if (hosts.length >= MAX_HOSTS) break;
  }
  return hosts;
}
/** The address of one try. */
function probeKey(host: string, port: number): string {
  return `${host}:${port}`;
}
/** Forgets the oldest tries that ended, so the record stays short. */
function pruneProbes(): void {
  if (probes.size <= MAX_PROBE_RECORDS) return;
  const ended = [...probes.entries()]
    .filter(([, record]) => !record.pending)
    .sort((a, b) => a[1].at - b[1].at);
  for (const [key] of ended) {
    if (probes.size <= MAX_PROBE_RECORDS) return;
    probes.delete(key);
  }
}
/**
 * Tries the addresses of one computer in the background. Each address is
 * tried at most once every ten seconds, and only a few at a time.
 */
function startProbes(candidates: string[], port: number, now: number): void {
  // A computer with one address has nothing to choose between.
  if (candidates.length < 2) return;
  for (const host of candidates) {
    const key = probeKey(host, port);
    const previous = probes.get(key);
    if (previous && (previous.pending || now - previous.at < PROBE_INTERVAL_MS)) continue;
    if (probesInFlight >= MAX_PROBES_IN_FLIGHT) break;
    probes.set(key, { answered: previous?.answered ?? null, pending: true, at: now });
    probeOne(host, port, now);
  }
  pruneProbes();
}
/** Tries one address, and writes down what it found unless the discovery stopped. */
function probeOne(host: string, port: number, now: number): void {
  const key = probeKey(host, port);
  probesInFlight += 1;
  const generation = probeGeneration;
  const settle = (answered: boolean): void => {
    if (generation !== probeGeneration) return;
    probesInFlight = Math.max(0, probesInFlight - 1);
    probes.set(key, { answered, pending: false, at: now });
  };
  let attempt: Promise<boolean>;
  try {
    attempt = (probeOverride ?? probeTcp)(host, port, DEFAULT_PROBE_TIMEOUT_MS);
  } catch {
    attempt = Promise.resolve(false);
  }
  attempt.then(
    (answered) => settle(answered === true),
    () => settle(false),
  );
}
/**
 * The address to pair with: the first that answered, those on a network of
 * this computer first, then the source, then the rest. With no answer yet,
 * the address the datagram came from, as before.
 */
function chosenHost(entry: PeerEntry): string {
  const locals = localInterfaces();
  const onLocal = entry.candidates.filter((host) =>
    locals.some((local) => sameSubnet(host, local)),
  );
  const order = [...new Set([...onLocal, entry.source, ...entry.candidates])];
  for (const host of order) {
    if (probes.get(probeKey(host, entry.port))?.answered === true) return host;
  }
  return entry.source;
}
/** Forgets the computers that stopped saying hello, and keeps the list short. */
function prunePeers(now: number): void {
  for (const [key, peer] of peers) {
    if (now - peer.seenAt >= PEER_TTL_MS) peers.delete(key);
  }
  while (peers.size > MAX_PEERS) {
    const oldest = [...peers.values()].sort((a, b) => a.seenAt - b.seenAt)[0];
    if (!oldest) return;
    peers.delete(oldest.key);
  }
}

/** Remembers one computer that said hello, and refuses the ones of this computer. */
export function handleDiscoveryDatagram(
  buffer: Buffer,
  remoteAddress: string,
  now: number = Date.now(),
): void {
  const announcement = readAnnouncement(buffer);
  if (!announcement) return;
  const host = remoteAddress.replace(/^::ffff:/, '');
  if (!host || host === '127.0.0.1' || host === '::1') return;
  if (getLanAddresses().includes(host)) return;
  const hosts = announcement.hosts ?? [];
  // A computer that lists its addresses is the same computer whichever of
  // them the datagram left from.
  const key = hosts.length ? `hosts:${[...hosts].sort().join(',')}:${announcement.port}` : host;
  const candidates = [...new Set([host, ...hosts])];
  peers.set(key, {
    key,
    source: host,
    name: announcement.name,
    port: announcement.port,
    candidates,
    seenAt: now,
  });
  prunePeers(now);
  startProbes(candidates, announcement.port, now);
}

/** The computers that said hello, the freshest first, with every address of each. */
export function listDiscoveredPeerEntries(
  now: number = Date.now(),
): Array<DiscoveredPeer & { addresses: string[] }> {
  prunePeers(now);
  return [...peers.values()]
    .sort((a, b) => b.seenAt - a.seenAt)
    .map((peer) => ({
      host: chosenHost(peer),
      name: peer.name,
      port: peer.port,
      addresses: [...peer.candidates],
    }));
}

/** The computers that said hello, the freshest first. */
export function listDiscoveredPeers(now: number = Date.now()): DiscoveredPeer[] {
  return listDiscoveredPeerEntries(now).map(({ host, name, port }) => ({ host, name, port }));
}

/** Hands in the probe the tests control, or null for the real one. */
export function setDiscoveryProbeForTests(probe: DiscoveryProbe | null): void {
  probeOverride = probe;
}

/** Hands in the interfaces the tests pretend to have, or null for the real ones. */
export function setLocalInterfacesForTests(list: LocalInterface[] | null): void {
  interfacesOverride = list;
}
/** Tells the network once that the socket could not do its work. */
function tellSocketError(err: Error): void {
  if (socketErrorTold) return;
  socketErrorTold = true;
  log.warn('peer', 'The peer discovery socket could not work.', { error: err.message });
}
/** Closes the socket, if it is still open. */
function closeSocket(sock: Socket): void {
  try {
    sock.close();
  } catch {
    // swallow: the socket is going away anyway.
  }
}

/** Opens the socket that listens for the computers of the network. */
function openSocket(): void {
  const sock = createSocket(SOCKET_OPTIONS);
  sock.on('error', (err) => {
    tellSocketError(err);
    // A socket that failed is never written to again.
    if (socket === sock) {
      socket = null;
      listening = false;
    }
    closeSocket(sock);
  });
  sock.on('message', (buffer, remote) => {
    handleDiscoveryDatagram(buffer, remote.address, Date.now());
  });
  sock.on('listening', () => {
    listening = true;
    // The broadcast may only be set once the socket is bound: a socket that
    // is not bound yet has nothing to broadcast from.
    try {
      sock.setBroadcast(true);
    } catch (err) {
      tellSocketError(err instanceof Error ? err : new Error(String(err)));
    }
  });
  sock.bind(LISTEN_OPTIONS);
  sock.unref();
  socket = sock;
}

/** Says hello to the network, when there is a code to hand out. */
function announce(): void {
  if (!socket || !listening) return;
  if (!hasActivePairingCode()) return;
  if (!tlsOf?.()) return;
  const payload = Buffer.from(JSON.stringify(buildAnnouncement()), 'utf8');
  for (const target of broadcastTargets()) {
    try {
      socket.send(payload, DISCOVERY_PORT, target, (err) => {
        if (err) tellSocketError(err);
      });
    } catch (err) {
      tellSocketError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

/** Starts the discovery: the socket that listens and the announcement. */
export function startPeerDiscovery(getPort: () => number, getTls: () => boolean): void {
  stopPeerDiscovery();
  portOf = getPort;
  tlsOf = getTls;
  try {
    openSocket();
  } catch (err) {
    // A machine that refuses the socket still runs the server: the address
    // is typed by hand there.
    tellSocketError(err instanceof Error ? err : new Error(String(err)));
  }
  announceTimer = setInterval(announce, ANNOUNCE_INTERVAL_MS);
  announceTimer.unref?.();
}

/** Stops the discovery and forgets the computers that said hello. */
export function stopPeerDiscovery(): void {
  if (announceTimer) {
    clearInterval(announceTimer);
    announceTimer = null;
  }
  const open = socket;
  socket = null;
  listening = false;
  portOf = null;
  tlsOf = null;
  socketErrorTold = false;
  peers.clear();
  probes.clear();
  probesInFlight = 0;
  probeGeneration += 1;
  if (open) closeSocket(open);
}
