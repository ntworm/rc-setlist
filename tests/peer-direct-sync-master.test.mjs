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

test('PeerPendingTable.onExternalConfirm returns active/expired and prunes stale records', () => {
  let now = 1_000;
  const table = new PeerPendingTable({ now: () => now });
  table.enqueue(makePendingInput('a1', 'play', { deadlineAt: 2_000 }));
  table.enqueue(makePendingInput('e1', 'play', { deadlineAt: 1_100 }));
  table.enqueue(makePendingInput('e2', 'play', { deadlineAt: 1_200 }));

  const active = table.onExternalConfirm(peerCommandId('a1'));
  is(active?.kind, 'active');
  is(active?.entry.originalCommandId, 'a1');
  is(table.has(peerCommandId('a1')), false);
  is(table.onExternalConfirm(peerCommandId('a1')), null);

  now = 1_250;
  table.collectDueSends({
    synchronized: false,
    rttMs: 10,
    bufferedAmount: 0,
    masterIsStopped: false,
    masterIsPanicked: false,
  });

  const exp = table.onExternalConfirm(peerCommandId('e1'), 1_300);
  is(exp?.kind, 'expired');
  is(exp?.entry.originalCommandId, 'e1');
  is(table.onExternalConfirm(peerCommandId('e1'), 1_300), null);

  is(table.onExternalConfirm(peerCommandId('e2'), 1_250 + RECENTLY_EXPIRED_TTL_MS), null);
  is(table.onExternalConfirm('peer-unknown'), null);
});

test('parsePeerDirectSync validates strictly and dispatchPeerCommandFrame consumes unconditionally', async () => {
  const maxSeq = Number.MAX_SAFE_INTEGER - 1_000_000;
  eq(
    parsePeerDirectSync({
      type: 'peer_direct_sync',
      confirmedIds: [],
      lastExecutedTransportSeq: 0,
    }),
    {
      confirmedIds: [],
      lastExecutedTransportSeq: 0,
    },
  );
  eq(
    parsePeerDirectSync({
      type: 'peer_direct_sync',
      confirmedIds: ['peer-1'],
      lastExecutedTransportSeq: maxSeq,
    }),
    { confirmedIds: ['peer-1'], lastExecutedTransportSeq: maxSeq },
  );

  const sparse = new Array(2);
  sparse[1] = 'peer-1';
  const bad = [
    { type: 'other', confirmedIds: [], lastExecutedTransportSeq: 0 },
    { type: 'peer_direct_sync', confirmedIds: 'x', lastExecutedTransportSeq: 0 },
    { type: 'peer_direct_sync', confirmedIds: Array(513).fill('a'), lastExecutedTransportSeq: 0 },
    { type: 'peer_direct_sync', confirmedIds: sparse, lastExecutedTransportSeq: 0 },
    { type: 'peer_direct_sync', confirmedIds: [123], lastExecutedTransportSeq: 0 },
    { type: 'peer_direct_sync', confirmedIds: [''], lastExecutedTransportSeq: 0 },
    { type: 'peer_direct_sync', confirmedIds: ['a'.repeat(257)], lastExecutedTransportSeq: 0 },
    { type: 'peer_direct_sync', confirmedIds: [], lastExecutedTransportSeq: -1 },
    { type: 'peer_direct_sync', confirmedIds: [], lastExecutedTransportSeq: 1.5 },
    { type: 'peer_direct_sync', confirmedIds: [], lastExecutedTransportSeq: Number.NaN },
    { type: 'peer_direct_sync', confirmedIds: [], lastExecutedTransportSeq: maxSeq + 1 },
  ];
  for (const frame of bad) is(parsePeerDirectSync(frame), null);

  await withBridge(() => {
    const valid = { type: 'peer_direct_sync', confirmedIds: [], lastExecutedTransportSeq: 7 };
    const blocked = [
      makeTarget(new PeerPendingTable(), { synchronized: false }),
      makeTarget(new PeerPendingTable(), { stopped: true }),
      makeTarget(new PeerPendingTable(), { state: { fingerprintMismatch: true } }),
      makeTarget(new PeerPendingTable(), {
        state: { fingerprintMismatch: false, versionMismatch: true },
      }),
    ];
    for (const t of blocked) is(dispatchPeerCommandFrame(t, valid), true);
    is(dispatchPeerCommandFrame(makeTarget(new PeerPendingTable()), bad[1]), true);
    is(bridgeState.masterTransportSeq, 0);
  });
});

function setupExpiredPair() {
  let now = 1_000;
  const pending = new PeerPendingTable({ now: () => now });
  const target = makeTarget(pending);
  pending.enqueue(makePendingInput('orig-play', 'play', { deadlineAt: 1_100 }));
  pending.enqueue(makePendingInput('play-2', 'play', { deadlineAt: 1_100 }));
  now = 1_200;
  pending.collectDueSends({
    synchronized: false,
    rttMs: 10,
    bufferedAmount: 0,
    masterIsStopped: true,
    masterIsPanicked: false,
  });

  return { pending, target, setNow: (v) => (now = v) };
}

test('peer_direct_sync reconciles expired entries and protects newer stop_unacked', async () => {
  await withBridge(({ broadcasts }) => {
    const { target } = setupExpiredPair();
    // Security regression: expired play must NOT clear a newer stop_unacked alert.
    bridgeState.peerAlerts[target.key] = {
      commandId: 'orig-stop',
      commandType: 'stop',
      status: 'stop_unacked',
      at: 1_200,
    };
    const msg1 = {
      type: 'peer_direct_sync',
      confirmedIds: [peerCommandId('orig-play')],
      lastExecutedTransportSeq: 5,
    };
    is(dispatchPeerCommandFrame(target, msg1), true);
    is(bridgeState.peerAlerts[target.key]?.status, 'stop_unacked');
    is(bridgeState.peerAlerts[target.key]?.commandId, 'orig-stop');
    is(broadcasts.at(-1)?.commandId, 'orig-play');
    is(broadcasts.at(-1)?.status, 'confirmed');
    is(bridgeState.masterTransportSeq, 5);
    is(bridgeState.masterTargetSeq, 0);

    // Expired entry matching its own alert clears it.
    bridgeState.peerAlerts[target.key] = {
      commandId: 'play-2',
      commandType: 'play',
      status: 'expired',
      at: 1_200,
    };
    dispatchPeerCommandFrame(target, {
      type: 'peer_direct_sync',
      confirmedIds: [peerCommandId('play-2')],
      lastExecutedTransportSeq: 3,
    });
    is(bridgeState.peerAlerts[target.key], undefined);
    is(bridgeState.masterTransportSeq, 5);
  });
});

test('peer_direct_sync reconciles active entries and alert-only fallback', async () => {
  await withBridge(({ broadcasts, stateBroadcasts }) => {
    const { pending, target } = setupExpiredPair();
    // Active entry + alert-only fallback.
    pending.enqueue(makePendingInput('act-stop', 'stop', { transportSeq: 6 }));
    bridgeState.peerAlerts[target.key] = {
      commandId: 'act-stop',
      commandType: 'stop',
      status: 'stop_unacked',
      at: 1_300,
    };
    dispatchPeerCommandFrame(target, {
      type: 'peer_direct_sync',
      confirmedIds: [peerCommandId('act-stop')],
      lastExecutedTransportSeq: 6,
    });
    is(bridgeState.peerAlerts[target.key], undefined);
    is(pending.size(), 0);

    bridgeState.peerAlerts[target.key] = {
      commandId: 'alert-only',
      commandType: 'jump',
      status: 'expired',
      at: 1_400,
    };
    const beforeStates = stateBroadcasts.length;
    dispatchPeerCommandFrame(target, {
      type: 'peer_direct_sync',
      confirmedIds: [peerCommandId('alert-only'), 'peer-unknown'],
      lastExecutedTransportSeq: 6,
    });
    is(bridgeState.peerAlerts[target.key], undefined);
    is(stateBroadcasts.length > beforeStates, true);
    is(broadcasts.at(-1)?.commandId, 'alert-only');
    is(broadcasts.at(-1)?.commandType, 'jump');
  });
});

test('inbound sync emits live deltas, skips backpressure, handles seq-only reconnect, and unregisters', async () => {
  resetInboundPeerState();
  resetSlaveCommandState();
  try {
    const ws = makeSock();
    onInboundPeerSyncConfirm(ws);
    const syncFrames = (s) => s.sent.filter((m) => m.type === 'peer_direct_sync');
    eq(syncFrames(ws), []);

    const dWs = makeSock();
    await receiveDirectCommand(dWs, { type: 'play', commandId: 'live-1', transportSeq: 3 }, okExec);
    eq(syncFrames(ws), [
      {
        type: 'peer_direct_sync',
        confirmedIds: [peerCommandId('live-1')],
        lastExecutedTransportSeq: 3,
      },
    ]);

    ws.bufferedAmount = STALLED_SOCKET_BYTES;
    await receiveDirectCommand(
      dWs,
      { type: 'play', commandId: 'live-bp', transportSeq: 4 },
      okExec,
    );
    is(syncFrames(ws).length, 1);

    onInboundPeerClosed(ws);
    ws.bufferedAmount = 0;
    await receiveDirectCommand(
      dWs,
      { type: 'play', commandId: 'live-off', transportSeq: 5 },
      okExec,
    );
    is(syncFrames(ws).length, 1);

    resetSlaveCommandState();
    const pWs = makeSock();
    await receivePeerCommand(
      pWs,
      {
        type: 'peer_command',
        commandId: 'peer-only',
        ttlMs: 1_000,
        transportSeq: 4,
        command: { type: 'play' },
      },
      okExec,
    );
    const wsSeqOnly = makeSock();
    onInboundPeerSyncConfirm(wsSeqOnly);
    eq(syncFrames(wsSeqOnly), [
      { type: 'peer_direct_sync', confirmedIds: [], lastExecutedTransportSeq: 4 },
    ]);
  } finally {
    resetInboundPeerState();
    resetSlaveCommandState();
  }
});

test('reconnect full sync chunks 64 IDs newest-first and stops on backpressure or send error', async () => {
  resetInboundPeerState();
  resetSlaveCommandState();
  try {
    const dWs = makeSock();
    for (let i = 0; i < 130; i += 1) {
      await receiveDirectCommand(
        dWs,
        { type: 'stop', commandId: `bulk-${i}`, transportSeq: i + 1 },
        okExec,
      );
    }

    const ws1 = makeSock();
    onInboundPeerSyncConfirm(ws1);
    const chunks = ws1.sent.filter((m) => m.type === 'peer_direct_sync');
    eq(
      chunks.map((c) => c.confirmedIds.length),
      [64, 64, 2],
    );
    for (const c of chunks) {
      assert.ok(parsePeerDirectSync(c));
      is(c.lastExecutedTransportSeq, 130);
    }
    const flattened = chunks.flatMap((c) => c.confirmedIds);
    is(flattened[0], peerCommandId('bulk-129'));
    is(flattened.at(-1), peerCommandId('bulk-0'));

    const wsBp = makeSock();
    wsBp.send = (raw) => {
      const msg = JSON.parse(raw);
      wsBp.sent.push(msg);
      if (msg.type === 'peer_direct_sync') wsBp.bufferedAmount = STALLED_SOCKET_BYTES;
    };
    onInboundPeerSyncConfirm(wsBp);
    is(wsBp.sent.filter((m) => m.type === 'peer_direct_sync').length, 1);

    const wsErr = makeSock();
    let syncAttempts = 0;
    wsErr.send = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'peer_direct_sync') {
        syncAttempts += 1;
        if (syncAttempts === 2) throw new Error('socket write failed');
      }
      wsErr.sent.push(msg);
    };
    onInboundPeerSyncConfirm(wsErr);
    is(syncAttempts, 2);
    is(wsErr.sent.filter((m) => m.type === 'peer_direct_sync').length, 1);
  } finally {
    resetInboundPeerState();
    resetSlaveCommandState();
  }
});
