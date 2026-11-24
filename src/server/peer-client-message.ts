import type { ClientMessage, DirectWireFields, PeerHealthTier, PeerHealthView } from '../types.js';
import { isPeerRelayWireType } from '../commands/handlers/peer.js';

export type PeerDecodeResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: 'invalid_message'; message: string; commandId?: string };

const COMMAND_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_COMMAND_ID_LENGTH = 128;
const MAX_EXTENSION_VERSION_LENGTH = 32;
const MAX_LINK_PROTOCOL = 1_000;
const MAX_SESSION_ID_LENGTH = 128;
const MAX_CUES_FINGERPRINT_LENGTH = 128;
const MAX_PEER_KEY_LENGTH = 256;
const MAX_BEAT = 1_000_000;
const MIN_TEMPO = 1;
const MAX_TEMPO = 1_000;
const MAX_PEER_COMMAND_TTL_MS = 600_000;

const TRANSPORT_WIRE_TYPES: ReadonlySet<string> = new Set([
  'play',
  'stop',
  'jump_time',
  'trigger_count_in',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maxLength &&
    value.trim().length > 0 &&
    !hasControlChars(value)
  );
}

function isSafeCommandId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_COMMAND_ID_LENGTH &&
    COMMAND_ID_PATTERN.test(value)
  );
}

function invalid(message: string, commandId?: string): PeerDecodeResult {
  return commandId
    ? { ok: false, code: 'invalid_message', message, commandId }
    : { ok: false, code: 'invalid_message', message };
}

function withCommandId(message: ClientMessage, commandId?: string): PeerDecodeResult {
  return {
    ok: true,
    message: commandId ? { ...message, commandId } : message,
  };
}

function isPeerHealthTier(value: unknown): value is PeerHealthTier {
  return value === 'ok' || value === 'unstable' || value === 'down';
}

function isValidCuesFingerprint(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_CUES_FINGERPRINT_LENGTH &&
    !hasControlChars(value)
  );
}

function isValidSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_SESSION_ID_LENGTH &&
    COMMAND_ID_PATTERN.test(value)
  );
}

interface HandshakeExtras {
  extensionVersion?: string;
  linkProtocol?: number;
  sessionId?: string;
}

type HandshakeExtrasResult = { ok: true; extras: HandshakeExtras } | { ok: false; message: string };

/**
 * Validates optional capability and session fields on a handshake message.
 */
export function decodeHandshakeExtras(input: Record<string, unknown>): HandshakeExtrasResult {
  const extras: HandshakeExtras = {};
  if (input.extensionVersion !== undefined) {
    if (!isBoundedText(input.extensionVersion, MAX_EXTENSION_VERSION_LENGTH)) {
      return { ok: false, message: 'Invalid extensionVersion for handshake.' };
    }
    extras.extensionVersion = input.extensionVersion;
  }
  if (input.linkProtocol !== undefined) {
    if (!isFiniteInteger(input.linkProtocol, 1, MAX_LINK_PROTOCOL)) {
      return { ok: false, message: 'Invalid linkProtocol for handshake.' };
    }
    extras.linkProtocol = input.linkProtocol;
  }
  if (input.sessionId !== undefined) {
    if (!isValidSessionId(input.sessionId)) {
      return { ok: false, message: 'Invalid sessionId for handshake.' };
    }
    extras.sessionId = input.sessionId;
  }
  return { ok: true, extras };
}

/**
 * Validates and canonicalizes a `PeerHealthView` snapshot.
 */
export function decodePeerHealthView(value: unknown): PeerHealthView | null {
  if (!isRecord(value)) return null;
  if (!isPeerHealthTier(value.linkHealth)) return null;
  if (
    typeof value.canAcknowledge !== 'boolean' ||
    typeof value.oscConnected !== 'boolean' ||
    typeof value.liveReady !== 'boolean' ||
    typeof value.outOfStep !== 'boolean'
  ) {
    return null;
  }
  if (!isValidCuesFingerprint(value.cuesFingerprint)) return null;
  return {
    linkHealth: value.linkHealth,
    canAcknowledge: value.canAcknowledge,
    oscConnected: value.oscConnected,
    liveReady: value.liveReady,
    cuesFingerprint: value.cuesFingerprint,
    outOfStep: value.outOfStep,
  };
}

/**
 * Decodes a `peer_hb` heartbeat frame.
 */
export function decodePeerHb(input: Record<string, unknown>, commandId?: string): PeerDecodeResult {
  if (!isFiniteInteger(input.hbId, 0, Number.MAX_SAFE_INTEGER)) {
    return invalid('Invalid hbId for peer_hb.', commandId);
  }
  if (!isNonNegativeNumber(input.t0)) {
    return invalid('Invalid t0 for peer_hb.', commandId);
  }
  const view = decodePeerHealthView(input.view);
  if (!view) return invalid('Invalid view for peer_hb.', commandId);
  return withCommandId({ type: 'peer_hb', hbId: input.hbId, t0: input.t0, view }, commandId);
}

/**
 * Decodes a `peer_hb_ack` heartbeat acknowledgement frame.
 */
export function decodePeerHbAck(
  input: Record<string, unknown>,
  commandId?: string,
): PeerDecodeResult {
  if (!isFiniteInteger(input.hbId, 0, Number.MAX_SAFE_INTEGER)) {
    return invalid('Invalid hbId for peer_hb_ack.', commandId);
  }
  if (
    !isNonNegativeNumber(input.t0) ||
    !isNonNegativeNumber(input.t1) ||
    !isNonNegativeNumber(input.t2)
  ) {
    return invalid('Invalid timestamps for peer_hb_ack.', commandId);
  }
  const view = decodePeerHealthView(input.view);
  if (!view) return invalid('Invalid view for peer_hb_ack.', commandId);
  return withCommandId(
    {
      type: 'peer_hb_ack',
      hbId: input.hbId,
      t0: input.t0,
      t1: input.t1,
      t2: input.t2,
      view,
    },
    commandId,
  );
}

/**
 * Decodes a `peer_health_ack` operator acknowledgement frame.
 */
export function decodePeerHealthAck(
  input: Record<string, unknown>,
  commandId?: string,
): PeerDecodeResult {
  const peerKey = input.peerKey;
  if (peerKey !== undefined && !isBoundedText(peerKey, MAX_PEER_KEY_LENGTH)) {
    return invalid('Invalid peerKey for peer_health_ack.', commandId);
  }
  return withCommandId(
    peerKey === undefined ? { type: 'peer_health_ack' } : { type: 'peer_health_ack', peerKey },
    commandId,
  );
}

/**
 * Decodes a `peer_target` state frame.
 */
export function decodePeerTarget(
  input: Record<string, unknown>,
  commandId?: string,
): PeerDecodeResult {
  if (!isFiniteInteger(input.transportSeq, 0, Number.MAX_SAFE_INTEGER)) {
    return invalid('Invalid transportSeq for peer_target.', commandId);
  }
  if (!isBoundedNumber(input.beat, 0, MAX_BEAT)) {
    return invalid('Invalid beat for peer_target.', commandId);
  }
  if (!isBoundedNumber(input.tempo, MIN_TEMPO, MAX_TEMPO)) {
    return invalid('Invalid tempo for peer_target.', commandId);
  }
  if (
    typeof input.section !== 'boolean' ||
    typeof input.isPlaying !== 'boolean' ||
    typeof input.jumpPending !== 'boolean' ||
    typeof input.loopActive !== 'boolean'
  ) {
    return invalid('Invalid flags for peer_target.', commandId);
  }
  return withCommandId(
    {
      type: 'peer_target',
      transportSeq: input.transportSeq,
      beat: input.beat,
      section: input.section,
      isPlaying: input.isPlaying,
      tempo: input.tempo,
      jumpPending: input.jumpPending,
      loopActive: input.loopActive,
    },
    commandId,
  );
}

function isSafetyStopCommand(msg: ClientMessage): boolean {
  return msg.type === 'stop' || (msg.type === 'set_panic' && msg.active);
}

function isTransportPeerCommand(msg: ClientMessage): boolean {
  return TRANSPORT_WIRE_TYPES.has(msg.type) || (msg.type === 'set_panic' && msg.active);
}

function decodePeerCommandTtl(
  raw: unknown,
  safetyStop: boolean,
): { ok: true; value: number | null } | { ok: false } {
  if (raw === null) return safetyStop ? { ok: true, value: null } : { ok: false };
  if (isBoundedNumber(raw, 0, MAX_PEER_COMMAND_TTL_MS) && raw > 0) {
    return { ok: true, value: raw };
  }
  return { ok: false };
}

function decodePeerCommandSeq(
  raw: unknown,
  transport: boolean,
): { ok: true; value: number | null } | { ok: false } {
  if (!transport) return raw === null ? { ok: true, value: null } : { ok: false };
  if (isFiniteInteger(raw, 1, Number.MAX_SAFE_INTEGER)) return { ok: true, value: raw };
  return { ok: false };
}

function hasDirectMetaKey(obj: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(obj, 'ttlMs') ||
    Object.prototype.hasOwnProperty.call(obj, 'transportSeq')
  );
}

/** Validates optional direct-wire `ttlMs` and `transportSeq` fields on transport commands. */
export function decodeOptionalDirectMeta(
  input: Record<string, unknown>,
  safetyStop: boolean,
  transport: boolean,
): { ok: true; meta: DirectWireFields } | { ok: false; message: string } {
  const meta: DirectWireFields = {};
  if (input.ttlMs !== undefined) {
    const ttl = decodePeerCommandTtl(input.ttlMs, safetyStop);
    if (!ttl.ok) return { ok: false, message: 'Invalid ttlMs.' };
    meta.ttlMs = ttl.value;
  }
  if (input.transportSeq !== undefined) {
    const seq = decodePeerCommandSeq(input.transportSeq, transport);
    if (!seq.ok) return { ok: false, message: 'Invalid transportSeq.' };
    meta.transportSeq = seq.value;
  }
  return { ok: true, meta };
}

/** Decodes an `rtt_ping` latency measurement frame. */
export function decodeRttPing(
  input: Record<string, unknown>,
  commandId?: string,
): PeerDecodeResult {
  if (!isNonNegativeNumber(input.t0)) return invalid('Invalid t0 for rtt_ping.', commandId);
  return withCommandId({ type: 'rtt_ping', t0: input.t0 }, commandId);
}

/**
 * Decodes a `peer_command` envelope around a relayed show command.
 */
export function decodePeerCommand(
  input: Record<string, unknown>,
  decodeInner: (input: unknown) => PeerDecodeResult,
  commandId?: string,
): PeerDecodeResult {
  if (!commandId || !isSafeCommandId(commandId)) {
    return invalid('Invalid commandId for peer_command.');
  }
  if (!isRecord(input.command) || hasDirectMetaKey(input.command)) {
    return invalid('Invalid command for peer_command.', commandId);
  }
  const inner = decodeInner(input.command);
  if (!inner.ok) return invalid('Invalid inner command for peer_command.', commandId);
  if (!isPeerRelayWireType(inner.message.type)) {
    return invalid('Unsupported inner command type for peer_command.', commandId);
  }
  const ttl = decodePeerCommandTtl(input.ttlMs, isSafetyStopCommand(inner.message));
  if (!ttl.ok) return invalid('Invalid ttlMs for peer_command.', commandId);
  const seq = decodePeerCommandSeq(input.transportSeq, isTransportPeerCommand(inner.message));
  if (!seq.ok) return invalid('Invalid transportSeq for peer_command.', commandId);
  return {
    ok: true,
    message: {
      type: 'peer_command',
      commandId,
      ttlMs: ttl.value,
      transportSeq: seq.value,
      command: inner.message,
    },
  };
}
