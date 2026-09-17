// Lyrics persistence: writing a `.lrc` (or `.txt`) for the active song into
// the lyrics folder of the active profile, then broadcasting the parsed result
// so every connected client re-renders the synchronized view.
import * as path from 'node:path';
import { bridgeState, loadLyricsForSong } from '../../runtime/bridge-state.js';
import { OperatorError } from '../../core/operator-error.js';
import {
  capturePersistenceScope,
  assertPersistenceScopeCurrent,
  type ClientMessageOf,
} from './shared.js';
import type { atomicWriteFile } from '../../util/atomic-write.js';

/**
 * ExecuteSaveLyricsCommand — implementation detail.
 */
export async function executeSaveLyricsCommand(
  msg: ClientMessageOf<'save_lyrics'>,
  writeFile: typeof atomicWriteFile,
): Promise<void> {
  const scope = capturePersistenceScope();
  if (scope.manager.getState().mode === 'show') {
    throw new OperatorError('Cannot save or modify lyrics in Show mode.');
  }

  try {
    const cleanTitle = msg.song.replace(/[\\/:*?"<>|]/g, '_').trim();
    const lrcPath = path.join(scope.paths.lyrics, `${cleanTitle}.lrc`);
    await writeFile(lrcPath, msg.text);
    assertPersistenceScopeCurrent(scope);
    console.log(`[Lyrics] Saved synchronized lyrics for "${msg.song}".`);
    bridgeState.wsServer?.broadcastLog(`Synchronized lyrics for "${msg.song}" saved.`, 'info');

    const lyrics = loadLyricsForSong(msg.song);
    bridgeState.wsServer?.broadcast({
      type: 'lyrics',
      song: msg.song,
      format: lyrics.type,
      lines: lyrics.lines,
    });
  } catch (err) {
    console.error('[Lyrics] Failed to save synchronized lyrics.');
    bridgeState.wsServer?.broadcastLog('Could not save lyrics.', 'error');
    throw err;
  }
}
