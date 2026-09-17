import { bridgeState } from '../runtime/bridge-state.js';
import { log } from '../util/log.js';
import type { AutomationAction } from '../core/setlist-manager.js';

/**
 * Move the playhead to `targetTime` right now.
 *
 * This is deliberately not a cue jump. Live launch-quantizes cue jumps
 * requested while the transport runs, so a jump asked for at a marker was
 * executed on the next bar line — measured on the owner's set on 2026-09-08:
 * NEXT fired at beat 872.3, Live jumped at 876.0. For the case this exists for,
 * a [next] on the last marker of a song followed by a short empty gap, that bar
 * of delay is the whole gap: the jump landed where the next song was starting
 * anyway and the marker appeared to do nothing.
 *
 * Writing `current_song_time` relocates the transport at once (verified on
 * Live 12.4 with playback running). It is late by the position poll plus
 * AbletonOSC's 100ms command tick, roughly 0.1-0.2s, and it can never be
 * early. Arming the quantized jump a bar ahead would be exact, but AbletonOSC
 * exposes no bar phase, so a marker off Live's grid — a time-signature change
 * earlier in the set is enough — would make Live jump *before* the marker and
 * cut the end of the song. Late by a tenth of a second beats that.
 *
 * One consequence to know: unlike a cue jump, this does not move Live's start
 * marker, so a double Stop afterwards returns wherever it pointed before.
 */
function handOver(targetTime: number): void {
  if (!bridgeState.oscClient || !bridgeState.manager) return;
  bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
  bridgeState.manager.clearLoop();
  bridgeState.oscClient.setCurrentSongTime(targetTime);
}

/**
 * ExecuteAutomationActions — implementation detail.
 */
export function executeAutomationActions(actions: AutomationAction[], time: number): void {
  if (!bridgeState.oscClient || !bridgeState.manager) return;

  for (const action of actions) {
    if (action.type === 'stop') {
      const msg = `■ STOP triggered at ${time.toFixed(1)}s — stopping playback`;
      log.info('core', msg);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      bridgeState.oscClient.stopPlaying();
    } else if (action.type === 'skip') {
      const msg = `⏭ SKIP triggered at ${time.toFixed(1)}s — handing over to "${action.targetCue}" at ${action.targetTime}`;
      log.info('core', msg);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      handOver(action.targetTime);
    } else if (action.type === 'jump_to') {
      const msg = `⤴ JUMP triggered at ${time.toFixed(1)}s — handing over to "${action.targetCue}" at ${action.targetTime}`;
      log.info('core', msg);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      handOver(action.targetTime);
    } else if (action.type === 'next') {
      const nextSong = bridgeState.manager.getState().songs[action.nextSongIndex];
      const msg = `⏭ NEXT triggered at ${time.toFixed(1)}s — handing over to "${nextSong?.title}" (idx ${action.nextSongIndex}) at ${action.targetTime}`;
      log.info('core', msg);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      handOver(action.targetTime);
    } else if (action.type === 'activate_loop') {
      const msg = `↻ LOOP triggered at ${time.toFixed(1)}s — loop_start: ${action.start}s, loop_length: ${action.duration}s`;
      log.info('core', msg);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 1 }]);
      bridgeState.oscClient.send('/live/song/set/loop_start', [
        { type: 'float', value: action.start },
      ]);
      bridgeState.oscClient.send('/live/song/set/loop_length', [
        { type: 'float', value: action.duration },
      ]);
    } else if (action.type === 'deactivate_loop') {
      const msg = `↻ Counted LOOP completed at ${time.toFixed(1)}s — releasing playback`;
      log.info('core', msg);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
    } else if (action.type === 'change_bpm') {
      const msg = `♩ BPM changed at ${time.toFixed(1)}s — new tempo: ${action.bpm} BPM`;
      log.info('core', msg);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      bridgeState.oscClient.send('/live/song/set/tempo', [{ type: 'float', value: action.bpm }]);
    } else if (action.type === 'change_metronome') {
      const msg = `✕ CLICK ${action.value ? 'enabled' : 'disabled'} at ${time.toFixed(1)}s`;
      log.info('core', msg);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      bridgeState.oscClient.setMetronome(action.value);
      bridgeState.manager?.updateMetronome(action.value);
    }
  }
}
