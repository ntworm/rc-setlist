// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Typed shape for the OSC messages the bridge consumes.
//
// `osc-min` (and its fork bundled in `bridge/RCBridge`) does not ship
// type declarations. Without a local shape every `osc.fromBuffer(buf)`
// call returns `any`, which propagates ~260 `@typescript-eslint/no-unsafe-*`
// warnings across `osc-client.ts`, `bridge-state.ts`, `setlist-manager.ts`,
// `locator-parser.ts`, and `ws.ts`. The interfaces below are the single
// source of truth for what the bridge actually emits on the wire.

import * as osc from 'osc-min';

/** A scalar OSC argument as defined by the OSC 1.0 spec. */
export type OscScalar = number | string | boolean | null | Uint8Array;

/** The shape the bridge actually emits on the wire for typed arguments.
 *  RC Bridge's `osc-min` fork always wraps typed values in `{ type, value }`.
 *  Bare scalars do not occur in the current bridge; if a future revision
 *  reintroduces them, extend this type with a union. */
export interface OscArg {
  readonly type?: string;
  readonly value?: OscScalar;
}

/** A typed OSC message. `args` carries the values sent after the address. */
export interface OscMessage {
  readonly oscType: 'message';
  readonly address: string;
  readonly args?: readonly OscArg[];
}

/** A typed OSC bundle. Real bridge traffic does not use these, but the
 *  decoder still accepts them so a misbehaving upstream cannot crash the
 *  consumer with an `any` access. */
export interface OscBundle {
  readonly oscType: 'bundle';
  readonly timeTag?: OscScalar;
  readonly packets?: readonly OscNode[];
}

export type OscNode = OscMessage | OscBundle;

/** Narrows an unknown payload to a typed `OscMessage`. */
export function isOscMessage(value: unknown): value is OscMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as { oscType?: unknown; address?: unknown; args?: unknown };
  if (v.oscType !== 'message' || typeof v.address !== 'string') return false;
  // `args` is supposed to be an array; we do not deeply validate each
  // element because the bridge sends heterogeneous typed values.
  if (v.args !== undefined && !Array.isArray(v.args)) return false;
  return true;
}

/** Narrows an unknown payload to a typed `OscBundle`. */
export function isOscBundle(value: unknown): value is OscBundle {
  if (!value || typeof value !== 'object') return false;
  const v = value as { oscType?: unknown };
  return v.oscType === 'bundle';
}

/** Decode a UDP buffer into a typed OSC node, or `null` if the bytes do
 *  not parse. The raw `osc-min` decoder throws on malformed input;
 *  `parseOsc` swallows the throw and returns `null` so the WS listener
 *  can drop bad packets without breaking the broadcast loop. */
export function parseOsc(buffer: Buffer): OscNode | null {
  try {
    const value: unknown = osc.fromBuffer(buffer);
    if (isOscMessage(value)) return value;
    if (isOscBundle(value)) return value;
    return null;
  } catch {
    return null;
  }
}
