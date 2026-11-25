// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Unit tests for slave follow modes: preference migration, follower behavior,
// and heartbeat decoding.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getPeerFollowMode, setPeerFollowMode } from '../src/preferences.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { PeerFollower, STABLE_CLOCKS } from '../src/runtime/peer-follow.ts';
import { PeerHealthTracker } from '../src/runtime/peer-health.ts';
import {
  buildLocalHealthView,
  evaluatePeerLinkHealth,
  localHealthViewKey,
} from '../src/runtime/peer-heartbeat.ts';
import { peerStatusRows } from '../src/runtime/peer-status-list.ts';
import {
  decodePeerHb,
  decodePeerHbAck,
  decodePeerHealthView,
} from '../src/server/peer-client-message.ts';
import { withTempStorage } from './helpers/peer-follow-mode-fixtures.mjs';

function makeFollowerHarness() {
  let clock = 0;
  const calls = [];
  const follower = new PeerFollower(
    {
      moveTo: (beat) => calls.push(['moveTo', beat]),
      seekStopped: (beat, section) => calls.push(['seekStopped', beat, section]),
      startAt: (beat) => calls.push(['startAt', beat]),
      stop: () => calls.push(['stop']),
      report: (message) => calls.push(['report', message]),
      onOutOfStepChange: (out) => calls.push(['outOfStep', out]),
    },
    () => clock,
  );
  return {
    follower,
    calls,
    advance: (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
}

function sampleRemote(overrides = {}) {
  return {
    transportSeq: 1,
    beat: 64,
    section: false,
    isPlaying: true,
    tempo: 120,
    jumpPending: false,
    loopActive: false,
    ...overrides,
  };
}

function sampleLocal(overrides = {}) {
  return {
    isPlaying: true,
    songTime: 64,
    tempo: 120,
    jumpPending: false,
    loopActive: false,
    beatsPerBar: 4,
    transportLocked: false,
    followMode: 'follow',
    ...overrides,
  };
}

test('getPeerFollowMode migrates legacy peer-auto-correct and handles invalid values', () => {
  withTempStorage((dir) => {
    assert.equal(getPeerFollowMode(), 'follow');
    fs.writeFileSync(path.join(dir, 'peer-auto-correct'), 'FALSE\n', 'utf8');
    assert.equal(getPeerFollowMode(), 'transport');
    fs.writeFileSync(path.join(dir, 'peer-auto-correct'), 'true', 'utf8');
    assert.equal(getPeerFollowMode(), 'follow');
    fs.writeFileSync(path.join(dir, 'peer-auto-correct'), 'false', 'utf8');
    assert.equal(setPeerFollowMode('independent'), true);
    assert.equal(getPeerFollowMode(), 'independent');
    assert.equal(fs.readFileSync(path.join(dir, 'peer-follow-mode'), 'utf8').trim(), 'independent');
    assert.equal(setPeerFollowMode('bogus'), false);
    assert.equal(getPeerFollowMode(), 'independent');
    fs.writeFileSync(path.join(dir, 'peer-follow-mode'), 'corrupt', 'utf8');
    assert.equal(getPeerFollowMode(), 'follow');
  });
});

test('PeerFollower in independent mode clears active outOfStep, streak, and samples', () => {
  const h = makeFollowerHarness();
  for (let i = 0; i < 8; i += 1) {
    h.advance(500);
    const base = 64 + h.now() / 500;
    h.follower.onTarget(
      sampleRemote({ beat: base + 1.5 }),
      sampleLocal({ songTime: base, followMode: 'follow' }),
    );
  }
  assert.equal(h.follower.isOutOfStep(), true);

  h.advance(500);
  const res = h.follower.onTarget(
    sampleRemote({ beat: 999, isPlaying: false }),
    sampleLocal({ songTime: 10, isPlaying: true, followMode: 'independent' }),
  );
  assert.deepEqual(res, { kind: 'none' });
  assert.equal(h.follower.isOutOfStep(), false);
  const outEvents = h.calls.filter((c) => c[0] === 'outOfStep');
  assert.deepEqual(outEvents, [
    ['outOfStep', true],
    ['outOfStep', false],
  ]);

  // Returning to follow starts with fresh samples (first playing sample is not steady).
  h.advance(500);
  const afterReturn = h.follower.onTarget(
    sampleRemote({ beat: 104, isPlaying: true }),
    sampleLocal({ songTime: 100, isPlaying: true, followMode: 'follow' }),
  );
  assert.deepEqual(afterReturn, { kind: 'none' });
  assert.equal(h.calls.filter((c) => c[0] === 'moveTo').length, 0);
});

test('PeerFollower in transport mode applies shift, start, and stop, and only alerts when stopped', () => {
  const h = makeFollowerHarness();
  for (let i = 0; i < STABLE_CLOCKS + 1; i += 1) {
    h.advance(500);
    const base = 64 + h.now() / 500;
    h.follower.onTarget(
      sampleRemote({ beat: base + 4 }),
      sampleLocal({ songTime: base, followMode: 'transport' }),
    );
  }
  assert.equal(h.calls.filter((c) => c[0] === 'moveTo').length, 1);

  const hStart = makeFollowerHarness();
  for (let i = 0; i < STABLE_CLOCKS + 1; i += 1) {
    hStart.advance(500);
    const beat = 64 + hStart.now() / 500;
    hStart.follower.onTarget(
      sampleRemote({ beat }),
      sampleLocal({ isPlaying: false, songTime: 0, followMode: 'transport' }),
    );
  }
  assert.equal(hStart.calls.filter((c) => c[0] === 'startAt').length, 1);

  const hStop = makeFollowerHarness();
  for (let i = 0; i < STABLE_CLOCKS; i += 1) {
    hStop.advance(500);
    hStop.follower.onTarget(
      sampleRemote({ isPlaying: false, beat: 0 }),
      sampleLocal({ isPlaying: true, songTime: 10, followMode: 'transport' }),
    );
  }
  assert.equal(hStop.calls.filter((c) => c[0] === 'stop').length, 1);
});

const BASE_HEALTH_VIEW = {
  linkHealth: 'ok',
  canAcknowledge: false,
  oscConnected: true,
  liveReady: true,
  cuesFingerprint: 'fp-1',
  outOfStep: false,
};

test('heartbeat decoding handles followMode and older peers without it', () => {
  const baseView = BASE_HEALTH_VIEW;
  assert.equal(decodePeerHealthView(baseView)?.followMode, undefined);
  assert.equal(
    decodePeerHealthView({ ...baseView, followMode: 'independent' })?.followMode,
    'independent',
  );
  assert.equal(
    decodePeerHealthView({ ...baseView, followMode: 'future_mode' })?.followMode,
    undefined,
  );

  const hb = decodePeerHb({ hbId: 1, t0: 10, view: { ...baseView, followMode: 'transport' } });
  assert.equal(hb.ok, true);
  assert.equal(hb.message.view.followMode, 'transport');

  const ack = decodePeerHbAck({ hbId: 1, t0: 10, t1: 11, t2: 12, view: baseView });
  assert.equal(ack.ok, true);
  assert.equal(ack.message.view.followMode, undefined);

  const tracker = new PeerHealthTracker();
  assert.equal(buildLocalHealthView(tracker, false).followMode, undefined);
  assert.equal(buildLocalHealthView(tracker, false, 'independent').followMode, 'independent');
});

test('health evaluation and status rows carry followMode, older peers read as null', () => {
  const baseView = BASE_HEALTH_VIEW;
  const tracker = new PeerHealthTracker();
  const prevMode = bridgeState.peerFollowMode;
  try {
    bridgeState.peerFollowMode = 'follow';
    const k1 = localHealthViewKey();
    bridgeState.peerFollowMode = 'independent';
    const k2 = localHealthViewKey();
    assert.notEqual(k1, k2);
  } finally {
    bridgeState.peerFollowMode = prevMode;
  }

  const withIndep = evaluatePeerLinkHealth(
    'p1',
    tracker,
    { ...baseView, followMode: 'independent' },
    true,
    '',
  );
  assert.equal(withIndep.patch.followMode, 'independent');
  const olderPeer = evaluatePeerLinkHealth('p1', tracker, baseView, true, '');
  assert.equal(olderPeer.patch.followMode, null);

  const rows = peerStatusRows([
    {
      key: 'a',
      config: { host: '10.0.0.1', port: 4444 },
      state: {
        connected: true,
        markersMatch: true,
        fingerprintMismatch: false,
        ...withIndep.patch,
      },
    },
    {
      key: 'b',
      config: { host: '10.0.0.2', port: 4444 },
      state: { connected: true, markersMatch: true, fingerprintMismatch: false },
    },
  ]);
  assert.equal(rows[0].followMode, 'independent');
  assert.equal(rows[1].followMode, null);
});
