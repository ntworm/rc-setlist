import assert from 'node:assert/strict';
import test from 'node:test';
import selfsigned from 'selfsigned';

import {
  certCoversRequiredAltNames,
  privateKeyMatchesCertificate,
} from '../src/server/cert.ts';

async function certificate({ altNames, notBeforeDate, notAfterDate } = {}) {
  return selfsigned.generate(
    [{ name: 'commonName', value: 'rc-setlist.local' }],
    {
      algorithm: 'sha256',
      keyType: 'ec',
      curve: 'P-256',
      notBeforeDate,
      notAfterDate,
      extensions: [
        { name: 'basicConstraints', cA: false },
        {
          name: 'subjectAltName',
          altNames: altNames ?? [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '192.168.1.10' },
          ],
        },
      ],
    },
  );
}

test('certificate validation requires localhost, loopback, LAN addresses, and current validity', async () => {
  const now = new Date('2026-08-01T12:00:00Z');
  const valid = await certificate({
    notBeforeDate: new Date('2026-07-01T00:00:00Z'),
    notAfterDate: new Date('2026-09-01T00:00:00Z'),
  });
  assert.equal(certCoversRequiredAltNames(valid.cert, ['192.168.1.10'], now), true);
  assert.equal(certCoversRequiredAltNames(valid.cert, ['192.168.1.11'], now), false);

  const missingLocalhost = await certificate({
    altNames: [
      { type: 7, ip: '127.0.0.1' },
      { type: 7, ip: '192.168.1.10' },
    ],
    notBeforeDate: new Date('2026-07-01T00:00:00Z'),
    notAfterDate: new Date('2026-09-01T00:00:00Z'),
  });
  assert.equal(certCoversRequiredAltNames(missingLocalhost.cert, ['192.168.1.10'], now), false);
  assert.equal(certCoversRequiredAltNames(valid.cert, ['192.168.1.10'], new Date('2027-01-01T00:00:00Z')), false);
  assert.equal(certCoversRequiredAltNames('not a certificate', [], now), false);
});

test('certificate validation rejects a mismatched private key', async () => {
  const first = await certificate();
  const second = await certificate();

  assert.equal(privateKeyMatchesCertificate(first.private, first.cert), true);
  assert.equal(privateKeyMatchesCertificate(second.private, first.cert), false);
  assert.equal(privateKeyMatchesCertificate('not a key', first.cert), false);
});
