import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEnvelopeToSession,
  createPanelSession,
  decodePanelEnvelope,
  isIpv4Address,
  isKnownAction,
  resolveSessionAddress,
} from '../src/ui/panel-session.ts';
import { isSetlistAction } from '../src/ui/panel-setlists.ts';
import { buildPeerPanelAlerts, formatPeerAlertText, peerPanelModel } from '../src/ui/peer-panel.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';

test('the panel session starts on the main section', () => {
  const session = createPanelSession();
  assert.deepEqual(session, { tab: 'main', access: 'stage', address: '', notice: null });
});

test('the actions the panel has always sent are still understood', () => {
  const actions = [
    'close',
    'start',
    'stop',
    'restart',
    'diagnose-osc',
    'toggle-auto-start',
    'toggle-write-tempo',
    'toggle-peer-auto-correct',
    'set-language:en',
    'set-language:pt-BR',
    'peer-code',
    'peer-unpair',
    'peer-ack',
    'peer-ack:192.168.1.5:4444',
    'peer-pair:192.168.1.5:123456',
  ];
  for (const action of actions) {
    const envelope = decodePanelEnvelope(action);
    assert.ok(envelope, `${action} must be understood`);
    assert.equal(envelope.action, action);
  }
});

test('the action that brings the setlist of the master is understood', () => {
  assert.equal(isKnownAction('pull-master-setlist'), true);
  assert.equal(isSetlistAction('pull-master-setlist'), true);
  const envelope = decodePanelEnvelope('pull-master-setlist');
  assert.ok(envelope);
  assert.equal(envelope.action, 'pull-master-setlist');
  const json = decodePanelEnvelope('{"action":"pull-master-setlist"}');
  assert.ok(json);
  assert.equal(json.action, 'pull-master-setlist');
});

test('an answer that is not an envelope is discarded', () => {
  assert.equal(decodePanelEnvelope(''), null);
  assert.equal(decodePanelEnvelope('   '), null);
  assert.equal(decodePanelEnvelope('drop the table'), null);
  assert.equal(decodePanelEnvelope(null), null);
  assert.equal(decodePanelEnvelope(undefined), null);
  assert.equal(decodePanelEnvelope(42), null);
  assert.equal(decodePanelEnvelope({ action: 'start' }), null);
});

test('a malformed envelope never carries its text further', () => {
  const raw = '{"action":"start","token":"super-secret"';
  const envelope = decodePanelEnvelope(raw);
  assert.equal(envelope, null);
  assert.ok(!JSON.stringify(envelope).includes('super-secret'));
});

test('an envelope that is not an object is discarded', () => {
  assert.equal(decodePanelEnvelope('[]'), null);
  assert.equal(decodePanelEnvelope('"start"'), null);
  assert.equal(decodePanelEnvelope('null'), null);
  assert.equal(decodePanelEnvelope('42'), null);
});

test('an envelope keeps only what the panel may say', () => {
  const envelope = decodePanelEnvelope(
    '{"action":"select-address","tab":"network","access":"performance","address":"192.168.1.50"}',
  );
  assert.ok(envelope);
  assert.equal(envelope.action, 'select-address');
  assert.equal(envelope.tab, 'network');
  assert.equal(envelope.access, 'performance');
  assert.equal(envelope.address, '192.168.1.50');
});

test('the enums of the envelope are narrow', () => {
  assert.equal(decodePanelEnvelope('{"action":"start","tab":"everything"}'), null);
  assert.equal(decodePanelEnvelope('{"action":"start","access":"everything"}'), null);
  assert.equal(decodePanelEnvelope('{"action":"start","tab":42}'), null);
});

test('the address of the envelope is an address and not a command', () => {
  assert.equal(decodePanelEnvelope('{"action":"start","address":"localhost"}'), null);
  assert.equal(decodePanelEnvelope('{"action":"start","address":"192.168.1.50; rm -rf /"}'), null);
  assert.equal(decodePanelEnvelope('{"action":"start","address":"999.1.1.1"}'), null);
  assert.equal(decodePanelEnvelope('{"action":"start","address":123}'), null);
  const automatic = decodePanelEnvelope('{"action":"select-address","address":""}');
  assert.ok(automatic);
  assert.equal(automatic.address, '');
});

test('the profile of the envelope is a name and nothing else', () => {
  const envelope = decodePanelEnvelope('{"action":"select-profile","profileId":"a1b2"}');
  assert.ok(envelope);
  assert.equal(envelope.profileId, 'a1b2');
  assert.equal(decodePanelEnvelope('{"action":"select-profile","profileId":"a b"}'), null);
  assert.equal(decodePanelEnvelope('{"action":"select-profile","profileId":42}'), null);
  assert.equal(decodePanelEnvelope('{"action":"select-profile","profileId":"x".repeat(65)}'), null);
});

test('the name of a setlist travels into the envelope', () => {
  const created = decodePanelEnvelope('{"action":"create-profile","name":"Festival"}');
  assert.ok(created);
  assert.equal(created.action, 'create-profile');
  assert.equal(created.name, 'Festival');
  const renamed = decodePanelEnvelope(
    '{"action":"rename-profile","profileId":"a1b2","name":"  Encore  "}',
  );
  assert.ok(renamed);
  assert.equal(renamed.profileId, 'a1b2');
  assert.equal(renamed.name, 'Encore');
});

test('a name the panel may not send is refused', () => {
  const long = 'x'.repeat(81);
  assert.equal(decodePanelEnvelope(`{"action":"create-profile","name":"${long}"}`), null);
  assert.equal(decodePanelEnvelope('{"action":"create-profile","name":"Fest\\u0000ival"}'), null);
  assert.equal(decodePanelEnvelope('{"action":"create-profile","name":"Fest\\u001fival"}'), null);
  assert.equal(decodePanelEnvelope('{"action":"create-profile","name":""}'), null);
  assert.equal(decodePanelEnvelope('{"action":"create-profile","name":"   "}'), null);
  assert.equal(decodePanelEnvelope('{"action":"create-profile","name":42}'), null);
});

test('the package file travels into the envelope', () => {
  const envelope = decodePanelEnvelope(
    '{"action":"import-package","packageFile":"Winter Set.rcsetlist"}',
  );
  assert.ok(envelope);
  assert.equal(envelope.action, 'import-package');
  assert.equal(envelope.packageFile, 'Winter Set.rcsetlist');
});

test('a package file the panel may not send is refused', () => {
  assert.equal(
    decodePanelEnvelope('{"action":"import-package","packageFile":"folder/Winter.rcsetlist"}'),
    null,
  );
  assert.equal(
    decodePanelEnvelope('{"action":"import-package","packageFile":"..\\\\Winter.rcsetlist"}'),
    null,
  );
  assert.equal(
    decodePanelEnvelope('{"action":"import-package","packageFile":"Winter Set.zip"}'),
    null,
  );
  assert.equal(decodePanelEnvelope('{"action":"import-package","packageFile":"Winter Set"}'), null);
  assert.equal(decodePanelEnvelope('{"action":"import-package","packageFile":42}'), null);
});

test('the rename of a package travels into the envelope', () => {
  const envelope = decodePanelEnvelope(
    '{"action":"rename-package","packageFile":"Winter Set.rcsetlist","name":"Summer Set"}',
  );
  assert.ok(envelope);
  assert.equal(envelope.action, 'rename-package');
  assert.equal(envelope.packageFile, 'Winter Set.rcsetlist');
  assert.equal(envelope.name, 'Summer Set');
  assert.equal(isKnownAction('rename-package'), true);
});

test('a rename the panel may not send is refused', () => {
  assert.equal(
    decodePanelEnvelope(
      '{"action":"rename-package","packageFile":"folder/Winter.rcsetlist","name":"Summer"}',
    ),
    null,
  );
  assert.equal(
    decodePanelEnvelope(
      '{"action":"rename-package","packageFile":"Winter Set.rcsetlist","name":"  "}',
    ),
    null,
  );
  assert.equal(
    decodePanelEnvelope(
      '{"action":"rename-package","packageFile":"Winter Set.rcsetlist","name":42}',
    ),
    null,
  );
});

test('an answer that is far too long is discarded', () => {
  assert.equal(decodePanelEnvelope('x'.repeat(600)), null);
});

test('an unknown action is not one the panel may send', () => {
  assert.equal(isKnownAction('drop-the-table'), false);
  assert.equal(isKnownAction('start'), true);
});

test('the action that unpairs one computer is understood', () => {
  const action = 'peer-unpair:192.168.1.5:4444';
  assert.equal(isKnownAction(action), true);
  const envelope = decodePanelEnvelope(action);
  assert.ok(envelope);
  assert.equal(envelope.action, action);
  assert.equal(isKnownAction('peer-unpair'), true);
  const json = decodePanelEnvelope('{"action":"peer-unpair:192.168.1.5:4444"}');
  assert.equal(json.action, action);
});

test('an unpair action that is far too long is discarded', () => {
  assert.equal(decodePanelEnvelope(`peer-unpair:${'x'.repeat(600)}`), null);
});

test('the session follows what the panel said', () => {
  const session = createPanelSession();
  const envelope = decodePanelEnvelope(
    '{"action":"select-address","tab":"network","access":"performance","address":"192.168.1.50"}',
  );
  assert.ok(envelope);
  applyEnvelopeToSession(session, envelope);
  assert.equal(session.tab, 'network');
  assert.equal(session.access, 'performance');
  assert.equal(session.address, '192.168.1.50');
});

test('an address the machine does not hold falls back to the automatic choice', () => {
  const session = createPanelSession();
  session.address = '192.168.1.50';
  assert.equal(resolveSessionAddress(session, ['192.168.1.50', '10.0.0.4']), '192.168.1.50');
  assert.equal(resolveSessionAddress(session, ['10.0.0.4']), '');
  assert.equal(resolveSessionAddress(session, []), '');
});

test('the addresses of the panel are plain IPv4 addresses', () => {
  assert.equal(isIpv4Address('192.168.1.50'), true);
  assert.equal(isIpv4Address('0.0.0.0'), true);
  assert.equal(isIpv4Address('255.255.255.255'), true);
  assert.equal(isIpv4Address('256.0.0.1'), false);
  assert.equal(isIpv4Address('192.168.1'), false);
  assert.equal(isIpv4Address('192.168.1.50 '), false);
  assert.equal(isIpv4Address(''), false);
});

test('formatPeerAlertText and buildPeerPanelAlerts format EN and pt-BR alerts', () => {
  assert.equal(
    formatPeerAlertText({ commandType: 'jump', status: 'expired' }, 'en'),
    'SLAVE DID NOT EXECUTE: jump',
  );
  assert.equal(
    formatPeerAlertText({ commandType: 'jump', status: 'expired' }, 'pt-BR'),
    'SLAVE N\u00c3O EXECUTOU: jump',
  );
  assert.equal(
    formatPeerAlertText({ commandType: 'stop', status: 'stop_unacked' }, 'en'),
    'SLAVE STILL NOT STOPPED',
  );
  assert.equal(
    formatPeerAlertText({ commandType: 'stop', status: 'stop_unacked' }, 'pt-BR'),
    'SLAVE AINDA N\u00c3O PAROU',
  );
  assert.equal(
    formatPeerAlertText({ commandType: 'play', status: 'late_confirmed' }, 'en'),
    'Executed late: play',
  );
  assert.equal(
    formatPeerAlertText({ commandType: 'play', status: 'late_confirmed' }, 'pt-BR'),
    'Executou atrasado: play',
  );

  const prev = bridgeState.peerAlerts;
  try {
    bridgeState.peerAlerts = {
      '10.0.0.2:4444': {
        commandId: 'c1',
        commandType: 'jump',
        status: 'expired',
        at: 1000,
      },
    };
    const alerts = buildPeerPanelAlerts(bridgeState.peerAlerts, 'pt-BR');
    assert.equal(alerts['10.0.0.2:4444'].text, 'SLAVE N\u00c3O EXECUTOU: jump');
    const model = peerPanelModel({ locale: 'en' });
    assert.equal(typeof model.autoCorrect, 'boolean');
    assert.equal(model.alerts['10.0.0.2:4444'].text, 'SLAVE DID NOT EXECUTE: jump');
  } finally {
    bridgeState.peerAlerts = prev;
  }
});
