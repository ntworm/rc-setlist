// Stop order and cleanup for the local server. Extracted from
// `server-lifecycle.ts` so that P06's shutdown test can target it directly
// without spinning up the whole SDK entry point, and so that the rules
// around timers, listeners and sockets live in one place.
//
// The order matters:
//   1. WS server stops accepting and drains.
//   2. HTTP/HTTPS server finishes lingering connections.
//   3. Polling intervals (OSC, cue points, mcp sync) and the connection
//      watchdog are cleared.
//   4. The OSC client closes its socket so the kernel releases the port.
//   5. The SDK sync interval (if any) and command bus are shut down.
//   6. The event logger is flushed last so the above lines can still log.

import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { bridgeState } from './bridge-state.js';

/**
 * Closes the http server.
 */
export async function closeHttpServer(server: HttpServer | HttpsServer | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

/**
 * Clears the timers.
 */
export function clearTimers(): void {
  if (bridgeState.pollInterval) {
    clearInterval(bridgeState.pollInterval);
    bridgeState.pollInterval = null;
  }
  if (bridgeState.sdkSyncInterval) {
    clearInterval(bridgeState.sdkSyncInterval);
    bridgeState.sdkSyncInterval = null;
  }
  if (bridgeState.mcpSyncInterval) {
    clearInterval(bridgeState.mcpSyncInterval);
    bridgeState.mcpSyncInterval = null;
  }
}

/**
 * Marks the server stopped.
 */
export function markServerStopped(): void {
  bridgeState.serverRunning = false;
}
