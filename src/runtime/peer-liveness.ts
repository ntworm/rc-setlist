// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The watchdog of the link to the paired computer.
//
// A socket that stops answering is a socket nobody is listening on: the
// command written into it would never arrive, and the show would drift away
// without a word. The link pings the paired computer every couple of seconds
// and calls the link dead when the answer does not come.
//
// The timings live here as well, and they are injectable: a test need not sit
// through five real seconds to watch a link die.

import { WebSocket } from 'ws';

/**
 * The timings of the link.
 */
export interface PeerLinkTiming {
  /** How often the link pings the paired computer. */
  pingIntervalMs: number;
  /** How long the paired computer may stay silent before the link calls it dead. */
  pongTimeoutMs: number;
  /** How long the TLS connection may take. */
  connectTimeoutMs: number;
  /** How long the WebSocket handshake may take. */
  handshakeTimeoutMs: number;
  /** The first reconnect wait in milliseconds. */
  reconnectBaseMs: number;
  /** The longest reconnect wait in milliseconds. */
  reconnectMaxMs: number;
}

const DEFAULT_TIMING: PeerLinkTiming = {
  pingIntervalMs: 2_000,
  pongTimeoutMs: 5_000,
  connectTimeoutMs: 5_000,
  handshakeTimeoutMs: 5_000,
  reconnectBaseMs: 1_000,
  reconnectMaxMs: 30_000,
};

let timing: PeerLinkTiming = { ...DEFAULT_TIMING };

/**
 * The timings the link runs with.
 */
export function peerLinkTiming(): PeerLinkTiming {
  return timing;
}

/**
 * Overrides the timings of the link.
 */
export function setPeerLinkTiming(next: Partial<PeerLinkTiming>): void {
  timing = { ...timing, ...next };
}

/**
 * Puts the timings of the link back.
 */
export function resetPeerLinkTiming(): void {
  timing = { ...DEFAULT_TIMING };
}

/**
 * The watchdog of one socket.
 */
export interface PeerWatchdog {
  /** Stops watching the socket. */
  stop(): void;
}

/**
 * Watches a socket and gives the link up when the peer stops answering.
 *
 * The socket is pinged every `pingIntervalMs`, and the link is called dead
 * when no pong comes within `pongTimeoutMs`.
 */
export function watchPeerSocket(socket: WebSocket, onDead: () => void): PeerWatchdog {
  let pongTimer: NodeJS.Timeout | null = null;

  const armPongTimeout = (): void => {
    if (pongTimer) clearTimeout(pongTimer);
    pongTimer = setTimeout(() => {
      pongTimer = null;
      onDead();
    }, timing.pongTimeoutMs);
    pongTimer.unref?.();
  };

  const pingTimer = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.ping();
    } catch {
      // swallow: the close handler of the link owns the reconnect.
    }
  }, timing.pingIntervalMs);
  pingTimer.unref?.();

  socket.on('pong', armPongTimeout);
  armPongTimeout();

  return {
    stop(): void {
      if (pongTimer) clearTimeout(pongTimer);
      pongTimer = null;
      clearInterval(pingTimer);
      socket.off('pong', armPongTimeout);
    },
  };
}
