// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist

import assert from 'node:assert/strict';
import test from 'node:test';
import { SetlistManager } from '../src/core/setlist-manager.ts';
import { bridgeState, resetMasterTransportSeq } from '../src/runtime/bridge-state.ts';
import { applyPeerDirectSync, parsePeerDirectSync } from '../src/runtime/peer-direct-targets.ts';
import { startPeerTarget } from '../src/runtime/peer-follow-runtime.ts';
import {
  onInboundPeerClosed,
  onInboundPeerSyncConfirm,
  resetInboundPeerState,
} from '../src/runtime/peer-inbound.ts';
import {
  dispatchPeerCommandFrame,
  relayCommandToPeers,
} from '../src/runtime/peer-link-commands.ts';
import { STALLED_SOCKET_BYTES, peerCommandId } from '../src/runtime/peer-message.ts';
import { PeerPendingTable, RECENTLY_EXPIRED_TTL_MS } from '../src/runtime/peer-pending.ts';
import { absorbCachedSeq, evictLruCache } from '../src/runtime/peer-protocol.ts';
import {
  SLAVE_COMMAND_CACHE_TTL_MS,
  SlaveCommandTracker,
  receiveDirectCommand,
  receivePeerCommand,
  resetSlaveCommandState,
} from '../src/runtime/peer-slave-commands.ts';
import {
  defer,
  eq,
  failExec,
  is,
  makePendingInput,
  makeSock,
  makeTarget,
  makeTracker,
  okExec,
  withBridge,
} from './helpers/peer-direct-sync-fixtures.mjs';

test('evictLruCache prunes expired entries, prefers oldest settled, and falls back to oldest', () => {
  const settledAt = (e) => e.settledAt;
  const cache = new Map([
    ['a', { settledAt: 100 }],
    ['b', { settledAt: 500 }],
  ]);
  evictLruCache(cache, 'a', settledAt, 2, 200, 1_000);
  eq([...cache.keys()], ['a', 'b']);

  evictLruCache(cache, 'c', settledAt, 2, 200, 1_000);
  eq([...cache.keys()], []);

  const mixed = new Map([
    ['inflight-1', { settledAt: null }],
    ['settled-1', { settledAt: 900 }],
    ['settled-2', { settledAt: 950 }],
  ]);
  evictLruCache(mixed, 'new', settledAt, 3, 500, 1_000);
  eq([...mixed.keys()], ['inflight-1', 'settled-2']);

  const allInFlight = new Map([
    ['f1', { settledAt: null }],
    ['f2', { settledAt: null }],
  ]);
  evictLruCache(allInFlight, 'f3', settledAt, 2, 500, 1_000);
  eq([...allInFlight.keys()], ['f2']);
});

test('absorbCachedSeq handles in_flight, intermediate seq, settled, epoch, and lower seq', () => {
  const sc1 = { prevSeq: 5, appliedSeq: 6 };
  is(absorbCachedSeq({ status: 'in_flight', epoch: 1, seqChange: sc1 }, 9, 1, 6), 9);
  eq(sc1, { prevSeq: 5, appliedSeq: 9 });

  const sc2 = { prevSeq: 5, appliedSeq: 6 };
  is(absorbCachedSeq({ status: 'in_flight', epoch: 1, seqChange: sc2 }, 9, 1, 7), 9);
  eq(sc2, { prevSeq: 7, appliedSeq: 9 });

  is(absorbCachedSeq({ status: 'in_flight', epoch: 1, seqChange: null }, 8, 1, 3), 8);
  is(absorbCachedSeq({ status: 'settled', epoch: 1, ack: { result: 'confirmed' } }, 10, 1, 8), 10);
  is(absorbCachedSeq({ status: 'settled', epoch: 1, ack: { result: 'failed' } }, 12, 1, 8), 8);
  is(absorbCachedSeq({ status: 'settled', epoch: 1, ack: { result: 'expired' } }, 12, 1, 8), 8);
  is(absorbCachedSeq({ status: 'settled', epoch: 1, ack: { result: 'superseded' } }, 12, 1, 8), 8);

  const sc3 = { prevSeq: 1, appliedSeq: 2 };
  is(absorbCachedSeq({ status: 'in_flight', epoch: 0, seqChange: sc3 }, 9, 1, 2), 2);
  is(absorbCachedSeq({ status: 'in_flight', epoch: 1, seqChange: sc3 }, null, 1, 2), 2);
  is(absorbCachedSeq({ status: 'in_flight', epoch: 1, seqChange: sc3 }, 2, 1, 2), 2);
  eq(sc3, { prevSeq: 1, appliedSeq: 2 });
});

test('SlaveCommandTracker absorbs higher seq on hits within sessionEpoch and resets listener', async () => {
  const { tracker, peer, direct, adv } = makeTracker();
  const [dWs, pWs, g1, g2] = [makeSock(), makeSock(), defer(), defer()];
  tracker.onHandshakeSession('sess-1');

  const r1 = direct(dWs, { type: 'play', commandId: 'c1', transportSeq: 2 }, () => g1.promise);
  is(await peer(pWs, 'c1', { type: 'play' }, 5), null);
  is(tracker.getLastExecutedTransportSeq(), 5);
  g1.resolve(okExec());
  is((await r1).transportSeq, 5);

  const hit1 = await direct(dWs, { type: 'play', commandId: 'c1', transportSeq: 8 }, failExec);
  is(hit1.transportSeq, 8);
  is(tracker.getLastExecutedTransportSeq(), 8);

  await direct(dWs, { type: 'play', commandId: 'f1', transportSeq: 9 }, failExec);
  await peer(pWs, 'f1', { type: 'play' }, 12);
  is(tracker.getLastExecutedTransportSeq(), 9);

  adv(SLAVE_COMMAND_CACHE_TTL_MS);
  let runs = 0;
  await peer(pWs, 'c1', { type: 'play' }, 10, () => ((runs += 1), okExec()));
  is(runs, 1);

  const r2 = direct(dWs, { type: 'play', commandId: 'cross', transportSeq: 11 }, () => g2.promise);
  tracker.onHandshakeSession('sess-2');
  is(tracker.getLastExecutedTransportSeq(), 0);
  is(await peer(pWs, 'cross', { type: 'play' }, 15), null);
  is(tracker.getLastExecutedTransportSeq(), 0);
  g2.resolve(okExec());
  await r2;
  await peer(pWs, 'cross', { type: 'play' }, 20);
  is(tracker.getLastExecutedTransportSeq(), 0);

  const seen = [];
  tracker.setDirectSyncListener((id) => seen.push(id));
  tracker.reset();
  await direct(dWs, { type: 'play', commandId: 'after-reset', transportSeq: 1 });
  eq(seen, []);
});

test('failed safety stop rolls back after absorbing higher seq with or without intermediate cmd', async () => {
  const { tracker, peer, direct } = makeTracker();
  const [dWs, pWs] = [makeSock(), makeSock()];
  await peer(pWs, 'p5', { type: 'play' }, 5);

  const g1 = defer();
  const stop1 = direct(dWs, { type: 'stop', commandId: 's1' }, () => g1.promise);
  is(tracker.getLastExecutedTransportSeq(), 6);
  is(await peer(pWs, 's1', { type: 'stop' }, 9), null);
  is(tracker.getLastExecutedTransportSeq(), 9);
  g1.resolve(failExec());
  is((await stop1).result, 'failed');
  is(tracker.getLastExecutedTransportSeq(), 5);

  const g2 = defer();
  const stop2 = direct(dWs, { type: 'stop', commandId: 's2' }, () => g2.promise);
  await peer(pWs, 'p7', { type: 'play' }, 7);
  is(tracker.getLastExecutedTransportSeq(), 7);
  is(await peer(pWs, 's2', { type: 'stop' }, 10), null);
  is(tracker.getLastExecutedTransportSeq(), 10);
  g2.resolve(failExec());
  is((await stop2).result, 'failed');
  is(tracker.getLastExecutedTransportSeq(), 7);
});

test('masterTargetSeq decouples periodic peer_target from masterTransportSeq and resets together', async () => {
  await withBridge(() => {
    const target = makeTarget(new PeerPendingTable());
    applyPeerDirectSync(
      target,
      { confirmedIds: [], lastExecutedTransportSeq: 10 },
      () => {},
      () => {},
    );
    is(bridgeState.masterTransportSeq, 10);
    is(bridgeState.masterTargetSeq, 0);

    const ws1 = makeSock();
    const t1 = startPeerTarget(() => ws1);
    clearInterval(t1);
    is(ws1.sent[0].type, 'peer_target');
    is(ws1.sent[0].transportSeq, 0);

    const playCmd = {
      commandId: 'm-play-1',
      type: 'play',
      payload: { type: 'play' },
      sourceClientId: 'ui',
      createdAt: Date.now(),
      status: 'created',
      retryCount: 0,
      maxRetries: 0,
      timeoutMs: 2_000,
    };
    is(relayCommandToPeers([target], playCmd), true);
    is(bridgeState.masterTransportSeq, 11);
    is(bridgeState.masterTargetSeq, 11);

    const ws2 = makeSock();
    const t2 = startPeerTarget(() => ws2);
    clearInterval(t2);
    is(ws2.sent[0].transportSeq, 11);

    resetMasterTransportSeq();
    is(bridgeState.masterTransportSeq, 0);
    is(bridgeState.masterTargetSeq, 0);
  });
});
