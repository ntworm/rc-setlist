import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as https from 'node:https';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import selfsigned from 'selfsigned';
import * as ctx from '../src/context.ts';
import * as prefs from '../src/preferences.ts';
import { bridgeState as bs } from '../src/runtime/bridge-state.ts';
import * as dt from '../src/runtime/direct-token.ts';
import * as pairing from '../src/runtime/pairing.ts';
import { sameConfig } from '../src/runtime/peer-message.ts';
import { startServer, stopServer } from '../src/server-lifecycle.ts';
import { createHttpRequestListener, setPeerToken } from '../src/server/http.ts';
import * as hp from '../src/server/http-peer.ts';
import * as h from '../src/util/helpers.ts';

function mkCtx() {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'rc-d-'));
  ctx.setExtensionContext({ environment: { storageDirectory: dir } });
  return dir;
}

async function makeTlsCert(ip) {
  const san = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    { type: 7, ip },
  ];
  const p = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    algorithm: 'sha256',
    keySize: 2048,
    extensions: [{ name: 'subjectAltName', altNames: san }],
  });
  return { key: Buffer.from(p.private), cert: Buffer.from(p.cert) };
}

test('validators and token persistence reject invalid, whitespace, and collisions', () => {
  for (const v of ['192.168.1.10', '10.0.0.5']) assert.equal(h.isStrictNonLoopbackIpv4(v), true);
  const badIps = [null, '', '192.168.01.1', '0.0.0.0', '127.0.0.1', '224.0.0.1'];
  for (const v of badIps) assert.equal(h.isStrictNonLoopbackIpv4(v), false);
  for (const v of ['abc123', '!-~']) assert.equal(h.isValidScopedToken(v), true);
  const badToks = [null, '', ' a', 'a ', 'a\nb', 'a\x00b', 'a\x7fb', 'a\u0080b', 'a\u00a0b'];
  for (const v of badToks) assert.equal(h.isValidScopedToken(v), false);
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'rc-dtok-'));
  const prev = { ...bs };
  try {
    Object.assign(bs, {
      globalPersistenceDir: dir,
      authToken: 'a1',
      peerToken: 'p1',
      directToken: '',
    });
    const d1 = dt.getOrGenerateDirectToken();
    assert.match(d1, /^[0-9a-f]{32}$/);
    fs.writeFileSync(path.join(dir, 'direct-token'), `${d1}\r\n`);
    assert.equal(dt.getOrGenerateDirectToken(), d1);
    for (const bad of [` ${d1}`, `${d1}\u00a0`, 'a1', 'p1']) {
      fs.writeFileSync(path.join(dir, 'direct-token'), bad);
      assert.notEqual(dt.getOrGenerateDirectToken(), bad);
    }
    bs.directToken = 'd-fixed';
    for (const bad of [' bad', 'bad\u00a0', 'd-fixed']) {
      fs.writeFileSync(path.join(dir, 'peer-token'), bad);
      assert.notEqual(pairing.getOrGeneratePeerToken(), bad);
    }
  } finally {
    Object.assign(bs, prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/peer/pair, PeerConfig, and sameConfig handle optional directToken/directHost', async () => {
  const dir = mkCtx();
  pairing.resetPairingState();
  const srv = https.createServer(await makeTlsCert('192.168.1.44'), createHttpRequestListener());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const port = srv.address().port;
    setPeerToken('peer-abc');
    hp.setDirectToken('bad token');
    hp.setDirectHost('127.0.0.1');
    const r1 = await pairing.pair('127.0.0.1', pairing.generatePairingCode(), port);
    assert.equal(r1.ok && !r1.config.directToken && !r1.config.directHost, true);

    hp.setDirectToken('direct-xyz');
    hp.setDirectHost('192.168.1.44');
    const r2 = await pairing.pair('127.0.0.1', pairing.generatePairingCode(), port);
    const c = r2.config;
    assert.equal(r2.ok && c.directToken === 'direct-xyz' && c.directHost === '192.168.1.44', true);
    assert.equal(prefs.readPeerConfig()?.directToken, 'direct-xyz');
    assert.equal(sameConfig(c, { ...c }) && !sameConfig(c, { ...c, directToken: 'o' }), true);
    for (const bad of [{ directToken: 'peer-abc' }, { directHost: '127.0.0.1' }]) {
      prefs.writePeerConfig({ ...c, ...bad });
      assert.equal(prefs.readPeerConfig(), null);
    }
  } finally {
    hp.setDirectToken('');
    hp.setDirectHost('');
    pairing.resetPairingState();
    ctx.clearExtensionContext();
    await new Promise((r) => srv.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveServerDirectHost and server lifecycle enforce TLS coverage and cleanup', async () => {
  const tls = await makeTlsCert('192.168.1.44');
  const stub = async () => ({ primary: '192.168.1.44', others: [] });
  const fail = () => Promise.reject(new Error('x'));
  assert.equal(await dt.resolveServerDirectHost({}, tls, stub), '192.168.1.44');
  assert.equal(await dt.resolveServerDirectHost({}, null, stub), '');
  assert.equal(await dt.resolveServerDirectHost({}, tls, fail), '');
  assert.equal(await dt.resolveServerDirectHost({ directHost: '192.168.1.99' }, tls, stub), '');
  assert.equal(await dt.resolveServerDirectHost({ directHost: '127.0.0.1' }, tls, stub), '');

  const dir = mkCtx();
  Object.assign(bs, { directToken: 'stale-direct', directHost: '192.168.1.44' });
  try {
    await startServer({ port: 0, skipOsc: true, skipCerts: true, skipProjectDetector: true });
    assert.match(bs.directToken, /^[0-9a-f]{32}$/);
    assert.equal(bs.directHost, '');
    const snap = JSON.stringify({ s: bs.manager?.getState(), p: bs.peerStatuses });
    assert.equal(snap.includes(bs.directToken), false);
    await stopServer();
    assert.equal(bs.directToken === '' && bs.directHost === '', true);
  } finally {
    await stopServer();
    ctx.clearExtensionContext();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
