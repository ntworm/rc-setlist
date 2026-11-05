import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import { tmpdir } from 'node:os';
import selfsigned from 'selfsigned';
import {
  isValidPeerHost,
  parsePeerAction,
  peerPanelModel,
  peerPanelState,
  peerStateText,
  runPeerAction,
  sanitizePanelAction,
} from '../src/ui/peer-panel.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import {
  generatePairingCode,
  currentPairingCode,
  resetPairingState,
} from '../src/runtime/pairing.ts';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import { clearPeerConfig, readPeerConfig } from '../src/preferences.ts';
import { startPeerLink, stopPeerLink } from '../src/runtime/peer-link.ts';
import { createHttpRequestListener, setPeerToken } from '../src/server/http.ts';

test('the panel reads the three peer actions', () => {
  assert.deepEqual(parsePeerAction('peer-unpair'), { kind: 'unpair' });
  assert.deepEqual(parsePeerAction('peer-code'), { kind: 'code' });
  assert.deepEqual(parsePeerAction('peer-pair:192.168.1.10:123456'), {
    kind: 'pair',
    host: '192.168.1.10',
    code: '123456',
  });
  assert.deepEqual(parsePeerAction('peer-pair:studio.local:123456'), {
    kind: 'pair',
    host: 'studio.local',
    code: '123456',
  });
  assert.deepEqual(parsePeerAction('peer-pair:localhost:123456'), {
    kind: 'pair',
    host: 'localhost',
    code: '123456',
  });
});

test('an action the panel does not know is not a peer action', () => {
  assert.equal(parsePeerAction('start'), null);
  assert.equal(parsePeerAction('peer-nonsense'), null);
  assert.equal(parsePeerAction(''), null);
  assert.equal(parsePeerAction('peer-unpair-please'), null);
});

test('a code that is not six digits is refused', () => {
  assert.equal(parsePeerAction('peer-pair:192.168.1.10:12345'), null);
  assert.equal(parsePeerAction('peer-pair:192.168.1.10:1234567'), null);
  assert.equal(parsePeerAction('peer-pair:192.168.1.10:abcdef'), null);
  assert.equal(parsePeerAction('peer-pair:192.168.1.10:'), null);
  assert.equal(parsePeerAction('peer-pair:192.168.1.10:123 456'), null);
});

test('a hostile address is refused', () => {
  // The address is about to be handed to the network stack. Anything that
  // is not a plain address or a plain name is refused before it gets there.
  const hostile = [
    'peer-pair:192.168.1.10:4444:123456',
    'peer-pair:192.168.1.256:123456',
    'peer-pair:192.168.1.10.5:123456',
    'peer-pair:evil.com/../etc:123456',
    'peer-pair:evil.com;rm -rf /:123456',
    'peer-pair:-evil-.com:123456',
    'peer-pair:evil-.com:123456',
    'peer-pair:.evil.com:123456',
    'peer-pair:evil..com:123456',
    'peer-pair:evil.com|:123456',
    'peer-pair:evil.com\n:123456',
    'peer-pair::123456',
  ];
  for (const action of hostile) {
    assert.equal(parsePeerAction(action), null, `${action} must be refused`);
  }
});

test('the address rules are the ones the panel advertises', () => {
  assert.equal(isValidPeerHost('192.168.1.10'), true);
  assert.equal(isValidPeerHost('10.0.0.1'), true);
  assert.equal(isValidPeerHost('studio.local'), true);
  assert.equal(isValidPeerHost('my-pc-2.local'), true);
  assert.equal(isValidPeerHost('192.168.1.256'), false);
  assert.equal(isValidPeerHost('192.168.1.10:4444'), false);
  assert.equal(isValidPeerHost('evil.com/path'), false);
});

test('the panel tells the five states of the link apart', () => {
  const base = { paired: true, connected: true, markersMatch: true, fingerprintMismatch: false };
  assert.equal(peerPanelState({ ...base, paired: false }), 'not_paired');
  assert.equal(peerPanelState(base), 'connected');
  assert.equal(peerPanelState({ ...base, markersMatch: false }), 'markers_differ');
  assert.equal(peerPanelState({ ...base, connected: false }), 'offline');
  assert.equal(
    peerPanelState({ ...base, connected: false, fingerprintMismatch: true }),
    'certificate_changed',
  );
});

test('every state says something in both languages', () => {
  const states = ['not_paired', 'connected', 'markers_differ', 'offline', 'certificate_changed'];
  for (const state of states) {
    const english = peerStateText(state, 'en');
    const portuguese = peerStateText(state, 'pt-BR');
    assert.ok(english.length > 0, `${state} must say something in English`);
    assert.ok(portuguese.length > 0, `${state} must say something in Portuguese`);
    assert.notEqual(english, portuguese, `${state} must be translated`);
  }
});

test('the panel model says the second computer is not paired', () => {
  const model = peerPanelModel({ locale: 'en' });
  assert.equal(model.state, 'not_paired');
  assert.equal(model.paired, false);
  assert.equal(typeof model.host, 'string');
  assert.equal(model.code, null);
  assert.equal(model.codeActive, false);
  assert.equal(model.serverRunning, false);
  assert.equal(model.tlsEnabled, false);
  assert.equal(model.canGenerateCode, false);
  assert.match(model.codeHint, /Start the server/);
  assert.match(model.statusText, /Not paired/);
});

test('the panel model follows the state of the link', () => {
  const previous = bridgeState.peerStatus;
  try {
    bridgeState.peerStatus = {
      paired: true,
      connected: true,
      markersMatch: false,
      fingerprintMismatch: false,
    };
    const model = peerPanelModel({ locale: 'pt-BR' });
    assert.equal(model.state, 'markers_differ');
    assert.equal(model.paired, true);
    assert.match(model.statusText, /marcadores/);
  } finally {
    bridgeState.peerStatus = previous;
  }
});

test('sanitizePanelAction masks peer-pair actions and preserves others', () => {
  assert.equal(sanitizePanelAction('peer-pair:192.168.1.10:123456'), 'peer-pair');
  assert.equal(sanitizePanelAction('peer-pair:studio.local:654321'), 'peer-pair');
  assert.equal(sanitizePanelAction('start'), 'start');
  assert.equal(sanitizePanelAction('peer-unpair'), 'peer-unpair');
  assert.equal(sanitizePanelAction('peer-code'), 'peer-code');
});

test('runPeerAction handles peer-code and peer-unpair', async () => {
  resetPairingState();
  const codeResult = await runPeerAction('peer-code');
  assert.equal(codeResult.ok, true);
  assert.notEqual(currentPairingCode(), null);

  const unpairResult = await runPeerAction('peer-unpair');
  assert.equal(unpairResult.ok, true);
  assert.equal(bridgeState.peerStatus.paired, false);
});

test('Unpair says so when the stored pairing cannot be removed, and the link stays', async () => {
  const storageDir = fs.mkdtempSync(path.join(tmpdir(), 'rc-setlist-unpair-test-'));
  setExtensionContext({ environment: { storageDirectory: storageDir } });
  // A folder where the pairing file belongs is a path the system refuses to
  // remove, the way a locked file would be.
  const stored = path.join(storageDir, 'peer.json');
  fs.mkdirSync(stored);
  fs.writeFileSync(path.join(stored, 'held'), 'x');
  startPeerLink({ host: '127.0.0.1', port: 1, peerToken: 'held', fingerprint: 'held' });
  try {
    const english = await runPeerAction('peer-unpair', 'en');
    assert.equal(english.ok, false);
    assert.match(english.message, /^Could not undo the pairing/);
    assert.equal(bridgeState.peerStatus.paired, true);

    const portuguese = await runPeerAction('peer-unpair', 'pt-BR');
    assert.equal(portuguese.ok, false);
    assert.match(portuguese.message, /^Não foi possível desfazer o pareamento/);
    assert.equal(bridgeState.peerStatus.paired, true);
  } finally {
    stopPeerLink();
    startPeerLink(null);
    clearExtensionContext();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
});

test('runPeerAction handles invalid peer-pair input in en and pt-BR', async () => {
  const badEn = await runPeerAction('peer-pair:bad-input', 'en');
  assert.equal(badEn.ok, false);
  assert.match(badEn.message, /That address or code was not accepted/);

  const badPt = await runPeerAction('peer-pair:bad-input', 'pt-BR');
  assert.equal(badPt.ok, false);
  assert.match(badPt.message, /Esse endereço ou código não foi aceito/);
});

test('runPeerAction handles peer-pair failure with translated messages in en and pt-BR', async () => {
  const failEn = await runPeerAction('peer-pair:127.0.0.1:000000', 'en');
  assert.equal(failEn.ok, false);
  assert.match(failEn.message, /^Could not pair with 127\.0\.0\.1:/);

  const failPt = await runPeerAction('peer-pair:127.0.0.1:000000', 'pt-BR');
  assert.equal(failPt.ok, false);
  assert.match(failPt.message, /^Não foi possível parear com 127\.0\.0\.1:/);
});

test('runPeerAction pairs with a computer on a port of its own, and always asserts', async () => {
  const storageDir = fs.mkdtempSync(path.join(tmpdir(), 'rc-setlist-panel-test-'));
  setExtensionContext({ environment: { storageDirectory: storageDir } });
  resetPairingState();
  setPeerToken('test-peer-token');
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    algorithm: 'sha256',
    keySize: 2048,
  });
  const tls = { key: pems.private, cert: pems.cert };
  const server = https.createServer(tls, createHttpRequestListener());
  // An ephemeral port: 4444 belongs to a running Live, and a test that
  // skipped itself when the port was busy proved nothing on that machine.
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  try {
    const code = generatePairingCode();
    const res = await runPeerAction(`peer-pair:127.0.0.1:${code}`, 'en', port);
    assert.equal(res.ok, true);
    assert.equal(bridgeState.peerStatus.paired, true);
    assert.equal(readPeerConfig()?.port, port);
  } finally {
    await new Promise((r) => server.close(r));
    stopPeerLink();
    clearPeerConfig();
    clearExtensionContext();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
});
