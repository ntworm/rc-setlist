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

const CONNECTED = { paired: true, connected: true, markersMatch: true, fingerprintMismatch: false };

test('the peer dot is hidden while no second computer is paired', () => {
  const view = peerStatus.peerStatusView({ paired: false, connected: false });
  assert.equal(view.hidden, true);
  assert.equal(view.className, '');
  assert.equal(view.textKey, 'peer.notPaired');
});

test('a missing peer status is the same as no pair', () => {
  assert.equal(peerStatus.peerStatusView(undefined).hidden, true);
  assert.equal(peerStatus.peerStatusView(null).hidden, true);
});

test('a connected peer with the same markers is green', () => {
  const view = peerStatus.peerStatusView(CONNECTED);
  assert.equal(view.hidden, false);
  assert.equal(view.className, 'connected');
  assert.equal(view.textKey, 'peer.connected');
});

test('a connected peer with different markers is amber', () => {
  // The link is up, but the two computers do not read the same markers, so
  // a jump would land somewhere else on the second machine.
  const view = peerStatus.peerStatusView({ ...CONNECTED, markersMatch: false });
  assert.equal(view.hidden, false);
  assert.equal(view.className, 'warning');
  assert.equal(view.textKey, 'peer.markersDiffer');
});

test('a peer that stopped answering is red', () => {
  const view = peerStatus.peerStatusView({ ...CONNECTED, connected: false });
  assert.equal(view.hidden, false);
  assert.equal(view.className, 'error');
  assert.equal(view.textKey, 'peer.offline');
});

test('a peer whose certificate changed is red, and says so', () => {
  // The link stopped on purpose: it is not "offline", it is refused.
  const view = peerStatus.peerStatusView({
    ...CONNECTED,
    connected: false,
    fingerprintMismatch: true,
  });
  assert.equal(view.hidden, false);
  assert.equal(view.className, 'error');
  assert.equal(view.textKey, 'peer.certificateChanged');
});

test('the three colours the dot can take are the ones the stylesheet defines', () => {
  const css = fs.readFileSync(path.join(here, 'setlist.css'), 'utf8');
  for (const className of ['connected', 'warning', 'error']) {
    assert.match(css, new RegExp(`\\.status-dot\\.${className}\\b`));
  }
});

test('applyPeerStatus with fake document and fake RcSetlistI18n updates hidden, class, title and aria-label', () => {
  const attributes = new Map();
  const dot = {
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
  const doc = {
    getElementById(id) {
      return id === 'peerStatusDot' ? dot : null;
    },
  };
  const i18n = {
    t(key) {
      return `translated:${key}`;
    },
  };

  scope.document = doc;
  scope.RcSetlistI18n = i18n;

  const cases = [
    [CONNECTED, false, 'status-dot connected', 'peer.connected'],
    [{ ...CONNECTED, markersMatch: false }, false, 'status-dot warning', 'peer.markersDiffer'],
    [{ ...CONNECTED, connected: false }, false, 'status-dot error', 'peer.offline'],
    [
      { ...CONNECTED, connected: false, fingerprintMismatch: true },
      false,
      'status-dot error',
      'peer.certificateChanged',
    ],
    [null, true, 'status-dot', 'peer.notPaired'],
    [undefined, true, 'status-dot', 'peer.notPaired'],
  ];
  for (const [status, hidden, className, key] of cases) {
    peerStatus.applyPeerStatus(status);
    assert.equal(dot.hidden, hidden);
    assert.equal(dot.className, className);
    assert.equal(dot.title, `translated:${key}`);
    assert.equal(dot.getAttribute('aria-label'), `translated:${key}`);
  }

  // Without translations the dot still says something.
  scope.RcSetlistI18n = null;
  peerStatus.applyPeerStatus(CONNECTED);
  assert.equal(dot.title, 'peer.connected');
  assert.equal(dot.getAttribute('aria-label'), 'peer.connected');
});
