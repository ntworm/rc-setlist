// Transport-level commands: jump (immediate and quantized), click preview,
// and the OSC-side rename helper the marker editor uses.
import { WebSocket } from 'ws';
import { bridgeState, broadcastState } from '../../runtime/bridge-state.js';
import { getQuantizationBeats } from '../../core/next-downbeat-jump.js';
import { applyJumpTargetTempo } from '../jump-tempo.js';
import { buildClickPreviewWav, clickPreviewFilename } from '../../core/click-preview.js';
import { OperatorError } from '../../core/operator-error.js';
import { resolveCueAtTime, type ClientMessageOf } from './shared.js';
import type { AugmentedWebSocket } from '../../types.js';
import type { atomicWriteFile } from '../../util/atomic-write.js';

/**
 * ExecuteJumpCommand — implementation detail.
 */
export function executeJumpCommand(msg: ClientMessageOf<'jump'>): void {
  if (!bridgeState.manager || !bridgeState.scheduler || !bridgeState.oscClient) {
    throw new OperatorError('The transport is not ready.');
  }
  // A jump is an observable command: it is confirmed by the playhead arriving.
  // A target that cannot be resolved must fail now, not expire five seconds
  // later as a timeout the operator cannot explain.
  const song = bridgeState.manager.getState().songs[msg.songIndex];
  if (!song) throw new OperatorError(`Jump target not found (song ${msg.songIndex}).`);

  const wantsSection =
    msg.sectionIndex !== undefined && msg.sectionIndex !== null && msg.sectionIndex >= 0;
  const section = wantsSection ? song.sections[msg.sectionIndex!] : undefined;
  if (wantsSection && !section) {
    throw new OperatorError(
      `Jump target not found (song ${msg.songIndex}, section ${msg.sectionIndex}).`,
    );
  }
  const cue = resolveCueAtTime(section ? section.time : song.time);
  if (!cue) {
    throw new OperatorError(`No cue point found at time ${section ? section.time : song.time}.`);
  }
  const { time: targetTime, name: cueName, cueIndex } = cue;

  const mgrState = bridgeState.manager.getState();
  const quantBeats = getQuantizationBeats(
    mgrState.clipTriggerQuantization,
    mgrState.signatureNumerator,
  );
  const isImmediate = !mgrState.isPlaying || quantBeats === 0;

  if (isImmediate) {
    bridgeState.scheduler.clearPending();
    applyJumpTargetTempo(msg.songIndex, msg.sectionIndex ?? null);
    bridgeState.oscClient.jumpToCuePoint(cueIndex);

    /*
     * Move this side's playhead to the target straight away, while stopped.
     * Live is only told to jump; the position poll catches up to half a second
     * later, and the count-in reads the tempo this setlist declares at the
     * playhead — so jumping to a section and pressing Play immediately
     * counted at the tempo of wherever the playhead had been, the rehearsal
     * case this feature exists for. Only while stopped; during playback the
     * same write would evaluate the target's automations before the transport
     * has reached it.
     */
    if (!mgrState.isPlaying && targetTime !== null && Number.isFinite(targetTime)) {
      bridgeState.manager.updateTransport(targetTime, false);
      broadcastState();
    }

    if (msg.sectionIndex !== null && msg.sectionIndex !== undefined) {
      const sec = song.sections[msg.sectionIndex];
      if (sec && sec.loopCount !== null) {
        const loopRegion = bridgeState.manager.getLoopRegion(msg.songIndex, msg.sectionIndex);
        if (loopRegion) {
          bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 1 }]);
          bridgeState.oscClient.send('/live/song/set/loop_start', [
            { type: 'float', value: loopRegion.start },
          ]);
          bridgeState.oscClient.send('/live/song/set/loop_length', [
            { type: 'float', value: loopRegion.duration },
          ]);
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
     * Live quantizes a cue jump requested while playing to its next global
     * quantization grid line. The request goes out now and Live lands it; the
     * scheduler only tracks the landing. The request used to be sent on the
     * landing sample, which is just past the grid line, so Live landed the
     * jump a full quantization period after the beat the page announced.
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
        clipTriggerQuantization: mgrState.clipTriggerQuantization,
      },
      cueIndex,
    );
  }
}

/**
 * RenameCuePoint — implementation detail.
 */
export async function renameCuePoint(
  beat: number,
  name: string,
  cueIndex: number,
): Promise<{ status: 'confirmed' | 'error'; message?: string }> {
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

/**
 * ExecuteClickPreviewCommand — implementation detail.
 */
export async function executeClickPreviewCommand(
  msg: ClientMessageOf<'click_preview'>,
  ws: AugmentedWebSocket | undefined,
  writeFile: typeof atomicWriteFile,
): Promise<void> {
  const path = await import('node:path');
  const { capturePersistenceScope, assertPersistenceScopeCurrent } = await import('./shared.js');
  const scope = capturePersistenceScope();
  try {
    const state = scope.manager.getState();
    const requestedBpm =
      typeof msg.bpm === 'number' && msg.bpm > 0 ? msg.bpm : (state?.tempo ?? 120);
    const beats = typeof msg.beats === 'number' && msg.beats > 0 ? msg.beats : 4;
    const wav = buildClickPreviewWav({ bpm: requestedBpm, beats });
    const fileName = clickPreviewFilename(requestedBpm, beats);
    const fullPath = path.join(scope.paths.audio, fileName);
    await writeFile(fullPath, wav);
    assertPersistenceScopeCurrent(scope);
    console.log(`[Click] Wrote preview WAV (bpm=${requestedBpm}, beats=${beats}, ${wav.length}B).`);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'click_preview_ready',
          url: `/audio/${fileName}`,
          bpm: requestedBpm,
          beats,
        }),
      );
    }
  } catch (err) {
    console.error('[Click] Failed to generate preview.');
    bridgeState.wsServer?.broadcastLog('Could not generate the click preview.', 'error');
    throw err;
  }
}
