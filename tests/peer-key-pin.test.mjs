// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The pin follows the key, not the certificate.
//
// A machine that gains an address — a cable plugged in, a VPN up — has to
// issue its certificate again. The certificate changes and the key must not:
// the paired computer pins the key, so a new key would break the link and
// send the operator back to the pairing screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { X509Certificate } from 'node:crypto';

import { buildSubjectAltNames, reissueWithSameKey } from '../src/server/cert.ts';
import {
  certificateFingerprint,
  generatePairingCode,
  pair,
  publicKeyPin,
  resetPairingState,
} from '../src/runtime/pairing.ts';
import { startPeerLink, stopPeerLink } from '../src/runtime/peer-link.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { SetlistWSServer } from '../src/server/ws.ts';
import { createHttpRequestListener, setPeerToken } from '../src/server/http.ts';
import { readPeerConfig, writePeerConfig } from '../src/preferences.ts';
import { clearExtensionContext, setExtensionContext } from '../src/context.ts';
import { PEER_TOKEN, fingerprintOf, makeTlsOptions } from './helpers/peer-link-harness.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await delay(25);
  }
  return predicate();
}

const listen = (server) =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

const closeServer = (server) => new Promise((resolve) => server.close(() => resolve()));

/**
 * The other side of the link: a server with its own certificate that
 * answers the handshake.
 */
async function startPeer(tlsOptions) {
  const wsServer = new SetlistWSServer('auth-token-of-the-second-computer', {
    peerToken: PEER_TOKEN,
  });
  wsServer.init();
  const server = https.createServer(tlsOptions, createHttpRequestListener());
  server.on('upgrade', (req, socket, head) => {
    wsServer.handleUpgrade(req, socket, head);
  });
  wsServer.on('client_message', (message, ws) => {
    if (message.type === 'handshake') {
      ws.send(JSON.stringify({ type: 'handshake_ack', stateVersion: 0, state: {} }));
    }
  });
  const port = await listen(server);
  return { server, wsServer, port };
}

async function stopPeer(peer) {
  stopPeerLink();
  peer.wsServer.stop();
  peer.server.closeAllConnections?.();
  await closeServer(peer.server);
}

test('issuing the certificate again for a new address keeps the key', async () => {
  const original = await makeTlsOptions();
  const reissued = await reissueWithSameKey(
    original.key,
    original.cert,
    buildSubjectAltNames(['192.168.1.10']),
  );
  assert.ok(reissued, 'the certificate must be issued again');

  const before = new X509Certificate(original.cert).raw;
  const after = new X509Certificate(reissued).raw;
  assert.equal(publicKeyPin(before), publicKeyPin(after), 'the pin of the key must not change');
  assert.notEqual(
    certificateFingerprint(before),
    certificateFingerprint(after),
    'the cert changed',
  );

  const names = new X509Certificate(reissued).subjectAltName ?? '';
  assert.match(names, /192\.168\.1\.10/, 'the new address must be named');
  assert.match(names, /localhost/, 'the addresses of before must be kept');

  // The addresses the old certificate covered are kept: the machine may
  // have lost one of them in the meantime.
  const onlyLocalhost = [{ type: 2, value: 'localhost' }];
  const again = await reissueWithSameKey(original.key, reissued, onlyLocalhost);
  assert.ok(again, 'the certificate must be issued again');
  const kept = new X509Certificate(again).subjectAltName ?? '';
  assert.match(kept, /127\.0\.0\.1/, 'the loopback of before must be kept');
  assert.match(kept, /192\.168\.1\.10/, 'the address of before must be kept');
});

test('a peer that issued its certificate again is still the computer that was paired', async () => {
  const tls = await makeTlsOptions();
  const reissued = await reissueWithSameKey(
    tls.key,
    tls.cert,
    buildSubjectAltNames(['192.168.1.10']),
  );
  assert.ok(reissued, 'the certificate must be issued again');
  const peer = await startPeer({ key: tls.key, cert: reissued });

  const oldFingerprint = fingerprintOf(tls);
  const keyPin = publicKeyPin(new X509Certificate(tls.cert).raw);
  const served = certificateFingerprint(new X509Certificate(reissued).raw);
  assert.notEqual(served, oldFingerprint, 'the peer serves another certificate');

  stopPeerLink();
  startPeerLink({
    host: '127.0.0.1',
    port: peer.port,
    peerToken: PEER_TOKEN,
    fingerprint: oldFingerprint,
    keyPin,
  });
  const connected = await waitFor(() => bridgeState.peerStatus.connected === true);
  assert.ok(connected, 'the link must survive a certificate that was issued again');
  assert.strictEqual(bridgeState.peerStatus.fingerprintMismatch, false);
  await stopPeer(peer);
});

test('a peer that holds another key is refused', async () => {
  const paired = await makeTlsOptions();
  const other = await makeTlsOptions();
  const peer = await startPeer(other);

  stopPeerLink();
  startPeerLink({
    host: '127.0.0.1',
    port: peer.port,
    peerToken: PEER_TOKEN,
    fingerprint: fingerprintOf(other),
    keyPin: publicKeyPin(new X509Certificate(paired.cert).raw),
  });
  const mismatch = await waitFor(() => bridgeState.peerStatus.fingerprintMismatch === true);
  assert.ok(mismatch, 'the link must refuse a computer with another key');
  assert.strictEqual(bridgeState.peerStatus.connected, false);
  await stopPeer(peer);
});

test('a pairing from before the key pin still connects', async () => {
  const tls = await makeTlsOptions();
  const peer = await startPeer(tls);

  stopPeerLink();
  startPeerLink({
    host: '127.0.0.1',
    port: peer.port,
    peerToken: PEER_TOKEN,
    fingerprint: fingerprintOf(tls),
  });
  const connected = await waitFor(() => bridgeState.peerStatus.connected === true);
  assert.ok(connected, 'the pairing from before the key pin must still work');
  assert.strictEqual(bridgeState.peerStatus.fingerprintMismatch, false);
  await stopPeer(peer);
});

test('the pairing stores the pin of the key beside the fingerprint', async () => {
  resetPairingState();
  const storageDir = fs.mkdtempSync(path.join(tmpdir(), 'rc-setlist-key-pin-'));
  setExtensionContext({ environment: { storageDirectory: storageDir } });
  setPeerToken(PEER_TOKEN);
  const tls = await makeTlsOptions();
  const server = https.createServer(tls, createHttpRequestListener());
  const port = await listen(server);
  try {
    const code = generatePairingCode();
    const result = await pair('127.0.0.1', code, port);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.config.keyPin, publicKeyPin(new X509Certificate(tls.cert).raw));
    assert.strictEqual(readPeerConfig()?.keyPin, result.config.keyPin);
  } finally {
    server.closeAllConnections?.();
    await closeServer(server);
    clearExtensionContext();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
});

test('a stored pairing from before the key pin still loads', () => {
  const storageDir = fs.mkdtempSync(path.join(tmpdir(), 'rc-setlist-old-pin-'));
  setExtensionContext({ environment: { storageDirectory: storageDir } });
  const old = { host: '127.0.0.1', port: 4444, peerToken: 'the-old-token', fingerprint: 'AA:BB' };
  try {
    writePeerConfig(old);
    const stored = readPeerConfig();
    assert.strictEqual(stored?.host, '127.0.0.1');
    assert.strictEqual(stored?.keyPin, undefined);

    // A pin that is there but empty is a broken pairing, not an old one.
    writePeerConfig({ ...old, keyPin: '' });
    assert.strictEqual(readPeerConfig(), null);
  } finally {
    clearExtensionContext();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
});
