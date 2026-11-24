import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StartServerOptions } from '../types.js';
import { bridgeState } from './bridge-state.js';
import { certCoversRequiredAltNames } from '../server/cert.js';
import { resolveLanAddress } from '../server/lan-address.js';
import { atomicWriteFileSync } from '../util/atomic-write.js';
import { isStrictNonLoopbackIpv4, isValidScopedToken } from '../util/helpers.js';
import { log } from '../util/log.js';

function readStoredDirectToken(tokenPath: string): string {
  try {
    if (!fs.existsSync(tokenPath)) return '';
    const token = fs.readFileSync(tokenPath, 'utf8').replace(/\r?\n$/, '');
    const ok = isValidScopedToken(token);
    return ok && token !== bridgeState.authToken && token !== bridgeState.peerToken ? token : '';
  } catch (err) {
    log.error('peer', 'Failed to read the direct token.', { error: String(err) });
    return '';
  }
}

/** Returns the credential for direct phone-to-slave connections. */
export function getOrGenerateDirectToken(): string {
  const tokenPath = path.join(bridgeState.globalPersistenceDir, 'direct-token');
  const existing = readStoredDirectToken(tokenPath);
  if (existing) {
    try {
      fs.chmodSync(tokenPath, 0o600);
    } catch (err) {
      log.error('peer', 'Failed to restrict the direct token file mode.', { error: String(err) });
    }
    return existing;
  }
  let token = randomBytes(16).toString('hex');
  while (token === bridgeState.authToken || token === bridgeState.peerToken) {
    token = randomBytes(16).toString('hex');
  }
  try {
    atomicWriteFileSync(tokenPath, token, { mode: 0o600 });
  } catch (err) {
    log.error('peer', 'Failed to write the direct token.', { error: String(err) });
  }
  return token;
}

async function safePrimaryLan(
  fn: () => Promise<{ primary: string; others: string[] }>,
): Promise<string> {
  try {
    return (await fn()).primary;
  } catch {
    return '';
  }
}

/** Resolves the LAN host advertised for direct TLS connections, or empty when unavailable. */
export async function resolveServerDirectHost(
  options: StartServerOptions,
  tlsOptions: { key: Buffer; cert: Buffer } | null,
  resolveLan: () => Promise<{ primary: string; others: string[] }> = resolveLanAddress,
): Promise<string> {
  if (tlsOptions === null) return '';
  const candidate =
    options.directHost !== undefined
      ? (options.directHost ?? '')
      : await safePrimaryLan(resolveLan);
  if (!isStrictNonLoopbackIpv4(candidate)) return '';
  return certCoversRequiredAltNames(tlsOptions.cert, [candidate]) ? candidate : '';
}
