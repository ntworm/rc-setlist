import * as path from 'node:path';
import * as net from 'node:net';
import { WebSocket } from 'ws';
import { ShowCommand, AugmentedWebSocket, type ClientMessage } from '../types.js';
import {
  bridgeState,
  broadcastState,
  broadcastProfileState,
  checkAndBroadcastLyrics,
  selectProfile,
  loadLyricsForSong,
} from '../core/bridge-state.js';
import {
  buildTracklistCsv,
  calculateSongDurationSec,
  csvFilenameTimestamp,
  formatDuration,
  formatSongAutomations,
  formatSongSections,
  type CsvTracklistRow,
} from '../core/csv-export.js';
import { buildClickPreviewWav, clickPreviewFilename } from '../core/click-preview.js';
import { getQuantizationBeats } from '../core/next-downbeat-jump.js';
import { atomicWriteFile } from '../util/atomic-write.js';
import type { ProfilePaths } from '../core/profile-manager.js';

type ClientMessageOf<TType extends ClientMessage['type']> = Extract<ClientMessage, { type: TType }>;
type TestSessionMarker = { name: string; beats: number };
type MarkerConfirmation = { name: string; time: number; confirmed: boolean };
type CuePointResult =
  | { status: 'confirmed'; transport: 'mcp' }
  | { status: 'accepted'; transport: 'osc' }
  | { status: 'error'; transport: 'osc'; message?: string };

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
    exports: path.resolve(paths.exports),
    audio: path.resolve(paths.audio),
  };
}

function capturePersistenceScope(): PersistenceScopeSnapshot {
  if (bridgeState.profileScopeSwitching) {
    throw new Error('Profile scope is changing. Try the command again.');
  }
  const profileManager = bridgeState.profileManager;
  const manager = bridgeState.manager;
  if (!profileManager || !manager) {
    throw new Error('Profile scope is not initialized.');
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
    throw new Error('Profile scope changed while the command was in progress.');
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
    throw new Error('Profile scope changed while the command was in progress.');
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
    throw new Error('OSC client is not initialized.');
  }
  if (msg.type === 'set_panic' && msg.active && !bridgeState.oscClient) {
    throw new Error('OSC client is not initialized.');
  }
  if (
    bridgeState.profileScopeSwitching &&
    ['profile_create', 'profile_select', 'profile_rename', 'profile_delete', 'profile_restore'].includes(msg.type)
  ) {
    throw new Error('Cannot modify setlists while the current Live Set is changing.');
  }

  const osc = bridgeState.oscClient!;

  switch (msg.type) {
    case 'play':
      osc.startPlaying();
      break;
    case 'stop':
      osc.stopPlaying();
      break;
    case 'metronome':
      osc.setMetronome(msg.value);
      bridgeState.manager?.updateMetronome(msg.value);
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
    case 'create_test_session':
      await executeCreateTestSessionCommand(msg, writeFile);
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
        throw new Error('Cannot create profile while transport is playing.');
      }
      const newProfile = await bridgeState.profileManager!.create(msg.name);
      await selectProfile(newProfile.id);
      break;
    case 'profile_select':
      if (bridgeState.manager!.getState().isPlaying) {
        throw new Error('Cannot select profile while transport is playing.');
      }
      await selectProfile(msg.id);
      break;
    case 'profile_rename':
      if (bridgeState.manager!.getState().isPlaying) {
        throw new Error('Cannot rename profile while transport is playing.');
      }
      await bridgeState.profileManager!.rename(msg.id, msg.name);
      broadcastProfileState();
      break;
    case 'profile_delete':
      if (bridgeState.manager!.getState().isPlaying) {
        throw new Error('Cannot remove profile while transport is playing.');
      }
      await bridgeState.profileManager!.remove(msg.id, msg.confirmationName);
      broadcastProfileState();
      break;
    case 'profile_restore':
      if (bridgeState.manager!.getState().isPlaying) {
        throw new Error('Cannot restore profile while transport is playing.');
      }
      await bridgeState.profileManager!.restore(msg.id);
      broadcastProfileState();
      break;
  }
}

export function executeJumpCommand(msg: ClientMessageOf<'jump'>): void {
  if (!bridgeState.manager || !bridgeState.scheduler || !bridgeState.oscClient) return;
  const song = bridgeState.manager.getState().songs[msg.songIndex];
  if (!song) return;

  let targetTime: number | null = null;
  let cueName: string | null = null;
  let cueIndex = -1;

  if (msg.sectionIndex !== undefined && msg.sectionIndex !== null && msg.sectionIndex >= 0) {
    const section = song.sections[msg.sectionIndex];
    if (!section) return;
    const idx = bridgeState.manager.getRawCues().findIndex((c) => c.time === section.time);
    if (idx === -1) return;
    targetTime = bridgeState.manager.getRawCues()[idx]!.time;
    cueName = bridgeState.manager.getRawCues()[idx]!.name;
    cueIndex = bridgeState.manager.getRawCues()[idx]!.cueIndex ?? idx;
  } else {
    const idx = bridgeState.manager.getRawCues().findIndex((c) => c.time === song.time);
    if (idx === -1) return;
    targetTime = bridgeState.manager.getRawCues()[idx]!.time;
    cueName = bridgeState.manager.getRawCues()[idx]!.name;
    cueIndex = bridgeState.manager.getRawCues()[idx]!.cueIndex ?? idx;
  }

  const mgrState = bridgeState.manager.getState();
  const quantBeats = getQuantizationBeats(mgrState.clipTriggerQuantization, mgrState.signatureNumerator);
  const isImmediate = !mgrState.isPlaying || quantBeats === 0;

  if (isImmediate) {
    bridgeState.scheduler.clearPending();
    bridgeState.oscClient.jumpToCuePoint(cueIndex);

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
    throw new Error('Cannot reorder setlist while transport is playing in Show mode.');
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
    throw new Error('Reorder must contain every song exactly once.');
  }

  const remainingByTitle = new Map<string, number>();
  for (const { title } of songs) {
    remainingByTitle.set(title, (remainingByTitle.get(title) ?? 0) + 1);
  }
  for (const title of songTitles) {
    const remaining = remainingByTitle.get(title) ?? 0;
    if (remaining === 0) {
      throw new Error('Reorder contains an unknown or duplicate song occurrence.');
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
    throw new Error('Cannot save or modify lyrics in Show mode.');
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
        const durationSec = calculateSongDurationSec(
          song,
          state.songs,
          state.tempo ?? 120,
          state.arrangementEndTime ?? null,
        );

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

async function executeCreateTestSessionCommand(
  msg: ClientMessageOf<'create_test_session'>,
  writeFile: typeof atomicWriteFile,
): Promise<void> {
  const markers: TestSessionMarker[] = [
    { name: 'TEST ALPHA [bpm 90] [click]', beats: 0 },
    { name: 'TEST ALPHA > INTRO [loop 2x]', beats: 8 },
    { name: 'TEST ALPHA > VERSE 1', beats: 24 },
    { name: 'TEST ALPHA > CHORUS [next]', beats: 48 },
    { name: 'TEST ALPHA > BRIDGE', beats: 64 },
    { name: 'TEST ALPHA > _HIDDEN BRIDGE [hidden]', beats: 80 },
    { name: 'TEST ALPHA > OUTRO [stop]', beats: 96 },
    { name: 'TEST BRAVO [bpm 110]', beats: 112 },
    { name: 'TEST BRAVO > INTRO [loop]', beats: 120 },
    { name: 'TEST BRAVO > VERSE 1 [click-off]', beats: 136 },
    { name: 'TEST BRAVO > _HIDDEN BRIDGE [hidden]', beats: 152 },
    { name: 'TEST BRAVO > CHORUS', beats: 168 },
    { name: 'TEST CHARLIE [bpm 132] [click]', beats: 184 },
    { name: 'TEST CHARLIE > INTRO', beats: 192 },
    { name: 'TEST CHARLIE > VERSE 1 [stop]', beats: 208 },
    { name: 'TEST DELTA [bpm 84]', beats: 224 },
    { name: 'TEST DELTA > INTRO [loop 2x]', beats: 232 },
    { name: 'TEST DELTA > VERSE 1 [next]', beats: 248 },
    { name: 'TEST ECHO [bpm 95] [click]', beats: 264 },
    { name: 'TEST ECHO > INTRO', beats: 272 },
    { name: 'TEST ECHO > VERSE 1 [stop]', beats: 288 },
    { name: 'TEST FOXTROT [bpm 100]', beats: 304 },
    { name: 'TEST FOXTROT > INTRO', beats: 312 },
    { name: 'TEST FOXTROT > VERSE 1 [stop]', beats: 328 },
    { name: 'TEST GOLF [bpm 105] [click]', beats: 344 },
    { name: 'TEST GOLF > INTRO', beats: 352 },
    { name: 'TEST GOLF > VERSE 1 [stop]', beats: 368 },
  ];

  const lyricsBySong: Record<string, string> = {
    'TEST ALPHA': `[00:00.00]TEST ALPHA — TAGS TEST\n[00:05.33]Verse 1: loop 2x, click and bpm 90\n[00:16.00]Chorus: automatic next, then stop\n[00:26.67]Bridge: hidden section test\n[00:32.00]Outro: stops Ableton Live automatically\n`,
    'TEST BRAVO': `[00:00.00]TEST BRAVO — INFINITE LOOP\n[00:04.36]Infinite loop starts here\n[00:13.09]The metronome turns off automatically\n[00:21.82]Chorus and manual ending\n`,
    'TEST CHARLIE': `[00:00.00]TEST CHARLIE — SIMPLE STOP\n[00:03.63]Intro at a faster tempo\n[00:10.90]Playback stops at the verse\n`,
    'TEST DELTA': `[00:00.00]TEST DELTA — NEXT AUTOMATION\n[00:05.71]Intro repeats twice\n[00:17.14]Jumps to the next song at the verse\n`,
    'TEST ECHO': `[00:00.00]TEST ECHO — SONG 5\n[00:05.05]Metronome on at 95 bpm\n[00:15.15]Stops automatically at the verse\n`,
    'TEST FOXTROT': `[00:00.00]TEST FOXTROT — SONG 6\n[00:04.80]Metronome off at 100 bpm\n[00:14.40]Stops automatically at the verse\n`,
    'TEST GOLF': `[00:00.00]TEST GOLF — SONG 7\n[00:04.57]Metronome on at 105 bpm\n[00:13.71]Stops at the verse\n`,
  };

  if (!bridgeState.oscClient) return;
  const persistenceScope = capturePersistenceScope();

  try {
    bridgeState.isCreatingTestSession = true;

    bridgeState.oscClient.stopPlaying();
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Turn off loop so cue points can land on any beat
    bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
    await delay(200);

    const mcpResults: MarkerConfirmation[] = [];
    let acceptedByOsc = 0;
    let tryMcp = true;
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i]!;
      const targetBeat = marker.beats;

      const res = await createCuePoint(marker.name, targetBeat, tryMcp);
      if (res.transport === 'osc') tryMcp = false;

      if (res.status === 'confirmed') {
        mcpResults.push({ name: marker.name, time: targetBeat, confirmed: true });
        bridgeState.wsServer?.broadcastLog(
          `Created: ${marker.name} at beat ${targetBeat} (${mcpResults.length}/${markers.length})`,
          'info'
        );
      } else if (res.status === 'accepted') {
        acceptedByOsc++;
        bridgeState.wsServer?.broadcastLog(
          `Requested: ${marker.name} at beat ${targetBeat}; awaiting Ableton confirmation.`,
          'info'
        );
      } else {
        const errMsg = res.message ?? 'OSC/MCP timeout or error';
        console.warn(`[Automation] Marker ${marker.name} failed: ${errMsg}`);
        bridgeState.wsServer?.broadcastLog(
          `Locator ${i + 1}/${markers.length} (${marker.name}) failed.`,
          'warn'
        );
      }
      await delay(100);
    }

    const expectedMarkers = markers.map(({ name, beats }) => ({ name, time: beats }));
    let createdCount = countConfirmedTestSessionMarkers(
      expectedMarkers,
      mcpResults,
      persistenceScope.manager.getRawCues(),
    );
    if (createdCount < markers.length && acceptedByOsc > 0) {
      const observationDeadline = Date.now() + 1_000;
      while (createdCount < markers.length && Date.now() < observationDeadline) {
        bridgeState.oscClient.getCuePoints();
        await delay(Math.min(100, Math.max(1, observationDeadline - Date.now())));
        assertPersistenceScopeCurrent(persistenceScope);
        createdCount = countConfirmedTestSessionMarkers(
          expectedMarkers,
          mcpResults,
          persistenceScope.manager.getRawCues(),
        );
      }
    }

    if (createdCount !== markers.length) {
      throw new Error(`${markers.length - createdCount} of ${markers.length} locator(s) were not confirmed.`);
    }

    console.log(
      `[Automation] Automated creation of test locators complete (${createdCount}/${markers.length})`
    );
    bridgeState.wsServer?.broadcastLog(
      `Automatic setup complete: ${createdCount}/${markers.length} locators. Select "Refresh" in Stage Control.`,
      'info'
    );

    assertPersistenceScopeCurrent(persistenceScope);
    const lyricsDir = persistenceScope.paths.lyrics;
    let lyricsSaved = 0;
    let lyricsSkipped = 0;
    for (const [songTitle, lrcContent] of Object.entries(lyricsBySong)) {
      const cleanTitle = songTitle.replace(/[\\/:*?"<>|]/g, '_').trim();
      const lrcPath = path.join(lyricsDir, `${cleanTitle}.lrc`);
      try {
        await writeFile(lrcPath, lrcContent);
        assertPersistenceScopeCurrent(persistenceScope);
        lyricsSaved++;
        console.log(`[Automation] Saved lyrics for "${songTitle}".`);
      } catch {
        lyricsSkipped++;
        console.error(`[Automation] Failed to save lyrics for "${songTitle}".`);
      }
    }
    bridgeState.wsServer?.broadcastLog(
      `Synchronized lyrics saved: ${lyricsSaved}/${Object.keys(lyricsBySong).length}.`,
      'info'
    );
    if (lyricsSkipped > 0) {
      bridgeState.wsServer?.broadcastLog(
        `⚠ ${lyricsSkipped} lyric file(s) could not be saved.`,
        'warn'
      );
      throw new Error(`${lyricsSkipped} lyric file(s) could not be saved.`);
    }
  } catch (err) {
    console.error('[Automation] Failed to create the complete test session.');
    bridgeState.wsServer?.broadcastLog('Could not create all test locators.', 'error');
    throw err;
  } finally {
    bridgeState.isCreatingTestSession = false;
  }
}

export function countConfirmedTestSessionMarkers(
  expected: ReadonlyArray<{ name: string; time: number }>,
  mcpResults: ReadonlyArray<{ name: string; time: number; confirmed: boolean }>,
  observedCues: ReadonlyArray<{ name: string; time: number }>,
): number {
  return expected.filter((marker) => {
    const mcpConfirmed = mcpResults.some((result) =>
      result.confirmed && result.name === marker.name && result.time === marker.time
    );
    if (mcpConfirmed) return true;
    return observedCues.some((cue) => cue.name === marker.name && cue.time === marker.time);
  }).length;
}

async function createCuePoint(name: string, beat: number, tryMcp: boolean): Promise<CuePointResult> {
  if (tryMcp) {
    try {
      const res = await callDebuggerMcp('create_cue_point', { name, time: beat });
      if (isRecord(res) && res.status === 'ok') {
        return { status: 'confirmed', transport: 'mcp' };
      }
    } catch {
    // MCP unavailable or timed out — fall through to OSC fallback
    }
  }
  return createCuePointViaOsc(name, beat);
}

function callDebuggerMcp(command: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = net.connect({ host: '127.0.0.1', port: 9888 }, () => {
      const req = JSON.stringify({ type: command, params }) + '\n';
      client.write(req);
    });

    let buffer = '';
    client.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      if (buffer.includes('\n')) {
        const line = buffer.split('\n')[0]!;
        client.end();
        try {
          resolve(JSON.parse(line));
        } catch (err) {
          reject(err);
        }
      }
    });

    client.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => {
      client.destroy();
      reject(new Error('Timeout connecting to MCP bridge'));
    }, 1500);
  });
}

function createCuePointViaOsc(name: string, beat: number): Promise<CuePointResult> {
  if (!bridgeState.oscClient) {
    return Promise.resolve({
      status: 'error',
      transport: 'osc',
      message: 'OSC client not initialized',
    });
  }
  const accepted = bridgeState.oscClient.send('/live/song/create_cue_point', [
    { type: 'string', value: name },
    { type: 'float', value: beat }
  ]);
  return Promise.resolve(accepted
    ? { status: 'accepted', transport: 'osc' }
    : { status: 'error', transport: 'osc', message: 'OSC socket did not accept the message' });
}
