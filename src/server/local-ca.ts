// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The certificate authority of this computer. The phone that opens the
// setlist has never seen the certificate of the server, so it warns about
// it. The way out is an authority the phone is told to trust once: the
// authority signs the certificate, and the name constraints keep that
// promise honest.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  webcrypto,
  X509Certificate,
} from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { isRfc1918 } from '../util/helpers.js';
import { privateKeyMatchesCertificate } from './cert-primitives.js';

/** The files the authority of this computer lives in. */
const CA_KEY_FILE = 'rc-setlist-local-ca.key';
const CA_CERT_FILE = 'rc-setlist-local-ca.crt';

/** How long the authority lives, and how long the certificate of the server lives. */
const CA_LIFETIME_DAYS = 3650;
const LEAF_LIFETIME_DAYS = 397;

/** The algorithm every certificate here is signed with. */
const SIGNING_ALGORITHM = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};

/** The usages the authority signs with, and the ones the server signs with. */
const CA_KEY_USAGES = x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign;
const SERVER_KEY_USAGES = x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment;

/**
 * The WebCrypto the library signs with: the library types it with a shape
 * of its own, and the one of Node is the same thing with a wider list of
 * key usages.
 */
type X509Crypto = Parameters<typeof x509.cryptoProvider.set>[1];

/** The key pair the library signs with. */
type X509KeyPair = Parameters<typeof x509.X509CertificateGenerator.createSelfSigned>[0]['keys'];

/** The key the library signs with. */
type X509CryptoKey = X509KeyPair['privateKey'];

/** The name the library writes into a certificate. */
type X509AltName = NonNullable<
  ConstructorParameters<typeof x509.SubjectAlternativeNameExtension>[0]
>[number];

x509.cryptoProvider.set(webcrypto as unknown as X509Crypto);

/**
 * The authority of this computer: the key that signs and the certificate
 * that the phone is told to trust.
 */
export type LocalCa = { keyPem: string; certPem: string };

/**
 * The name constraints of the authority, as they go into the certificate.
 *
 * The bytes are the DER of the extension: the name `localhost` and the
 * addresses 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 and
 * 169.254.0.0/16 may be named by a certificate the authority signs.
 */
export const CA_NAME_CONSTRAINTS_DER = Buffer.from(
  '304ba049300b82096c6f63616c686f7374300a87087f000000ff000000300a87080a000000ff000000300a8708ac100000fff00000300a8708c0a80000ffff0000300a8708a9fe0000ffff0000',
  'hex',
);

/** The four octets of an IPv4 address, or null when the text is not one. */
function ipv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^(0|[1-9]\d{0,2})$/.test(part) ? Number(part) : -1));
  if (octets.some((value) => value < 0 || value > 255)) return null;
  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0];
}

/**
 * Reports whether the address is one the authority may sign for: the
 * loopback, the private addresses of the local network and the link-local
 * ones.
 */
export function isPermittedServerIp(ip: string): boolean {
  const octets = ipv4Octets(ip);
  if (!octets) return false;
  if (octets[0] === 127) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  return isRfc1918(ip);
}

/** The key of the authority, in the shape the library signs with. */
async function importSigningKey(keyPem: string): Promise<X509CryptoKey> {
  const pkcs8 = createPrivateKey(keyPem).export({ type: 'pkcs8', format: 'der' });
  const key = await webcrypto.subtle.importKey('pkcs8', pkcs8, SIGNING_ALGORITHM, true, ['sign']);
  return key as unknown as X509CryptoKey;
}

/** The public key of a certificate, in the shape the library writes with. */
async function importPublicKey(keyPem: Buffer | string): Promise<X509CryptoKey> {
  const spki = createPublicKey(keyPem).export({ type: 'spki', format: 'der' });
  const key = await webcrypto.subtle.importKey('spki', spki, SIGNING_ALGORITHM, true, ['verify']);
  return key as unknown as X509CryptoKey;
}

/** The certificate, in the shape the library reads. */
function parseCertificate(pem: string): x509.X509Certificate {
  const der = new X509Certificate(pem).raw;
  const bytes = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength);
  return new x509.X509Certificate(bytes);
}

/** The names a certificate of the server may carry. */
function serverAltNames(ips: string[]): X509AltName[] {
  const names: X509AltName[] = [{ type: 'dns', value: 'localhost' }];
  const seen = new Set<string>();
  for (const raw of ips) {
    if (typeof raw !== 'string') continue;
    const ip = raw.trim();
    if (!isPermittedServerIp(ip) || seen.has(ip)) continue;
    seen.add(ip);
    names.push({ type: 'ip', value: ip });
  }
  return names;
}

/** Creates the authority of this computer. */
async function createLocalCa(): Promise<LocalCa | null> {
  try {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const keys: X509KeyPair = {
      privateKey: await importSigningKey(keyPem),
      publicKey: await importPublicKey(keyPem),
    };
    const ca = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: '01',
      name: 'CN=RC Setlist local CA',
      notBefore: new Date(),
      notAfter: new Date(Date.now() + CA_LIFETIME_DAYS * 864e5),
      keys,
      signingAlgorithm: SIGNING_ALGORITHM,
      extensions: [
        new x509.BasicConstraintsExtension(true, 0, true),
        new x509.KeyUsagesExtension(CA_KEY_USAGES, true),
        await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
        new x509.Extension('2.5.29.30', true, CA_NAME_CONSTRAINTS_DER),
      ],
    });
    return { keyPem, certPem: ca.toString('pem') };
  } catch {
    return null;
  }
}

/** The authority that is already on this computer, when there is one. */
async function readStoredCa(certDir: string): Promise<LocalCa | null> {
  try {
    const [keyPem, certPem] = await Promise.all([
      fs.readFile(path.join(certDir, CA_KEY_FILE), 'utf8'),
      fs.readFile(path.join(certDir, CA_CERT_FILE), 'utf8'),
    ]);
    if (!privateKeyMatchesCertificate(keyPem, certPem)) return null;
    if (!new X509Certificate(certPem).ca) return null;
    return { keyPem, certPem };
  } catch {
    return null;
  }
}

/**
 * The authority of this computer, created once and kept afterwards.
 *
 * The phone is told to trust the certificate that comes out of here, so the
 * authority has to survive: a new one would send the phone back to the
 * installation. A key that does not match the certificate is no authority.
 */
export async function loadOrCreateLocalCa(certDir: string): Promise<LocalCa | null> {
  try {
    const stored = await readStoredCa(certDir);
    if (stored) return stored;
    const created = await createLocalCa();
    if (!created) return null;
    await fs.mkdir(certDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(certDir, CA_KEY_FILE), created.keyPem, { mode: 0o600 }),
      fs.writeFile(path.join(certDir, CA_CERT_FILE), created.certPem, { mode: 0o600 }),
    ]);
    return created;
  } catch {
    return null;
  }
}

/**
 * Signs the certificate of the server with the authority.
 *
 * The key of the server is the one that is already in place: the other
 * computer pins it, so a certificate that is signed again may not bring a
 * new key with it. The addresses that go into the certificate are the ones
 * the authority may sign for; the others are dropped, because a
 * certificate that names them would not chain to the authority.
 */
export async function issueServerCertificate(
  ca: LocalCa,
  serverKeyPem: Buffer | string,
  ips: string[],
): Promise<Buffer | null> {
  try {
    const caCertificate = parseCertificate(ca.certPem);
    const publicKey = await importPublicKey(serverKeyPem);
    const leaf = await x509.X509CertificateGenerator.create({
      serialNumber: '02',
      subject: 'CN=rc-setlist.local',
      issuer: caCertificate.subject,
      notBefore: new Date(),
      notAfter: new Date(Date.now() + LEAF_LIFETIME_DAYS * 864e5),
      publicKey,
      signingKey: await importSigningKey(ca.keyPem),
      signingAlgorithm: SIGNING_ALGORITHM,
      extensions: [
        new x509.BasicConstraintsExtension(false, undefined, true),
        new x509.KeyUsagesExtension(SERVER_KEY_USAGES, true),
        new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth], false),
        await x509.SubjectKeyIdentifierExtension.create(publicKey),
        await x509.AuthorityKeyIdentifierExtension.create(caCertificate, false),
        new x509.SubjectAlternativeNameExtension(serverAltNames(ips)),
      ],
    });
    return Buffer.from(leaf.toString('pem'), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Reports whether the certificate was signed by the authority.
 */
export function isIssuedByCa(certPem: Buffer | string, caCertPem: Buffer | string): boolean {
  try {
    const cert = new X509Certificate(certPem);
    const ca = new X509Certificate(caCertPem);
    if (!cert.checkIssued(ca)) return false;
    return cert.verify(ca.publicKey);
  } catch {
    return false;
  }
}
