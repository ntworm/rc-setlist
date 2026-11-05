// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The one-shot code that lets a second computer claim the peer credential.
//
// The code is short enough to read over a table of gear, so it is also short
// enough to guess: it lives for ten minutes, works exactly once, dies after
// five wrong guesses, and the attempts that reach it are rate limited per
// address and in total. Every comparison is constant time, because the
// length of the guess must not leak through the time it takes to reject it.
//
// The exchange itself lives here too: the pairing answers with the peer
// credential and with the fingerprint of the certificate that answered, so
// the link can pin the computer it was paired with.

import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import { createHash, randomBytes, randomInt, timingSafeEqual, X509Certificate } from 'node:crypto';
import type { TLSSocket } from 'node:tls';
import { httpsOptions } from '../server/cert.js';
import { writePeerConfig, type PeerConfig } from '../preferences.js';
import { bridgeState } from './bridge-state.js';
import { log } from '../util/log.js';

/** How long a pairing code stays usable. */
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
/** Wrong guesses before the code is dead. */
const MAX_PAIRING_FAILURES = 5;
/** Attempts one address may spend in a minute. */
const MAX_ATTEMPTS_PER_IP = 5;
/** Attempts everybody may spend in a minute. */
const MAX_ATTEMPTS_TOTAL = 20;
/** The rate-limit window. */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
/** How many addresses are remembered for the rate limit. */
const MAX_TRACKED_IPS = 256;

export type PairingAttemptStatus = 'accepted' | 'rejected' | 'rate_limited' | 'no_code';

export interface PairingAttempt {
  status: PairingAttemptStatus;
}

interface ActiveCode {
  code: string;
  expiresAt: number;
  failures: number;
}

interface AttemptWindow {
  count: number;
  windowStart: number;
}

let activeCode: ActiveCode | null = null;
const attemptsByIp = new Map<string, AttemptWindow>();
let totalAttempts: AttemptWindow = { count: 0, windowStart: 0 };

/**
 * Compares two strings without leaking their contents through the time the
 * comparison takes. Both sides are hashed first so that two strings of
 * different lengths can still be compared without throwing.
 */
function constantTimeEquals(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/**
 * Issues a fresh pairing code and makes it the only one that works.
 */
export function generatePairingCode(now: number = Date.now()): string {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  activeCode = { code, expiresAt: now + PAIRING_CODE_TTL_MS, failures: 0 };
  return code;
}

/**
 * Reports whether a pairing code is currently usable.
 */
export function hasActivePairingCode(now: number = Date.now()): boolean {
  return activeCode !== null && activeCode.expiresAt > now;
}

/**
 * The pairing code that is usable right now, or null when there is none.
 *
 * The panel redraws itself every time an action comes back, so it needs to
 * read the code that is already alive instead of asking for a new one: a
 * second code would kill the first, and the operator would be reading a
 * number that no longer opens the door.
 */
export function currentPairingCode(now: number = Date.now()): string | null {
  if (!activeCode || activeCode.expiresAt <= now) return null;
  return activeCode.code;
}

/**
 * Drops the pairing code without using it.
 */
export function clearPairingCode(): void {
  activeCode = null;
}

function windowExpired(window: AttemptWindow, now: number): boolean {
  return now - window.windowStart > RATE_LIMIT_WINDOW_MS;
}

function isRateLimited(ip: string, now: number): boolean {
  const ipWindow = attemptsByIp.get(ip);
  if (ipWindow && !windowExpired(ipWindow, now) && ipWindow.count >= MAX_ATTEMPTS_PER_IP) {
    return true;
  }
  if (!windowExpired(totalAttempts, now) && totalAttempts.count >= MAX_ATTEMPTS_TOTAL) {
    return true;
  }
  return false;
}

function pruneAttemptWindows(now: number): void {
  if (attemptsByIp.size <= MAX_TRACKED_IPS) return;
  for (const [ip, window] of attemptsByIp) {
    if (windowExpired(window, now)) attemptsByIp.delete(ip);
    if (attemptsByIp.size <= MAX_TRACKED_IPS) return;
  }
}

function recordAttempt(ip: string, now: number): void {
  const ipWindow = attemptsByIp.get(ip);
  if (!ipWindow || windowExpired(ipWindow, now)) {
    attemptsByIp.set(ip, { count: 1, windowStart: now });
  } else {
    ipWindow.count += 1;
  }
  if (windowExpired(totalAttempts, now)) {
    totalAttempts = { count: 1, windowStart: now };
  } else {
    totalAttempts.count += 1;
  }
  pruneAttemptWindows(now);
}

/**
 * Spends one pairing attempt.
 *
 * The rate limit is checked before the code itself, so a client that keeps
 * hammering a dead code still runs into the limit instead of getting an
 * unlimited stream of free answers.
 */
export function attemptPairing(
  candidate: string,
  ip: string,
  now: number = Date.now(),
): PairingAttempt {
  if (isRateLimited(ip, now)) return { status: 'rate_limited' };
  recordAttempt(ip, now);

  const code = activeCode;
  if (!code || code.expiresAt <= now) {
    activeCode = null;
    return { status: 'no_code' };
  }

  if (!constantTimeEquals(code.code, candidate)) {
    code.failures += 1;
    if (code.failures >= MAX_PAIRING_FAILURES) activeCode = null;
    return { status: 'rejected' };
  }

  activeCode = null;
  return { status: 'accepted' };
}

/**
 * Forgets every pairing code and every attempt counter.
 */
export function resetPairingState(): void {
  activeCode = null;
  attemptsByIp.clear();
  totalAttempts = { count: 0, windowStart: 0 };
}

/**
 * The SHA-256 fingerprint of a DER-encoded certificate.
 */
export function certificateFingerprint(raw: Buffer): string {
  return new X509Certificate(raw).fingerprint256;
}

/**
 * Returns the credential a paired computer presents.
 *
 * It lives beside the security token and is a credential of its own: a
 * computer that holds it may run transport commands here and nothing else.
 * It is never the same string as the security token.
 */
export function getOrGeneratePeerToken(): string {
  const tokenPath = path.join(bridgeState.globalPersistenceDir, 'peer-token');
  try {
    if (fs.existsSync(tokenPath)) {
      const token = fs.readFileSync(tokenPath, 'utf8').trim();
      if (token && token !== bridgeState.authToken) return token;
    }
  } catch (err) {
    log.error('peer', 'Failed to read the peer token.', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let token = randomBytes(16).toString('hex'); // 32 hex characters
  while (token === bridgeState.authToken) token = randomBytes(16).toString('hex');
  try {
    fs.writeFileSync(tokenPath, token, 'utf8');
  } catch (err) {
    log.error('peer', 'Failed to write the peer token.', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return token;
}

/**
 * The fingerprint of the certificate a TLS socket was handed, or null when
 * the socket has none to offer.
 */
export function fingerprintFromSocket(socket: unknown): string | null {
  const tlsSocket = socket as TLSSocket | undefined;
  if (!tlsSocket || typeof tlsSocket.getPeerCertificate !== 'function') return null;
  const certificate = tlsSocket.getPeerCertificate(true) as { raw?: Buffer } | undefined;
  if (!certificate?.raw) return null;
  return certificateFingerprint(certificate.raw);
}

/**
 * The SHA-256 fingerprint of the public key a certificate carries.
 *
 * The pin follows the key and not the certificate: a certificate that is
 * issued again for a new address keeps its key, and the link has to survive
 * that. The format is the one of the certificate fingerprint.
 */
export function publicKeyPin(rawCertificateDer: Buffer): string {
  const spki = new X509Certificate(rawCertificateDer).publicKey.export({
    type: 'spki',
    format: 'der',
  });
  const digest = createHash('sha256').update(spki).digest('hex').toUpperCase();
  const pairs: string[] = [];
  for (let i = 0; i < digest.length; i += 2) pairs.push(digest.slice(i, i + 2));
  return pairs.join(':');
}

/**
 * The pin of the key a TLS socket was handed, or null when the socket has
 * no certificate to offer.
 */
export function publicKeyPinFromSocket(socket: unknown): string | null {
  const tlsSocket = socket as TLSSocket | undefined;
  if (!tlsSocket || typeof tlsSocket.getPeerCertificate !== 'function') return null;
  const certificate = tlsSocket.getPeerCertificate(true) as { raw?: Buffer } | undefined;
  if (!certificate?.raw) return null;
  try {
    return publicKeyPin(certificate.raw);
  } catch {
    return null;
  }
}

/**
 * The fingerprint of the certificate this computer serves with, or null when
 * it has none: a server that fell back to plain HTTP has no certificate.
 *
 * The certificate is what tells two computers apart, so it also tells this
 * computer from itself: an address that answers with this very certificate
 * is this very computer.
 */
function ownCertificateFingerprint(): string | null {
  const cert = httpsOptions?.cert;
  if (!cert) return null;
  try {
    return certificateFingerprint(new X509Certificate(cert).raw);
  } catch {
    return null;
  }
}

export interface PairResult {
  ok: boolean;
  config?: PeerConfig;
  error?: string;
}

/** The port the paired computer's server listens on by default. */
export const DEFAULT_PEER_PORT = 4444;

interface PeerTokenResponse {
  ok: true;
  peerToken: string;
  fingerprint: string;
  keyPin: string | null;
}

interface PeerTokenFailure {
  ok: false;
  error: string;
}

function requestPeerToken(
  host: string,
  port: number,
  code: string,
): Promise<PeerTokenResponse | PeerTokenFailure> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: PeerTokenResponse | PeerTokenFailure): void => {
      if (finished) return;
      finished = true;
      resolve(result);
    };
    const request = https.request(
      {
        host,
        port,
        path: `/peer/pair?code=${encodeURIComponent(code)}`,
        method: 'GET',
        rejectUnauthorized: false,
        timeout: 10_000,
      },
      (response) => {
        const fingerprint = fingerprintFromSocket(response.socket);
        const keyPin = publicKeyPinFromSocket(response.socket);
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          finish(readPairResponse(response.statusCode, body, fingerprint, keyPin));
        });
        response.on('error', (err: Error) => {
          finish({ ok: false, error: err.message });
        });
        response.on('aborted', () => {
          finish({ ok: false, error: 'the pairing response was aborted' });
        });
      },
    );
    request.on('error', (err: Error) => {
      finish({ ok: false, error: err.message });
    });
    request.on('timeout', () => {
      request.destroy();
      finish({ ok: false, error: 'the pairing request timed out' });
    });
    request.end();
  });
}

/**
 * The sentence a refusal carries.
 *
 * A 404 is the second computer saying that it has no code alive: the code is
 * made on the second computer, so the operator has to press Generate code
 * over there. Every other refusal keeps its own wording.
 */
function refusalText(statusCode: number | undefined): string {
  if (statusCode === 404) return 'no active code on that computer';
  return `the pairing request was refused (${statusCode ?? 'no answer'})`;
}

function readPairResponse(
  statusCode: number | undefined,
  body: string,
  fingerprint: string | null,
  keyPin: string | null,
): PeerTokenResponse | PeerTokenFailure {
  if (statusCode !== 200) {
    return { ok: false, error: refusalText(statusCode) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: 'the pairing answer was not JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'the pairing answer carried no peer token' };
  }
  const peerToken = (parsed as Record<string, unknown>).peerToken;
  if (typeof peerToken !== 'string' || !peerToken) {
    return { ok: false, error: 'the pairing answer carried no peer token' };
  }
  if (!fingerprint) {
    return { ok: false, error: 'the paired computer presented no certificate' };
  }
  return { ok: true, peerToken, fingerprint, keyPin };
}

/**
 * Pairs this computer with the one that holds the given host, and stores the
 * credential and the certificate fingerprint it answers with.
 */
export async function pair(
  host: string,
  code: string,
  port: number = DEFAULT_PEER_PORT,
): Promise<PairResult> {
  try {
    const response = await requestPeerToken(host, port, code);
    if (!response.ok) return { ok: false, error: response.error };
    const own = ownCertificateFingerprint();
    if (own !== null && own === response.fingerprint) {
      // The operator typed this computer's own address. The link would
      // point at itself, and every command would come back to this very
      // Live: the play would run twice and a jump would be armed twice.
      return { ok: false, error: 'that address is this computer' };
    }
    const config: PeerConfig = {
      host,
      port,
      peerToken: response.peerToken,
      fingerprint: response.fingerprint,
    };
    // The pin of the key travels with the pairing: a certificate that is
    // issued again keeps its key, and the link has to survive that.
    if (response.keyPin) config.keyPin = response.keyPin;
    if (!writePeerConfig(config)) {
      log.error('peer', 'The pairing could not be stored.');
      return { ok: false, error: 'the pairing could not be stored' };
    }
    return { ok: true, config };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
