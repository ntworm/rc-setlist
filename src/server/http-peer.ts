import * as http from 'node:http';
import type { TLSSocket } from 'node:tls';
import { URL as NodeURL } from 'node:url';
import { attemptPairing, type PairingAttempt } from '../runtime/pairing.js';
import { writeSlaveRole } from '../preferences.js';
import { isStrictNonLoopbackIpv4, isValidScopedToken } from '../util/helpers.js';

let peerToken = '';
let directToken = '';
let directHost = '';

/** Sets the credential a paired computer is given when it pairs. */
export function setPeerToken(token: string): void {
  peerToken = token;
}

/** Sets the credential offered to direct phone clients during pairing. */
export function setDirectToken(token: string): void {
  directToken = isValidScopedToken(token) ? token : '';
}

/** Sets the TLS-covered LAN host offered to direct phone clients during pairing. */
export function setDirectHost(host: string): void {
  directHost = isStrictNonLoopbackIpv4(host) ? host : '';
}

function writePlain(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(body);
}

function pairingRefusal(attempt: PairingAttempt): { status: number; body: string } | null {
  if (attempt.status === 'rate_limited') return { status: 429, body: 'too many attempts\n' };
  if (attempt.status === 'no_code') return { status: 404, body: 'not found\n' };
  if (attempt.status === 'rejected') return { status: 403, body: 'forbidden\n' };
  return null;
}

function pairPayload(): { peerToken: string; directToken?: string; directHost?: string } {
  const payload: { peerToken: string; directToken?: string; directHost?: string } = { peerToken };
  if (directToken && directToken !== peerToken) payload.directToken = directToken;
  if (directHost) payload.directHost = directHost;
  return payload;
}

function remoteAddressOf(req: http.IncomingMessage): string {
  const addr = req.socket?.remoteAddress ?? 'unknown';
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr;
}

/** Answers the pairing request of a computer that wants to be the peer. */
export function handlePeerPair(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new NodeURL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
  const code = url.searchParams.get('code');
  const encrypted = (req.socket as TLSSocket | undefined)?.encrypted === true;
  if (!code || !encrypted) {
    writePlain(res, 404, 'not found\n');
    return;
  }
  const refusal = pairingRefusal(attemptPairing(code, req.socket?.remoteAddress ?? 'unknown'));
  if (refusal) {
    writePlain(res, refusal.status, refusal.body);
    return;
  }
  writeSlaveRole({ masterAddress: remoteAddressOf(req), pairedAt: new Date().toISOString() });
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(pairPayload()));
}
