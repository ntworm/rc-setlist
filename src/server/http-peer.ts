import * as http from 'node:http';
import type { TLSSocket } from 'node:tls';
import { URL as NodeURL } from 'node:url';
import { attemptPairing } from '../runtime/pairing.js';
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

const REFUSALS: Record<string, [number, string]> = {
  rate_limited: [429, 'too many attempts\n'],
  no_code: [404, 'not found\n'],
  rejected: [403, 'forbidden\n'],
};

function pairPayload(): { peerToken: string; directToken?: string; directHost?: string } {
  return {
    peerToken,
    ...(directToken && directToken !== peerToken ? { directToken } : {}),
    ...(directHost ? { directHost } : {}),
  };
}

/** Answers the pairing request of a computer that wants to be the peer. */
export function handlePeerPair(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new NodeURL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
  const code = url.searchParams.get('code');
  const encrypted = (req.socket as TLSSocket | undefined)?.encrypted === true;
  if (!code || !encrypted) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found\n');
    return;
  }
  const rawAddr = req.socket?.remoteAddress ?? 'unknown';
  const refusal = REFUSALS[attemptPairing(code, rawAddr).status];
  if (refusal) {
    res.writeHead(refusal[0], { 'Content-Type': 'text/plain' });
    res.end(refusal[1]);
    return;
  }
  const masterAddress = rawAddr.startsWith('::ffff:') ? rawAddr.slice(7) : rawAddr;
  writeSlaveRole({ masterAddress, pairedAt: new Date().toISOString() });
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(pairPayload()));
}
