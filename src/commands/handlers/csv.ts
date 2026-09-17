// CSV export of the active setlist. The rows carry the duration the UI is
// showing (computed from the frozen tempo base), not Live's current tempo at
// the moment of the export, so the file always agrees with the screen it came
// from.
import * as path from 'node:path';
import { bridgeState, loadLyricsForSong } from '../../runtime/bridge-state.js';
import {
  buildTracklistCsv,
  csvFilenameTimestamp,
  formatDuration,
  formatSongAutomations,
  formatSongSections,
  type CsvTracklistRow,
} from '../../core/csv-export.js';
import { capturePersistenceScope, assertPersistenceScopeCurrent } from './shared.js';
import type { AugmentedWebSocket } from '../../types.js';
import type { atomicWriteFile } from '../../util/atomic-write.js';

/**
 * ExecuteExportCsvCommand — implementation detail.
 */
export async function executeExportCsvCommand(
  ws: AugmentedWebSocket | undefined,
  writeFile: typeof atomicWriteFile,
): Promise<void> {
  const scope = capturePersistenceScope();
  try {
    const state = scope.manager.getState();
    if (!state || !state.songs.length) {
      bridgeState.wsServer?.broadcastLog('There are no songs in the setlist to export.', 'warn');
    } else {
      const activeSetlistName = scope.profileManager.getActive().name;
      const rows: CsvTracklistRow[] = state.songs.map((song, idx) => {
        const durationSec = song.durationSeconds ?? null;

        let lyricCount = 0;
        try {
          const lyrics = loadLyricsForSong(song.title);
          if (lyrics && lyrics.lines) {
            lyricCount = lyrics.lines.length;
          }
        } catch {
          // swallow: nothing to do here on purpose
        }

        const sectionSummary = formatSongSections(song);

        return {
          index: idx + 1,
          setlist: activeSetlistName,
          title: song.title,
          startBeat: song.time,
          bpm: song.bpm,
          durationSec,
          duration: formatDuration(durationSec),
          sectionsCount: sectionSummary.count,
          sections: sectionSummary.names,
          automations: formatSongAutomations(song),
          lyricLines: lyricCount,
        };
      });
      const csv = buildTracklistCsv(rows);
      const stamp = csvFilenameTimestamp();
      const fileName = `tracklist-${stamp}.csv`;
      const fullPath = path.join(scope.paths.exports, fileName);
      await writeFile(fullPath, csv);
      assertPersistenceScopeCurrent(scope);
      console.log(`[CSV] Wrote tracklist export (${rows.length} rows).`);
      bridgeState.wsServer?.broadcastLog(
        `Tracklist exported: ${fileName} (${rows.length} songs)`,
        'info',
      );

      if (ws && ws.readyState === 1 /* OPEN */) {
        ws.send(
          JSON.stringify({
            type: 'csv_ready',
            url: `/exports/${fileName}`,
            count: rows.length,
            fileName,
          }),
        );
      }
    }
  } catch (err) {
    console.error('[CSV] Failed to export tracklist.');
    bridgeState.wsServer?.broadcastLog('Could not export CSV.', 'error');
    throw err;
  }
}
