import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { peerCommandRejection } from '../src/commands/handlers/peer.ts';
import { clearExtensionContext, setExtensionContext } from '../src/context.ts';
import { startServer, stopServer } from '../src/index.ts';
import { clearPeerConfig, clearSlaveRole, writeSlaveRole } from '../src/preferences.ts';
import { bridgeState as bs } from '../src/runtime/bridge-state.ts';
import { handlePeerTarget, resetPeerFollowRuntime } from '../src/runtime/peer-follow-runtime.ts';
import { startPeerLinks, stopPeerLink } from '../src/runtime/peer-link.ts';
import { payloadFields, peerCommandId } from '../src/runtime/peer-message.ts';
import { decodeClientMessage } from '../src/server/client-message.ts';
import * as h from './helpers/peer-link-harness.mjs';

const { MAIN_CUES, PEER_TOKEN, createFakeOsc, createPeerComputer, fingerprintOf } = h;
const [eq, is] = [assert.deepEqual, assert.equal];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (c, m) => c.ws.send(JSON.stringify(m));
const msgBy = (c, fn) => waitFor(() => c.msgs.find(fn));
const errAt = (c, id) => msgBy(c, (m) => m.commandId === id).then((m) => m.code);
async function waitFor(fn, ms = 5000) {
  for (let end = Date.now() + ms; Date.now() < end; await sleep(20)) if (fn()) return fn();
  return fn();
}
function openWs(port, tok) {
  const url = `ws://127.0.0.1:${port}/ws${tok ? `?token=${encodeURIComponent(tok)}` : ''}`;
  return new Promise((res, rej) => {
    const [ws, msgs] = [new WebSocket(url), []];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    ws.once('open', () => res({ ws, msgs })).once('error', rej);
  });
}
async function syncWs(c, clientId) {
  send(c, { type: 'handshake', clientId, linkProtocol: 2, sessionId: 's-1' });
  const ack = await msgBy(c, (m) => m.type === 'handshake_ack');
  send(c, { type: 'sync_confirm', stateVersion: ack.stateVersion });
  return (await sleep(20), { ...c, ack });
}
async function withServer(beforeStart, fn) {
  const [dir, calls, socks, reg] = [fs.mkdtempSync(path.join(tmpdir(), 'rc-wire-')), [], [], []];
  const open = (tok) => openWs(bs.server.address().port, tok).then((c) => (socks.push(c.ws), c));
  const sync = (tok, id) => open(tok).then((c) => syncWs(c, id));
  const song = { handle: { id: 1 }, tempo: 120, cuePoints: MAIN_CUES };
  setExtensionContext({ environment: { storageDirectory: dir }, application: { song } });
  try {
    if (beforeStart) await beforeStart(dir);
    await startServer({ port: 0, skipOsc: true, skipCerts: true, skipProjectDetector: true });
    const orig = bs.commandBus.registerCommand.bind(bs.commandBus);
    bs.commandBus.registerCommand = (...a) => (
      reg.push({ id: a[0], type: a[1], payload: a[2], sender: a[3] }),
      orig(...a)
    );
    bs.oscClient = { ...createFakeOsc(calls), setCurrentSongTime: () => {} };
    bs.manager.updateCues(MAIN_CUES);
    await fn({ calls, open, sync, reg });
  } finally {
    socks.forEach((w) => w.close());
    stopPeerLink();
    await stopServer();
    [clearPeerConfig, clearSlaveRole, clearExtensionContext].forEach((f) => f());
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('payloadFields and peerCommandRejection enforce role matrices', () => {
  const jt = { type: 'jump_time', commandId: 'c1', ttlMs: 500, transportSeq: 2, time: 100 };
  eq(payloadFields({ ...jt, section: true }), { time: 100, section: true });
  eq(payloadFields({ type: 'play', commandId: 'c1', ttlMs: null, transportSeq: null }), {});
  eq(payloadFields(null), {});
  const chk = (r, exp, list) =>
    list.forEach((m) => is(peerCommandRejection(m, r)?.code ?? null, exp, `${r}:${m.type}`));
  const byT = (s, ex) => s.split(' ').map((type) => ({ type, ...ex }));
  const sp = (active, cid) =>
    cid === undefined
      ? { type: 'set_panic', active }
      : { type: 'set_panic', active, commandId: cid };
  const acts = byT('play stop jump_time', { commandId: 'd1' });
  chk('direct', null, [...byT('handshake sync_confirm'), ...acts, sp(true, 'd4'), sp(false, 'd5')]);
  const miss = [...byT('play stop jump_time'), ...byT('play stop jump_time', { commandId: ' \t' })];
  chk('direct', 'invalid_message', [...miss, sp(true), sp(false, '')]);
  chk('direct', 'unauthorized', byT('rtt_ping jump set_mode peer_command', { commandId: 'x' }));
  chk('browser', null, [{ type: 'rtt_ping', t0: 1 }]);
  const po =
    'jump_time peer_upstream_result setlist_chunk peer_hb peer_hb_ack peer_target peer_command';
  chk('browser', 'unauthorized', byT(po));
  chk('peer', 'unauthorized', byT('rtt_ping jump set_mode get_lyrics'));
  chk('peer', null, byT('play peer_command'));
});

test('decodeClientMessage validates ttlMs/transportSeq, peer_command inner, and rtt_ping', () => {
  const [p, s, j] = [{ type: 'play' }, { type: 'stop' }, { type: 'jump_time', time: 10 }];
  const pa = { type: 'set_panic', active: true };
  const pf = { type: 'set_panic', active: false };
  const cmds = [p, s, j, pa, pf];
  for (const c of cmds) {
    const r = decodeClientMessage(c);
    is(r.ok && !('ttlMs' in r.message) && !('transportSeq' in r.message), true);
    eq(r.message, c);
  }
  const pcOf = (commandId, command) => ({
    type: 'peer_command',
    commandId,
    ttlMs: 500,
    transportSeq: 1,
    command,
  });
  const nn = (v) => (v === '' ? null : Number(v));
  const okSpec = '0,1,1 0,600000,9 1,,2 1,500,2 2,600000,3 3,,4 3,250,4 4,1, 4,600000,';
  const okMeta = okSpec.split(' ').map((r) => {
    const [i, t, q] = r.split(',');
    return { ...cmds[Number(i)], ttlMs: nn(t), transportSeq: nn(q) };
  });
  const ok = (list) => list.forEach((m) => eq(decodeClientMessage(m), { ok: true, message: m }));
  ok([...okMeta, { type: 'rtt_ping', t0: 0 }, { type: 'rtt_ping', t0: 12.5, commandId: 'r1' }]);
  ok([pcOf('p0', p)]);
  eq(decodeClientMessage({ type: 'rtt_ping', t0: 5, x: 1 }).message, { type: 'rtt_ping', t0: 5 });
  const bad = (list) => list.forEach((m) => is(decodeClientMessage(m).code, 'invalid_message'));
  for (const ttlMs of [0, 600_001]) bad(cmds.map((c) => ({ ...c, ttlMs })));
  for (const transportSeq of [null, 0]) bad(cmds.slice(0, 4).map((c) => ({ ...c, transportSeq })));
  bad([p, j, pf].map((c) => ({ ...c, ttlMs: null })));
  bad([1, 0].map((transportSeq) => ({ ...pf, transportSeq })));
  bad([pcOf('p1', { ...p, ttlMs: 500 }), pcOf('p2', { ...p, transportSeq: 1 })]);
  bad([{ type: 'rtt_ping' }, ...[-1, null, '1'].map((t0) => ({ type: 'rtt_ping', t0 }))]);
});

test('direct handshake_ack is minimal, rtt_ping is browser-only, and errors keep commandId', async () => {
  await withServer(null, async ({ open }) => {
    const toks = [bs.directToken, bs.authToken, '', bs.peerToken];
    const [dir, ctrl, view, peer] = await Promise.all(toks.map(open));
    send(dir, { type: 'play', commandId: 'e-ns' });
    send(ctrl, { type: 'rtt_ping', t0: 12.5, commandId: 'rp-b' });
    send(dir, { type: 'rtt_ping', t0: 12.5, commandId: 'rp-d' });
    send(peer, { type: 'rtt_ping', t0: 12.5, commandId: 'rp-p' });
    const e1 = [await errAt(dir, 'e-ns'), await errAt(dir, 'rp-d'), await errAt(peer, 'rp-p')];
    eq(e1, ['not_synchronized', 'unauthorized', 'unauthorized']);
    eq(await msgBy(ctrl, (m) => m.type === 'rtt_pong'), { type: 'rtt_pong', t0: 12.5 });
    const [dAck, bAck] = [(await syncWs(dir, 'd-1')).ack, (await syncWs(ctrl, 'b-1')).ack];
    await syncWs(view, 'v-1');
    is(!('state' in dAck) && typeof dAck.transportSeq === 'number', true);
    is(!dir.msgs.some((m) => m.type === 'profiles_state'), true);
    is('state' in bAck && Array.isArray(bAck.state.songs), true);
    assert.ok(await msgBy(ctrl, (m) => m.type === 'profiles_state'));
    send(dir, { type: 'set_mode', mode: 'show', commandId: 'e-pr' });
    send(ctrl, { type: 'jump_time', time: 100, commandId: 'e-pr2' });
    send(view, { type: 'play', commandId: 'e-ua' });
    send(dir, { type: 'jump_time', time: 999, commandId: 'e-nm' });
    is(await errAt(dir, 'e-pr'), 'unauthorized');
    is(await errAt(ctrl, 'e-pr2'), 'unauthorized');
    is(await errAt(view, 'e-ua'), 'unauthorized');
    is(await errAt(dir, 'e-nm'), 'peer_no_marker');
  });
});

test('direct strips meta before CommandBus, holds handlePeerTarget, and drops duplicate status', async () => {
  await withServer(null, async ({ calls, sync, reg }) => {
    resetPeerFollowRuntime();
    const [dir, ctrl] = await Promise.all([sync(bs.directToken, 'd-2'), sync(bs.authToken, 'b-2')]);
    send(dir, { type: 'stop', commandId: 'd-stop', ttlMs: 500, transportSeq: 4 });
    const dStopId = peerCommandId('d-stop');
    const r1 = await waitFor(() => reg.find((r) => r.id === dStopId));
    await waitFor(() => calls.includes('stopPlaying'));
    eq(r1.payload, { type: 'stop', commandId: dStopId });
    const dAck = await msgBy(dir, (m) => m.type === 'direct_ack' && m.commandId === 'd-stop');
    is(
      dAck.peerCommandId === dStopId && dAck.result === 'confirmed' && dAck.transportSeq === 4,
      true,
    );
    const f = {
      section: false,
      isPlaying: false,
      tempo: 120,
      jumpPending: false,
      loopActive: false,
    };
    const runT = () =>
      [0, 1, 2].map(() => handlePeerTarget({ transportSeq: 1, beat: 50, ...f }).kind);
    eq(runT(), ['none', 'none', 'none']);
    resetPeerFollowRuntime();
    eq(runT(), ['none', 'none', 'seek_stopped']);
    send(dir, { type: 'stop', commandId: 'd-stop', ttlMs: 500, transportSeq: 4 });
    send(dir, { type: 'rtt_ping', t0: 1, commandId: 'fence-d' });
    is(await errAt(dir, 'fence-d'), 'unauthorized');
    is(!dir.msgs.some((m) => m.type === 'command_status'), true);
    send(ctrl, { type: 'stop', commandId: 'b-stop' });
    const isB = (m) => m.type === 'command_status' && m.commandId === 'b-stop';
    await waitFor(() => ctrl.msgs.some(isB));
    send(ctrl, { type: 'stop', commandId: 'b-stop' });
    await waitFor(() => ctrl.msgs.filter(isB).length === 2);
  });
});

test('slave mode locks browser play, forwards browser stop without direct meta, and runs direct locally', async () => {
  const setRole = () =>
    writeSlaveRole({ masterAddress: '127.0.0.1:4444', pairedAt: '1970-01-01T00:00:00.000Z' });
  await withServer(setRole, async ({ calls, sync }) => {
    const peer = await sync(bs.peerToken, 'master-peer');
    await waitFor(() => bs.wsServer.peerSockets().some((s) => s.synchronized));
    const [ctrl, dir] = await Promise.all([sync(bs.authToken, 'sb'), sync(bs.directToken, 'sd')]);
    send(ctrl, { type: 'play', commandId: 'sb-0' });
    const locked = await msgBy(ctrl, (m) => m.type === 'command_status' && m.commandId === 'sb-0');
    is(locked.status === 'failed' && locked.reason === 'slave_locked', true);
    send(ctrl, { type: 'stop', commandId: 'sb-1', ttlMs: 500, transportSeq: 7 });
    const up = await msgBy(peer, (m) => m.type === 'peer_upstream');
    eq(up, { type: 'peer_upstream', command: { type: 'stop', commandId: 'sb-1' } });
    is(calls.length, 0);
    send(dir, { type: 'stop', commandId: 'sd-2', ttlMs: 500, transportSeq: 8 });
    const sdAck = await msgBy(dir, (m) => m.type === 'direct_ack' && m.commandId === 'sd-2');
    is(sdAck.result === 'confirmed' && sdAck.transportSeq === 8, true);
    is((await sync(bs.directToken, 'sd-2-ws')).ack.transportSeq, 8);
    const pCmd = {
      type: 'peer_command',
      commandId: peerCommandId('sd-2'),
      ttlMs: 500,
      transportSeq: 8,
    };
    send(peer, { ...pCmd, command: { type: 'stop' } });
    const pAck = await msgBy(peer, (m) => m.type === 'peer_ack');
    is(pAck.result === 'confirmed' && calls.length === 1, true);
    resetPeerFollowRuntime();
    const tLow = {
      type: 'peer_target',
      transportSeq: 7,
      beat: 50,
      section: false,
      isPlaying: false,
      tempo: 120,
      jumpPending: false,
      loopActive: false,
    };
    for (let i = 0; i < 3; i += 1) send(peer, tLow);
    await sleep(40);
    is(bs.manager.getState().currentSongTime, 0);
    send(dir, { type: 'play', commandId: 'sd-1', ttlMs: 500, transportSeq: 9 });
    await waitFor(() => calls.includes('startPlaying'));
    await sleep(30);
    is(peer.msgs.filter((m) => m.type === 'peer_upstream').length, 1);
  });
});

test('master mode relays browser play, runs direct locally, and strips upstream meta', async () => {
  const pc = await createPeerComputer();
  const listen = (r) => pc.server.listen(0, '127.0.0.1', () => r(pc.server.address().port));
  const port = await new Promise(listen);
  try {
    await withServer(null, async ({ calls, sync, reg }) => {
      const clr = () => (pc.messages.length = pc.actions.length = 0);
      const fp = fingerprintOf(pc.tls);
      startPeerLinks([{ host: '127.0.0.1', port, peerToken: PEER_TOKEN, fingerprint: fp }]);
      await waitFor(() => bs.peerStatus.connected === true, 8000);
      const [ctrl, dir] = await Promise.all([sync(bs.authToken, 'mb'), sync(bs.directToken, 'md')]);
      clr();
      send(ctrl, { type: 'play', commandId: 'mb-1' });
      const cmd = await waitFor(() => pc.messages.find((m) => m.type === 'peer_command'));
      await waitFor(() => calls.includes('startPlaying'));
      is(cmd.command.type === 'play' && cmd.command.commandId === peerCommandId('mb-1'), true);
      clr();
      const before = calls.length;
      send(dir, { type: 'play', commandId: 'md-1', ttlMs: 500, transportSeq: 3 });
      await waitFor(() => calls.length > before);
      await sleep(80);
      is(pc.messages.some((m) => m.type === 'peer_command') || pc.actions.length > 0, false);
      const upCmd = { type: 'play', commandId: 'up-1', ttlMs: 500, transportSeq: 9 };
      pc.wsServer.peerSockets()[0].send(JSON.stringify({ type: 'peer_upstream', command: upCmd }));
      const upReg = await waitFor(() => reg.find((r) => r.id === 'up-1'));
      eq(upReg.payload, { type: 'play', commandId: 'up-1' });
      is(upReg.sender, 'rc-peer-upstream');
    });
  } finally {
    pc.wsServer.stop();
    pc.server.closeAllConnections?.();
    await new Promise((r) => pc.server.close(r));
  }
});
