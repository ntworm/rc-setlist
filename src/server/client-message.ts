type BaseMessage = {
  type: string;
  commandId?: string;
};

export type ClientMessage =
  | (BaseMessage & { type: 'handshake'; clientId: string })
  | (BaseMessage & { type: 'sync_confirm'; stateVersion: number })
  | (BaseMessage & { type: 'get_lyrics'; song?: string })
  | (BaseMessage & { type: 'profiles_get' })
  | (BaseMessage & { type: 'preflight_check' })
  | (BaseMessage & { type: 'play' })
  | (BaseMessage & { type: 'stop' })
  | (BaseMessage & { type: 'refresh' })
  | (BaseMessage & { type: 'export_csv' })
  | (BaseMessage & { type: 'create_test_session' })
  | (BaseMessage & { type: 'metronome'; value: boolean })
  | (BaseMessage & { type: 'set_quantization'; value: number })
  | (BaseMessage & { type: 'jump'; songIndex: number; sectionIndex?: number | null })
  | (BaseMessage & { type: 'reorder'; songTitles: string[] })
  | (BaseMessage & { type: 'save_lyrics'; song: string; text: string })
  | (BaseMessage & { type: 'click_preview'; bpm?: number; beats?: number })
  | (BaseMessage & { type: 'set_panic'; active: boolean })
  | (BaseMessage & { type: 'set_critical_lock'; locked: boolean })
  | (BaseMessage & { type: 'set_mode'; mode: 'rehearsal' | 'show' })
  | (BaseMessage & { type: 'profile_create'; name: string })
  | (BaseMessage & { type: 'profile_select'; id: string })
  | (BaseMessage & { type: 'profile_restore'; id: string })
  | (BaseMessage & { type: 'profile_rename'; id: string; name: string })
  | (BaseMessage & { type: 'profile_delete'; id: string; confirmationName: string });

export type DecodeClientMessageResult =
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

function isBoundedText(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === 'string'
    && value.length <= maxLength
    && (allowEmpty || value.trim().length > 0)
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

function safeCommandId(value: unknown): string | undefined {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_COMMAND_ID_LENGTH
    && COMMAND_ID_PATTERN.test(value)
    ? value
    : undefined;
}

function invalid(message: string, commandId?: string): DecodeClientMessageResult {
  return commandId
    ? { ok: false, code: 'invalid_message', message, commandId }
    : { ok: false, code: 'invalid_message', message };
}

export function decodeClientMessage(input: unknown): DecodeClientMessageResult {
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
  const requireText = (field: string, max: number, allowEmpty = false): boolean => {
    return isBoundedText(input[field], max, allowEmpty);
  };

  switch (input.type) {
    case 'handshake':
      if (!requireText('clientId', MAX_CLIENT_ID_LENGTH)) return fail('Invalid clientId.');
      break;
    case 'sync_confirm':
      if (!isFiniteInteger(input.stateVersion, 0, Number.MAX_SAFE_INTEGER)) return fail('Invalid stateVersion.');
      break;
    case 'get_lyrics':
      if (input.song !== undefined && !isBoundedText(input.song, MAX_SONG_TITLE_LENGTH, true)) return fail('Invalid song.');
      break;
    case 'profiles_get':
    case 'preflight_check':
    case 'play':
    case 'stop':
    case 'refresh':
    case 'export_csv':
    case 'create_test_session':
      break;
    case 'metronome':
      if (typeof input.value !== 'boolean') return fail('Invalid value for metronome.');
      break;
    case 'set_quantization':
      if (!isFiniteInteger(input.value, 0, 13)) return fail('Invalid value for quantization.');
      break;
    case 'jump':
      if (!isFiniteInteger(input.songIndex, 0, 100_000)) return fail('Invalid songIndex.');
      if (input.sectionIndex !== undefined && input.sectionIndex !== null
        && !isFiniteInteger(input.sectionIndex, 0, 100_000)) return fail('Invalid sectionIndex.');
      break;
    case 'reorder': {
      if (!Array.isArray(input.songTitles) || input.songTitles.length > MAX_REORDER_SONGS
        || !input.songTitles.every((title) => isBoundedText(title, MAX_SONG_TITLE_LENGTH))) {
        return fail('Invalid songTitles; expected a bounded array of non-empty strings.');
      }
      break;
    }
    case 'save_lyrics':
      if (!requireText('song', MAX_SONG_TITLE_LENGTH)) return fail('Invalid song.');
      if (typeof input.text !== 'string' || input.text.length > MAX_LYRICS_LENGTH || input.text.includes('\u0000')) {
        return fail('Invalid text for lyrics.');
      }
      break;
    case 'click_preview':
      if (input.bpm !== undefined && !isBoundedNumber(input.bpm, 1, 999)) return fail('Invalid bpm.');
      if (input.beats !== undefined && !isFiniteInteger(input.beats, 1, 64)) return fail('Invalid beats.');
      break;
    case 'set_panic':
      if (typeof input.active !== 'boolean') return fail('Invalid active flag.');
      break;
    case 'set_critical_lock':
      if (typeof input.locked !== 'boolean') return fail('Invalid locked flag.');
      break;
    case 'set_mode':
      if (input.mode !== 'rehearsal' && input.mode !== 'show') return fail('Invalid mode.');
      break;
    case 'profile_create':
      if (!requireText('name', MAX_PROFILE_FIELD_LENGTH)) return fail('Invalid profile name.');
      break;
    case 'profile_select':
    case 'profile_restore':
      if (!requireText('id', MAX_COMMAND_ID_LENGTH)) return fail('Invalid profile id.');
      break;
    case 'profile_rename':
      if (!requireText('id', MAX_COMMAND_ID_LENGTH)) return fail('Invalid profile id.');
      if (!requireText('name', MAX_PROFILE_FIELD_LENGTH)) return fail('Invalid profile name.');
      break;
    case 'profile_delete':
      if (!requireText('id', MAX_COMMAND_ID_LENGTH)) return fail('Invalid profile id.');
      if (!requireText('confirmationName', MAX_PROFILE_FIELD_LENGTH)) return fail('Invalid confirmationName.');
      break;
    default:
      return fail(`Unsupported message type: ${input.type}.`);
  }

  return { ok: true, message: input as ClientMessage };
}
