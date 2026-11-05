// The five bugs an adversarial review of RC Setlist 1.1.0 found, each one
// with the test that keeps it from coming back.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import selfsigned from 'selfsigned';
import { WebSocket } from 'ws';
import { executeCommandAction } from '../src/commands/handlers/index.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { pair, resetPairingState } from '../src/runtime/pairing.ts';
import { clearExtensionContext, setExtensionContext } from '../src/context.ts';
import { clearPeerConfig, readPeerConfig } from '../src/preferences.ts';
import { httpsOptions, loadCerts } from '../src/server/cert.ts';
import { createHttpRequestListener, setPeerToken } from '../src/server/http.ts';
import { SetlistWSServer } from '../src/server/ws.ts';
import { runPeerAction } from '../src/ui/peer-panel.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const PEER_TOKEN = 'peer-token-for-the-adversarial-tests';

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

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// The certificate of the second computer: another one, so the tests can tell
// it apart from the certificate this computer serves with.
let secondComputerCertificate = null;

async function secondComputerTls() {
  if (secondComputerCertificate) return secondComputerCertificate;
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    algorithm: 'sha256',
    keySize: 2048,
  });
  secondComputerCertificate = { key: pems.private, cert: pems.cert };
  return secondComputerCertificate;
}

// The second computer, answering the pairing route the way the server does:
// a 404 there means that it has no code alive.
async function startSecondComputer() {
  const tls = await secondComputerTls();
  setPeerToken(PEER_TOKEN);
  const server = https.createServer(tls, createHttpRequestListener());
  const port = await listen(server);
  return { server, port };
}

// The certificate this computer serves with, loaded the way the server loads
// it: from the same code, with the same fingerprints.
let ownCertificate = null;

async function ownCertificateTls() {
  if (ownCertificate) return ownCertificate;
  const storageDir = tempDir('rc-setlist-own-cert-');
  setExtensionContext({ environment: { storageDirectory: storageDir } });
  await loadCerts();
  assert.ok(httpsOptions, 'this computer must have a certificate for this test');
  ownCertificate = { key: httpsOptions.key, cert: httpsOptions.cert };
  return ownCertificate;
}

// This computer answering its own address: the address the operator typed
// points back at the machine the operator is sitting at.
async function startThisComputer() {
  const tls = await ownCertificateTls();
  const server = https.createServer(tls, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ peerToken: PEER_TOKEN }));
  });
  const port = await listen(server);
  return { server, port };
}

test('a computer cannot be paired with itself', async () => {
  resetPairingState();
  const storageDir = tempDir('rc-setlist-self-pair-');
  setExtensionContext({ environment: { storageDirectory: storageDir } });
  const { server, port } = await startThisComputer();
  try {
    const result = await pair('127.0.0.1', '123456', port);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'that address is this computer');
    assert.equal(readPeerConfig(), null, 'the pairing must not be stored');
  } finally {
    await closeServer(server);
    clearPeerConfig();
    clearExtensionContext();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
});

test('the panel says that the address is this computer', async () => {
  const { server, port } = await startThisComputer();
  try {
    const english = await runPeerAction('peer-pair:127.0.0.1:123456', 'en', port);
    assert.equal(english.ok, false);
    assert.match(
      english.message,
      /that address is this computer: type the IP of the second computer/,
    );
    const portuguese = await runPeerAction('peer-pair:127.0.0.1:123456', 'pt-BR', port);
    assert.equal(portuguese.ok, false);
    assert.match(
      portuguese.message,
      /esse endereço é deste computador: digite o IP do segundo computador/,
    );
  } finally {
    await closeServer(server);
  }
});

test('a computer with no code alive says so instead of refusing', async () => {
  resetPairingState();
  const { server, port } = await startSecondComputer();
  try {
    const result = await pair('127.0.0.1', '123456', port);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'no active code on that computer');
  } finally {
    await closeServer(server);
  }
});

test('the panel says that the second computer has no code', async () => {
  resetPairingState();
  const { server, port } = await startSecondComputer();
  try {
    const english = await runPeerAction('peer-pair:127.0.0.1:123456', 'en', port);
    assert.equal(english.ok, false);
    assert.match(
      english.message,
      /that computer has no active code: press Generate code ON THE SECOND computer/,
    );
    const portuguese = await runPeerAction('peer-pair:127.0.0.1:123456', 'pt-BR', port);
    assert.equal(portuguese.ok, false);
    assert.match(
      portuguese.message,
      /aquele computador não tem código ativo: toque Gerar código NO SEGUNDO computador/,
    );
  } finally {
    await closeServer(server);
  }
});

test('the QR code points at the scheme the server really serves', () => {
  const html = fs.readFileSync(path.join(ROOT, 'static/panel/index.html'), 'utf8');
  const match = html.match(/const scheme = (.+);/);
  assert.ok(match, 'the panel must pick the scheme from the TLS flag');
  const schemeFor = (tls) => new Function('window', `return ${match[1]}`)({ INITIAL_TLS: tls });
  assert.equal(schemeFor(false), 'http');
  assert.equal(schemeFor(true), 'https');
  assert.equal(schemeFor(undefined), 'https');
  assert.match(html, /const setlistUrl = `\$\{scheme\}:\/\//);
  assert.match(html, /const stageUrl = `\$\{scheme\}:\/\//);
  assert.doesNotMatch(html, /const setlistUrl = `https:/);
  assert.doesNotMatch(html, /const stageUrl = `https:/);
});

test('the panel tells the page whether the server speaks TLS', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/ui/panel.ts'), 'utf8');
  assert.match(source, /window\.INITIAL_TLS = \$\{isServerTls\(\)\};/);
});

function fakeClient(bufferedAmount = 0) {
  const sent = [];
  return {
    bufferedAmount,
    isAlive: true,
    readyState: WebSocket.OPEN,
    sent,
    terminated: false,
    close() {},
    ping() {},
    removeAllListeners() {},
    send(message) {
      sent.push(JSON.parse(message));
    },
    terminate() {
      this.terminated = true;
    },
  };
}

function injectedInterval() {
  const handle = { unref() {} };
  return {
    setIntervalFn() {
      return handle;
    },
    clearIntervalFn() {},
  };
}

test('a state that backpressure dropped is sent again when the phone catches up', () => {
  const interval = injectedInterval();
  const server = new SetlistWSServer('', {
    heartbeatIntervalMs: 60_000,
    setIntervalFn: interval.setIntervalFn,
    clearIntervalFn: interval.clearIntervalFn,
  });
  server.init();
  const phone = fakeClient(524_289);
  server['clients'].add(phone);
  const state = { stateVersion: 1 };

  server.broadcastState(state);
  assert.equal(phone.sent.length, 0, 'the frame is dropped while the phone is slow');

  phone.bufferedAmount = 0;
  server.broadcastState(state);
  assert.equal(phone.sent.length, 1, 'the state has to reach the phone that missed it');
  assert.equal(phone.sent[0].type, 'state');
  server.stop();
});

class FakeOsc {
  calls = [];

  continuePlaying() {
    this.calls.push(['continue']);
  }

  startPlaying() {
    this.calls.push(['start']);
  }

  stopPlaying() {
    this.calls.push(['stop']);
  }
}

function installHarness() {
  const saved = {
    manager: bridgeState.manager,
    oscClient: bridgeState.oscClient,
    wsServer: bridgeState.wsServer,
    scheduler: bridgeState.scheduler,
  };
  const osc = new FakeOsc();
  bridgeState.manager = new SetlistManager();
  bridgeState.oscClient = osc;
  bridgeState.scheduler = null;
  bridgeState.wsServer = { broadcastState() {}, broadcastLog() {}, broadcast() {} };
  return {
    osc,
    restore() {
      Object.assign(bridgeState, saved);
    },
  };
}

function command(type, payload = {}) {
  return {
    commandId: `${type}-test`,
    type,
    payload,
    sourceClientId: 'test',
    createdAt: 0,
    status: 'sent',
    retryCount: 0,
    maxRetries: 3,
    timeoutMs: 5_000,
  };
}

test('a panic during a count-in keeps the transport stopped', async () => {
  const harness = installHarness();
  try {
    await executeCommandAction(command('trigger_count_in', { sendPlayOffsetMs: 20 }));
    await executeCommandAction(command('set_panic', { active: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    const started = harness.osc.calls.filter(([kind]) => kind === 'start' || kind === 'continue');
    assert.deepEqual(started, [], 'the count-in must not start the transport after the panic');
  } finally {
    harness.restore();
  }
});
