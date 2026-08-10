import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeClientMessage } from '../src/server/client-message.ts';

function expectInvalid(input, messagePattern) {
  const result = decodeClientMessage(input);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_message');
  if (messagePattern) assert.match(result.message, messagePattern);
  return result;
}

test('decoder rejects values without a supported message type', () => {
  for (const value of [
    null,
    undefined,
    [],
    'play',
    42,
    {},
    { type: '' },
    { type: 7 },
    { type: 'destroy_everything' },
    { type: 'profile_purge', id: 'profile-1' },
  ]) {
    expectInvalid(value, /message|type/i);
  }
});

test('decoder bounds message types without reflecting unsafe input', () => {
  const sentinel = `unsupported-${'x'.repeat(256)}\nsecret`;
  const result = decodeClientMessage({ type: sentinel });

  assert.equal(result.ok, false);
  assert.doesNotMatch(result.message, /unsupported|secret|x{20}/);
});

test('decoder validates command identifiers without echoing unsafe values', () => {
  const safe = decodeClientMessage({ type: 'play', commandId: 'play-123_A' });
  assert.equal(safe.ok, true);

  const controlCharacters = expectInvalid({ type: 'play', commandId: 'bad\nvalue' }, /commandId/);
  assert.equal(controlCharacters.commandId, undefined);
  expectInvalid({ type: 'play', commandId: '' }, /commandId/);
  expectInvalid({ type: 'play', commandId: 'x'.repeat(129) }, /commandId/);
  expectInvalid({ type: 'play', commandId: 12 }, /commandId/);
});

test('decoder accepts every current browser and server command, including legacy commands without IDs', () => {
  const valid = [
    { type: 'handshake', clientId: 'browser-setlist-abc' },
    { type: 'sync_confirm', stateVersion: 42 },
    { type: 'get_lyrics' },
    { type: 'get_lyrics', song: 'Song A' },
    { type: 'profiles_get' },
    { type: 'preflight_check' },
    { type: 'play' },
    { type: 'stop', commandId: 'stop-now' },
    { type: 'refresh' },
    { type: 'export_csv' },
    { type: 'create_test_session' },
    { type: 'metronome', value: true },
    { type: 'set_pre_roll', value: true },
    { type: 'set_quantization', value: 11 },
    { type: 'jump', songIndex: 2 },
    { type: 'jump', songIndex: 2, sectionIndex: null },
    { type: 'jump', songIndex: 2, sectionIndex: 3 },
    { type: 'click_preview' },
    { type: 'click_preview', bpm: 120, beats: 4 },
    { type: 'set_panic', active: true },
    { type: 'set_critical_lock', locked: false },
    { type: 'set_mode', mode: 'rehearsal' },
    { type: 'set_mode', mode: 'show' },
    { type: 'reorder', songTitles: ['Song B', 'Song A'] },
    { type: 'save_lyrics', song: 'Song A', text: '[00:01.00] Hello' },
    { type: 'profile_create', name: 'Main set' },
    { type: 'profile_select', id: 'profile-1' },
    { type: 'profile_rename', id: 'profile-1', name: 'Encore' },
    { type: 'profile_delete', id: 'profile-1', confirmationName: 'Encore' },
    { type: 'profile_restore', id: 'profile-1' },
  ];

  for (const message of valid) {
    const result = decodeClientMessage(message);
    assert.equal(result.ok, true, JSON.stringify(message));
    assert.deepEqual(result.message, message);
  }
});

test('decoder rejects invalid scalar command fields', () => {
  const invalid = [
    [{ type: 'handshake', clientId: '' }, /clientId/],
    [{ type: 'handshake', clientId: 'x'.repeat(129) }, /clientId/],
    [{ type: 'sync_confirm', stateVersion: Number.NaN }, /stateVersion/],
    [{ type: 'sync_confirm', stateVersion: 1.5 }, /stateVersion/],
    [{ type: 'get_lyrics', song: '' }, /song/],
    [{ type: 'get_lyrics', song: 7 }, /song/],
    [{ type: 'metronome', value: 'yes' }, /value/],
    [{ type: 'set_pre_roll', value: 1 }, /value/],
    [{ type: 'set_quantization', value: 6.5 }, /value/],
    [{ type: 'set_quantization', value: 99 }, /value/],
    [{ type: 'jump', songIndex: -1 }, /songIndex/],
    [{ type: 'jump', songIndex: 0, sectionIndex: -1 }, /sectionIndex/],
    [{ type: 'click_preview', bpm: 0 }, /bpm/],
    [{ type: 'click_preview', beats: Number.POSITIVE_INFINITY }, /beats/],
    [{ type: 'set_panic', active: 1 }, /active/],
    [{ type: 'set_critical_lock', locked: 'false' }, /locked/],
    [{ type: 'set_mode', mode: 'production' }, /mode/],
  ];

  for (const [message, pattern] of invalid) expectInvalid(message, pattern);
});

test('decoder canonicalizes the pre-roll toggle and drops unexpected fields', () => {
  const result = decodeClientMessage({ type: 'set_pre_roll', value: true, ignored: 'drop-me' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.message, { type: 'set_pre_roll', value: true });
});

test('decoder rejects C0 and C1 controls in every structured text field', () => {
  const invalid = [
    [{ type: 'handshake', clientId: 'browser\nsetlist' }, /clientId/],
    [{ type: 'get_lyrics', song: 'Song\rA' }, /song/],
    [{ type: 'save_lyrics', song: 'Song\tA', text: 'valid' }, /song/],
    [{ type: 'reorder', songTitles: ['Song A', 'Song\u0085B'] }, /songTitles/],
    [{ type: 'profile_create', name: 'Main\u009fSet' }, /name/],
    [{ type: 'profile_select', id: 'profile\n1' }, /id/],
    [{ type: 'profile_rename', id: 'profile-1', name: 'En\rcore' }, /name/],
    [{ type: 'profile_delete', id: 'profile\t1', confirmationName: 'Encore' }, /id/],
    [{ type: 'profile_delete', id: 'profile-1', confirmationName: 'En\u0080core' }, /confirmationName/],
    [{ type: 'profile_restore', id: 'profile\u009f1' }, /id/],
  ];

  for (const [message, pattern] of invalid) expectInvalid(message, pattern);
});

test('decoder keeps multiline lyrics body validation separate from structured text', () => {
  const message = {
    type: 'save_lyrics',
    song: 'Song A',
    text: '[00:01.00] First line\r\n[00:02.00]\tSecond line',
  };

  const result = decodeClientMessage(message);
  assert.equal(result.ok, true);
  assert.deepEqual(result.message, message);
});

test('decoder constructs canonical messages without retaining unexpected properties', () => {
  const cases = [
    [{ type: 'play', raw: 'hostile\nvalue' }, { type: 'play' }],
    [
      { type: 'get_lyrics', song: 'Song A', token: 'secret' },
      { type: 'get_lyrics', song: 'Song A' },
    ],
    [
      { type: 'jump', songIndex: 2, sectionIndex: null, commandId: 'jump-1', extra: { nested: true } },
      { type: 'jump', songIndex: 2, sectionIndex: null, commandId: 'jump-1' },
    ],
    [
      { type: 'profile_rename', id: 'profile-1', name: 'Encore', confirmationName: 'unused' },
      { type: 'profile_rename', id: 'profile-1', name: 'Encore' },
    ],
  ];

  for (const [input, expected] of cases) {
    const result = decodeClientMessage(input);
    assert.equal(result.ok, true);
    assert.deepEqual(result.message, expected);
  }
});

test('decoder rejects malformed reorder values but preserves duplicate song titles', () => {
  expectInvalid({ type: 'reorder', songTitles: 'Song A' }, /songTitles/);
  expectInvalid({ type: 'reorder', songTitles: ['Song A', 7] }, /songTitles/);
  expectInvalid({ type: 'reorder', songTitles: [''] }, /songTitles/);
  expectInvalid({ type: 'reorder', songTitles: ['x'.repeat(257)] }, /songTitles/);

  const duplicateTitles = decodeClientMessage({
    type: 'reorder',
    songTitles: ['Repeated', 'Song B', 'Repeated'],
    commandId: 'reorder-1',
  });
  assert.equal(duplicateTitles.ok, true, 'duplicate song titles are valid in existing setlists');
  assert.deepEqual(duplicateTitles.message.songTitles, ['Repeated', 'Song B', 'Repeated']);
});

test('decoder bounds lyrics and profile mutation fields', () => {
  expectInvalid({ type: 'save_lyrics', song: '', text: 'x' }, /song/);
  expectInvalid({ type: 'save_lyrics', song: 'Song A', text: 7 }, /text/);
  expectInvalid({ type: 'save_lyrics', song: 'Song A', text: 'x'.repeat(96 * 1024 + 1) }, /text/);
  expectInvalid({ type: 'profile_create', name: ' ' }, /name/);
  expectInvalid({ type: 'profile_select', id: '' }, /id/);
  expectInvalid({ type: 'profile_select', id: 'x'.repeat(129) }, /id/);
  expectInvalid({ type: 'profile_rename', id: '', name: 'Encore' }, /id/);
  expectInvalid({ type: 'profile_rename', id: 'p1', name: 'x'.repeat(81) }, /name/);
  expectInvalid({ type: 'profile_delete', id: '', confirmationName: 'Encore' }, /id/);
  expectInvalid({ type: 'profile_delete', id: 'p1', confirmationName: '' }, /confirmationName/);
  expectInvalid({ type: 'profile_restore', id: '' }, /id/);
  expectInvalid({ type: 'profile_restore', id: 1 }, /id/);
});

test('decoder returns only a safe valid commandId on failures', () => {
  const safeId = expectInvalid({ type: 'metronome', value: 'yes', commandId: 'metronome-1' }, /value/);
  assert.equal(safeId.commandId, 'metronome-1');

  const hostileId = expectInvalid({ type: 'metronome', value: 'yes', commandId: 'bad\nvalue' }, /commandId/);
  assert.equal(hostileId.commandId, undefined);
  assert.doesNotMatch(hostileId.message, /bad|value\n/);
});
