import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { clearExtensionContext, setExtensionContext } from '../src/context.ts';
import { clearSlaveRole, readSlaveRole, writeSlaveRole } from '../src/preferences.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import { peerLinkTiming, resetPeerLinkTiming } from '../src/runtime/peer-liveness.ts';
import {
  isPeerCommandType,
  isPeerRelayWireType,
  peerCommandRejection,
} from '../src/commands/handlers/peer.ts';
import { decodeClientMessage } from '../src/server/client-message.ts';
import {
  decodeHandshakeExtras,
  decodePeerCommand,
  decodePeerHb,
  decodePeerHbAck,
  decodePeerHealthAck,
  decodePeerHealthView,
  decodePeerTarget,
} from '../src/server/peer-client-message.ts';

function validView(overrides = {}) {
  return {
    linkHealth: 'ok',
    canAcknowledge: false,
    oscConnected: true,
    liveReady: true,
    cuesFingerprint: 'abc123',
    outOfStep: false,
    ...overrides,
  };
}

function minimalMessage(type) {
  if (type === 'set_panic') return { type, active: true };
  if (type === 'jump') return { type, songIndex: 0 };
  if (type === 'jump_time') return { type, time: 16 };
  return { type };
}

test('isPeerRelayWireType allows relayed wire commands and rejects control frames', () => {
  const allowed = [
    'play',
    'stop',
    'jump_time',
    'metronome',
    'set_quantization',
    'trigger_count_in',
    'refresh',
    'set_panic',
  ];
  const blocked = [
    'jump',
    'handshake',
    'sync_confirm',
    'peer_hb',
    'peer_hb_ack',
    'peer_target',
    'peer_health_ack',
    'peer_command',
    'peer_clock',
    'peer_upstream_result',
    'setlist_chunk',
    'reorder',
    'set_mode',
  ];
  for (const type of allowed) assert.equal(isPeerRelayWireType(type), true, type);
  for (const type of blocked) assert.equal(isPeerRelayWireType(type), false, type);
});

test('isPeerCommandType and peerCommandRejection enforce peer and controller rules', () => {
  const peerAllowed = [
    'handshake',
    'sync_confirm',
    'jump_time',
    'peer_clock',
    'peer_upstream_result',
    'setlist_chunk',
    'peer_hb',
    'peer_hb_ack',
    'peer_target',
    'peer_command',
    'peer_health_ack',
    'play',
    'stop',
  ];
  for (const type of peerAllowed) {
    assert.equal(isPeerCommandType(type), true, type);
    assert.equal(peerCommandRejection(minimalMessage(type), true), null, type);
  }
  const peerOnly = [
    'jump_time',
    'peer_clock',
    'peer_upstream_result',
    'setlist_chunk',
    'peer_hb',
    'peer_hb_ack',
    'peer_target',
    'peer_command',
  ];
  for (const type of peerOnly) {
    assert.equal(peerCommandRejection(minimalMessage(type), false)?.code, 'unauthorized', type);
  }
  assert.equal(peerCommandRejection({ type: 'peer_health_ack' }, false), null);
  for (const type of ['jump', 'reorder', 'set_mode']) {
    assert.equal(isPeerCommandType(type), false, type);
    assert.equal(peerCommandRejection(minimalMessage(type), true)?.code, 'unauthorized', type);
  }
});

test('clearSlaveRole removes peer-role.json and reports removal errors', () => {
  clearExtensionContext();
  assert.equal(clearSlaveRole(), true);
  const storageDir = fs.mkdtempSync(path.join(tmpdir(), 'rc-clear-role-'));
  setExtensionContext({ environment: { storageDirectory: storageDir } });
  try {
    assert.equal(clearSlaveRole(), true);
    assert.equal(
      writeSlaveRole({ masterAddress: '10.0.0.1', pairedAt: '2026-11-22T00:00:00.000Z' }),
      true,
    );
    assert.ok(readSlaveRole());
    assert.equal(clearSlaveRole(), true);
    assert.equal(readSlaveRole(), null);
    assert.equal(fs.existsSync(path.join(storageDir, 'peer-role.json')), false);

    const blocker = path.join(storageDir, 'peer-role.json');
    fs.mkdirSync(blocker);
    fs.writeFileSync(path.join(blocker, 'held'), 'x', 'utf8');
    assert.equal(clearSlaveRole(), false);
  } finally {
    clearExtensionContext();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
});

test('peerLinkTiming and bridgeState defaults match Delivery 1 contracts', () => {
  resetPeerLinkTiming();
  assert.deepEqual(peerLinkTiming(), {
    pingIntervalMs: 2_000,
    pongTimeoutMs: 5_000,
    connectTimeoutMs: 5_000,
    handshakeTimeoutMs: 5_000,
    reconnectBaseMs: 500,
    reconnectMaxMs: 5_000,
  });
  assert.equal(bridgeState.peerStatus.versionMismatch, false);
  assert.equal(bridgeState.peerStatus.health, 'ok');
  assert.equal(bridgeState.peerStatus.reason, 'ok');
  assert.equal(bridgeState.peerStatus.canAcknowledge, false);
  assert.equal(bridgeState.peerStatus.rttP95Ms, null);
  assert.equal(bridgeState.peerStatus.drops5m, 0);
  assert.equal(bridgeState.peerStatus.lastDropAt, null);
  assert.ok(Array.isArray(bridgeState.peerStatuses));
});

test('decodeClientMessage validates optional handshake capability fields', () => {
  const base = decodeClientMessage({ type: 'handshake', clientId: 'peer-a' });
  assert.equal(base.ok, true);
  assert.deepEqual(base.message, { type: 'handshake', clientId: 'peer-a' });

  const full = decodeClientMessage({
    type: 'handshake',
    clientId: 'peer-a',
    extensionVersion: '1.2.1',
    linkProtocol: 2,
    sessionId: 'sess-1_A:0',
    ignored: 'drop',
  });
  assert.equal(full.ok, true);
  assert.deepEqual(full.message, {
    type: 'handshake',
    clientId: 'peer-a',
    extensionVersion: '1.2.1',
    linkProtocol: 2,
    sessionId: 'sess-1_A:0',
  });

  const invalid = [
    { extensionVersion: '' },
    { extensionVersion: '   ' },
    { extensionVersion: 'x'.repeat(33) },
    { extensionVersion: '1.0\n' },
    { extensionVersion: 12 },
    { linkProtocol: 0 },
    { linkProtocol: 1001 },
    { linkProtocol: 1.5 },
    { linkProtocol: Number.NaN },
    { linkProtocol: '2' },
    { sessionId: '' },
    { sessionId: 'x'.repeat(129) },
    { sessionId: 'bad id' },
    { sessionId: 'bad/id' },
    { sessionId: 9 },
  ];
  for (const extras of invalid) {
    assert.equal(decodeHandshakeExtras(extras).ok, false, JSON.stringify(extras));
    assert.equal(
      decodeClientMessage({ type: 'handshake', clientId: 'peer-a', ...extras }).ok,
      false,
    );
  }
});

test('decodeClientMessage validates peer_hb, peer_hb_ack, and PeerHealthView', () => {
  const hb = decodeClientMessage({
    type: 'peer_hb',
    hbId: 0,
    t0: 0,
    view: validView({ cuesFingerprint: '', extra: 'drop-me' }),
    ignored: 1,
  });
  assert.equal(hb.ok, true);
  assert.deepEqual(hb.message, {
    type: 'peer_hb',
    hbId: 0,
    t0: 0,
    view: validView({ cuesFingerprint: '' }),
  });

  const ack = decodeClientMessage({
    type: 'peer_hb_ack',
    hbId: 7,
    t0: 10,
    t1: 12.5,
    t2: 13,
    view: validView({ linkHealth: 'unstable', canAcknowledge: true }),
  });
  assert.equal(ack.ok, true);
  assert.equal(ack.message.type, 'peer_hb_ack');

  assert.equal(decodePeerHealthView(null), null);
  assert.equal(decodePeerHealthView(validView({ linkHealth: 'broken' })), null);
  assert.equal(decodePeerHealthView(validView({ liveReady: 'yes' })), null);
  assert.equal(decodePeerHealthView(validView({ cuesFingerprint: 'x'.repeat(129) })), null);
  assert.equal(decodePeerHealthView(validView({ cuesFingerprint: 'bad\nfp' })), null);

  assert.equal(decodePeerHb({ hbId: -1, t0: 0, view: validView() }).ok, false);
  assert.equal(decodePeerHb({ hbId: 1.5, t0: 0, view: validView() }).ok, false);
  assert.equal(decodePeerHb({ hbId: 1, t0: -1, view: validView() }).ok, false);
  assert.equal(
    decodePeerHb({ hbId: 1, t0: Number.POSITIVE_INFINITY, view: validView() }).ok,
    false,
  );
  assert.equal(decodePeerHbAck({ hbId: 1, t0: 1, t1: -1, t2: 2, view: validView() }).ok, false);
  assert.equal(
    decodePeerHbAck({ hbId: 1, t0: 1, t1: 2, t2: Number.NaN, view: validView() }).ok,
    false,
  );
});

test('decodeClientMessage validates peer_health_ack', () => {
  assert.deepEqual(decodeClientMessage({ type: 'peer_health_ack', extra: 1 }).message, {
    type: 'peer_health_ack',
  });
  assert.deepEqual(
    decodeClientMessage({ type: 'peer_health_ack', peerKey: '10.0.0.2:4444' }).message,
    { type: 'peer_health_ack', peerKey: '10.0.0.2:4444' },
  );
  for (const badKey of ['', '  ', 'x'.repeat(257), 'bad\nkey', 12]) {
    assert.equal(decodePeerHealthAck({ peerKey: badKey }).ok, false);
    assert.equal(decodeClientMessage({ type: 'peer_health_ack', peerKey: badKey }).ok, false);
  }
});

test('decodeClientMessage validates peer_target', () => {
  const validTarget = {
    transportSeq: 0,
    beat: 64.5,
    section: true,
    isPlaying: true,
    tempo: 120,
    jumpPending: false,
    loopActive: true,
  };
  const decoded = decodeClientMessage({ type: 'peer_target', ...validTarget, extra: 'drop' });
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.message, { type: 'peer_target', ...validTarget });

  for (const patch of [
    { transportSeq: -1 },
    { transportSeq: 1.5 },
    { beat: -0.1 },
    { beat: 1_000_001 },
    { tempo: 0.9 },
    { tempo: 1_001 },
    { section: 'yes' },
    { isPlaying: 1 },
    { jumpPending: null },
    { loopActive: 0 },
  ]) {
    assert.equal(decodePeerTarget({ ...validTarget, ...patch }).ok, false);
    assert.equal(decodeClientMessage({ type: 'peer_target', ...validTarget, ...patch }).ok, false);
  }
});

test('decodeClientMessage accepts valid peer_command envelopes', () => {
  const validCases = [
    {
      type: 'peer_command',
      commandId: 'cmd-play-1',
      ttlMs: 1_500,
      transportSeq: 1,
      command: { type: 'play' },
    },
    {
      type: 'peer_command',
      commandId: 'cmd-stop-null-ttl',
      ttlMs: null,
      transportSeq: 2,
      command: { type: 'stop' },
    },
    {
      type: 'peer_command',
      commandId: 'cmd-panic-on',
      ttlMs: null,
      transportSeq: 3,
      command: { type: 'set_panic', active: true },
    },
    {
      type: 'peer_command',
      commandId: 'cmd-jump-time',
      ttlMs: 600_000,
      transportSeq: 4,
      command: { type: 'jump_time', time: 100, section: true },
    },
    {
      type: 'peer_command',
      commandId: 'cmd-count-in',
      ttlMs: 500,
      transportSeq: 5,
      command: { type: 'trigger_count_in', sendPlayOffsetMs: 250 },
    },
    {
      type: 'peer_command',
      commandId: 'cmd-metro',
      ttlMs: 2_000,
      transportSeq: null,
      command: { type: 'metronome', value: true },
    },
    {
      type: 'peer_command',
      commandId: 'cmd-panic-off',
      ttlMs: 2_000,
      transportSeq: null,
      command: { type: 'set_panic', active: false },
    },
  ];
  for (const msg of validCases) {
    const decoded = decodeClientMessage(msg);
    assert.equal(decoded.ok, true, msg.commandId);
    assert.deepEqual(decoded.message, msg);
  }
});

test('decodePeerCommand rejects disallowed inner commands', () => {
  const disallowed = [
    {
      type: 'peer_command',
      commandId: 'nested-inner',
      ttlMs: 1_000,
      transportSeq: 1,
      command: { type: 'play' },
    },
    { type: 'jump', songIndex: 0 },
    { type: 'handshake', clientId: 'a' },
    { type: 'sync_confirm', stateVersion: 1 },
    { type: 'peer_hb', hbId: 0, t0: 0, view: validView() },
    { type: 'peer_hb_ack', hbId: 0, t0: 0, t1: 0, t2: 0, view: validView() },
    {
      type: 'peer_target',
      transportSeq: 0,
      beat: 0,
      section: false,
      isPlaying: false,
      tempo: 120,
      jumpPending: false,
      loopActive: false,
    },
    { type: 'peer_health_ack' },
    { type: 'peer_upstream_result', commandId: 'u1', ok: false },
    { type: 'setlist_chunk', requestId: 'ab', index: 0, total: 1, data: '' },
    { type: 'metronome', value: 'not-bool' },
  ];
  for (const command of disallowed) {
    const res = decodeClientMessage({
      type: 'peer_command',
      commandId: `blk-${command.type}`,
      ttlMs: 1_000,
      transportSeq: null,
      command,
    });
    assert.equal(res.ok, false, command.type);
  }
  assert.equal(
    decodeClientMessage({ type: 'peer_command', ttlMs: 1000, transportSeq: 1 }).ok,
    false,
  );
  assert.equal(
    decodeClientMessage({
      type: 'peer_command',
      commandId: 'not-obj',
      ttlMs: 1000,
      transportSeq: 1,
      command: 'play',
    }).ok,
    false,
  );
});

test('decodePeerCommand rejects invalid ttlMs and transportSeq bounds', () => {
  const badEnvelopes = [
    { commandId: 'null-play', ttlMs: null, transportSeq: 1, command: { type: 'play' } },
    {
      commandId: 'null-jump',
      ttlMs: null,
      transportSeq: 1,
      command: { type: 'jump_time', time: 8 },
    },
    {
      commandId: 'null-panic-off',
      ttlMs: null,
      transportSeq: null,
      command: { type: 'set_panic', active: false },
    },
    { commandId: 'zero-ttl', ttlMs: 0, transportSeq: 1, command: { type: 'play' } },
    { commandId: 'over-ttl', ttlMs: 600_001, transportSeq: 1, command: { type: 'play' } },
    { commandId: 'nan-ttl', ttlMs: Number.NaN, transportSeq: 1, command: { type: 'play' } },
    { commandId: 'seq-0', ttlMs: 1_000, transportSeq: 0, command: { type: 'play' } },
    { commandId: 'seq-null', ttlMs: 1_000, transportSeq: null, command: { type: 'play' } },
    { commandId: 'seq-float', ttlMs: 1_000, transportSeq: 1.5, command: { type: 'play' } },
    {
      commandId: 'seq-metro',
      ttlMs: 1_000,
      transportSeq: 1,
      command: { type: 'metronome', value: true },
    },
    {
      commandId: 'seq-panic-off',
      ttlMs: 1_000,
      transportSeq: 1,
      command: { type: 'set_panic', active: false },
    },
  ];
  for (const envelope of badEnvelopes) {
    assert.equal(decodeClientMessage({ type: 'peer_command', ...envelope }).ok, false);
  }
  assert.equal(
    decodePeerCommand(
      { ttlMs: 1_000, transportSeq: 1, command: { type: 'play' } },
      decodeClientMessage,
      'direct-1',
    ).ok,
    true,
  );
});
