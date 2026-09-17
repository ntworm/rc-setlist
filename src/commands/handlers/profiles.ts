// Profile-scope commands: create/select/rename/delete/restore and the custom
// reorder, all of which are blocked while the transport is playing in any
// mode. The capture/assert helpers live in `./index.ts` because both
// `lyrics.ts` and `csv.ts` rely on them too.
import { bridgeState, broadcastProfileState, selectProfile } from '../../runtime/bridge-state.js';
import { OperatorError } from '../../core/operator-error.js';
import {
  capturePersistenceScope,
  assertPersistenceScopeCurrent,
  type ClientMessageOf,
} from './shared.js';
import type { atomicWriteFile } from '../../util/atomic-write.js';

/**
 * ExecuteProfileCreate — implementation detail.
 */
export async function executeProfileCreate(name: string): Promise<void> {
  if (bridgeState.manager!.getState().isPlaying) {
    throw new OperatorError('Cannot create profile while transport is playing.');
  }
  const newProfile = await bridgeState.profileManager!.create(name);
  await selectProfile(newProfile.id);
}

/**
 * ExecuteProfileSelect — implementation detail.
 */
export async function executeProfileSelect(id: string): Promise<void> {
  if (bridgeState.manager!.getState().isPlaying) {
    throw new OperatorError('Cannot select profile while transport is playing.');
  }
  await selectProfile(id);
}

/**
 * ExecuteProfileRename — implementation detail.
 */
export async function executeProfileRename(id: string, name: string): Promise<void> {
  if (bridgeState.manager!.getState().isPlaying) {
    throw new OperatorError('Cannot rename profile while transport is playing.');
  }
  await bridgeState.profileManager!.rename(id, name);
  broadcastProfileState();
}

/**
 * ExecuteProfileDelete — implementation detail.
 */
export async function executeProfileDelete(id: string, confirmationName: string): Promise<void> {
  if (bridgeState.manager!.getState().isPlaying) {
    throw new OperatorError('Cannot remove profile while transport is playing.');
  }
  await bridgeState.profileManager!.remove(id, confirmationName);
  broadcastProfileState();
}

/**
 * ExecuteProfileRestore — implementation detail.
 */
export async function executeProfileRestore(id: string): Promise<void> {
  if (bridgeState.manager!.getState().isPlaying) {
    throw new OperatorError('Cannot restore profile while transport is playing.');
  }
  await bridgeState.profileManager!.restore(id);
  broadcastProfileState();
}

function validateOrder(
  songTitles: string[],
  manager: NonNullable<typeof bridgeState.manager>,
): void {
  const songs = manager.getState().songs;
  if (songTitles.length !== songs.length || songTitles.length === 0) {
    throw new OperatorError('Reorder must contain every song exactly once.');
  }

  const remainingByTitle = new Map<string, number>();
  for (const { title } of songs) {
    remainingByTitle.set(title, (remainingByTitle.get(title) ?? 0) + 1);
  }
  for (const title of songTitles) {
    const remaining = remainingByTitle.get(title) ?? 0;
    if (remaining === 0) {
      throw new OperatorError('Reorder contains an unknown or duplicate song occurrence.');
    }
    remainingByTitle.set(title, remaining - 1);
  }
}

/**
 * ExecuteReorderCommand — implementation detail.
 */
export async function executeReorderCommand(
  msg: ClientMessageOf<'reorder'>,
  writeFile: typeof atomicWriteFile,
): Promise<void> {
  const scope = capturePersistenceScope();
  if (scope.manager.getState().mode === 'show' && scope.manager.getState().isPlaying) {
    throw new OperatorError('Cannot reorder setlist while transport is playing in Show mode.');
  }

  const { songTitles } = msg;
  try {
    validateOrder(songTitles, scope.manager);
    await writeFile(scope.paths.customOrder, JSON.stringify(songTitles, null, 2));
    assertPersistenceScopeCurrent(scope);
    scope.manager.setCustomOrder(songTitles);
    console.log('[Persistence] Custom song order saved.');
    bridgeState.wsServer?.broadcastLog('Custom song order saved.', 'info');
    broadcastProfileState();
  } catch (err) {
    console.error('[Persistence] Failed to save custom song order.');
    bridgeState.wsServer?.broadcastLog('Could not save the custom song order.', 'error');
    throw err;
  }
}
