import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import selfsigned from 'selfsigned';
import {
  attemptPairing,
  clearPairingCode,
  generatePairingCode,
  getOrGeneratePeerToken,
  hasActivePairingCode,
  pair,
  resetPairingState,
} from '../src/runtime/pairing.ts';
import { clearPeerConfig, readPeerConfig } from '../src/preferences.ts';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { createHttpRequestListener, sanitizeUrl, setPeerToken } from '../src/server/http.ts';
import { redactString } from '../src/util/log.ts';

const PEER_TOKEN = 'peer-token-for-the-pairing-tests';

function makeTlsOptions() {
  // The library builds the certificate in a worker: the promise has to be
  // awaited before the PEMs are read, or the certificate is undefined.
  return selfsigned
    .generate([{ name: 'commonName', value: 'localhost' }], {
      algorithm: 'sha256',
      keySize: 2048,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
          ],
        },
      ],
    })
    .then((pems) => ({ key: pems.private, cert: pems.cert }));
}

// One certificate for the whole file: generating a key is the slow part, and
// every server here answers on localhost anyway.
let tlsOptions = null;

function sharedTlsOptions() {
  if (!tlsOptions) tlsOptions = makeTlsOptions();
  return tlsOptions;
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function readBody(response, resolve) {
  let body = '';
  response.setEncoding('utf8');
  response.on('data', (chunk) => {
    body += chunk;
  });
  response.on('end', () => resolve({ status: response.statusCode, body }));
}

function secureRequest(port, path) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', rejectUnauthorized: false },
      (response) => readBody(response, resolve),
    );
    request.on('error', reject);
    request.end();
  });
}

function plainRequest(port, path) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (response) =>
      readBody(response, resolve),
    );
    request.on('error', reject);
    request.end();
  });
}

async function startTlsServer() {
  setPeerToken(PEER_TOKEN);
  const server = https.createServer(await sharedTlsOptions(), createHttpRequestListener());
  const port = await listen(server);
  return { server, port };
}

function aWrongCode(code) {
  return code === '000000' ? '111111' : '000000';
}

test('pairing: the route answers 404 while no code is active', async () => {
  resetPairingState();
  const { server, port } = await startTlsServer();
  try {
    const response = await secureRequest(port, '/peer/pair?code=123456');
    assert.strictEqual(response.status, 404);
  } finally {
    await closeServer(server);
  }
});

test('pairing: the right code hands out the peer token', async () => {
  resetPairingState();
  const code = generatePairingCode();
  const { server, port } = await startTlsServer();
  try {
    const response = await secureRequest(port, `/peer/pair?code=${code}`);
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(JSON.parse(response.body), { peerToken: PEER_TOKEN });
  } finally {
    await closeServer(server);
  }
});

test('pairing: a wrong code is refused without saying why', async () => {
  resetPairingState();
  const code = generatePairingCode();
  const { server, port } = await startTlsServer();
  try {
    const response = await secureRequest(port, `/peer/pair?code=${aWrongCode(code)}`);
    assert.strictEqual(response.status, 403);
    assert.doesNotMatch(response.body, /code|token|pair/i);
  } finally {
    await closeServer(server);
  }
});

test('pairing: a code that expired is gone', () => {
  resetPairingState();
  const code = generatePairingCode();
  const later = Date.now() + 11 * 60 * 1000;
  assert.strictEqual(hasActivePairingCode(later), false);
  assert.strictEqual(attemptPairing(code, '10.0.0.1', later).status, 'no_code');
});

test('pairing: a code works exactly once', () => {
  resetPairingState();
  const code = generatePairingCode();
  assert.strictEqual(attemptPairing(code, '10.0.0.2').status, 'accepted');
  assert.strictEqual(attemptPairing(code, '10.0.0.2').status, 'no_code');
});

test('pairing: five wrong guesses kill the code', () => {
  resetPairingState();
  const code = generatePairingCode();
  const wrong = aWrongCode(code);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.strictEqual(attemptPairing(wrong, '10.0.0.3').status, 'rejected');
  }
  assert.strictEqual(hasActivePairingCode(), true);
  assert.strictEqual(attemptPairing(wrong, '10.0.0.3').status, 'rejected');
  assert.strictEqual(hasActivePairingCode(), false);
});

test('pairing: one address may spend five attempts a minute', async () => {
  resetPairingState();
  const code = generatePairingCode();
  const wrong = aWrongCode(code);
  const { server, port } = await startTlsServer();
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await secureRequest(port, `/peer/pair?code=${wrong}`);
      assert.strictEqual(response.status, 403);
    }
    const limited = await secureRequest(port, `/peer/pair?code=${wrong}`);
    assert.strictEqual(limited.status, 429);
  } finally {
    await closeServer(server);
  }
});

test('pairing: everybody together may spend twenty attempts a minute', () => {
  resetPairingState();
  const code = generatePairingCode();
  const wrong = aWrongCode(code);
  // Every request from one machine has one address, so the total is spent
  // from many addresses to reach the total limit at all.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    attemptPairing(wrong, `10.1.0.${attempt}`);
  }
  assert.strictEqual(attemptPairing(wrong, '10.1.0.200').status, 'rate_limited');
});

test('pairing: without TLS the route answers 404', async () => {
  resetPairingState();
  const code = generatePairingCode();
  setPeerToken(PEER_TOKEN);
  const server = http.createServer(createHttpRequestListener());
  const port = await listen(server);
  try {
    const response = await plainRequest(port, `/peer/pair?code=${code}`);
    assert.strictEqual(response.status, 404);
  } finally {
    await closeServer(server);
  }
});

test('pairing: the code is masked in the URL and in the log', () => {
  assert.strictEqual(sanitizeUrl('/peer/pair?code=123456'), '/peer/pair?code=***');
  assert.strictEqual(
    redactString('pairing code=123456 was refused'),
    'pairing code=[REDACTED] was refused',
  );
});

test('pairing: a code that was dropped is gone', () => {
  resetPairingState();
  generatePairingCode();
  clearPairingCode();
  assert.strictEqual(hasActivePairingCode(), false);
});

test('pairing: the exchange stores the credential and the certificate', async () => {
  resetPairingState();
  const storageDir = fs.mkdtempSync(path.join(tmpdir(), 'rc-setlist-pairing-'));
  setExtensionContext({ environment: { storageDirectory: storageDir } });
  const code = generatePairingCode();
  const { server, port } = await startTlsServer();
  try {
    const result = await pair('127.0.0.1', code, port);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.config.peerToken, PEER_TOKEN);
    assert.strictEqual(result.config.port, port);
    assert.ok(result.config.fingerprint.length > 0);
    assert.deepStrictEqual(readPeerConfig(), result.config);
    clearPeerConfig();
    assert.strictEqual(readPeerConfig(), null);
  } finally {
    await closeServer(server);
    clearExtensionContext();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
});

test('pair: returns ok false on 403, 404, non-JSON body, missing token and write failure', async () => {
  resetPairingState();
  const storageDir = fs.mkdtempSync(path.join(tmpdir(), 'rc-setlist-pairing-fail-'));
  setExtensionContext({ environment: { storageDirectory: storageDir } });
  const { server: normalServer, port: normalPort } = await startTlsServer();

  // 1. 404: no code active
  const res404 = await pair('127.0.0.1', '123456', normalPort);
  assert.strictEqual(res404.ok, false);

  // 2. 403: wrong code
  const code = generatePairingCode();
  const res403 = await pair('127.0.0.1', aWrongCode(code), normalPort);
  assert.strictEqual(res403.ok, false);

  await closeServer(normalServer);

  // 3. Non-JSON body
  const nonJsonServer = https.createServer(await sharedTlsOptions(), (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('this is not json');
  });
  const nonJsonPort = await listen(nonJsonServer);
  const resNonJson = await pair('127.0.0.1', '123456', nonJsonPort);
  assert.strictEqual(resNonJson.ok, false);
  await closeServer(nonJsonServer);

  // 4. Missing peerToken in JSON
  const noTokenServer = https.createServer(await sharedTlsOptions(), (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ otherField: 'no-token' }));
  });
  const noTokenPort = await listen(noTokenServer);
  const resNoToken = await pair('127.0.0.1', '123456', noTokenPort);
  assert.strictEqual(resNoToken.ok, false);
  await closeServer(noTokenServer);

  // 5. Write failure (storageDirectory is a file, so write fails)
  const badStoragePath = path.join(storageDir, 'cannot-write-file');
  fs.writeFileSync(badStoragePath, 'blocking');
  setExtensionContext({ environment: { storageDirectory: badStoragePath } });
  const validServer = https.createServer(await sharedTlsOptions(), (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ peerToken: 'valid-peer-token' }));
  });
  const validPort = await listen(validServer);
  const resWriteFail = await pair('127.0.0.1', '123456', validPort);
  assert.strictEqual(resWriteFail.ok, false);
  await closeServer(validServer);

  clearExtensionContext();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test('pair: aborts cleanly when server drops connection mid-body', async () => {
  const abortServer = https.createServer(await sharedTlsOptions(), (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"peerToken": "part');
    // Drop connection in the middle of body
    setTimeout(() => {
      res.destroy();
    }, 50);
  });
  const abortPort = await listen(abortServer);
  try {
    const res = await pair('127.0.0.1', '123456', abortPort);
    assert.strictEqual(res.ok, false);
  } finally {
    await closeServer(abortServer);
  }
});

test('getOrGeneratePeerToken: writes token, reuses existing, and never equals authToken', () => {
  const tempDir = fs.mkdtempSync(path.join(tmpdir(), 'rc-setlist-token-'));
  const prevDir = bridgeState.globalPersistenceDir;
  const prevAuth = bridgeState.authToken;
  try {
    bridgeState.globalPersistenceDir = tempDir;
    bridgeState.authToken = 'my-auth-token';

    const token1 = getOrGeneratePeerToken();
    assert.strictEqual(typeof token1, 'string');
    assert.strictEqual(token1.length, 32);
    assert.notStrictEqual(token1, bridgeState.authToken);

    const saved = fs.readFileSync(path.join(tempDir, 'peer-token'), 'utf8');
    assert.strictEqual(saved, token1);

    // Reuses existing token
    const token2 = getOrGeneratePeerToken();
    assert.strictEqual(token2, token1);

    // If authToken becomes equal to peer token, generates a fresh one
    bridgeState.authToken = token1;
    const token3 = getOrGeneratePeerToken();
    assert.notStrictEqual(token3, bridgeState.authToken);
    assert.strictEqual(typeof token3, 'string');
    assert.strictEqual(token3.length, 32);
  } finally {
    bridgeState.globalPersistenceDir = prevDir;
    bridgeState.authToken = prevAuth;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
