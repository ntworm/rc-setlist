// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist

import assert from 'node:assert/strict';
import { SetlistManager } from '../../src/core/setlist-manager.ts';
import { bridgeState, resetMasterTransportSeq } from '../../src/runtime/bridge-state.ts';
import { peerCommandId } from '../../src/runtime/peer-message.ts';
import { SlaveCommandTracker } from '../../src/runtime/peer-slave-commands.ts';
export const [eq, is] = [assert.deepEqual, assert.equal];
export const okExec = () => ({ result: 'confirmed' });
export const failExec = () => ({ result: 'failed', reason: 'down' });

export function makeSock(bufferedAmount = 0) {
  const sent = [];
  return {
    readyState: 1,
    isPeer: true,
    bufferedAmount,
    sent,
    send(raw) {
      sent.push(JSON.parse(raw));
    },
    close() {},
    terminate() {},
  };
}

export function defer() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export function makeTracker() {
  let now = 1_000;
  const tracker = new SlaveCommandTracker({
    now: () => now,
    getTransportSnapshot: () => ({ isPlaying: false, beat: 0 }),
    noteCommand: () => {},
    adoptEcho: (m) => m,
  });
  const peer = (ws, id, cmd, seq = 1, fn = okExec) =>
    tracker.receiveCommand(
      ws,
      {
        type: 'peer_command',
        commandId: peerCommandId(id),
        ttlMs: 1_000,
        transportSeq: seq,
        command: cmd,
      },
      fn,
    );
  const direct = (ws, msg, fn = okExec) => tracker.receiveDirectCommand(ws, msg, fn);
  return { tracker, peer, direct, adv: (ms) => (now += ms) };
}

export function makePendingInput(origId, type, overrides = {}) {
  return {
    commandId: peerCommandId(origId),
    originalCommandId: origId,
    commandType: type,
    wireCommand: { type, commandId: peerCommandId(origId) },
    transportSeq: 1,
    safetyStop: type === 'stop',
    deadlineAt: type === 'stop' ? null : 1_100,
    createdAt: 1_000,
    ...overrides,
  };
}

export function makeTarget(pending, overrides = {}) {
  return {
    key: '127.0.0.1:4444',
    config: { host: '127.0.0.1', port: 4444 },
    socket: makeSock(),
    synchronized: true,
    stopped: false,
    state: { fingerprintMismatch: false, versionMismatch: false },
    pending,
    pendingTimer: null,
    rttMs: () => 10,
    ...overrides,
  };
}

export async function withBridge(fn) {
  const saved = {
    manager: bridgeState.manager,
    oscClient: bridgeState.oscClient,
    wsServer: bridgeState.wsServer,
    peerAlerts: bridgeState.peerAlerts,
    seq: bridgeState.masterTransportSeq,
    targetSeq: bridgeState.masterTargetSeq,
  };
  const broadcasts = [];
  const stateBroadcasts = [];
  bridgeState.manager = new SetlistManager();
  bridgeState.oscClient = { isConnected: true };
  bridgeState.wsServer = {
    broadcast: (m) => broadcasts.push(m),
    broadcastState: (s) => stateBroadcasts.push(s),
  };
  bridgeState.peerAlerts = {};
  resetMasterTransportSeq();
  try {
    await fn({ broadcasts, stateBroadcasts });
  } finally {
    bridgeState.manager = saved.manager;
    bridgeState.oscClient = saved.oscClient;
    bridgeState.wsServer = saved.wsServer;
    bridgeState.peerAlerts = saved.peerAlerts;
    bridgeState.masterTransportSeq = saved.seq;
    bridgeState.masterTargetSeq = saved.targetSeq;
  }
}
