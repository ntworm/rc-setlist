import assert from 'node:assert/strict';
import test from 'node:test';
import { SetlistManager } from '../src/core/setlist-manager.ts';
import { bridgeState as bs } from '../src/runtime/bridge-state.ts';
import { handlePeerTarget, resetPeerFollowRuntime } from '../src/runtime/peer-follow-runtime.ts';
import { peerCommandId as pid } from '../src/runtime/peer-message.ts';
import * as psc from '../src/runtime/peer-slave-commands.ts';

const [eq, is] = [assert.deepEqual, assert.equal];
const [ok, fail] = [() => ({ result: 'confirmed' }), () => ({ result: 'failed', reason: 'down' })];
const ackOf = (commandId, result, reason, transportSeq) => ({
  type: 'direct_ack',
  commandId,
  peerCommandId: pid(commandId),
  result,
  reason,
  isPlaying: true,
  beat: 12,
  transportSeq,
});
const sock = (sent = []) => ({ readyState: 1, sent, send: (r) => sent.push(JSON.parse(r)) });
const defer = () => {
  let resolve;
  return { promise: new Promise((r) => (resolve = r)), resolve };
};
const mk = () => {
  let now = 1_000;
  const [noted, adopted] = [[], []];
  const t = new psc.SlaveCommandTracker({
    now: () => now,
    getTransportSnapshot: () => ({ isPlaying: true, beat: 12 }),
    noteCommand: (x) => noted.push(x),
    adoptEcho: (m) => (adopted.push(m.commandId), { ...m, adopted: true }),
  });
  const d = (w, m, fn = ok) => t.receiveDirectCommand(w, m, fn);
  const p = (w, id, cmd, seq = 1, fn = ok) => {
    const e = { type: 'peer_command', commandId: pid(id), ttlMs: 1_000, transportSeq: seq };
    return t.receiveCommand(w, { ...e, command: cmd }, fn);
  };
  return { t, d, p, noted, adopted, adv: (ms) => (now += ms) };
};

test('dual-path dedupe runs once in both orders and fans out peer_ack + direct_ack', async () => {
  const { d, p, noted } = mk();
  const [pWs, dWs, dWs2, seen, g1, g2] = [sock(), sock(), sock(), [], defer(), defer()];
  const run1 = p(pWs, 'c1', { type: 'play' }, 2, (m) => (seen.push(m), g1.promise));
  const dPlay = { type: 'play', commandId: 'c1', transportSeq: 2 };
  is((await d(dWs, dPlay)) === null && (await d(dWs2, dPlay)) === null, true);
  g1.resolve(ok());
  await run1;
  const [a] = dWs.sent;
  is(seen.length === 1 && pWs.sent[0].type === 'peer_ack' && dWs2.sent.length === 1, true);
  is(a.type === 'direct_ack' && a.commandId === 'c1' && a.peerCommandId === pid('c1'), true);
  is(a.result === 'confirmed' && a.isPlaying && a.beat === 12 && a.transportSeq === 2, true);
  const dJ = { type: 'jump_time', time: 16, commandId: 'peer-raw', ttlMs: 500, transportSeq: 3 };
  const run2 = d(dWs, dJ, (m) => (seen.push(m), g2.promise));
  is(await p(pWs, 'peer-raw', { type: 'jump_time', time: 16 }, 3), null);
  g2.resolve(ok());
  const dAck = await run2;
  eq(seen[1], { type: 'jump_time', time: 16, commandId: pid('peer-raw') });
  is(dAck.peerCommandId === pid('peer-raw') && pWs.sent[1].commandId === pid('peer-raw'), true);
  is((await d(dWs, dPlay, fail)).result, 'confirmed');
  is((await p(pWs, 'peer-raw', { type: 'jump_time', time: 16 }, 3, fail)).result, 'confirmed');
  is((await d(dWs, { type: 'jump_time', time: 32, commandId: 'no-meta' })).result, 'confirmed');
  eq(noted, ['play', 'jump_time', 'jump_time']);
});

test('unified transportSeq: safety stop supersedes play and rolls back on failure', async () => {
  const { t, d, p, adopted } = mk();
  const [dWs, pWs, syncs] = [sock(), sock(), []];
  t.setDirectSyncListener((id) => syncs.push(id));
  await p(pWs, 'p5', { type: 'play' }, 5);
  is(adopted.length, 1);
  const hitP5 = await d(dWs, { type: 'play', commandId: 'p5', transportSeq: 5 }, fail);
  eq(dWs.sent.at(-1), ackOf('p5', 'confirmed', '', 5));
  is(
    hitP5.result === 'confirmed' && t.getConfirmedDirectSummary().confirmedIds.includes(pid('p5')),
    true,
  );
  eq(syncs, [pid('p5')]);
  const s5 = { type: 'stop', commandId: 's5', transportSeq: 5 };
  const [rf, ro] = [await d(dWs, s5, fail), await d(dWs, s5)];
  is(rf.result === 'failed' && rf.transportSeq === 5 && ro.transportSeq === 6, true);
  eq(syncs, [pid('p5'), pid('s5')]);
  await d(dWs, { type: 'play', commandId: 'p6', transportSeq: 6, ttlMs: 500 });
  eq(dWs.sent.at(-1), ackOf('p6', 'superseded', 'superseded', 6));
  is(
    (await d(dWs, { type: 'jump_time', time: 4, commandId: 'j6', transportSeq: 6 })).result,
    'superseded',
  );
  is((await p(pWs, 'ci6', { type: 'trigger_count_in' }, 6)).result, 'superseded');
  is(adopted.length, 1);
  is((await d(dWs, { type: 'stop', commandId: 's4', transportSeq: 4 })).result, 'superseded');
  await d(dWs, { type: 'play', commandId: 'p9', transportSeq: 9, ttlMs: 0 });
  eq(dWs.sent.at(-1), ackOf('p9', 'expired', 'expired', 6));
  const pan8 = { type: 'set_panic', active: true, commandId: 'pan8', transportSeq: 8 };
  is(
    (await d(dWs, pan8, fail)).transportSeq === 6 && (await d(dWs, pan8)).transportSeq === 8,
    true,
  );
  is((await p(pWs, 'p9ok', { type: 'play' }, 9)).result, 'confirmed');
  is((await d(dWs, { type: 'stop', commandId: 's-null' })).transportSeq, 10);
});

test('onHandshakeSession preserves pre-handshake state and confirmedDirectIds cap/TTL', async () => {
  const { t, d, adv } = mk();
  const ws = sock();
  t.setDirectSyncListener(() => {
    throw new Error('boom');
  });
  is((await d(ws, { type: 'play', commandId: 'pre1', transportSeq: 7 })).result, 'confirmed');
  t.onHandshakeSession('sess-a');
  is(t.getLastExecutedTransportSeq(), 7);
  eq(t.getConfirmedDirectSummary().confirmedIds, [pid('pre1')]);
  t.onHandshakeSession('sess-b');
  is(t.getLastExecutedTransportSeq() + t.getConfirmedDirectSummary().confirmedIds.length, 0);
  t.setDirectSyncListener(null);
  const cap = psc.SLAVE_COMMAND_CACHE_CAPACITY;
  for (let i = 0; i < cap + 2; i += 1) await d(ws, { type: 'stop', commandId: `cap-${i}` });
  const ids = t.getConfirmedDirectSummary().confirmedIds;
  is(ids.length === cap && !ids.includes(pid('cap-0')), true);
  adv(psc.SLAVE_COMMAND_CACHE_TTL_MS);
  eq(t.getConfirmedDirectSummary().confirmedIds, []);
  psc.resetSlaveCommandState();
  const seen = [];
  psc.setDirectSyncListener((id) => seen.push(id));
  await psc.receiveDirectCommand(ws, { type: 'stop', commandId: 'def-d', transportSeq: 3 }, ok);
  psc.onPeerHandshakeSession('def-sess');
  eq(psc.getConfirmedDirectSummary(), {
    confirmedIds: [pid('def-d')],
    lastExecutedTransportSeq: 3,
  });
  is(psc.getLastExecutedTransportSeq() === 3 && seen[0] === pid('def-d'), true);
  psc.setDirectSyncListener(null);
  psc.resetSlaveCommandState();
});

test('handlePeerTarget filters targets below minTransportSeq', () => {
  const [prevMgr, prevOsc] = [bs.manager, bs.oscClient];
  const mgr = new SetlistManager();
  mgr.updateCues([
    { name: 'A', time: 0 },
    { name: 'B', time: 50 },
  ]);
  bs.manager = mgr;
  bs.oscClient = { isConnected: true, setCurrentSongTime: () => {}, jumpToCuePoint: () => {} };
  try {
    resetPeerFollowRuntime();
    const b = { beat: 50, section: false, isPlaying: false, tempo: 120, jumpPending: false };
    const run = (s) =>
      [0, 1, 2].map(() => handlePeerTarget({ transportSeq: s, ...b, loopActive: false }, 5).kind);
    eq(run(4), ['none', 'none', 'none']);
    eq(run(5), ['none', 'none', 'seek_stopped']);
  } finally {
    resetPeerFollowRuntime();
    bs.manager = prevMgr;
    bs.oscClient = prevOsc;
  }
});
