// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The computers of the network, found without an address to type.
//
// The second computer says hello: while it holds a pairing code it sends a
// datagram every second and a half, and the main computer listens for it.
// The datagram carries the name and the port of the computer, and nothing
// else: the code that opens the door never travels over the network.

import { createSocket, type Socket } from 'node:dgram';
import { hostname, networkInterfaces } from 'node:os';
import { DEFAULT_PEER_PORT, hasActivePairingCode } from './pairing.js';
import { getLanAddresses } from '../util/helpers.js';
import { log } from '../util/log.js';

/** The port the computers of the network talk on. */
export const DISCOVERY_PORT = 4447;

/** How often the announcement travels, and how long a computer stays in the list. */
const ANNOUNCE_INTERVAL_MS = 1500;
const PEER_TTL_MS = 5000;

/** What a datagram may carry, and how many computers the list holds. */
const MAX_DATAGRAM_BYTES = 512;
const MAX_PEERS = 32;
const MAX_NAME_LENGTH = 63;

/** The name and the version of this application, and the address of the world. */
const APP_NAME = 'rc-setlist';
const APP_VERSION = 1;
const GLOBAL_BROADCAST = '255.255.255.255';

/** The options of the socket, and the ones it listens with. */
const SOCKET_OPTIONS = { type: 'udp4', reuseAddr: true } as const;
const LISTEN_OPTIONS = { port: DISCOVERY_PORT, address: '0.0.0.0', reuseAddr: true };

/** One computer that answered on the network. */
export type DiscoveredPeer = { host: string; name: string; port: number };

/** What a computer says about itself. */
export type DiscoveryAnnouncement = { app: string; v: number; name: string; port: number };

/** The computers that said hello, by the address they said it from. */
const peers = new Map<string, DiscoveredPeer & { seenAt: number }>();

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
  return {
    app: APP_NAME,
    v: APP_VERSION,
    name: hostname().slice(0, MAX_NAME_LENGTH),
    port: port ?? portOf?.() ?? DEFAULT_PEER_PORT,
  };
}

/** The four bytes of an IPv4 address, or null when it is not one. */
function ipv4Bytes(address: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!match) return null;
  const bytes = match.slice(1).map((part) => Number(part));
  if (bytes.some((byte) => byte > 255)) return null;
  return bytes;
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
  return { app: APP_NAME, v: APP_VERSION, name, port };
}
/** Forgets the computers that stopped saying hello, and keeps the list short. */
function prunePeers(now: number): void {
  for (const [host, peer] of peers) {
    if (now - peer.seenAt >= PEER_TTL_MS) peers.delete(host);
  }
  while (peers.size > MAX_PEERS) {
    const oldest = [...peers.values()].sort((a, b) => a.seenAt - b.seenAt)[0];
    if (!oldest) return;
    peers.delete(oldest.host);
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
  peers.set(host, { host, name: announcement.name, port: announcement.port, seenAt: now });
  prunePeers(now);
}

/** The computers that said hello, the freshest first. */
export function listDiscoveredPeers(now: number = Date.now()): DiscoveredPeer[] {
  prunePeers(now);
  return [...peers.values()]
    .sort((a, b) => b.seenAt - a.seenAt)
    .map((peer) => ({ host: peer.host, name: peer.name, port: peer.port }));
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
  if (open) closeSocket(open);
}
