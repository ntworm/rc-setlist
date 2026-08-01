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
  for (const value of [null, undefined, [], 'play', 42, {}, { type: '' }, { type: 'destroy_everything' }]) {
    expectInvalid(value, /message|type/i);
  }
});

test('decoder bounds message types without reflecting unsafe input', () => {
  const sentinel = `unsupported-${'x'.repeat(256)}\nsecret`;
  const result = decodeClientMessage({ type: sentinel });

  assert.equal(result.ok, false);
  assert.doesNotMatch(result.message, /secret/);
});

test('decoder validates command identifiers without echoing unsafe values', () => {
  const safe = decodeClientMessage({ type: 'play', commandId: 'play-123_A' });
  assert.equal(safe.ok, true);

  const controlCharacters = expectInvalid({ type: 'play', commandId: 'bad\nvalue' }, /commandId/);
  assert.equal(controlCharacters.commandId, undefined);
  expectInvalid({ type: 'play', commandId: 'x'.repeat(129) }, /commandId/);
  expectInvalid({ type: 'play', commandId: 12 }, /commandId/);
});

test('decoder accepts valid read and transport messages, including legacy commands without IDs', () => {
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
    { type: 'set_quantization', value: 11 },
    { type: 'jump', songIndex: 2, sectionIndex: null },
    { type: 'jump', songIndex: 2, sectionIndex: 3 },
    { type: 'click_preview', bpm: 120, beats: 4 },
    { type: 'set_panic', active: true },
    { type: 'set_critical_lock', locked: false },
    { type: 'set_mode', mode: 'show' },
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
    [{ type: 'sync_confirm', stateVersion: Number.NaN }, /stateVersion/],
    [{ type: 'get_lyrics', song: 7 }, /song/],
    [{ type: 'metronome', value: 'yes' }, /value/],
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

test('decoder prevents malformed reorder data from reaching persistence', () => {
  expectInvalid({ type: 'reorder', songTitles: 'Song A' }, /songTitles/);
  expectInvalid({ type: 'reorder', songTitles: ['Song A', 7] }, /songTitles/);
  expectInvalid({ type: 'reorder', songTitles: ['Song A', 'Song A'] }, /duplicate/);
  expectInvalid({ type: 'reorder', songTitles: [''] }, /songTitles/);

  const result = decodeClientMessage({
    type: 'reorder',
    songTitles: ['Song B', 'Song A'],
    commandId: 'reorder-1',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.message.songTitles, ['Song B', 'Song A']);
});

test('decoder bounds lyrics and profile mutation fields', () => {
  expectInvalid({ type: 'save_lyrics', song: '', text: 'x' }, /song/);
  expectInvalid({ type: 'save_lyrics', song: 'Song A', text: 7 }, /text/);
  expectInvalid({ type: 'save_lyrics', song: 'Song A', text: 'x'.repeat(96 * 1024 + 1) }, /text/);
  expectInvalid({ type: 'profile_create', name: ' ' }, /name/);
  expectInvalid({ type: 'profile_select', id: '' }, /id/);
  expectInvalid({ type: 'profile_rename', id: 'p1', name: 'x'.repeat(81) }, /name/);
  expectInvalid({ type: 'profile_delete', id: 'p1', confirmationName: '' }, /confirmationName/);
  expectInvalid({ type: 'profile_restore', id: 1 }, /id/);

  const valid = [
    { type: 'save_lyrics', song: 'Song A', text: '[00:01.00] Hello', commandId: 'lyrics-1' },
    { type: 'profile_create', name: 'Main set' },
    { type: 'profile_select', id: 'profile-1' },
    { type: 'profile_rename', id: 'profile-1', name: 'Encore' },
    { type: 'profile_delete', id: 'profile-1', confirmationName: 'Encore' },
    { type: 'profile_restore', id: 'profile-1' },
  ];
  for (const message of valid) assert.equal(decodeClientMessage(message).ok, true);
});
