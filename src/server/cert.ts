import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
// @ts-ignore
import selfsigned from 'selfsigned';
import { getExtensionContext } from '../context.js';
import { getLanAddresses } from '../util/helpers.js';

export let useHttps = false;
export let httpsOptions: { key: Buffer; cert: Buffer } | null = null;

export type SubjectAltNameEntry = {
  type: 1 | 2 | 6 | 7;
  value?: string;
  ip?: string;
};

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

export function privateKeyMatchesCertificate(
  privateKeyPem: Buffer | string,
  certPem: Buffer | string,
): boolean {
  try {
    const privatePublicKey = createPublicKey(createPrivateKey(privateKeyPem)).export({
      type: 'spki',
      format: 'der',
    });
    const certificatePublicKey = new X509Certificate(certPem).publicKey.export({
      type: 'spki',
      format: 'der',
    });
    return privatePublicKey.equals(certificatePublicKey);
  } catch {
    return false;
  }
}

export async function loadCerts(): Promise<void> {
  const extensionContext = getExtensionContext();
  const storageDir = extensionContext?.environment?.storageDirectory;
  const lanIps = getLanAddresses();
  const altNames = buildSubjectAltNames(lanIps);

  if (!storageDir) {
    console.warn('[rc-setlist] storageDirectory unavailable, generating ephemeral HTTPS certs');
    await generateAndApplyEphemeral(altNames);
    return;
  }

  const cleanStorageDir = storageDir.replace(/^\/([a-zA-Z]):/, '$1:');
  const certDir = path.join(cleanStorageDir, 'certs');
  const keyPath = path.join(certDir, 'ableton-setlist-server.key');
  const certPath = path.join(certDir, 'ableton-setlist-server.crt');

  try {
    const [key, cert] = await Promise.all([
      fs.readFile(keyPath),
      fs.readFile(certPath),
    ]);
    if (!certCoversRequiredAltNames(cert, lanIps) || !privateKeyMatchesCertificate(key, cert)) {
      console.log('[rc-setlist] persisted certificate is stale or invalid; regenerating');
      throw new Error('cert_invalid');
    }
    httpsOptions = { key, cert };
    useHttps = true;
    console.log(`[rc-setlist] loaded HTTPS certs from ${certDir}`);
    return;
  } catch {
    // Generate new
  }

  try {
    await fs.mkdir(certDir, { recursive: true });
    const pems = await selfsigned.generate(
      [{ name: 'commonName', value: 'rc-setlist.local' }],
      {
        algorithm: 'sha256',
        keySize: 2048,
        extensions: [
          { name: 'basicConstraints', cA: false },
          { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
          { name: 'subjectAltName', altNames },
        ],
      },
    );
    await Promise.all([
      fs.writeFile(keyPath, pems.private, { mode: 0o600 }),
      fs.writeFile(certPath, pems.cert, { mode: 0o600 }),
    ]);
    httpsOptions = {
      key: Buffer.from(pems.private, 'utf8'),
      cert: Buffer.from(pems.cert, 'utf8'),
    };
    useHttps = true;
    console.log(`[rc-setlist] saved new certs to ${certDir}`);
  } catch (err) {
    console.error(`[rc-setlist] cert generation failed: ${err}; falling back to HTTP`);
    useHttps = false;
    httpsOptions = null;
  }
}

async function generateAndApplyEphemeral(altNames: SubjectAltNameEntry[]): Promise<void> {
  try {
    const pems = await selfsigned.generate(
      [{ name: 'commonName', value: 'rc-setlist.local' }],
      {
        algorithm: 'sha256',
        keySize: 2048,
        extensions: [
          { name: 'basicConstraints', cA: false },
          { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
          { name: 'subjectAltName', altNames },
        ],
      },
    );
    httpsOptions = {
      key: Buffer.from(pems.private, 'utf8'),
      cert: Buffer.from(pems.cert, 'utf8'),
    };
    useHttps = true;
  } catch (err) {
    console.error(`[rc-setlist] ephemeral cert generation failed, falling back to HTTP`);
    useHttps = false;
    httpsOptions = null;
  }
}
