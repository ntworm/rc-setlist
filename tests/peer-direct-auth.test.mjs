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

const mkCtx = () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'rc-d-'));
  ctx.setExtensionContext({ environment: { storageDirectory: dir } });
  return dir;
};
const rmCtx = (dir) => {
  for (const fn of [setPeerToken, hp.setDirectToken, hp.setDirectHost]) fn('');
  pairing.resetPairingState();
  ctx.clearExtensionContext();
  fs.rmSync(dir, { recursive: true, force: true });
};
function callPairRaw() {
  let body = '';
  const sock = { encrypted: true, remoteAddress: '127.0.0.1' };
  const url = `/peer/pair?code=${pairing.generatePairingCode()}`;
  const res = { writeHead: () => {}, end: (s) => (body = s) };
  hp.handlePeerPair({ url, headers: {}, socket: sock }, res);
  return JSON.parse(body);
}
const san = ['localhost', '127.0.0.1', '192.168.1.44'].map((v, i) =>
  i ? { type: 7, ip: v } : { type: 2, value: v },
);
const ext = [{ name: 'subjectAltName', altNames: san }];
const pems = await selfsigned.generate([], { extensions: ext });
const tls = { key: Buffer.from(pems.private), cert: Buffer.from(pems.cert) };
function assertRegen(fn, file, bads, prev) {
  for (const bad of bads) {
    fs.writeFileSync(file, bad);
    const nx = fn();
    assert.equal(nx !== prev && nx !== bad.trim() && fs.readFileSync(file, 'utf8') === nx, true);
    assert.match(nx, /^[0-9a-f]{32}$/);
  }
}

test('validators and token persistence reject invalid, whitespace, and collisions', () => {
  const badIps1 = [null, '', '192.168.01.1', '0.0.0.0', '127.0.0.1', '224.0.0.1'];
  const badToks = [null, '', ' a', 'a ', 'a\nb', 'a\x00b', 'a\x7fb', 'a\u0080b', 'a\u00a0b'];
  const chk = (f, a, e) => a.forEach((v) => assert.equal(f(v), e));
  chk(h.isStrictNonLoopbackIpv4, ['192.168.1.10', '10.0.0.5'], true);
  chk(h.isStrictNonLoopbackIpv4, [...badIps1, '192.168.1.256', '192.168.1', '192.168.1.1 '], false);
  chk(h.isValidScopedToken, ['abc123', '!-~'], true);
  chk(h.isValidScopedToken, badToks, false);
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
  let overrideBody = null;
  const app = createHttpRequestListener();
  const srv = https.createServer(tls, (q, s) => (overrideBody ? s.end(overrideBody) : app(q, s)));
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
    assert.deepEqual(prefs.readPeerConfig(), c);
    assert.equal(sameConfig(c, { ...c }) && !sameConfig(c, { ...c, directToken: 'o' }), true);
    assert.equal(sameConfig(c, { ...c, directHost: '10.0.0.9' }), false);
    for (const t of [null, 'bad token', 'peer-abc']) {
      hp.setDirectToken(t);
      hp.setDirectHost(t ? '127.0.0.1' : null);
      assert.deepEqual(callPairRaw(), { peerToken: 'peer-abc' });
    }
    overrideBody = JSON.stringify({ peerToken: 'p', directToken: 'p', directHost: '127.0.0.1' });
    const r3 = await pairing.pair('127.0.0.1', '000000', srv.address().port);
    assert.equal(r3.ok && !r3.config.directToken && !r3.config.directHost, true);
    for (const patch of [{ directToken: 'peer-abc' }, { directHost: '127.0.0.1' }]) {
      prefs.writePeerConfig({ ...c, ...patch });
      assert.equal(prefs.readPeerConfig(), null);
    }
  } finally {
    await new Promise((r) => srv.close(r));
    rmCtx(dir);
  }
});

test('resolveServerDirectHost and server lifecycle enforce TLS coverage and cleanup', async () => {
  const stub = async () => ({ primary: '192.168.1.44', others: [] });
  const r = dt.resolveServerDirectHost;
  assert.equal(await r({}, tls, stub), '192.168.1.44');
  assert.equal(await r({ directHost: '192.168.1.44' }, null, () => assert.fail('x')), '');
  assert.equal(await r({}, tls, () => Promise.reject(new Error('x'))), '');
  assert.equal(await r({}, tls, () => assert.fail('sync')), '');
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
