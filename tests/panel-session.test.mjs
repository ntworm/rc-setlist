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
    'set-language:en',
    'set-language:pt-BR',
    'peer-code',
    'peer-unpair',
    'peer-pair:192.168.1.5:123456',
  ];
  for (const action of actions) {
    const envelope = decodePanelEnvelope(action);
    assert.ok(envelope, `${action} must be understood`);
    assert.equal(envelope.action, action);
  }
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

test('an answer that is far too long is discarded', () => {
  assert.equal(decodePanelEnvelope('x'.repeat(600)), null);
});

test('an unknown action is not one the panel may send', () => {
  assert.equal(isKnownAction('drop-the-table'), false);
  assert.equal(isKnownAction('start'), true);
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
