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
import {
  parsePeerAckAction,
  peerHealthBadgeText,
  peerReasonText,
  peerRowDisplay,
} from '../src/ui/peer-panel-health.ts';
import { roleText } from '../src/ui/peer-role-text.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import {
  generatePairingCode,
  currentPairingCode,
  resetPairingState,
} from '../src/runtime/pairing.ts';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import {
  clearPeerConfig,
  readPeerConfig,
  readPeerConfigs,
  writePeerConfig,
  writeSlaveRole,
} from '../src/preferences.ts';
import { startPeerLink, startPeerLinks, stopPeerLink } from '../src/runtime/peer-link.ts';
import { createHttpRequestListener, setPeerToken } from '../src/server/http.ts';
import { createPeerComputer, fingerprintOf, PEER_TOKEN } from './helpers/peer-link-harness.mjs';

test('the panel reads the three peer actions', () => {
  assert.deepEqual(parsePeerAction('peer-unpair'), { kind: 'unpair' });
  assert.deepEqual(parsePeerAction('peer-code'), { kind: 'code' });
  assert.deepEqual(parsePeerAction('peer-ack'), { kind: 'ack' });
  assert.deepEqual(parsePeerAction('peer-ack:192.168.1.20:4444'), {
    kind: 'ack',
    peerKey: '192.168.1.20:4444',
  });
  assert.deepEqual(parsePeerAction('peer-ack:inbound:master'), {
    kind: 'ack',
    peerKey: 'inbound:master',
  });
  for (const host of ['192.168.1.10', 'studio.local', 'localhost']) {
    assert.deepEqual(parsePeerAction(`peer-pair:${host}:123456`), {
      kind: 'pair',
      host,
      code: '123456',
    });
  }
});

test('an action the panel does not know is not a peer action', () => {
  assert.equal(parsePeerAction('start'), null);
  assert.equal(parsePeerAction('peer-nonsense'), null);
  assert.equal(parsePeerAction(''), null);
  assert.equal(parsePeerAction('peer-unpair-please'), null);
  assert.equal(parsePeerAction('peer-ack:'), null);
  assert.equal(parsePeerAction('peer-ack:bad key'), null);
  assert.equal(parsePeerAckAction('peer-ack:evil/path'), null);
});

test('a code that is not six digits is refused', () => {
  for (const bad of ['12345', '1234567', 'abcdef', '']) {
    assert.equal(parsePeerAction(`peer-pair:192.168.1.10:${bad}`), null);
  }
});

test('a hostile address is refused', () => {
  // The address is about to be handed to the network stack. Anything that
  // is not a plain address or a plain name is refused before it gets there.
  const hostile = [
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
    'peer-pair:https://evil.com/../etc:123456',
    'peer-pair:192.168.1.10:4444/x:123456',
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

test('the panel tells the link states apart with health precedence', () => {
  const b = { paired: true, connected: true, markersMatch: true, fingerprintMismatch: false };
  const at = (patch) => peerPanelState({ ...b, ...patch });
  assert.equal(at({ paired: false }), 'not_paired');
  assert.equal(at({}), 'connected');
  assert.equal(at({ markersMatch: false }), 'markers_differ');
  assert.equal(at({ connected: false }), 'offline');
  assert.equal(at({ versionMismatch: true, health: 'down' }), 'version_mismatch');
  assert.equal(at({ fingerprintMismatch: true, versionMismatch: true }), 'certificate_changed');
  assert.equal(at({ connected: true, health: 'down' }), 'offline');
  assert.equal(at({ health: 'unstable', reason: 'recent_drop' }), 'unstable');
  assert.equal(at({ health: 'unstable', reason: 'markers_differ' }), 'markers_differ');
  assert.equal(at({ connected: false, health: 'ok' }), 'connected');
});

test('every state says something in both languages', () => {
  const states =
    'not_paired,connected,markers_differ,unstable,offline,version_mismatch,certificate_changed'.split(
      ',',
    );
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

test('sanitizePanelAction masks peer-pair and peer-ack actions and preserves others', () => {
  assert.equal(sanitizePanelAction('peer-pair:192.168.1.10:123456'), 'peer-pair');
  assert.equal(sanitizePanelAction('peer-pair:studio.local:654321'), 'peer-pair');
  assert.equal(sanitizePanelAction('peer-ack:192.168.1.20:4444'), 'peer-ack');
  assert.equal(sanitizePanelAction('peer-ack'), 'peer-ack');
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

test('parsePeerAction reads the address and code the way people type them', () => {
  const want = { kind: 'pair', host: '192.168.1.10', code: '123456' };
  assert.deepEqual(parsePeerAction('peer-pair:192.168.1.10:4444:123456'), want);
  assert.deepEqual(parsePeerAction('peer-pair:https://192.168.1.10:4444/:123456'), want);
  assert.deepEqual(parsePeerAction('peer-pair: 192.168.1.10 :123 456'), want);
  assert.deepEqual(parsePeerAction('peer-pair:192.168.1.10:123-456'), want);
  assert.deepEqual(parsePeerAction('peer-pair:１９２.168.1.10:１２３456'), want);
  assert.deepEqual(parsePeerAction('peer-pair:Studio.Local:123456'), {
    kind: 'pair',
    host: 'studio.local',
    code: '123456',
  });
  assert.equal(parsePeerAction('peer-pair:192168110:123456'), null);
  assert.equal(parsePeerAction('peer-pair:192.168.1.10:12345'), null);
});

test('a refused pairing says what it read without the code itself', async () => {
  const outcome = await runPeerAction('peer-pair:19216811:654321', 'en');
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /Read: address "19216811", code with 6 digits\./);
  assert.doesNotMatch(outcome.message, /654321/);
});

// The main computer, the second computers, and the roles they play.

test('the panel reads the action that unpairs one computer', () => {
  assert.deepEqual(parsePeerAction('peer-unpair:192.168.1.10:4444'), {
    kind: 'unpair-one',
    host: '192.168.1.10',
    port: 4444,
  });
  const named = parsePeerAction('peer-unpair:studio.local:4444');
  assert.equal(named.kind, 'unpair-one');
  assert.equal(named.host, 'studio.local');
  assert.equal(named.port, 4444);
});

test('an unpair action that names no computer is refused', () => {
  const refused = (
    'peer-unpair:,peer-unpair:192.168.1.10,peer-unpair:192.168.1.10:,' +
    'peer-unpair:192.168.1.10:0,peer-unpair:192.168.1.10:65536,' +
    'peer-unpair:192.168.1.10:port,peer-unpair:evil.com/path:4444'
  ).split(',');
  for (const action of refused) {
    assert.equal(parsePeerAction(action), null, `${action} must be refused`);
  }
});

test('sanitizePanelAction masks the action that unpairs one computer', () => {
  assert.equal(sanitizePanelAction('peer-unpair:192.168.1.10:4444'), 'peer-unpair');
  assert.equal(sanitizePanelAction('peer-unpair'), 'peer-unpair');
});

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const closeServer = (s) => new Promise((r) => s.close(() => r()));
const rowOf = (port) => bridgeState.peerStatuses.find((row) => row.port === port);

/** What the panel shows about one paired computer. */
function peerRow(host, connected) {
  return { host, port: 4444, connected, markersMatch: true, fingerprintMismatch: false };
}

/** Runs a test with two paired computers, each with a server of its own. */
async function withTwoPairedComputers(run) {
  const storageDir = fs.mkdtempSync(path.join(tmpdir(), 'rc-setlist-slaves-'));
  setExtensionContext({ environment: { storageDirectory: storageDir } });
  setPeerToken(PEER_TOKEN);
  resetPairingState();
  const first = await createPeerComputer();
  const second = await createPeerComputer();
  const firstPort = await listen(first.server);
  const secondPort = await listen(second.server);
  try {
    // The first computer is paired already; the second one is paired from the panel.
    writePeerConfig(pairingOf(first, firstPort));
    startPeerLinks(readPeerConfigs());
    await waitFor(() => bridgeState.peerStatus.connected === true);
    const code = generatePairingCode();
    const paired = await runPeerAction(`peer-pair:127.0.0.1:${code}`, 'en', secondPort);
    assert.equal(paired.ok, true);
    const bothAreUp = await waitFor(
      () => bridgeState.peerStatuses.length === 2 && bridgeState.peerStatus.connected === true,
    );
    assert.equal(bothAreUp, true, 'both computers must be linked');
    await run({ first, second, firstPort, secondPort });
  } finally {
    stopPeerLink();
    await closeServer(first.server);
    await closeServer(second.server);
    clearPeerConfig();
    clearExtensionContext();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
}

/** Runs a test with a storage of its own and with the peers as they were. */
function withOwnStorage(run) {
  const storageDir = fs.mkdtempSync(path.join(tmpdir(), 'rc-setlist-model-'));
  const statuses = bridgeState.peerStatuses;
  const server = bridgeState.wsServer;
  setExtensionContext({ environment: { storageDirectory: storageDir } });
  try {
    run(storageDir);
  } finally {
    bridgeState.peerStatuses = statuses;
    bridgeState.wsServer = server;
    clearExtensionContext();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
}

/** The pairing of one computer, written down by hand. */
function pairingOf(peer, port) {
  return { host: '127.0.0.1', port, peerToken: PEER_TOKEN, fingerprint: fingerprintOf(peer.tls) };
}

test('pairing a second computer keeps the first one linked, and unpairing one keeps the other', async () => {
  await withTwoPairedComputers(async ({ first, firstPort, secondPort }) => {
    assert.equal(readPeerConfigs().length, 2);
    assert.equal(rowOf(firstPort).connected, true);
    assert.equal(rowOf(secondPort).connected, true);
    // The first computer still sees the main one talking to it.
    assert.equal(first.wsServer.peerConnectionCount(), 1);

    const outcome = await runPeerAction(`peer-unpair:127.0.0.1:${firstPort}`, 'en');
    assert.equal(outcome.ok, true);
    const configs = readPeerConfigs();
    assert.equal(configs.length, 1, 'the other computer stays paired');
    assert.equal(configs[0].port, secondPort);
    assert.equal(rowOf(firstPort), undefined, 'the forgotten computer is gone');
    const otherIsUp = await waitFor(() => rowOf(secondPort)?.connected === true);
    assert.equal(otherIsUp, true, 'the other computer is linked again');
  });
});

test('the model names the role of the main computer and counts the second ones', () => {
  withOwnStorage(() => {
    bridgeState.peerStatuses = [peerRow('192.168.1.10', true), peerRow('192.168.1.11', false)];
    writePeerConfig({ host: '192.168.1.10', port: 4444, peerToken: 'token', fingerprint: 'print' });

    const english = peerPanelModel({ locale: 'en' });
    assert.equal(english.role, 'master');
    assert.equal(english.roleText, 'Master \xB7 1 of 2 slaves connected');
    assert.equal(english.peers.length, 2);
    assert.equal(english.peers[0].host, '192.168.1.10');
    assert.equal(english.peers[0].port, 4444);
    assert.equal(english.peers[0].statusText, peerStateText('connected', 'en'));
    assert.equal(english.peers[1].statusText, peerStateText('offline', 'en'));

    const portuguese = peerPanelModel({ locale: 'pt-BR' });
    assert.equal(portuguese.roleText, 'Master \xB7 1 de 2 slaves conectados');
    assert.equal(portuguese.peers[1].statusText, peerStateText('offline', 'pt-BR'));
  });
});

test('the model says the second computer follows a master, and that nobody is nobody', () => {
  withOwnStorage(() => {
    // A computer that paired with nobody is neither main nor second.
    bridgeState.peerStatuses = [];
    const alone = peerPanelModel({ locale: 'en' });
    assert.equal(alone.role, 'none');
    assert.equal(alone.roleText, '');
    assert.equal(alone.masterAddress, '');
    assert.deepEqual(alone.peers, []);

    writeSlaveRole({ masterAddress: '192.168.1.2', pairedAt: '2026-11-18T10:00:00.000Z' });
    bridgeState.wsServer = null;

    const away = peerPanelModel({ locale: 'en' });
    assert.equal(away.role, 'slave');
    assert.equal(away.masterAddress, '192.168.1.2');
    assert.equal(away.roleText, 'Slave \xB7 master not connected');
    assert.equal(peerPanelModel({ locale: 'pt-BR' }).roleText, 'Slave \xB7 master desconectado');

    bridgeState.wsServer = { peerConnectionCount: () => 1 };
    const here = peerPanelModel({ locale: 'en' });
    assert.equal(here.roleText, 'Slave \xB7 connected to the master');
    assert.equal(peerPanelModel({ locale: 'pt-BR' }).roleText, 'Slave \xB7 conectado ao master');
  });
});

test('peer-panel health badges, reasons, row display, roleText, and peer-ack', async () => {
  for (const s of ['ok', 'unstable', 'down', 'version_mismatch', 'certificate_changed']) {
    assert.ok(peerHealthBadgeText(s, 'en') && peerHealthBadgeText(s, 'pt-BR'));
  }
  assert.equal(peerHealthBadgeText('unstable', 'pt-BR'), 'INST\u00c1VEL');
  assert.equal(peerHealthBadgeText('down', 'pt-BR'), 'CA\u00cdDO');
  assert.equal(peerHealthBadgeText('version_mismatch', 'pt-BR'), 'VERS\u00d5ES DIFERENTES');
  const reasons = (
    'ok,link_down,remote_link_down,local_osc_live_unready,remote_osc_live_unready,' +
    'link_oscillating,warming_up,recent_drop,heartbeat_lost,high_rtt,remote_unstable,' +
    'markers_differ,out_of_step'
  ).split(',');
  for (const r of reasons) assert.ok(peerReasonText(r, 'en') && peerReasonText(r, 'pt-BR'));
  assert.equal(peerReasonText(undefined, 'en'), '');
  const row = { ...peerRow('10.0.0.2', true), health: 'down', canAcknowledge: true };
  assert.equal(peerRowDisplay(row, 'en', 9_000).canAcknowledge, false);
  const u = { ...row, connected: false, health: 'unstable', reason: 'recent_drop' };
  const ack = peerRowDisplay(u, 'pt-BR', 9_000);
  assert.deepEqual(
    [ack.badgeText, ack.canAcknowledge, ack.lastSeenAt],
    ['INST\u00c1VEL', true, 9_000],
  );
  assert.equal(roleText('master', 'en', [u]), 'Master \xB7 0 of 1 slaves healthy');
  assert.equal(roleText('slave', 'pt-BR', [u]), 'Slave \xB7 link inst\u00e1vel');
  assert.equal((await runPeerAction('peer-ack:10.0.0.2:4444')).ok, true);
  withOwnStorage(() => {
    const p = { ...row, key: '10.0.0.2:4444', health: 'ok', connected: false };
    bridgeState.peerStatuses = [p];
    const m = peerPanelModel({ locale: 'pt-BR', lastSeenByKey: { '10.0.0.2:4444': 777 } });
    assert.deepEqual(
      [typeof m.serverNow, m.peers[0].badgeText, m.peers[0].lastSeenAt],
      ['number', 'OK', 777],
    );
  });
});
