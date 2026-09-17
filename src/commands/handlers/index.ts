// Dispatcher for every Show command. The switch is a table; the per-family
// work lives in `handlers/transport.ts`, `handlers/profiles.ts`,
// `handlers/lyrics.ts`, `handlers/song-book.ts`, `handlers/editor.ts`, and
// `handlers/csv.ts`. Shape validation stays in `server/client-message.ts`;
// this module only decides where the validated message goes.
import type { ShowCommand, AugmentedWebSocket, ClientMessage } from '../../types.js';
import { bridgeState, broadcastState } from '../../runtime/bridge-state.js';
import { atomicWriteFile } from '../../util/atomic-write.js';
import { OperatorError } from '../../core/operator-error.js';
import { executeClickPreviewCommand } from './transport.js';
import {
  executeProfileCreate,
  executeProfileSelect,
  executeProfileRename,
  executeProfileDelete,
  executeProfileRestore,
  executeReorderCommand,
} from './profiles.js';
import { executeSaveLyricsCommand } from './lyrics.js';
import { executeSetSongColor, executeSetSongNotes } from './song-book.js';
import { executeEditLocatorCommand } from './editor.js';
import { executeExportCsvCommand } from './csv.js';

// Dispatcher-only exports: per-family helpers live in their own modules
// (`./transport.js`, `./profiles.js`, ...) and are imported there directly
// by tests and other callers. The earlier re-export block was removed in
// P04 batch A as dead surface — see `internal/CODE-HYGIENE-1.0.md`.

export interface CommandActionDependencies {
  writeFile?: typeof atomicWriteFile;
}

let countInTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * ExecuteCommandAction — implementation detail.
 */
export async function executeCommandAction(
  command: ShowCommand,
  ws?: AugmentedWebSocket,
  dependencies: CommandActionDependencies = {},
): Promise<void> {
  const msg = { ...(command.payload as object), type: command.type } as ClientMessage;
  const writeFile = dependencies.writeFile ?? atomicWriteFile;

  const requiresOsc = new Set(['play', 'stop', 'metronome', 'refresh', 'jump', 'set_quantization', 'trigger_count_in']);
  if (requiresOsc.has(msg.type) && !bridgeState.oscClient) {
    throw new OperatorError('OSC client is not initialized.');
  }
  if (msg.type === 'set_panic' && msg.active && !bridgeState.oscClient) {
    throw new OperatorError('OSC client is not initialized.');
  }
  if (
    bridgeState.profileScopeSwitching &&
    [
      'profile_create',
      'profile_select',
      'profile_rename',
      'profile_delete',
      'profile_restore',
    ].includes(msg.type)
  ) {
    throw new OperatorError('Cannot modify setlists while the current Live Set is changing.');
  }

  const osc = bridgeState.oscClient!;

  switch (msg.type) {
    case 'trigger_count_in':
      if (countInTimeoutId) clearTimeout(countInTimeoutId);
      bridgeState.wsServer?.broadcast({ type: 'count_in_started', sendPlayOffsetMs: msg.sendPlayOffsetMs });
      countInTimeoutId = setTimeout(() => {
        countInTimeoutId = null;
        if (bridgeState.manager!.shouldContinuePlayback()) osc.continuePlaying();
        else osc.startPlaying();
      }, msg.sendPlayOffsetMs);
      break;
    case 'play':
      if (countInTimeoutId) { clearTimeout(countInTimeoutId); countInTimeoutId = null; }
      // The count is produced in the browser (static/setlist/count-in.js);
      // Live is told to resume when the transport last came to rest, or to
      // start from the start marker after a jump or a click.
      if (bridgeState.manager!.shouldContinuePlayback()) osc.continuePlaying();
      else osc.startPlaying();
      break;
    case 'stop':
      if (countInTimeoutId) { clearTimeout(countInTimeoutId); countInTimeoutId = null; }
      // Stop disarms a jump waiting for its quantization boundary; Live
      // cancels an armed cue jump on Stop too, so the page's `jump_cancelled`
      // stays truthful.
      if (bridgeState.scheduler?.hasPending()) {
        bridgeState.scheduler.clearPending();
        bridgeState.wsServer?.broadcast({ type: 'jump_cancelled' });
      }
      osc.stopPlaying();
      break;
    case 'metronome':
      osc.setMetronome(msg.value);
      bridgeState.manager!.updateMetronome(msg.value);
      broadcastState();
      break;
    case 'set_pre_roll':
      bridgeState.manager!.setPreRollEnabled(msg.value);
      broadcastState();
      break;
    case 'refresh':
      osc.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
      bridgeState.manager!.clearLoop();
      osc.getCuePoints();
      break;
    case 'jump': {
      const { executeJumpCommand } = await import('./transport.js');
      executeJumpCommand(msg);
      break;
    }
    case 'reorder':
      await executeReorderCommand(msg, writeFile);
      break;
    case 'save_lyrics':
      await executeSaveLyricsCommand(msg, writeFile);
      break;
    case 'click_preview':
      await executeClickPreviewCommand(msg, ws, writeFile);
      break;
    case 'export_csv':
      await executeExportCsvCommand(ws, writeFile);
      break;
    case 'set_quantization':
      osc.setClipTriggerQuantization(msg.value);
      bridgeState.manager!.updateQuantization(msg.value);
      broadcastState();
      break;
    case 'set_panic':
      bridgeState.manager!.setPanic(msg.active);
      if (msg.active) {
        osc.stopPlaying();
        bridgeState.manager!.clearLoop();
      }
      broadcastState();
      break;
    case 'set_critical_lock':
      bridgeState.manager!.setCriticalCommandsLocked(msg.locked);
      broadcastState();
      break;
    case 'set_mode':
      bridgeState.manager!.setMode(msg.mode);
      broadcastState();
      break;
    case 'profile_create':
      await executeProfileCreate(msg.name);
      break;
    case 'profile_select':
      await executeProfileSelect(msg.id);
      break;
    case 'profile_rename':
      await executeProfileRename(msg.id, msg.name);
      break;
    case 'profile_delete':
      await executeProfileDelete(msg.id, msg.confirmationName);
      break;
    case 'profile_restore':
      await executeProfileRestore(msg.id);
      break;
    case 'edit_locator':
      await executeEditLocatorCommand(msg);
      break;
    case 'set_song_color':
      executeSetSongColor(msg);
      break;
    case 'set_song_notes':
      executeSetSongNotes(msg);
      break;
  }
}
