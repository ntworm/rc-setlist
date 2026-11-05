// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// What travels on the link to the paired computer, as plain data.

import { createHash } from 'node:crypto';
import type { WebSocket } from 'ws';

/** Whether a value is a plain record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The command id the paired computer sees for a command of this computer.
 *
 * The two ids must not collide, and the paired computer must not be able to
 * guess the original one, so the id is hashed and truncated.
 */
export function peerCommandId(commandId: string): string {
  return `peer-${createHash('sha256').update(commandId, 'utf8').digest('hex').slice(0, 32)}`;
}

/** The fields of a command, without its type and its id. */
export function payloadFields(payload: unknown): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (!isRecord(payload)) return fields;
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'type' || key === 'commandId') continue;
    fields[key] = value;
  }
  return fields;
}

/** Reads a frame of the link, or null when it is not a JSON object. */
export function parseMessage(data: WebSocket.Data): Record<string, unknown> | null {
  try {
    const text =
      typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : Buffer.from(data).toString('utf8');
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
