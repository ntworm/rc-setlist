// Transport-level commands: jump (immediate and quantized), click preview,
// and the OSC-side rename helper the marker editor uses.
import { WebSocket } from 'ws';
import { bridgeState, broadcastState } from '../../runtime/bridge-state.js';
import { getQuantizationBeats, quantizationPeriodMs } from '../../core/next-downbeat-jump.js';
import { log } from '../../util/log.js';
import { applyJumpTargetTempo } from '../jump-tempo.js';
import { buildClickPreviewWav, clickPreviewFilename } from '../../core/click-preview.js';
import { OperatorError } from '../../core/operator-error.js';
import { handOver } from '../../automation/executor.js';
import { resolveCueAtTime, type ClientMessageOf } from './shared.js';
import type { AugmentedWebSocket } from '../../types.js';
import type { atomicWriteFile } from '../../util/atomic-write.js';

/**
 * Arms the loop of the section a jump lands on, or turns the loop off.
 *
 * A section that counts its loops repeats in Live; a song does not, so a jump
 * that lands on a song always turns the loop off.
 */
function applyJumpLoop(songIndex: number, sectionIndex: number | null | undefined): void {
  const manager = bridgeState.manager;
  const osc = bridgeState.oscClient;
  if (!manager || !osc) return;

  if (sectionIndex === null || sectionIndex === undefined) {
    osc.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
    return;
  }

  const section = manager.getState().songs[songIndex]?.sections[sectionIndex];
  if (!section || section.loopCount === null) {
    osc.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
    return;
  }

  const loopRegion = manager.getLoopRegion(songIndex, sectionIndex);
  if (!loopRegion) return;
  osc.send('/live/song/set/loop', [{ type: 'integer', value: 1 }]);
  osc.send('/live/song/set/loop_start', [{ type: 'float', value: loopRegion.start }]);
  osc.send('/live/song/set/loop_length', [{ type: 'float', value: loopRegion.duration }]);
}

/**
 * Whether an immediate jump would be refused because a jump is waiting for
 * the grid.
 *
 * Live keeps the cue jump of a waiting jump armed: it would land after the
 * immediate one and undo it. The rule lives here so the command that refuses
 * the jump and the relay to the paired computer ask the same question.
 */
export function immediateJumpRefused(msg: ClientMessageOf<'jump'>): boolean {
  if (msg.immediate !== true) return false;
  const manager = bridgeState.manager;
  const scheduler = bridgeState.scheduler;
  if (!manager || !scheduler) return false;
  const state = manager.getState();
  if (!state.isPlaying) return false;
  const quantBeats = getQuantizationBeats(
    state.clipTriggerQuantization,
    state.signatureNumerator,
  );
  if (quantBeats <= 0) return false;
  return scheduler.hasPending();
}

/**
 * ExecuteJumpCommand — implementation detail. Returns how long, in
 * milliseconds, Live is expected to wait for the quantization grid before the
 * jump lands; 0 for an immediate jump.
 */
export function executeJumpCommand(msg: ClientMessageOf<'jump'>): number {
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

  /*
   * Live already holds the cue jump of a jump waiting for the grid; it would
   * land after an immediate one and undo it, so the immediate jump is
   * refused. The rule lives in one place, so the relay refuses it too.
   */
  if (immediateJumpRefused(msg)) {
    throw new OperatorError('A jump is already waiting for the grid.');
  }

  /*
   * An immediate jump asked for while the transport runs moves the playhead
   * now, through the same handover the automation uses, instead of the cue
   * jump Live would hold until the next grid line. A stopped transport and a
   * transport with no grid jump at once already, so the flag changes nothing
   * there.
   */
  if (msg.immediate === true && mgrState.isPlaying && quantBeats > 0) {
    applyJumpTargetTempo(msg.songIndex, msg.sectionIndex ?? null);
    handOver(targetTime);
    applyJumpLoop(msg.songIndex, msg.sectionIndex);
    bridgeState.manager.resetFiredAutomations();
    bridgeState.wsServer?.broadcast({
      type: 'jump_executed',
      songIndex: msg.songIndex,
      sectionIndex: msg.sectionIndex ?? null,
    });
    return 0;
  }

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

    applyJumpLoop(msg.songIndex, msg.sectionIndex);

    bridgeState.manager.clearLoop();
    bridgeState.manager.resetFiredAutomations();
    bridgeState.wsServer?.broadcast({
      type: 'jump_executed',
      songIndex: msg.songIndex,
      sectionIndex: msg.sectionIndex ?? null,
    });
    return 0;
  } else {
    /*
     * Live quantizes a cue jump requested while playing to its next global
     * quantization grid line. The request goes out now and Live lands it; the
     * scheduler only tracks the landing. The request used to be sent on the
     * landing sample, which is just past the grid line, so Live landed the
     * jump a full quantization period after the beat the page announced.
     */
    bridgeState.oscClient.jumpToCuePoint(cueIndex);
    const { landingTime } = bridgeState.scheduler.schedule(
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
    // A coarse grid can hold the landing longer than the confirmation window
    // (4 bars at 130 BPM is 7.4 s); the caller extends the window so a jump
    // that lands on time is not reported as expired. It extends by a whole
    // period, not by the wait to `landingTime`: the playhead sample is up to
    // 100 ms old, and a grid line passing in between makes Live land the jump
    // one period later than that estimate.
    const periodMs = quantizationPeriodMs(quantBeats, mgrState.tempo);
    log.info('commands', 'Quantized jump waits for the grid', {
      landingBeat: landingTime,
      windowExtendedMs: Math.round(periodMs),
    });
    return periodMs;
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
