import * as path from 'node:path';
import { WebSocket } from 'ws';
import { ShowCommand, AugmentedWebSocket, type ClientMessage } from '../types.js';
import {
  bridgeState,
  broadcastState,
  broadcastProfileState,
  checkAndBroadcastLyrics,
  selectProfile,
  loadLyricsForSong,
  setSongColorAtTime,
  setSongNotesAtTime,
} from '../core/bridge-state.js';
import {
  buildTracklistCsv,
  csvFilenameTimestamp,
  formatDuration,
  formatSongAutomations,
  formatSongSections,
  type CsvTracklistRow,
} from '../core/csv-export.js';
import { buildClickPreviewWav, clickPreviewFilename } from '../core/click-preview.js';
import { getQuantizationBeats } from '../core/next-downbeat-jump.js';
import { applyJumpTargetTempo } from './jump-tempo.js';
import { parseLocator } from '../core/locator-parser.js';
import { atomicWriteFile } from '../util/atomic-write.js';
import { OperatorError } from './operator-error.js';
import type { ProfilePaths } from '../core/profile-manager.js';

type ClientMessageOf<TType extends ClientMessage['type']> = Extract<ClientMessage, { type: TType }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface CommandActionDependencies {
  writeFile?: typeof atomicWriteFile;
}

interface PersistenceScopeSnapshot {
  profileManager: NonNullable<typeof bridgeState.profileManager>;
  manager: NonNullable<typeof bridgeState.manager>;
  activeProfileId: string;
  paths: ProfilePaths;
  projectIdentityKey: string | null;
  projectSessionId: string;
}

function normalizedProfilePaths(paths: ProfilePaths): ProfilePaths {
  return {
    root: path.resolve(paths.root),
    metadata: path.resolve(paths.metadata),
    lyrics: path.resolve(paths.lyrics),
    customOrder: path.resolve(paths.customOrder),
    songBook: path.resolve(paths.songBook),
    exports: path.resolve(paths.exports),
    audio: path.resolve(paths.audio),
  };
}

function capturePersistenceScope(): PersistenceScopeSnapshot {
  if (bridgeState.profileScopeSwitching) {
    throw new OperatorError('Profile scope is changing. Try the command again.');
  }
  const profileManager = bridgeState.profileManager;
  const manager = bridgeState.manager;
  if (!profileManager || !manager) {
    throw new OperatorError('Profile scope is not initialized.');
  }
  return {
    profileManager,
    manager,
    activeProfileId: profileManager.getActive().id,
    paths: normalizedProfilePaths(profileManager.getActivePaths()),
    projectIdentityKey: bridgeState.projectIdentity?.key ?? null,
    projectSessionId: bridgeState.projectSessionId,
  };
}

function assertPersistenceScopeCurrent(snapshot: PersistenceScopeSnapshot): void {
  const profileManager = bridgeState.profileManager;
  if (
    bridgeState.profileScopeSwitching
    || profileManager !== snapshot.profileManager
    || bridgeState.manager !== snapshot.manager
    || (bridgeState.projectIdentity?.key ?? null) !== snapshot.projectIdentityKey
    || bridgeState.projectSessionId !== snapshot.projectSessionId
  ) {
    throw new OperatorError('Profile scope changed while the command was in progress.');
  }

  const activeProfileId = profileManager.getActive().id;
  const currentPaths = normalizedProfilePaths(profileManager.getActivePaths());
  if (
    activeProfileId !== snapshot.activeProfileId
    || currentPaths.root !== snapshot.paths.root
    || currentPaths.metadata !== snapshot.paths.metadata
    || currentPaths.lyrics !== snapshot.paths.lyrics
    || currentPaths.customOrder !== snapshot.paths.customOrder
    || currentPaths.exports !== snapshot.paths.exports
    || currentPaths.audio !== snapshot.paths.audio
  ) {
    throw new OperatorError('Profile scope changed while the command was in progress.');
  }
}

export async function executeCommandAction(
  command: ShowCommand,
  ws?: AugmentedWebSocket,
  dependencies: CommandActionDependencies = {},
): Promise<void> {
  const msg = { ...(command.payload as object), type: command.type } as ClientMessage;
  const writeFile = dependencies.writeFile ?? atomicWriteFile;

  const requiresOsc = new Set([
    'play', 'stop', 'metronome', 'refresh', 'jump', 'set_quantization'
  ]);
  if (requiresOsc.has(msg.type) && !bridgeState.oscClient) {
    throw new OperatorError('OSC client is not initialized.');
  }
  if (msg.type === 'set_panic' && msg.active && !bridgeState.oscClient) {
    throw new OperatorError('OSC client is not initialized.');
  }
  if (
    bridgeState.profileScopeSwitching &&
    ['profile_create', 'profile_select', 'profile_rename', 'profile_delete', 'profile_restore'].includes(msg.type)
  ) {
    throw new OperatorError('Cannot modify setlists while the current Live Set is changing.');
  }

  const osc = bridgeState.oscClient!;

  switch (msg.type) {
    case 'play':
      // Play starts the transport where it stands, and nothing else.
      //
      // The count-in used to live here: it rewound Live's playhead one bar and
      // started there. That bar is real arrangement time belonging to the
      // previous song, so the count was heard at the previous song's tempo and
      // its audio played too. Making the count audible also meant switching
      // Live's metronome on, which overrode a click the operator had
      // deliberately turned off.
      //
      // The count is now produced in the browser, at the tempo this setlist
      // declares for the playhead, and Play is sent when it finishes. See
      // static/setlist/count-in.js.
      //
      // Live offers a resume and a start-from-the-start-marker, and only one of
      // them plays from where the operator sees the playhead: resume when it
      // has not moved since the transport stopped, start when a jump or a
      // click moved it (both of which move Live's start marker too). See
      // SetlistManager.shouldContinuePlayback.
      if (bridgeState.manager!.shouldContinuePlayback()) osc.continuePlaying();
      else osc.startPlaying();
      break;
    case 'stop':
      /*
       * Stop disarms a jump that was waiting for a quantization boundary.
       *
       * Live cancels a cue jump it has armed when the transport stops
       * (measured on Live 12.4), and this side's landing tracker must agree:
       * left pending, its landing sample would apply the destination's tempo
       * and loop to a transport that never went there, and the page would
       * announce a jump that did not happen.
       *
       * Stop itself is exactly Live's `stop_playing`. Note that a second
       * `stop_playing` while already stopped does nothing over the API
       * (measured): the return to the start marker that Live's own Stop button
       * performs does not happen from here.
       */
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
    case 'jump':
      executeJumpCommand(msg);
      break;
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
      await executeExportCsvCommand(msg, ws, writeFile);
      break;
    case 'set_quantization':
      osc.setClipTriggerQuantization(msg.value);
      // AbletonOSC may be able to receive this setter while its fixed reply
      // port is owned by another RC extension. Keep the operator's requested
      // value authoritative for local jump scheduling until an observed OSC
      // value is available to reconcile it.
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
      if (bridgeState.manager!.getState().isPlaying) {
        throw new OperatorError('Cannot create profile while transport is playing.');
      }
      const newProfile = await bridgeState.profileManager!.create(msg.name);
      await selectProfile(newProfile.id);
      break;
    case 'profile_select':
      if (bridgeState.manager!.getState().isPlaying) {
        throw new OperatorError('Cannot select profile while transport is playing.');
      }
      await selectProfile(msg.id);
      break;
    case 'profile_rename':
      if (bridgeState.manager!.getState().isPlaying) {
        throw new OperatorError('Cannot rename profile while transport is playing.');
      }
      await bridgeState.profileManager!.rename(msg.id, msg.name);
      broadcastProfileState();
      break;
    case 'profile_delete':
      if (bridgeState.manager!.getState().isPlaying) {
        throw new OperatorError('Cannot remove profile while transport is playing.');
      }
      await bridgeState.profileManager!.remove(msg.id, msg.confirmationName);
      broadcastProfileState();
      break;
    case 'profile_restore':
      if (bridgeState.manager!.getState().isPlaying) {
        throw new OperatorError('Cannot restore profile while transport is playing.');
      }
      await bridgeState.profileManager!.restore(msg.id);
      broadcastProfileState();
      break;
    case 'edit_locator':
      await executeEditLocatorCommand(msg);
      break;
    case 'set_song_color': {
      // Colour is RC Setlist's own memory. It never touches the Live project,
      // so it is allowed while playing — unlike a locator rename.
      const applied = setSongColorAtTime(msg.time, msg.color ?? undefined);
      if (applied) broadcastState();
      else bridgeState.wsServer?.broadcastLog('No song is known at that position yet.', 'warn');
      break;
    }
    case 'set_song_notes': {
      // Same memory as the colour: beside the setlist, never in the Live project.
      const applied = setSongNotesAtTime(msg.time, msg.notes ?? undefined);
      if (applied) broadcastState();
      else bridgeState.wsServer?.broadcastLog('No song is known at that position yet.', 'warn');
      break;
    }
  }
}

export function executeJumpCommand(msg: ClientMessageOf<'jump'>): void {
  if (!bridgeState.manager || !bridgeState.scheduler || !bridgeState.oscClient) {
    throw new OperatorError('The transport is not ready.');
  }
  // A jump is an observable command: it is confirmed by the playhead arriving.
  // A target that cannot be resolved must fail now, not expire five seconds
  // later as a timeout the operator cannot explain.
  const song = bridgeState.manager.getState().songs[msg.songIndex];
  if (!song) throw new OperatorError(`Jump target not found (song ${msg.songIndex}).`);

  const wantsSection = msg.sectionIndex !== undefined && msg.sectionIndex !== null && msg.sectionIndex >= 0;
  const section = wantsSection ? song.sections[msg.sectionIndex!] : undefined;
  if (wantsSection && !section) {
    throw new OperatorError(`Jump target not found (song ${msg.songIndex}, section ${msg.sectionIndex}).`);
  }
  const cue = resolveCueAtTime(section ? section.time : song.time);
  if (!cue) {
    throw new OperatorError(`No cue point found at time ${section ? section.time : song.time}.`);
  }
  const { time: targetTime, name: cueName, cueIndex } = cue;

  const mgrState = bridgeState.manager.getState();
  const quantBeats = getQuantizationBeats(mgrState.clipTriggerQuantization, mgrState.signatureNumerator);
  const isImmediate = !mgrState.isPlaying || quantBeats === 0;

  if (isImmediate) {
    bridgeState.scheduler.clearPending();
    applyJumpTargetTempo(msg.songIndex, msg.sectionIndex ?? null);
    bridgeState.oscClient.jumpToCuePoint(cueIndex);

    /*
     * Move this side's playhead to the target straight away, while stopped.
     *
     * Live is only told to jump; where the playhead actually is comes back on
     * the position poll, up to half a second later. The count-in reads the
     * tempo this setlist declares at the playhead, so jumping to a section and
     * pressing Play immediately counted at the tempo of wherever the playhead
     * had been — the rehearsal case this feature exists for.
     *
     * Only while stopped. During playback the same write would evaluate the
     * target's automations before the transport has reached it.
     */
    if (!mgrState.isPlaying && targetTime !== null && Number.isFinite(targetTime)) {
      bridgeState.manager.updateTransport(targetTime, false);
      broadcastState();
    }

    if (msg.sectionIndex !== null && msg.sectionIndex !== undefined) {
      const section = song.sections[msg.sectionIndex];
      if (section && section.loopCount !== null) {
        const loopRegion = bridgeState.manager.getLoopRegion(msg.songIndex, msg.sectionIndex);
        if (loopRegion) {
          bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 1 }]);
          bridgeState.oscClient.send('/live/song/set/loop_start', [{ type: 'float', value: loopRegion.start }]);
          bridgeState.oscClient.send('/live/song/set/loop_length', [{ type: 'float', value: loopRegion.duration }]);
        }
      } else {
        bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
      }
    } else {
      bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
    }

    bridgeState.manager.clearLoop();
    bridgeState.manager.resetFiredAutomations();
    bridgeState.wsServer?.broadcast({
      type: 'jump_executed',
      songIndex: msg.songIndex,
      sectionIndex: msg.sectionIndex ?? null,
    });
  } else {
    /*
     * Live quantizes a cue jump requested while playing to its next
     * global-quantization grid line, so the jump goes out now and Live lands
     * it. The scheduler only tracks the landing: the page shows it, a second
     * request replaces it, Stop disarms it, and the landing sample applies the
     * destination tempo and loop.
     *
     * The request used to be sent on the landing sample instead. That sample
     * is just past the grid line, so Live landed the jump a full quantization
     * period after the beat the page had announced — one bar late, every
     * time. Live cancels an armed cue jump on Stop (measured), which keeps
     * this side's `jump_cancelled` truthful.
     */
    bridgeState.oscClient.jumpToCuePoint(cueIndex);
    bridgeState.scheduler.schedule(
      msg.songIndex,
      msg.sectionIndex ?? null,
      cueName,
      targetTime,
      {
        tempo: mgrState.tempo,
        isPlaying: mgrState.isPlaying,
        signatureNumerator: mgrState.signatureNumerator,
        currentSongTime: mgrState.currentSongTime,
        clipTriggerQuantization: mgrState.clipTriggerQuantization
      },
      cueIndex
    );
  }
}

async function executeReorderCommand(
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
    broadcastState();
  } catch (err) {
    console.error('[Persistence] Failed to save custom song order.');
    bridgeState.wsServer?.broadcastLog('Could not save the custom song order.', 'error');
    throw err;
  }
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

async function executeSaveLyricsCommand(
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
      lines: lyrics.lines
    });
  } catch (err) {
    console.error('[Lyrics] Failed to save synchronized lyrics.');
    bridgeState.wsServer?.broadcastLog('Could not save lyrics.', 'error');
    throw err;
  }
}

async function executeClickPreviewCommand(
  msg: ClientMessageOf<'click_preview'>,
  ws: AugmentedWebSocket | undefined,
  writeFile: typeof atomicWriteFile,
): Promise<void> {
  const scope = capturePersistenceScope();
  try {
    const state = scope.manager.getState();
    const requestedBpm = (typeof msg.bpm === 'number' && msg.bpm > 0)
      ? msg.bpm
      : state?.tempo ?? 120;
    const beats = (typeof msg.beats === 'number' && msg.beats > 0)
      ? msg.beats
      : 4;
    const wav = buildClickPreviewWav({ bpm: requestedBpm, beats });
    const fileName = clickPreviewFilename(requestedBpm, beats);
    const fullPath = path.join(scope.paths.audio, fileName);
    await writeFile(fullPath, wav);
    assertPersistenceScopeCurrent(scope);
    console.log(`[Click] Wrote preview WAV (bpm=${requestedBpm}, beats=${beats}, ${wav.length}B).`);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'click_preview_ready',
        url: `/audio/${fileName}`,
        bpm: requestedBpm,
        beats,
      }));
    }
  } catch (err) {
    console.error('[Click] Failed to generate preview.');
    bridgeState.wsServer?.broadcastLog('Could not generate the click preview.', 'error');
    throw err;
  }
}

async function executeExportCsvCommand(
  msg: ClientMessageOf<'export_csv'>,
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
        // The state already carries the duration the UI is showing, computed
        // from the frozen tempo base. Recomputing here with state.tempo made
        // the CSV scale with whatever Live happened to be playing at the moment
        // of the export, so the file disagreed with the screen it came from.
        const durationSec = song.durationSeconds ?? null;

        let lyricCount = 0;
        try {
          const lyrics = loadLyricsForSong(song.title);
          if (lyrics && lyrics.lines) {
            lyricCount = lyrics.lines.length;
          }
        } catch {}

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
      bridgeState.wsServer?.broadcastLog(`Tracklist exported: ${fileName} (${rows.length} songs)`, 'info');

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'csv_ready',
          url: `/exports/${fileName}`,
          count: rows.length,
          fileName,
        }));
      }
    }
  } catch (err) {
    console.error('[CSV] Failed to export tracklist.');
    bridgeState.wsServer?.broadcastLog('Could not export CSV.', 'error');
    throw err;
  }
}

async function executeEditLocatorCommand(
  msg: ClientMessageOf<'edit_locator'>,
): Promise<void> {
  if (!bridgeState.manager) {
    throw new OperatorError('Setlist manager is not initialized.');
  }
  // A rename moves the playhead to the cue's position to act on it. With the
  // transport rolling, Live services that call wherever playback has advanced
  // to by then, so the write lands at the wrong beat. Blocked in every mode,
  // not only Show.
  if (bridgeState.manager.getState().isPlaying) {
    throw new OperatorError('Cannot edit a locator while the transport is playing. Stop playback first.');
  }

  const { time, name } = msg;

  const parsed = parseLocator(name);
  if (parsed.kind === 'hidden' && parsed.hiddenName === '_empty') {
    throw new OperatorError('Name cannot be empty.');
  }

  const rawCues = bridgeState.manager.getRawCues();
  const matches = rawCues.filter((c) => c.time === time);

  if (matches.length === 0) {
    throw new OperatorError(`No cue point found at time ${time}.`);
  }
  if (matches.length > 1) {
    throw new OperatorError(`Ambiguous cue point at time ${time}: ${matches.length} cues collide.`);
  }

  const existing = matches[0]!;
  if (existing.name === name) {
    // No-op: same name. Treat as success.
    return;
  }

  // One call, and the marker never stops existing.
  //
  // This used to delete the cue point and create a replacement, which is how a
  // rename has to be expressed through the raw Live API: a cue point is made by
  // toggling one at the playhead, so a delete that silently failed turned the
  // create into a second delete and the marker vanished. It also left a window
  // in which the position had no marker at all.
  //
  // Both transports rename in place now: the MCP bridge by beat, RC Bridge and
  // AbletonOSC by the cue's index in Live's chronological list
  // (`/live/song/cue_point/set/name`), which is the index the manager keeps
  // beside each raw cue.
  const renamed = await renameCuePoint(time, name, existing.cueIndex ?? rawCues.indexOf(existing));
  if (renamed.status !== 'confirmed') {
    throw new OperatorError(`Could not rename the cue point at ${time}: ${renamed.message ?? 'unknown error'}`);
  }

  const verdict = await verifyLocator(time, name);
  if (verdict === 'missing') {
    bridgeState.wsServer?.broadcastLog(
      `The locator at ${time} is gone after the rename. Check the Arrangement.`,
      'error',
    );
    requestCueRefresh();
    throw new OperatorError(`Rename left no cue point at ${time}.`);
  }
  if (verdict === 'wrong-name') {
    bridgeState.wsServer?.broadcastLog(
      `Live did not accept the new name for the locator at ${time}.`,
      'error',
    );
    requestCueRefresh();
    throw new OperatorError(`Cue point at ${time} did not take the new name.`);
  }

  bridgeState.wsServer?.broadcastLog(`Locator edited at ${time}.`, 'info');
  requestCueRefresh();
}

async function renameCuePoint(
  beat: number,
  name: string,
  cueIndex: number,
): Promise<{ status: 'confirmed' | 'error'; message?: string }> {
  // Either transport's own success is provisional: verifyLocator reads the
  // cue list back afterwards and that answer is the one that counts.
  if (bridgeState.mcpClient) {
    try {
      await bridgeState.mcpClient.call('create_cue_point', { name, time: beat });
      return { status: 'confirmed' };
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  }
  if (!bridgeState.oscClient || cueIndex < 0) {
    return { status: 'error', message: 'no transport can rename the cue point' };
  }
  return bridgeState.oscClient.setCuePointName(cueIndex, name)
    ? { status: 'confirmed' }
    : { status: 'error', message: 'OSC socket did not accept the rename' };
}

/** The raw cue at a beat with the index Live's cue list gives it, or null. */
function resolveCueAtTime(time: number): { name: string; time: number; cueIndex: number } | null {
  const rawCues = bridgeState.manager?.getRawCues() ?? [];
  const idx = rawCues.findIndex((c) => c.time === time);
  if (idx === -1) return null;
  const cue = rawCues[idx]!;
  return { name: cue.name, time: cue.time, cueIndex: cue.cueIndex ?? idx };
}

/**
 * Read the cue list back and confirm the rename actually took.
 *
 * The bridge reports its own success, and that is not the same as Live having
 * the name. Reporting a rename that did not happen is worse than the failure
 * itself, so this asks Live directly and treats an unreadable answer as unknown
 * rather than as success.
 */
async function verifyLocator(
  time: number,
  name: string,
): Promise<'ok' | 'missing' | 'wrong-name' | 'unknown'> {
  let cues: unknown;
  if (bridgeState.mcpClient) {
    try {
      cues = await bridgeState.mcpClient.call('get_locators', {});
    } catch {
      return 'unknown';
    }
  } else if (bridgeState.oscClient) {
    cues = await bridgeState.oscClient.readCuePoints();
  }
  if (!Array.isArray(cues)) return 'unknown';

  const here = cues.filter((cue) => isRecord(cue) && cue.time === time);
  if (here.length === 0) return 'missing';
  return here.some((cue) => (cue as Record<string, unknown>).name === name) ? 'ok' : 'wrong-name';
}

/**
 * Pull the cue list back from Live now instead of waiting for the poll.
 *
 * Cue points are polled every two seconds, because they rarely change and a
 * tight loop lags a set with two hundred markers. That interval is invisible
 * until something does change them: for up to two seconds after a rename the
 * client still held the old name, so reopening the marker straight away showed
 * stale values and the next save wrote them back — the edit appeared to have
 * been silently dropped, but only when the user was quick.
 *
 * The request is repeated once because Live services the create and the cue
 * query on its own schedule, and a single immediate read can beat the write.
 * Both are free when nothing changed: the cue fingerprint suppresses a
 * re-parse and a re-broadcast.
 */
function requestCueRefresh(): void {
  bridgeState.oscClient?.getCuePoints();
  setTimeout(() => bridgeState.oscClient?.getCuePoints(), 400).unref?.();
}

