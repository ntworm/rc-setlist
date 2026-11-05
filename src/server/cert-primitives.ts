// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The certificate primitives that more than one module needs.

import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';

/**
 * Reports whether the private key is the key of the certificate. The key is
 * what the other computer pins, so a certificate that is issued again has
 * to keep it.
 */
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
