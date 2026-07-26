import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { WebSocket } from 'ws';
import { ShowCommand, AugmentedWebSocket } from '../types.js';
import {
  bridgeState,
  broadcastState,
  broadcastProfileState,
  checkAndBroadcastLyrics,
  getActiveProfilePaths,
  selectProfile,
  loadLyricsForSong,
} from '../core/bridge-state.js';
import {
  buildTracklistCsv,
  calculateSongDurationSec,
  csvFilenameTimestamp,
  type CsvTracklistRow,
} from '../core/csv-export.js';
import { buildClickPreviewWav, clickPreviewFilename } from '../core/click-preview.js';
import { getQuantizationBeats } from '../core/next-downbeat-jump.js';

export async function executeCommandAction(command: ShowCommand, ws?: AugmentedWebSocket): Promise<void> {
  const msg = command.payload;

  const requiresOsc = new Set([
    'play', 'stop', 'metronome', 'refresh', 'jump', 'set_quantization'
  ]);
  if (requiresOsc.has(command.type) && !bridgeState.oscClient) {
    throw new Error('OSC client is not initialized.');
  }
  if (command.type === 'set_panic' && msg.active && !bridgeState.oscClient) {
    throw new Error('OSC client is not initialized.');
  }

  const osc = bridgeState.oscClient!;

  switch (command.type) {
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
      await executeReorderCommand(msg);
      break;
    case 'save_lyrics':
      executeSaveLyricsCommand(msg);
      break;
    case 'click_preview':
      executeClickPreviewCommand(msg, ws);
      break;
    case 'export_csv':
      executeExportCsvCommand(msg, ws);
      break;
    case 'set_quantization':
      osc.setClipTriggerQuantization(msg.value);
      break;
    case 'create_test_session':
      await executeCreateTestSessionCommand(msg);
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
  }
}

export function executeJumpCommand(msg: any): void {
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

async function executeReorderCommand(msg: any): Promise<void> {
  if (bridgeState.manager?.getState().mode === 'show' && bridgeState.manager?.getState().isPlaying) {
    throw new Error('Cannot reorder setlist while transport is playing in Show mode.');
  }

  const { songTitles } = msg;
  if (bridgeState.manager && songTitles) {
    bridgeState.manager.setCustomOrder(songTitles);

    try {
      const orderFilePath = getActiveProfilePaths().customOrder;
      const targetPersistenceDir = path.dirname(orderFilePath);

      if (!fs.existsSync(targetPersistenceDir)) {
        fs.mkdirSync(targetPersistenceDir, { recursive: true });
      }
      fs.writeFileSync(
        orderFilePath,
        JSON.stringify(songTitles, null, 2),
        'utf-8'
      );
      console.log(`[Persistence] Custom song order saved to ${orderFilePath}`);
      bridgeState.wsServer?.broadcastLog('Ordem das músicas salva com sucesso!', 'info');
    } catch (err) {
      console.error(`[Persistence] Failed to save custom order: ${err}`);
      bridgeState.wsServer?.broadcastLog(`Erro ao salvar ordem das músicas: ${err}`, 'error');
      throw err;
    }
    broadcastState();
  }
}

function executeSaveLyricsCommand(msg: any): void {
  if (bridgeState.manager?.getState().mode === 'show') {
    throw new Error('Cannot save or modify lyrics in Show mode.');
  }

  try {
    const cleanTitle = msg.song.replace(/[\\/:*?"<>|]/g, '_').trim();
    const targetLyricsDir = getActiveProfilePaths().lyrics;

    if (!fs.existsSync(targetLyricsDir)) {
      fs.mkdirSync(targetLyricsDir, { recursive: true });
    }

    const lrcPath = path.join(targetLyricsDir, `${cleanTitle}.lrc`);
    fs.writeFileSync(lrcPath, msg.text, 'utf-8');
    console.log(`[Lyrics] Saved synchronized lyrics for "${msg.song}" to ${lrcPath}`);
    bridgeState.wsServer?.broadcastLog(`Letra sincronizada para "${msg.song}" salva com sucesso!`, 'info');

    const lyrics = loadLyricsForSong(msg.song);
    bridgeState.wsServer?.broadcast({
      type: 'lyrics',
      song: msg.song,
      format: lyrics.type,
      lines: lyrics.lines
    });
  } catch (err) {
    console.error('[Lyrics] Error saving lyrics:', err);
    bridgeState.wsServer?.broadcastLog(`Erro ao salvar a letra: ${err instanceof Error ? err.message : String(err)}`, 'error');
    throw err;
  }
}

function executeClickPreviewCommand(msg: any, ws?: AugmentedWebSocket): void {
  try {
    const state = bridgeState.manager?.getState();
    const requestedBpm = (typeof msg.bpm === 'number' && msg.bpm > 0)
      ? msg.bpm
      : state?.tempo ?? 120;
    const beats = (typeof msg.beats === 'number' && msg.beats > 0)
      ? msg.beats
      : 4;
    const wav = buildClickPreviewWav({ bpm: requestedBpm, beats });
    const audioDir = getActiveProfilePaths().audio;
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }
    const fileName = clickPreviewFilename(requestedBpm, beats);
    const fullPath = path.join(audioDir, fileName);
    fs.writeFileSync(fullPath, wav);
    console.log(`[Click] Wrote preview WAV to ${fullPath} (bpm=${requestedBpm}, beats=${beats}, ${wav.length}B)`);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'click_preview_ready',
        url: `/audio/${fileName}`,
        bpm: requestedBpm,
        beats,
      }));
    }
  } catch (err) {
    console.error('[Click] Error generating preview:', err);
    bridgeState.wsServer?.broadcastLog(`Erro ao gerar click preview: ${err instanceof Error ? err.message : String(err)}`, 'error');
    throw err;
  }
}

function executeExportCsvCommand(msg: any, ws?: AugmentedWebSocket): void {
  try {
    const state = bridgeState.manager?.getState();
    if (!state || !state.songs.length) {
      bridgeState.wsServer?.broadcastLog('Nenhuma música no setlist para exportar.', 'warn');
    } else {
      const customOrder = bridgeState.manager!.getCustomOrder();
      const rows: CsvTracklistRow[] = state.songs.map((song, idx) => {
        const customIdx = customOrder.indexOf(song.title);
        const durationSec = calculateSongDurationSec(song, state.songs, state.tempo ?? 120);

        let lyricCount = 0;
        try {
          const lyrics = loadLyricsForSong(song.title);
          if (lyrics && lyrics.lines) {
            lyricCount = lyrics.lines.length;
          }
        } catch {}

        return {
          index: idx + 1,
          title: song.title,
          bpm: song.bpm,
          signature: '',
          key: '',
          durationSec,
          plays: 0,
          lyricLines: lyricCount,
          customOrder: customIdx >= 0 ? customIdx + 1 : idx + 1,
          inSetlist: true,
          cuesCount: song.sections.length,
          lastPlayedAt: null,
        };
      });
      const csv = buildTracklistCsv(rows);
      const exportsDir = getActiveProfilePaths().exports;
      if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
      }
      const stamp = csvFilenameTimestamp();
      const fileName = `tracklist-${stamp}.csv`;
      const fullPath = path.join(exportsDir, fileName);
      fs.writeFileSync(fullPath, csv, 'utf-8');
      console.log(`[CSV] Wrote tracklist export to ${fullPath} (${rows.length} rows)`);
      bridgeState.wsServer?.broadcastLog(`Tracklist exportado: ${fileName} (${rows.length} músicas)`, 'info');

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
    console.error('[CSV] Error exporting tracklist:', err);
    bridgeState.wsServer?.broadcastLog(`Erro ao exportar CSV: ${err instanceof Error ? err.message : String(err)}`, 'error');
    throw err;
  }
}

async function executeCreateTestSessionCommand(msg: any): Promise<void> {
  const markers: Array<{ name: string; beats: number }> = [
    { name: 'TEST ALPHA [bpm 90] [click]', beats: 0 },
    { name: 'TEST ALPHA > Intro [loop 2x]', beats: 8 },
    { name: 'TEST ALPHA > Verso 1', beats: 24 },
    { name: 'TEST ALPHA > Refrão [next]', beats: 48 },
    { name: 'TEST ALPHA > Bridge', beats: 64 },
    { name: 'TEST ALPHA > _BridgeOculta [hidden]', beats: 80 },
    { name: 'TEST ALPHA > Outro [stop]', beats: 96 },
    { name: 'TEST BRAVO [bpm 110]', beats: 112 },
    { name: 'TEST BRAVO > Intro [loop]', beats: 120 },
    { name: 'TEST BRAVO > Verso 1 [click-off]', beats: 136 },
    { name: 'TEST BRAVO > _BridgeOculta [hidden]', beats: 152 },
    { name: 'TEST BRAVO > Refrão', beats: 168 },
    { name: 'TEST CHARLIE [bpm 132] [click]', beats: 184 },
    { name: 'TEST CHARLIE > Intro', beats: 192 },
    { name: 'TEST CHARLIE > Verso 1 [stop]', beats: 208 },
    { name: 'TEST DELTA [bpm 84]', beats: 224 },
    { name: 'TEST DELTA > Intro [loop 2x]', beats: 232 },
    { name: 'TEST DELTA > Verso 1 [next]', beats: 248 },
    { name: 'TEST ECHO [bpm 95] [click]', beats: 264 },
    { name: 'TEST ECHO > Intro', beats: 272 },
    { name: 'TEST ECHO > Verso 1 [stop]', beats: 288 },
    { name: 'TEST FOXTROT [bpm 100]', beats: 304 },
    { name: 'TEST FOXTROT > Intro', beats: 312 },
    { name: 'TEST FOXTROT > Verso 1 [stop]', beats: 328 },
    { name: 'TEST GOLF [bpm 105] [click]', beats: 344 },
    { name: 'TEST GOLF > Intro', beats: 352 },
    { name: 'TEST GOLF > Verso 1 [stop]', beats: 368 },
  ];

  const lyricsBySong: Record<string, string> = {
    'TEST ALPHA': `[00:00.00]TEST ALPHA — TAGS TEST\n[00:05.33]Verso 1: loop 2x, click e bpm 90\n[00:16.00]Refrão: auto next e depois stop\n[00:26.67]Bridge: secreta e oculta\n[00:32.00]Outro: para o Ableton automaticamente\n`,
    'TEST BRAVO': `[00:00.00]TEST BRAVO — INFINITE LOOP\n[00:04.36]Loop infinito ativado aqui\n[00:13.09]Desliga o metrônomo automaticamente\n[00:21.82]Refrão e finalização manual\n`,
    'TEST CHARLIE': `[00:00.00]TEST CHARLIE — SIMPLE STOP\n[00:03.63]Intro e andamento acelerado\n[00:10.90]Para imediatamente no verso\n`,
    'TEST DELTA': `[00:00.00]TEST DELTA — NEXT AUTOMATION\n[00:05.71]Intro com repetição 2x\n[00:17.14]Pula para a próxima música no verso\n`,
    'TEST ECHO': `[00:00.00]TEST ECHO — SONG 5\n[00:05.05]Metrônomo ativo e bpm 95\n[00:15.15]Para automaticamente no verso\n`,
    'TEST FOXTROT': `[00:00.00]TEST FOXTROT — SONG 6\n[00:04.80]Sem metrônomo e bpm 100\n[00:14.40]Para automaticamente no verso\n`,
    'TEST GOLF': `[00:00.00]TEST GOLF — SONG 7\n[00:04.57]Com metrônomo e bpm 105\n[00:13.71]Para no verso\n`,
  };

  if (!bridgeState.oscClient) return;

  try {
    bridgeState.isCreatingTestSession = true;

    bridgeState.oscClient.stopPlaying();
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Turn off loop so cue points can land on any beat
    bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
    await delay(200);

    let createdCount = 0;
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i]!;
      const targetBeat = marker.beats;

      const res = await createCuePoint(marker.name, targetBeat);

      if (res && res.status === 'ok') {
        createdCount++;
        bridgeState.wsServer?.broadcastLog(
          `Criado: ${marker.name} na batida ${targetBeat} (${createdCount}/${markers.length})`,
          'info'
        );
      } else {
        const errMsg = res && (res as any).message ? (res as any).message : 'OSC/MCP timeout ou erro';
        console.warn(`[Automation] Marker ${marker.name} failed: ${errMsg}`);
        bridgeState.wsServer?.broadcastLog(
          `Marcador ${i + 1}/${markers.length} (${marker.name}) falhou: ${errMsg}`,
          'warn'
        );
      }
      await delay(100);
    }

    console.log(
      `[Automation] Automated creation of test locators complete (${createdCount}/${markers.length})`
    );
    bridgeState.wsServer?.broadcastLog(
      `Criação automática finalizada: ${createdCount}/${markers.length} marcadores. Clique em "Recarregar Setlist".`,
      'info'
    );

    bridgeState.oscClient.getCuePoints();

    const lyricsDir = getActiveProfilePaths().lyrics;
    if (!fs.existsSync(lyricsDir)) {
      fs.mkdirSync(lyricsDir, { recursive: true });
    }
    let lyricsSaved = 0;
    let lyricsSkipped = 0;
    for (const [songTitle, lrcContent] of Object.entries(lyricsBySong)) {
      const cleanTitle = songTitle.replace(/[\\/:*?"<>|]/g, '_').trim();
      const lrcPath = path.join(lyricsDir, `${cleanTitle}.lrc`);
      try {
        fs.writeFileSync(lrcPath, lrcContent, 'utf-8');
        lyricsSaved++;
        console.log(`[Automation] Saved lyrics for "${songTitle}" to ${lrcPath}`);
      } catch (err) {
        lyricsSkipped++;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Automation] Failed to save lyrics for "${songTitle}": ${errMsg}`);
      }
    }
    bridgeState.wsServer?.broadcastLog(
      `Letras sincronizadas salvas: ${lyricsSaved}/${Object.keys(lyricsBySong).length}.`,
      'info'
    );
    if (lyricsSkipped > 0) {
      bridgeState.wsServer?.broadcastLog(
        `⚠ ${lyricsSkipped} letra(s) não puderam ser salvas.`,
        'warn'
      );
    }
  } catch (err) {
    console.error('[Automation] Error creating test locators:', err);
    bridgeState.wsServer?.broadcastLog(`Erro ao criar marcadores: ${err}`, 'error');
  } finally {
    bridgeState.isCreatingTestSession = false;
  }
}

async function createCuePoint(name: string, beat: number): Promise<{ status: string; message?: string }> {
  try {
    const res = await callDebuggerMcp('create_cue_point', { name, time: beat });
    if (res && res.status === 'ok') return { status: 'ok' };
  } catch {
    // MCP unavailable or timed out — fall through to OSC fallback
  }
  return createCuePointViaOsc(name, beat);
}

function callDebuggerMcp(command: string, params: Record<string, unknown>): Promise<any> {
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

function createCuePointViaOsc(name: string, beat: number): Promise<{ status: string; message?: string }> {
  return new Promise((resolve) => {
    if (!bridgeState.oscClient) {
      resolve({ status: 'error', message: 'OSC client not initialized' });
      return;
    }
    bridgeState.oscClient.send('/live/song/create_cue_point', [
      { type: 'string', value: name },
      { type: 'float', value: beat }
    ]);
    setTimeout(() => {
      resolve({ status: 'ok' });
    }, 100);
  });
}
