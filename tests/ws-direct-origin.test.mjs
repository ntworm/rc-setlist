import assert from 'node:assert/strict';
import * as http from 'node:http';
import test from 'node:test';
import { WebSocket } from 'ws';
import { SetlistWSServer } from '../src/server/ws.ts';
import { classifyUpgradeRequest, isLocalOrigin } from '../src/server/ws-origin.ts';
import { isLinkLocalIpv4 } from '../src/util/helpers.ts';

const TOK = { authToken: 'a-tok', peerToken: 'p-tok', directToken: 'd-tok' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextMsg = (ws) => new Promise((r) => ws.once('message', (d) => r(JSON.parse(d.toString()))));
const has = (c, t) => c.msgs.some((m) => m.type === t);
const auth = (c, token) => c.ws.send(JSON.stringify({ type: 'auth', token }));

async function withWsServer(opts, fn) {
  const wsServer = new SetlistWSServer(opts.auth ?? 'a-tok', {
    peerToken: opts.peer ?? 'p-tok',
    directToken: opts.direct ?? 'd-tok',
  });
  wsServer.init();
  const srv = http.createServer();
  srv.on('upgrade', (req, sock, head) => wsServer.handleUpgrade(req, sock, head));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await fn(wsServer, srv.address().port);
  } finally {
    wsServer.stop();
    await new Promise((r) => srv.close(r));
  }
}

function rawUpgrade(port, path, hdrs) {
  const headers = {
    Upgrade: 'websocket',
    Connection: 'Upgrade',
    'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version': '13',
    ...hdrs,
  };
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers });
    req.on('upgrade', (_r, s) => (s.destroy(), resolve(101)));
    req.on('response', (r) => (r.resume(), resolve(r.statusCode)));
    req.on('error', reject);
    req.end();
  });
}

function openWs(url, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, headers ? { headers } : undefined);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    ws.once('open', () => resolve({ ws, msgs }));
    ws.once('error', reject);
  });
}

test('isLinkLocalIpv4, isLocalOrigin, and classifyUpgradeRequest enforce boundaries', () => {
  const chk = (f, list, exp) => list.forEach((v) => assert.equal(f(v), exp, String(v)));
  chk(isLinkLocalIpv4, ['169.254.0.1', '169.254.255.254'], true);
  chk(
    isLinkLocalIpv4,
    [null, '169.253.1.1', '169.255.1.1', '169.254.01.1', '169.254.256.1', '169.254.1.1 '],
    false,
  );
  const okO =
    'http://localhost:4444 https://127.0.0.1:4444 http://[::1]:4444 https://192.168.1.10:4444 http://169.254.1.2:4444 http://foo.local:4444'.split(
      ' ',
    );
  const badO = [
    ' http://localhost:4444',
    ...'http://.local http://a..local http://localhost:4444/ http://@localhost:4444 http://localhost:4444?a=1 http://localhost:4444#h http://localhost:4444\\ http://localhost: ftp://localhost:4444 https://evil.com'.split(
      ' ',
    ),
  ];
  chk(isLocalOrigin, okO, true);
  chk(isLocalOrigin, badO, false);
  const h = { host: 'h:1' };
  const loc = { host: 'h:1', origin: 'http://169.254.2.2:5173' };
  const dup = { authToken: 'dup', peerToken: 'p', directToken: 'dup' };
  const rows = [
    ['/ws?token=a-tok', { ...h, origin: 'http://h:1' }, TOK, 'allow:browser:true'],
    ['/ws?token=p-tok', h, TOK, 'allow:peer:false'],
    ['/ws', h, TOK, 'allow:browser:false'],
    ['/ws?token=d-tok', { origin: 'http://localhost:5173' }, TOK, 'forbid:none:false'],
    ['/ws?token=d-tok', { ...h, origin: 'https://evil.com' }, TOK, 'forbid:none:false'],
    ['/ws?token=d-tok', loc, TOK, 'allow_direct:direct:false'],
    ['/ws?token=a-tok', loc, TOK, 'forbid_check_rate:none:false'],
    ['/ws', loc, TOK, 'forbid:none:false'],
    ['/ws?token=d-tok', h, TOK, 'allow_direct:direct:false'],
    ['/ws?token=dup', h, dup, 'allow_check_rate:browser:false'],
  ];
  for (const [url, headers, toks, exp] of rows) {
    const r = classifyUpgradeRequest({ url, headers }, toks);
    assert.equal(`${r.decision}:${r.role}:${r.isController}`, exp);
  }
});

test('WS upgrade allows local cross-origin directToken and enforces 403/429 lockout', async () => {
  await withWsServer({}, async (wsServer, port) => {
    const h = { Host: `127.0.0.1:${port}` };
    const loc = { ...h, Origin: 'http://169.254.1.2:5173' };
    assert.equal(await rawUpgrade(port, '/ws?token=d-tok', loc), 101);
    let wrote = '';
    const sock = { remoteAddress: '127.0.0.1', write: (s) => (wrote += s), destroy: () => {} };
    wsServer.handleUpgrade(
      { url: '/ws?token=d-tok', headers: { origin: 'http://localhost:5173' } },
      sock,
      Buffer.alloc(0),
    );
    assert.match(wrote, /^HTTP\/1\.1 403/);
    assert.equal(
      await rawUpgrade(port, '/ws?token=d-tok', { ...h, Origin: 'https://evil.com' }),
      403,
    );
    for (let i = 0; i < 5; i += 1) assert.equal(await rawUpgrade(port, '/ws?token=bad', loc), 403);
    assert.equal(await rawUpgrade(port, '/ws?token=bad', loc), 429);
    assert.equal(await rawUpgrade(port, '/ws?token=d-tok', loc), 429);
    assert.equal(await rawUpgrade(port, '/ws?token=d-tok', h), 429);
  });
});

test('direct sockets stay isolated and sendToControllers/controller_authenticated work', async () => {
  await withWsServer({}, async (wsServer, port) => {
    const ev = [];
    wsServer.on('controller_authenticated', (s) => ev.push(s));
    wsServer.broadcastState({ stateVersion: 1 });
    const base = `ws://127.0.0.1:${port}/ws`;
    const [dir, peer, view, ctrl] = await Promise.all([
      openWs(`${base}?token=d-tok`, { Host: `127.0.0.1:${port}`, Origin: 'http://[::1]:5173' }),
      openWs(`${base}?token=p-tok`),
      openWs(base),
      openWs(`${base}?token=a-tok`),
    ]);
    await sleep(40);
    assert.equal(dir.msgs.length, 0);
    assert.equal(wsServer.peerConnectionCount() === 1 && wsServer.peerSockets().length === 1, true);
    wsServer.broadcast({ type: 'bcast_ping' });
    wsServer.broadcastLog('hi');
    wsServer.sendToControllers({ type: 'direct_targets', n: 1 });
    auth(dir, 'a-tok');
    assert.equal((await nextMsg(dir.ws)).success, false);
    auth(ctrl, 'a-tok');
    auth(view, 'd-tok');
    assert.equal((await nextMsg(view.ws)).success, false);
    auth(view, 'a-tok');
    await sleep(40);
    assert.equal(ev.length, 1);
    assert.equal(
      has(ctrl, 'direct_targets') && !has(view, 'direct_targets') && !has(peer, 'direct_targets'),
      true,
    );
    assert.equal(dir.msgs.filter((m) => m.type !== 'auth_result').length, 0);
    for (const c of [dir, peer, view, ctrl]) c.ws.close();
  });
});

test('manual auth denies colliding authToken/directToken without emitting event', async () => {
  await withWsServer({ auth: 'same', direct: 'same' }, async (wsServer, port) => {
    const ev = [];
    wsServer.on('controller_authenticated', (s) => ev.push(s));
    const v = await openWs(`ws://127.0.0.1:${port}/ws`);
    await sleep(20);
    auth(v, 'same');
    assert.equal((await nextMsg(v.ws)).success, false);
    assert.equal(ev.length, 0);
    v.ws.close();
  });
});
