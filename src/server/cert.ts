import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  X509Certificate,
} from 'node:crypto';
import selfsigned from 'selfsigned';
import { getExtensionContext } from '../context.js';
import { getLanAddresses } from '../util/helpers.js';
import { log } from '../util/log.js';
import {
  isIssuedByCa,
  isPermittedServerIp,
  issueServerCertificate,
  loadOrCreateLocalCa,
  type LocalCa,
} from './local-ca.js';
import { privateKeyMatchesCertificate } from './cert-primitives.js';

export { privateKeyMatchesCertificate };

export let useHttps = false;
export let httpsOptions: { key: Buffer; cert: Buffer } | null = null;

/** The authority that signed the certificate in use, when there is one. */
let activeLocalCa: LocalCa | null = null;

export type SubjectAltNameEntry = {
  type: 1 | 2 | 6 | 7;
  value?: string;
  ip?: string;
};

/**
 * Builds the subject alt names.
 */
export function buildSubjectAltNames(lanIps: string[]): SubjectAltNameEntry[] {
  const out: SubjectAltNameEntry[] = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
  ];
  const seen = new Set<string>(['127.0.0.1']);
  for (const raw of lanIps) {
    if (typeof raw !== 'string') continue;
    const ip = raw.trim();
    if (!isLikelyIpv4(ip) || seen.has(ip)) continue;
    seen.add(ip);
    out.push({ type: 7, ip });
  }
  return out;
}

function isLikelyIpv4(s: string): boolean {
  const parts = s.split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
    if (p.length > 1 && p.startsWith('0')) return false;
  }
  return true;
}

/**
 * The addresses a certificate names, as they were written.
 *
 * A certificate that is issued again has to keep them: the machine may have
 * lost one of them in the meantime, and the address that is gone still works.
 */
function readSubjectAltNames(certPem: Buffer | string): SubjectAltNameEntry[] {
  const names: SubjectAltNameEntry[] = [];
  let raw: string | undefined;
  try {
    raw = new X509Certificate(certPem).subjectAltName;
  } catch {
    return names;
  }
  if (!raw) return names;
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (entry.startsWith('DNS:')) names.push({ type: 2, value: entry.slice('DNS:'.length) });
    else if (entry.startsWith('IP Address:'))
      names.push({ type: 7, ip: entry.slice('IP Address:'.length) });
  }
  return names;
}

/**
 * The addresses of both lists, the ones of the moment first.
 */
function mergeSubjectAltNames(
  current: SubjectAltNameEntry[],
  previous: SubjectAltNameEntry[],
): SubjectAltNameEntry[] {
  const names: SubjectAltNameEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...current, ...previous]) {
    const key = `${entry.type}:${entry.value ?? entry.ip ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(entry);
  }
  return names;
}

/**
 * CertCoversRequiredAltNames — implementation detail.
 */
export function certCoversRequiredAltNames(
  certPem: Buffer | string,
  lanIps: string[],
  now: Date = new Date(),
): boolean {
  try {
    const cert = new X509Certificate(certPem);
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) return false;
    if (nowMs < Date.parse(cert.validFrom) || nowMs > Date.parse(cert.validTo)) return false;
    if (!cert.checkHost('localhost') || !cert.checkIP('127.0.0.1')) return false;
    for (const raw of lanIps) {
      if (typeof raw !== 'string') continue;
      const ip = raw.trim();
      if (isLikelyIpv4(ip) && !cert.checkIP(ip)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Issues the certificate again with the key that is already in place.
 *
 * The key is what the other computer pins, so a certificate that is issued
 * again for a new address has to keep it: a new key would break the link
 * and send the operator back to the pairing. The certificate that comes out
 * names the addresses of the moment and the ones the old one covered.
 */
export async function reissueWithSameKey(
  privateKeyPem: Buffer | string,
  oldCertPem: Buffer | string,
  altNames: SubjectAltNameEntry[],
): Promise<Buffer | null> {
  try {
    const privateKey = createPrivateKey(privateKeyPem);
    const publicKey = createPublicKey(privateKey);
    const names = mergeSubjectAltNames(altNames, readSubjectAltNames(oldCertPem));
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'rc-setlist.local' }], {
      algorithm: 'sha256',
      keyPair: {
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'subjectAltName', altNames: names },
      ],
    });
    if (!privateKeyMatchesCertificate(privateKeyPem, pems.cert)) return null;
    return Buffer.from(pems.cert, 'utf8');
  } catch {
    return null;
  }
}

/** The addresses of a list of names. */
function ipsOf(names: SubjectAltNameEntry[]): string[] {
  return names
    .filter((entry) => entry.type === 7)
    .map((entry) => entry.ip ?? '')
    .filter((ip) => ip.length > 0);
}

/** Reports whether the certificate is good for longer than the given days. */
function expiresInMoreThan(certPem: Buffer | string, days: number): boolean {
  try {
    const notAfter = Date.parse(new X509Certificate(certPem).validTo);
    if (!Number.isFinite(notAfter)) return false;
    return notAfter - Date.now() > days * 864e5;
  } catch {
    return false;
  }
}

/** The file, when it is there to be read. */
async function readFileOrNull(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

/** The key of the server, or a new one when the file is of no use. */
async function readOrCreateServerKey(keyPath: string): Promise<Buffer> {
  try {
    const key = await fs.readFile(keyPath);
    createPrivateKey(key);
    return key;
  } catch {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    await fs.writeFile(keyPath, pem, { mode: 0o600 });
    return Buffer.from(pem);
  }
}

/**
 * Applies the certificate that the authority of this computer signs.
 *
 * The stored certificate is kept when the authority signed it, when the key
 * is the one that is in place, when it names the addresses of the machine
 * and when it is not about to expire. Otherwise a new one is signed with
 * the same key: the other computer pins the key.
 */
async function applyLocalCaCerts(
  ca: LocalCa,
  keyPath: string,
  certPath: string,
  altNames: SubjectAltNameEntry[],
): Promise<boolean> {
  try {
    const key = await readOrCreateServerKey(keyPath);
    const currentIps = ipsOf(altNames).filter(isPermittedServerIp);
    const stored = await readFileOrNull(certPath);
    if (
      stored &&
      isIssuedByCa(stored, ca.certPem) &&
      privateKeyMatchesCertificate(key, stored) &&
      certCoversRequiredAltNames(stored, currentIps) &&
      expiresInMoreThan(stored, 30)
    ) {
      httpsOptions = { key, cert: stored };
      useHttps = true;
      activeLocalCa = ca;
      log.info('core', 'loaded persisted HTTPS certificates');
      return true;
    }
    // The addresses of before are kept: the address that is gone still works.
    const previousIps = stored ? ipsOf(readSubjectAltNames(stored)) : [];
    const leaf = await issueServerCertificate(ca, key, [...currentIps, ...previousIps]);
    if (!leaf) return false;
    await fs.writeFile(certPath, leaf, { mode: 0o600 });
    httpsOptions = { key, cert: leaf };
    useHttps = true;
    activeLocalCa = ca;
    log.info('core', 'issued the HTTPS certificate with the local certificate authority');
    return true;
  } catch {
    // The certificate could not be signed or written: the self-signed path
    // takes over, so the server still answers.
    return false;
  }
}

/**
 * Applies the certificate that is stored, when there is one to apply.
 *
 * The certificate is issued again when the machine has an address it does
 * not name, and the key it already has is kept. Reports whether the stored
 * certificate is the one in use.
 */
async function applyStoredCerts(
  keyPath: string,
  certPath: string,
  altNames: SubjectAltNameEntry[],
  lanIps: string[],
): Promise<boolean> {
  try {
    const [key, cert] = await Promise.all([fs.readFile(keyPath), fs.readFile(certPath)]);
    if (!privateKeyMatchesCertificate(key, cert)) {
      log.info('core', 'persisted certificate is stale or invalid; regenerating');
      return false;
    }
    if (!certCoversRequiredAltNames(cert, lanIps)) {
      // The machine has an address the certificate does not name: a cable
      // was plugged in, a VPN came up. The certificate is issued again with
      // the key it already has, because the other computer pins the key.
      const reissued = await reissueWithSameKey(key, cert, altNames);
      if (!reissued) return false;
      await fs.writeFile(certPath, reissued, { mode: 0o600 });
      httpsOptions = { key, cert: reissued };
      useHttps = true;
      log.info('core', 're-issued the HTTPS certificate for the addresses of this machine');
      return true;
    }
    httpsOptions = { key, cert };
    useHttps = true;
    log.info('core', 'loaded persisted HTTPS certificates');
    return true;
  } catch {
    // The stored certificate could not be read or written: a new one is
    // issued instead.
    return false;
  }
}

/**
 * Loads the certs.
 */
export async function loadCerts(): Promise<void> {
  const extensionContext = getExtensionContext();
  const storageDir = extensionContext?.environment?.storageDirectory;
  const lanIps = getLanAddresses();
  const altNames = buildSubjectAltNames(lanIps);
  activeLocalCa = null;

  if (!storageDir) {
    log.warn('lifecycle', 'storageDirectory unavailable; generating ephemeral HTTPS certs');
    await generateAndApplyEphemeral(altNames);
    return;
  }

  const cleanStorageDir = storageDir.replace(/^\/([a-zA-Z]):/, '$1:');
  const certDir = path.join(cleanStorageDir, 'certs');
  const keyPath = path.join(certDir, 'ableton-setlist-server.key');
  const certPath = path.join(certDir, 'ableton-setlist-server.crt');

  // The phone is told to trust the authority of this computer once, so the
  // certificate of the server is signed by it.
  const ca = await loadOrCreateLocalCa(certDir);
  if (ca && (await applyLocalCaCerts(ca, keyPath, certPath, altNames))) return;

  if (await applyStoredCerts(keyPath, certPath, altNames, lanIps)) return;

  try {
    await fs.mkdir(certDir, { recursive: true });
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'rc-setlist.local' }], {
      algorithm: 'sha256',
      keySize: 2048,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'subjectAltName', altNames },
      ],
    });
    await Promise.all([
      fs.writeFile(keyPath, pems.private, { mode: 0o600 }),
      fs.writeFile(certPath, pems.cert, { mode: 0o600 }),
    ]);
    httpsOptions = {
      key: Buffer.from(pems.private, 'utf8'),
      cert: Buffer.from(pems.cert, 'utf8'),
    };
    useHttps = true;
    log.info('core', 'saved new HTTPS certificates');
  } catch {
    log.error('lifecycle', 'certificate generation failed; falling back to HTTP');
    useHttps = false;
    httpsOptions = null;
  }
}

async function generateAndApplyEphemeral(altNames: SubjectAltNameEntry[]): Promise<void> {
  try {
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'rc-setlist.local' }], {
      algorithm: 'sha256',
      keySize: 2048,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'subjectAltName', altNames },
      ],
    });
    httpsOptions = {
      key: Buffer.from(pems.private, 'utf8'),
      cert: Buffer.from(pems.cert, 'utf8'),
    };
    useHttps = true;
  } catch {
    log.error('lifecycle', 'ephemeral certificate generation failed; falling back to HTTP');
    useHttps = false;
    httpsOptions = null;
  }
}

/**
 * Reports whether the certificate in use was signed by the local
 * authority: the one the phone has to trust.
 */
export function hasLocalCa(): boolean {
  return activeLocalCa !== null;
}

/**
 * The certificate of the authority in use, in the form the phone takes.
 * It is null when there is no authority in use.
 */
export function getLocalCaDer(): Buffer | null {
  if (!activeLocalCa) return null;
  try {
    return new X509Certificate(activeLocalCa.certPem).raw;
  } catch {
    return null;
  }
}
