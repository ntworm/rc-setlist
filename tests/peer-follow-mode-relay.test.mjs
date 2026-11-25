// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Unit tests for slave follow modes: relay filtering, independent acks,
// slave lock, and panel helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPeerFollowMode, writeSlaveRole, clearSlaveRole } from '../src/preferences.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';
import { bridgeState, isSlaveLocked } from '../src/runtime/bridge-state.ts';
import {
  clearPendingForIndependent,
  isIndependentTarget,
  shouldRejectSlaveLocked,
} from '../src/runtime/peer-follow-mode.ts';
import {
  onInboundPeerClosed,
  onInboundPeerSyncConfirm,
  resetInboundPeerState,
  setInboundHasOutboundPeers,
  syncInboundSlaveRole,
} from '../src/runtime/peer-inbound.ts';
import {
  createPeerPendingTable,
  dispatchPeerCommandFrame,
  relayCommandToPeers,
} from '../src/runtime/peer-link-commands.ts';
import {
  applyPanelFollowModeAction,
  peerFollowModeTagText,
} from '../src/ui/peer-follow-mode-panel.ts';
import { peerPanelModel } from '../src/ui/peer-panel.ts';
import { peerRowDisplay } from '../src/ui/peer-panel-health.ts';
import { withTempStorage } from './helpers/peer-follow-mode-fixtures.mjs';

function makeTarget(key, followMode, useGetter = false) {
  const target = {
    key,
    config: { host: '127.0.0.1', port: 4444 },
    socket: null,
    synchronized: false,
    stopped: false,
    state: {
      fingerprintMismatch: false,
      versionMismatch: false,
      ...(useGetter ? {} : { followMode }),
    },
    pending: createPeerPendingTable(),
    pendingTimer: null,
    rttMs: () => 10,
  };
  if (useGetter) target.remoteFollowMode = () => followMode;
  return target;
}

function makeShowCommand(type, commandId, payload = { type }) {
  return {
    commandId,
    type,
    payload,
    sourceClientId: 'test',
    createdAt: Date.now(),
    status: 'created',
    retryCount: 0,
    maxRetries: 0,
    timeoutMs: 1000,
  };
}

/**
 * Queues a pending relay of `type` on `target` (a safety stop for `stop`) and
 * seeds the matching master alert with `status`.
 */
function seedPendingWithAlert(target, type, seq, status) {
  const safetyStop = type === 'stop';
  target.pending.enqueue({
    commandId: `peer-${type}-${seq}`,
    originalCommandId: `orig-${type}-${seq}`,
    commandType: type,
    wireCommand: { type },
    transportSeq: seq,
    safetyStop,
    deadlineAt: safetyStop ? null : performance.now() + 1000,
  });
  bridgeState.peerAlerts[target.key] = {
    commandId: `orig-${type}-${seq}`,
    commandType: type,
    status,
    at: Date.now(),
  };
}

/** Asserts which browser commands the slave lock refuses and which it lets through. */
function assertSlaveLockMatrix() {
  for (const cmd of [
    'play',
    'jump',
    'trigger_count_in',
    'metronome',
    'set_quantization',
    'set_pre_roll',
  ]) {
    assert.equal(shouldRejectSlaveLocked('browser', cmd), true, cmd);
    assert.equal(shouldRejectSlaveLocked('peer', cmd), false, `peer:${cmd}`);
    assert.equal(shouldRejectSlaveLocked('direct', cmd), false, `direct:${cmd}`);
  }
  for (const allowed of ['stop', 'set_panic', 'refresh', 'reorder', 'save_lyrics']) {
    assert.equal(shouldRejectSlaveLocked('browser', allowed), false, allowed);
  }
}

test('relayCommandToPeers skips independent targets and includes older peers without followMode', () => {
  const indep = makeTarget('10.0.0.1:4444', 'independent', true);
  const older = makeTarget('10.0.0.2:4444', null, true);
  const transport = makeTarget('10.0.0.3:4444', 'transport', false);
  assert.equal(isIndependentTarget(indep), true);
  assert.equal(isIndependentTarget(older), false);
  assert.equal(isIndependentTarget(transport), false);

  const onlyIndep = relayCommandToPeers([indep], makeShowCommand('play', 'cmd-indep-only'));
  assert.equal(onlyIndep, false);
  assert.equal(indep.pending.size(), 0);

  const mixed = relayCommandToPeers(
    [indep, older, transport],
    makeShowCommand('stop', 'cmd-mixed-stop'),
  );
  assert.equal(mixed, true);
  assert.equal(indep.pending.size(), 0);
  assert.equal(older.pending.size(), 1);
  assert.equal(transport.pending.size(), 1);
});

test('independent peer_ack settles safety stops without retry, clears alerts, and does not broadcast failed', () => {
  const prevAlerts = bridgeState.peerAlerts;
  const prevWs = bridgeState.wsServer;
  const sent = [];
  bridgeState.wsServer = {
    broadcast: (msg) => sent.push(msg),
    broadcastState: () => {},
  };
  bridgeState.peerAlerts = {};
  try {
    const target = makeTarget('10.0.0.9:4444', 'follow');
    seedPendingWithAlert(target, 'stop', 1, 'stop_unacked');

    const handled = dispatchPeerCommandFrame(target, {
      type: 'peer_ack',
      commandId: 'peer-stop-1',
      result: 'failed',
      reason: 'independent',
      isPlaying: true,
      beat: 12,
    });
    assert.equal(handled, true);
    assert.equal(target.pending.size(), 0);
    assert.equal(bridgeState.peerAlerts[target.key], undefined);
    assert.equal(
      sent.some((m) => m.type === 'peer_command_status' && m.status === 'failed'),
      false,
    );

    seedPendingWithAlert(target, 'play', 2, 'expired');
    clearPendingForIndependent(target);
    assert.equal(target.pending.size(), 0);
    assert.equal(bridgeState.peerAlerts[target.key], undefined);
  } finally {
    bridgeState.peerAlerts = prevAlerts;
    bridgeState.wsServer = prevWs;
  }
});

test('inboundSlaveSynced helper updates isSlaveLocked and broadcasts across role and link changes', () => {
  withTempStorage(() => {
    const prevManager = bridgeState.manager;
    const prevWs = bridgeState.wsServer;
    const prevMode = bridgeState.peerFollowMode;
    const broadcasts = [];
    bridgeState.manager = new SetlistManager();
    bridgeState.wsServer = {
      broadcast: () => {},
      broadcastState: (state) => broadcasts.push(state),
    };
    bridgeState.peerFollowMode = 'follow';
    try {
      resetInboundPeerState();
      writeSlaveRole({ masterAddress: '10.0.0.1:4444', pairedAt: '2026-11-25T00:00:00.000Z' });
      syncInboundSlaveRole();
      assert.equal(isSlaveLocked(), false);

      const fakeWs = { isPeer: true, readyState: 1, send: () => {}, close: () => {} };
      onInboundPeerSyncConfirm(fakeWs);
      assert.equal(bridgeState.inboundSlaveSynced, true);
      assert.equal(isSlaveLocked(), true);
      assert.equal(broadcasts.at(-1)?.slaveLock, true);

      assertSlaveLockMatrix();

      const beforeOutbound = broadcasts.length;
      setInboundHasOutboundPeers(true);
      assert.equal(bridgeState.inboundSlaveSynced, false);
      assert.equal(isSlaveLocked(), false);
      assert.ok(broadcasts.length > beforeOutbound);
      assert.equal(broadcasts.at(-1)?.slaveLock, false);

      setInboundHasOutboundPeers(false);
      assert.equal(bridgeState.inboundSlaveSynced, true);
      onInboundPeerClosed(fakeWs);
      assert.equal(bridgeState.inboundSlaveSynced, false);
      assert.equal(broadcasts.at(-1)?.slaveLock, false);

      clearSlaveRole();
      syncInboundSlaveRole();
    } finally {
      resetInboundPeerState();
      bridgeState.manager = prevManager;
      bridgeState.wsServer = prevWs;
      bridgeState.peerFollowMode = prevMode;
    }
  });
});

test('panel follow-mode actions and row badges expose localized Independent tag without changing tier', () => {
  withTempStorage(() => {
    const prevManager = bridgeState.manager;
    const prevWs = bridgeState.wsServer;
    const prevStatuses = bridgeState.peerStatuses;
    const prevMode = bridgeState.peerFollowMode;
    const prevSynced = bridgeState.inboundSlaveSynced;
    const broadcasts = [];
    bridgeState.manager = new SetlistManager();
    bridgeState.wsServer = {
      broadcast: () => {},
      broadcastState: (state) => broadcasts.push(state),
      peerConnectionCount: () => 1,
    };
    bridgeState.inboundSlaveSynced = true;
    try {
      writeSlaveRole({ masterAddress: '10.0.0.1:4444', pairedAt: '2026-11-25T00:00:00.000Z' });
      assert.equal(applyPanelFollowModeAction('set-follow-mode:invalid'), false);
      assert.equal(applyPanelFollowModeAction('set-follow-mode:independent'), true);
      assert.equal(bridgeState.peerFollowMode, 'independent');
      assert.equal(getPeerFollowMode(), 'independent');
      assert.equal(broadcasts.at(-1)?.slaveLock, false);

      const slaveModel = peerPanelModel({ locale: 'en' });
      assert.equal(slaveModel.role, 'slave');
      assert.equal(slaveModel.followMode, 'independent');

      assert.equal(peerFollowModeTagText('independent', 'en'), 'Independent');
      assert.equal(peerFollowModeTagText('independent', 'pt-BR'), 'Independente');
      assert.equal(peerFollowModeTagText('follow', 'en'), '');
      assert.equal(peerFollowModeTagText(null, 'pt-BR'), '');

      const row = {
        host: '10.0.0.2',
        port: 4444,
        connected: true,
        markersMatch: true,
        fingerprintMismatch: false,
        health: 'ok',
        reason: 'ok',
        followMode: 'independent',
      };
      const dispEn = peerRowDisplay(row, 'en', 1000);
      const dispPt = peerRowDisplay(row, 'pt-BR', 1000);
      assert.equal(dispEn.state, 'ok');
      assert.equal(dispEn.followMode, 'independent');
      assert.equal(dispEn.followModeTagText, 'Independent');
      assert.equal(dispPt.followModeTagText, 'Independente');
    } finally {
      bridgeState.manager = prevManager;
      bridgeState.wsServer = prevWs;
      bridgeState.peerStatuses = prevStatuses;
      bridgeState.peerFollowMode = prevMode;
      bridgeState.inboundSlaveSynced = prevSynced;
    }
  });
});
