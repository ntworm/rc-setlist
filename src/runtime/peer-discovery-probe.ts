// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Whether a computer of the network answers at one of its addresses.
//
// A computer with two interfaces on the same network may say hello from the
// one that cannot be reached. A quick connection tells the two apart: the
// address that opens it is the address to pair with.

import { createConnection } from 'node:net';

/** How long an address has to answer before it counts as silent. */
export const DEFAULT_PROBE_TIMEOUT_MS = 800;

/**
 * Whether something accepts a connection at this address and port.
 *
 * Nothing is sent: the connection is closed as soon as it opens. Never
 * throws and never rejects.
 */
export function probeTcp(
  host: string,
  port: number,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: ReturnType<typeof createConnection> | null = null;
    let timer: NodeJS.Timeout | null = null;
    const finish = (answered: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        // swallow: the attempt is over.
      }
      resolve(answered);
    };
    timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    try {
      socket = createConnection({ host, port });
      socket.unref();
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    } catch {
      finish(false);
    }
  });
}
