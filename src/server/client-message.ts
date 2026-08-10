import type { ClientMessage } from '../types.js';

export type { ClientMessage } from '../types.js';

export type DecodeResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: 'invalid_message'; message: string; commandId?: string };

const COMMAND_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MESSAGE_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_COMMAND_ID_LENGTH = 128;
const MAX_CLIENT_ID_LENGTH = 128;
const MAX_PROFILE_FIELD_LENGTH = 80;
const MAX_SONG_TITLE_LENGTH = 255;
const MAX_LYRICS_LENGTH = 96 * 1024;
const MAX_REORDER_SONGS = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length <= maxLength
    && value.trim().length > 0
    && !/[\u0000-\u001F\u007F-\u009F]/.test(value);
}

function safeCommandId(value: unknown): string | undefined {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_COMMAND_ID_LENGTH
    && COMMAND_ID_PATTERN.test(value)
    ? value
    : undefined;
}

function invalid(message: string, commandId?: string): DecodeResult {
  return commandId
    ? { ok: false, code: 'invalid_message', message, commandId }
    : { ok: false, code: 'invalid_message', message };
}

export function decodeClientMessage(input: unknown): DecodeResult {
  if (!isRecord(input)) return invalid('Message must be a JSON object.');
  if (typeof input.type !== 'string' || !MESSAGE_TYPE_PATTERN.test(input.type)) {
    return invalid('Message type must use 1-64 lowercase ASCII letters, digits, or underscores.');
  }

  const hasCommandId = Object.prototype.hasOwnProperty.call(input, 'commandId');
  const commandId = safeCommandId(input.commandId);
  if (hasCommandId && !commandId) {
    return invalid(`Invalid commandId; expected 1-${MAX_COMMAND_ID_LENGTH} safe characters.`);
  }

  const fail = (message: string) => invalid(message, commandId);
  const success = (message: ClientMessage): DecodeResult => ({
    ok: true,
    message: commandId ? { ...message, commandId } : message,
  });
  const requireText = (field: string, max: number): boolean => isBoundedText(input[field], max);

  switch (input.type) {
    case 'handshake':
      if (!requireText('clientId', MAX_CLIENT_ID_LENGTH)) return fail('Invalid clientId.');
      return success({ type: 'handshake', clientId: input.clientId as string });
    case 'sync_confirm':
      if (!isFiniteInteger(input.stateVersion, 0, Number.MAX_SAFE_INTEGER)) return fail('Invalid stateVersion.');
      return success({ type: 'sync_confirm', stateVersion: input.stateVersion });
    case 'get_lyrics':
      if (input.song !== undefined && !isBoundedText(input.song, MAX_SONG_TITLE_LENGTH)) return fail('Invalid song.');
      return success(input.song === undefined
        ? { type: 'get_lyrics' }
        : { type: 'get_lyrics', song: input.song });
    case 'profiles_get':
      return success({ type: 'profiles_get' });
    case 'preflight_check':
      return success({ type: 'preflight_check' });
    case 'play':
      return success({ type: 'play' });
    case 'stop':
      return success({ type: 'stop' });
    case 'refresh':
      return success({ type: 'refresh' });
    case 'export_csv':
      return success({ type: 'export_csv' });
    case 'create_test_session':
      return success({ type: 'create_test_session' });
    case 'metronome':
      if (typeof input.value !== 'boolean') return fail('Invalid value for metronome.');
      return success({ type: 'metronome', value: input.value });
    case 'set_pre_roll':
      if (typeof input.value !== 'boolean') return fail('Invalid value for pre-roll.');
      return success({ type: 'set_pre_roll', value: input.value });
    case 'set_quantization':
      if (!isFiniteInteger(input.value, 0, 13)) return fail('Invalid value for quantization.');
      return success({ type: 'set_quantization', value: input.value });
    case 'jump':
      if (!isFiniteInteger(input.songIndex, 0, 100_000)) return fail('Invalid songIndex.');
      if (input.sectionIndex !== undefined && input.sectionIndex !== null
        && !isFiniteInteger(input.sectionIndex, 0, 100_000)) return fail('Invalid sectionIndex.');
      return success(input.sectionIndex === undefined
        ? { type: 'jump', songIndex: input.songIndex }
        : { type: 'jump', songIndex: input.songIndex, sectionIndex: input.sectionIndex as number | null });
    case 'reorder':
      if (!Array.isArray(input.songTitles) || input.songTitles.length > MAX_REORDER_SONGS
        || !input.songTitles.every((title) => isBoundedText(title, MAX_SONG_TITLE_LENGTH))) {
        return fail('Invalid songTitles; expected a bounded array of non-empty strings.');
      }
      return success({ type: 'reorder', songTitles: [...input.songTitles] as string[] });
    case 'save_lyrics':
      if (!requireText('song', MAX_SONG_TITLE_LENGTH)) return fail('Invalid song.');
      if (typeof input.text !== 'string' || input.text.length > MAX_LYRICS_LENGTH || input.text.includes('\u0000')) {
        return fail('Invalid text for lyrics.');
      }
      return success({ type: 'save_lyrics', song: input.song as string, text: input.text });
    case 'click_preview':
      if (input.bpm !== undefined && !isBoundedNumber(input.bpm, 1, 999)) return fail('Invalid bpm.');
      if (input.beats !== undefined && !isFiniteInteger(input.beats, 1, 64)) return fail('Invalid beats.');
      return success({
        type: 'click_preview',
        ...(input.bpm === undefined ? {} : { bpm: input.bpm }),
        ...(input.beats === undefined ? {} : { beats: input.beats }),
      });
    case 'set_panic':
      if (typeof input.active !== 'boolean') return fail('Invalid active flag.');
      return success({ type: 'set_panic', active: input.active });
    case 'set_critical_lock':
      if (typeof input.locked !== 'boolean') return fail('Invalid locked flag.');
      return success({ type: 'set_critical_lock', locked: input.locked });
    case 'set_mode':
      if (input.mode !== 'rehearsal' && input.mode !== 'show') return fail('Invalid mode.');
      return success({ type: 'set_mode', mode: input.mode });
    case 'profile_create':
      if (!requireText('name', MAX_PROFILE_FIELD_LENGTH)) return fail('Invalid profile name.');
      return success({ type: 'profile_create', name: input.name as string });
    case 'profile_select':
      if (!requireText('id', MAX_COMMAND_ID_LENGTH)) return fail('Invalid profile id.');
      return success({ type: 'profile_select', id: input.id as string });
    case 'profile_restore':
      if (!requireText('id', MAX_COMMAND_ID_LENGTH)) return fail('Invalid profile id.');
      return success({ type: 'profile_restore', id: input.id as string });
    case 'profile_rename':
      if (!requireText('id', MAX_COMMAND_ID_LENGTH)) return fail('Invalid profile id.');
      if (!requireText('name', MAX_PROFILE_FIELD_LENGTH)) return fail('Invalid profile name.');
      return success({ type: 'profile_rename', id: input.id as string, name: input.name as string });
    case 'profile_delete':
      if (!requireText('id', MAX_COMMAND_ID_LENGTH)) return fail('Invalid profile id.');
      if (!requireText('confirmationName', MAX_PROFILE_FIELD_LENGTH)) return fail('Invalid confirmationName.');
      return success({
        type: 'profile_delete',
        id: input.id as string,
        confirmationName: input.confirmationName as string,
      });
    default:
      return fail('Unsupported message type.');
  }
}
