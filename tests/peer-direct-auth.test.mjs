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

function rmCtx(dir) {
  for (const fn of [setPeerToken, hp.setDirectToken, hp.setDirectHost]) fn('');
  pairing.resetPairingState();
  ctx.clearExtensionContext();
  fs.rmSync(dir, { recursive: true, force: true });
}

function callPairRaw() {
  let body = '';
  const sock = { encrypted: true, remoteAddress: '127.0.0.1' };
  const url = `/peer/pair?code=${pairing.generatePairingCode()}`;
  const res = { writeHead: () => res, end: (s) => (body = s) };
  hp.handlePeerPair({ url, headers: {}, socket: sock }, res);
  return JSON.parse(body);
}

async function makeTlsCert(ip) {
  const alt = (t, v) => (t === 2 ? { type: 2, value: v } : { type: 7, ip: v });
  const alts = [alt(2, 'localhost'), alt(7, '127.0.0.1'), alt(7, ip)];
  const cn = [{ name: 'commonName', value: 'localhost' }];
  const p = await selfsigned.generate(cn, {
    extensions: [{ name: 'subjectAltName', altNames: alts }],
  });
  return { key: Buffer.from(p.private), cert: Buffer.from(p.cert) };
}

function assertRegen(fn, file, bads, prev) {
  for (const bad of bads) {
    fs.writeFileSync(file, bad);
    const nx = fn();
    assert.equal(/^[0-9a-f]{32}$/.test(nx) && nx !== prev && nx !== bad.trim(), true);
    assert.equal(fs.readFileSync(file, 'utf8'), nx);
  }
}

test('validators and token persistence reject invalid, whitespace, and collisions', () => {
  const badIps = [null, '', '192.168.01.1', '0.0.0.0', '127.0.0.1', '224.0.0.1'];
  const badToks = [null, '', ' a', 'a ', 'a\nb', 'a\x00b', 'a\x7fb', 'a\u0080b', 'a\u00a0b'];
  for (const v of ['192.168.1.10', '10.0.0.5']) assert.equal(h.isStrictNonLoopbackIpv4(v), true);
  for (const v of badIps) assert.equal(h.isStrictNonLoopbackIpv4(v), false);
  for (const v of ['abc123', '!-~']) assert.equal(h.isValidScopedToken(v), true);
  for (const v of badToks) assert.equal(h.isValidScopedToken(v), false);
  const dir = mkCtx();
  const prev = { ...bs };
  const [dp, pp] = [path.join(dir, 'direct-token'), path.join(dir, 'peer-token')];
  try {
    const init = { globalPersistenceDir: dir, authToken: 'a1', peerToken: 'p1', directToken: '' };
    Object.assign(bs, init);
    const d1 = dt.getOrGenerateDirectToken();
    assert.equal(/^[0-9a-f]{32}$/.test(d1) && fs.readFileSync(dp, 'utf8') === d1, true);
    if (process.platform !== 'win32') assert.equal(fs.statSync(dp).mode & 0o777, 0o600);
    fs.writeFileSync(dp, `${d1}\r\n`);
    assert.equal(dt.getOrGenerateDirectToken(), d1);
    const badD = [` ${d1}`, `${d1} `, `${d1}\n\n`, `${d1}\u00a0`, 'a1', 'p1'];
    assertRegen(dt.getOrGenerateDirectToken, dp, badD, d1);
    bs.directToken = 'd-fixed';
    const badP = [' bad', 'bad ', 'bad\n\n', 'bad\u00a0', 'd-fixed'];
    assertRegen(pairing.getOrGeneratePeerToken, pp, badP, '');
  } finally {
    Object.assign(bs, prev);
    rmCtx(dir);
  }
});

test('/peer/pair, PeerConfig, and sameConfig handle optional directToken/directHost', async () => {
  const dir = mkCtx();
  pairing.resetPairingState();
  const srv = https.createServer(await makeTlsCert('192.168.1.44'), createHttpRequestListener());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    setPeerToken('peer-abc');
    hp.setDirectToken('direct-xyz');
    hp.setDirectHost('192.168.1.44');
    const exp = { peerToken: 'peer-abc', directToken: 'direct-xyz', directHost: '192.168.1.44' };
    assert.deepEqual(callPairRaw(), exp);
    const r2 = await pairing.pair('127.0.0.1', pairing.generatePairingCode(), srv.address().port);
    const c = r2.config;
    assert.equal(r2.ok && c.directToken === 'direct-xyz' && c.directHost === '192.168.1.44', true);
    assert.equal(prefs.readPeerConfig()?.directToken, 'direct-xyz');
    assert.equal(sameConfig(c, { ...c }) && !sameConfig(c, { ...c, directToken: 'o' }), true);
    assert.equal(sameConfig(c, { ...c, directHost: '10.0.0.9' }), false);
    for (const t of [null, 'bad token', 'peer-abc']) {
      hp.setDirectToken(t);
      hp.setDirectHost(t ? '127.0.0.1' : null);
      assert.deepEqual(callPairRaw(), { peerToken: 'peer-abc' });
    }
    for (const bad of [{ directToken: 'peer-abc' }, { directHost: '127.0.0.1' }]) {
      prefs.writePeerConfig({ ...c, ...bad });
      assert.equal(prefs.readPeerConfig(), null);
    }
  } finally {
    await new Promise((r) => srv.close(r));
    rmCtx(dir);
  }
});

test('resolveServerDirectHost and server lifecycle enforce TLS coverage and cleanup', async () => {
  const tls = await makeTlsCert('192.168.1.44');
  const stub = async () => ({ primary: '192.168.1.44', others: [] });
  const r = dt.resolveServerDirectHost;
  assert.equal(await r({}, tls, stub), '192.168.1.44');
  assert.equal(await r({ directHost: '192.168.1.44' }, null, () => assert.fail('x')), '');
  assert.equal(await r({}, tls, () => Promise.reject(new Error('x'))), '');
  assert.equal(await r({ directHost: '192.168.1.99' }, tls, stub), '');
  assert.equal(await r({ directHost: '127.0.0.1' }, tls, stub), '');

  const dir = mkCtx();
  fs.writeFileSync(path.join(dir, 'peer-token'), 'stale-direct');
  Object.assign(bs, { directToken: 'stale-direct', directHost: '192.168.1.44' });
  try {
    await startServer({ port: 0, skipOsc: true, skipCerts: true, skipProjectDetector: true });
    const okTok = bs.peerToken === 'stale-direct' && /^[0-9a-f]{32}$/.test(bs.directToken);
    assert.equal(okTok && bs.directToken !== 'stale-direct' && bs.directHost === '', true);
    assert.deepEqual(callPairRaw(), { peerToken: 'stale-direct', directToken: bs.directToken });
    const snap = JSON.stringify({ s: bs.manager?.getState(), p: bs.peerStatuses });
    assert.equal(snap.includes(bs.directToken), false);
    hp.setDirectHost('192.168.1.44');
    await stopServer();
    assert.equal(bs.directToken === '' && bs.directHost === '', true);
    assert.deepEqual(callPairRaw(), { peerToken: 'stale-direct' });
  } finally {
    await stopServer();
    rmCtx(dir);
  }
});
