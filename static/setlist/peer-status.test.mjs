import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'peer-status.js'), 'utf8');
const scope = {};
vm.runInNewContext(source, { globalThis: scope });
const peerStatus = scope.RcPeerStatus;

const HEALTHY = {
  paired: true,
  connected: true,
  markersMatch: true,
  fingerprintMismatch: false,
  versionMismatch: false,
  health: 'ok',
  reason: 'ok',
  canAcknowledge: false,
};

function createFakeDot() {
  const attributes = new Map();
  return {
    hidden: false,
    className: '',
    title: '',
    setAttribute(k, v) {
      attributes.set(k, v);
    },
    getAttribute(k) {
      return attributes.get(k);
    },
  };
}

function createFakeBadge({ withClassList = true } = {}) {
  const classes = new Set(['peer-transport-badge']);
  const badge = { hidden: false, textContent: '', className: 'peer-transport-badge' };
  if (withClassList) {
    badge.classList = {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
        badge.className = [...classes].join(' ');
      },
      contains(name) {
        return classes.has(name);
      },
    };
  }
  return badge;
}

test('the peer dot is hidden while no second computer is paired', () => {
  const view = {
    ...peerStatus.peerStatusView({ paired: false, connected: false, health: 'down' }),
  };
  assert.deepEqual(view, {
    hidden: true,
    className: '',
    tier: 'none',
    stateKey: 'peer.notPaired',
    textKey: 'peer.notPaired',
    reasonKey: '',
    badgeKey: '',
    canAcknowledge: false,
  });
});

test('a missing peer status is the same as no pair', () => {
  assert.equal(peerStatus.peerStatusView(undefined).hidden, true);
  assert.equal(peerStatus.peerStatusView(null).hidden, true);
  assert.equal(peerStatus.peerStatusView(undefined).tier, 'none');
});

test('a healthy peer with ok health is green', () => {
  assert.deepEqual(
    { ...peerStatus.peerStatusView(HEALTHY) },
    {
      hidden: false,
      className: 'connected',
      tier: 'ok',
      stateKey: 'peer.state.ok',
      textKey: 'peer.connected',
      reasonKey: 'peer.reason.ok',
      badgeKey: '',
      canAcknowledge: false,
    },
  );
});

test('an unstable peer with differing markers is amber and keeps legacy markersDiffer text', () => {
  const view = {
    ...peerStatus.peerStatusView({
      ...HEALTHY,
      markersMatch: false,
      health: 'unstable',
      reason: 'markers_differ',
    }),
  };
  assert.deepEqual(view, {
    hidden: false,
    className: 'warning',
    tier: 'unstable',
    stateKey: 'peer.state.unstable',
    textKey: 'peer.markersDiffer',
    reasonKey: 'peer.reason.markers_differ',
    badgeKey: 'peer.transportBadge.unstable',
    canAcknowledge: false,
  });
});

test('unstable peer uses state unstable and forwards canAcknowledge', () => {
  const ackable = peerStatus.peerStatusView({
    ...HEALTHY,
    health: 'unstable',
    reason: 'recent_drop',
    canAcknowledge: true,
  });
  assert.equal(ackable.className, 'warning');
  assert.equal(ackable.tier, 'unstable');
  assert.equal(ackable.textKey, 'peer.state.unstable');
  assert.equal(ackable.reasonKey, 'peer.reason.recent_drop');
  assert.equal(ackable.canAcknowledge, true);

  const warming = peerStatus.peerStatusView({
    ...HEALTHY,
    health: 'unstable',
    reason: 'warming_up',
    canAcknowledge: false,
  });
  assert.equal(warming.reasonKey, 'peer.reason.warming_up');
  assert.equal(warming.canAcknowledge, false);
});

test('a down peer is red and defaults missing reason to link_down', () => {
  const view = { ...peerStatus.peerStatusView({ ...HEALTHY, health: 'down', reason: undefined }) };
  assert.deepEqual(view, {
    hidden: false,
    className: 'error',
    tier: 'down',
    stateKey: 'peer.state.down',
    textKey: 'peer.offline',
    reasonKey: 'peer.reason.link_down',
    badgeKey: 'peer.transportBadge.down',
    canAcknowledge: false,
  });
});

test('precedence is fingerprintMismatch > versionMismatch > down > unstable > ok', () => {
  const certOverVersion = peerStatus.peerStatusView({
    ...HEALTHY,
    fingerprintMismatch: true,
    versionMismatch: true,
    health: 'ok',
  });
  assert.equal(certOverVersion.tier, 'certificate_changed');
  assert.equal(certOverVersion.className, 'error');
  assert.equal(certOverVersion.badgeKey, 'peer.transportBadge.certificateChanged');

  const versionOverDown = peerStatus.peerStatusView({
    ...HEALTHY,
    versionMismatch: true,
    health: 'down',
    reason: 'link_down',
  });
  assert.equal(versionOverDown.tier, 'version_mismatch');
  assert.equal(versionOverDown.className, 'error');
  assert.equal(versionOverDown.textKey, 'peer.versionMismatch');
  assert.equal(versionOverDown.badgeKey, 'peer.transportBadge.versionMismatch');
});

test('connected is never read for colour; missing or degraded health never turns green', () => {
  const raw = { paired: true, connected: true };
  assert.equal(peerStatus.peerStatusView({ ...raw, health: 'unstable' }).className, 'warning');
  assert.equal(peerStatus.peerStatusView({ ...raw, health: 'down' }).className, 'error');
  const missingHealth = peerStatus.peerStatusView({ ...raw, markersMatch: true });
  assert.equal(missingHealth.className, 'error');
  assert.equal(missingHealth.tier, 'down');

  const okEvenIfRawConnectedFalse = peerStatus.peerStatusView({
    ...HEALTHY,
    connected: false,
    health: 'ok',
  });
  assert.equal(okEvenIfRawConnectedFalse.className, 'connected');
  assert.equal(okEvenIfRawConnectedFalse.tier, 'ok');
});

test('canAcknowledge passes through only on unstable tier', () => {
  for (const overrides of [
    { health: 'ok', canAcknowledge: true },
    { health: 'down', canAcknowledge: true },
    { versionMismatch: true, health: 'unstable', canAcknowledge: true },
    { fingerprintMismatch: true, health: 'unstable', canAcknowledge: true },
  ]) {
    const view = peerStatus.peerStatusView({ ...HEALTHY, ...overrides });
    assert.equal(view.canAcknowledge, false);
  }
  const nonBoolAck = peerStatus.peerStatusView({
    ...HEALTHY,
    health: 'unstable',
    canAcknowledge: 'yes',
  });
  assert.equal(nonBoolAck.canAcknowledge, false);
  const boolAck = peerStatus.peerStatusView({
    ...HEALTHY,
    health: 'unstable',
    canAcknowledge: true,
  });
  assert.equal(boolAck.canAcknowledge, true);
});

test('the three colours the dot can take are the ones the stylesheet defines', () => {
  const css = fs.readFileSync(path.join(here, 'setlist.css'), 'utf8');
  for (const className of ['connected', 'warning', 'error']) {
    assert.match(css, new RegExp(`\\.status-dot\\.${className}\\b`));
  }
});

test('formatAgo formats sub-minute, minute, hour, and invalid ages cleanly', () => {
  assert.equal(peerStatus.formatAgo(-1), '\u2014');
  assert.equal(peerStatus.formatAgo(Number.NaN), '\u2014');
  assert.equal(peerStatus.formatAgo(Number.POSITIVE_INFINITY), '\u2014');
  assert.equal(peerStatus.formatAgo(null), '\u2014');
  assert.equal(peerStatus.formatAgo(0), '0s');
  assert.equal(peerStatus.formatAgo(999), '0s');
  assert.equal(peerStatus.formatAgo(15_200), '15s');
  assert.equal(peerStatus.formatAgo(59_999), '59s');
  assert.equal(peerStatus.formatAgo(60_000), '1m 0s');
  assert.equal(peerStatus.formatAgo(65_400), '1m 5s');
  assert.equal(peerStatus.formatAgo(3_599_999), '59m 59s');
  assert.equal(peerStatus.formatAgo(3_600_000), '1h 0m');
  assert.equal(peerStatus.formatAgo(5_400_000), '1h 30m');
});

test('formatRowMetrics formats RTT, drops5m, lastDropAgo, and clock-skew-safe lastSeenInfo', () => {
  const t = (key, params = {}) => `${key}:${JSON.stringify(params)}`;
  const serverNow = 1_700_000_010_000;
  const lastSeenInfo = {
    serverNow,
    lastSeenAt: serverNow - 2_000,
    receivedAt: 1_000,
  };
  const row = {
    rttP95Ms: 24.4,
    drops5m: 2,
    lastDropAt: serverNow - 60_000,
  };

  // Client clock nowMs (4_000) is far from serverNow (1.7e12); age stays accurate.
  const parts = Array.from(peerStatus.formatRowMetrics(row, 4_000, t, lastSeenInfo));
  assert.deepEqual(parts, [
    'peer.metric.rtt:{"ms":24}',
    'peer.metric.drops5m:{"count":2}',
    'peer.metric.lastDropAgo:{"ago":"1m 3s"}',
    'peer.metric.lastSeenAgo:{"ago":"5s"}',
  ]);
});

test('formatRowMetrics clamps negative skew to 0s and omits null optional fields', () => {
  const t = (key, params = {}) => `${key}:${params.ago ?? params.count ?? params.ms}`;
  const parts = Array.from(
    peerStatus.formatRowMetrics({ rttP95Ms: null, drops5m: 0, lastDropAt: null }, 1_000, t, {
      serverNow: 5_000,
      lastSeenAt: 5_400,
      receivedAt: 1_000,
    }),
  );
  assert.deepEqual(parts, ['peer.metric.drops5m:0', 'peer.metric.lastSeenAgo:0s']);
});

test('createPeerAlarmController shows on initial down only while playing', () => {
  const playingCtrl = peerStatus.createPeerAlarmController();
  assert.equal(playingCtrl.update({ paired: true, health: 'down', isPlaying: true }).visible, true);
  assert.equal(playingCtrl.isVisible(), true);

  const stoppedCtrl = peerStatus.createPeerAlarmController();
  assert.equal(
    stoppedCtrl.update({ paired: true, health: 'down', isPlaying: false }).visible,
    false,
  );
  assert.equal(stoppedCtrl.isVisible(), false);
  assert.equal(
    stoppedCtrl.update({ paired: true, health: 'down', isPlaying: false }).visible,
    false,
  );
});

test('createPeerAlarmController triggers on transition to down even when stopped', () => {
  const ctrl = peerStatus.createPeerAlarmController();
  assert.equal(ctrl.update({ paired: true, health: 'ok', isPlaying: false }).visible, false);
  assert.equal(ctrl.update({ paired: true, health: 'down', isPlaying: false }).visible, true);
  assert.equal(ctrl.isVisible(), true);
});

test('createPeerAlarmController handles dismiss, recovery, re-entry, and reset', () => {
  const ctrl = peerStatus.createPeerAlarmController();
  ctrl.update({ paired: true, health: 'ok', isPlaying: true });
  ctrl.update({ paired: true, health: 'down', isPlaying: true });
  assert.equal(ctrl.dismiss().visible, false);
  assert.equal(ctrl.isVisible(), false);
  assert.equal(ctrl.update({ paired: true, health: 'down', isPlaying: true }).visible, false);

  // Leaving down clears dismiss; re-entering down shows the alarm again.
  assert.equal(ctrl.update({ paired: true, health: 'unstable', isPlaying: true }).visible, false);
  assert.equal(ctrl.update({ paired: true, health: 'down', isPlaying: false }).visible, true);

  // Leaving via ok also hides it.
  assert.equal(ctrl.update({ paired: true, health: 'ok', isPlaying: true }).visible, false);

  ctrl.reset();
  assert.equal(ctrl.isVisible(), false);
  assert.equal(ctrl.update({ paired: true, health: 'down', isPlaying: false }).visible, false);
});

test('applyPeerStatus updates dot and transport badge with 1-arg and options calls', () => {
  const dot = createFakeDot();
  const badge = createFakeBadge();
  const doc = {
    getElementById(id) {
      if (id === 'peerStatusDot') return dot;
      if (id === 'peerTransportBadge') return badge;
      return null;
    },
  };
  scope.document = doc;
  scope.RcSetlistI18n = { t: (key) => `tr:${key}` };

  peerStatus.applyPeerStatus(HEALTHY);
  assert.equal(dot.hidden, false);
  assert.equal(dot.className, 'status-dot connected');
  assert.equal(dot.title, 'tr:peer.connected');
  assert.equal(dot.getAttribute('aria-label'), 'tr:peer.connected');
  assert.equal(badge.hidden, true);
  assert.equal(badge.textContent, '');

  peerStatus.applyPeerStatus({ ...HEALTHY, health: 'unstable', reason: 'high_rtt' });
  assert.equal(dot.className, 'status-dot warning');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, 'tr:peer.transportBadge.unstable');
  assert.equal(badge.classList.contains('is-warning'), true);
  assert.equal(badge.classList.contains('is-error'), false);

  peerStatus.applyPeerStatus({ ...HEALTHY, health: 'down' });
  assert.equal(dot.className, 'status-dot error');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, 'tr:peer.transportBadge.down');
  assert.equal(badge.classList.contains('is-warning'), false);
  assert.equal(badge.classList.contains('is-error'), true);

  peerStatus.applyPeerStatus(null);
  assert.equal(dot.hidden, true);
  assert.equal(dot.className, 'status-dot');
  assert.equal(badge.hidden, true);
  assert.equal(badge.classList.contains('is-error'), false);
});

test('applyPeerStatus supports custom options, className-only badge, and missing i18n', () => {
  const dot = createFakeDot();
  const badge = createFakeBadge({ withClassList: false });
  const customDoc = {
    getElementById(id) {
      if (id === 'peerStatusDot') return dot;
      if (id === 'peerTransportBadge') return badge;
      return null;
    },
  };

  peerStatus.applyPeerStatus(
    { ...HEALTHY, versionMismatch: true },
    { document: customDoc, translate: (key) => `opt:${key}` },
  );
  assert.equal(dot.title, 'opt:peer.versionMismatch');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, 'opt:peer.transportBadge.versionMismatch');
  assert.equal(badge.className, 'peer-transport-badge is-error');

  peerStatus.applyPeerStatus(HEALTHY, { document: customDoc });
  assert.equal(badge.hidden, true);
  assert.equal(badge.className, 'peer-transport-badge');

  scope.RcSetlistI18n = null;
  scope.document = customDoc;
  peerStatus.applyPeerStatus(HEALTHY);
  assert.equal(dot.title, 'peer.connected');
  assert.equal(dot.getAttribute('aria-label'), 'peer.connected');
});
