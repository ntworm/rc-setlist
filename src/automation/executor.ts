import { bridgeState, broadcastState } from '../core/bridge-state.js';

export function executeAutomationActions(actions: any[], time: number): void {
  if (!bridgeState.oscClient || !bridgeState.manager) return;

  for (const action of actions) {
    if (action.type === 'stop') {
      const msg = `■ STOP triggered at ${time.toFixed(1)}s — stopping playback`;
      console.log(`[Automation] ${msg}`);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      bridgeState.oscClient.stopPlaying();
    } else if (action.type === 'skip') {
      const msg = `⏭ SKIP triggered — jumping to "${action.targetCue}"`;
      console.log(`[Automation] ${msg}`);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
      bridgeState.manager.clearLoop();
      bridgeState.oscClient.jumpToCuePoint(action.targetCue);
    } else if (action.type === 'next') {
      const nextSong = bridgeState.manager.getState().songs[action.nextSongIndex];
      const msg = `⏭ NEXT triggered at ${time.toFixed(1)}s — jumping to "${nextSong?.title}" (idx ${action.nextSongIndex})`;
      console.log(`[Automation] ${msg}`);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      if (nextSong) {
        bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
        bridgeState.manager.clearLoop();
        const matchingCue = bridgeState.manager.getRawCues().find(c => c.time === nextSong.time);
        if (matchingCue) {
          console.log(`[Automation]   → Jumping through cue "${matchingCue.name}" at ${matchingCue.time}s`);
          bridgeState.oscClient.jumpToCuePoint(matchingCue.name);
        } else {
          const warnMsg = `⚠ No matching cue found at ${nextSong.time}s`;
          console.log(`[Automation] ${warnMsg}`);
          bridgeState.wsServer?.broadcastLog(warnMsg, 'warn');
        }
      }
    } else if (action.type === 'activate_loop') {
      const msg = `↻ LOOP triggered at ${time.toFixed(1)}s — loop_start: ${action.start}s, loop_length: ${action.duration}s`;
      console.log(`[Automation] ${msg}`);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 1 }]);
      bridgeState.oscClient.send('/live/song/set/loop_start', [{ type: 'float', value: action.start }]);
      bridgeState.oscClient.send('/live/song/set/loop_length', [{ type: 'float', value: action.duration }]);
    } else if (action.type === 'deactivate_loop') {
      const msg = `↻ Counted LOOP completed at ${time.toFixed(1)}s — releasing playback`;
      console.log(`[Automation] ${msg}`);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
    } else if (action.type === 'change_bpm') {
      const msg = `♩ BPM changed at ${time.toFixed(1)}s — new tempo: ${action.bpm} BPM`;
      console.log(`[Automation] ${msg}`);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      bridgeState.oscClient.send('/live/song/set/tempo', [{ type: 'float', value: action.bpm }]);
    } else if (action.type === 'change_metronome') {
      const msg = `✕ CLICK ${action.value ? 'enabled' : 'disabled'} at ${time.toFixed(1)}s`;
      console.log(`[Automation] ${msg}`);
      bridgeState.wsServer?.broadcastLog(msg, 'automation');
      bridgeState.oscClient.setMetronome(action.value);
      bridgeState.manager?.updateMetronome(action.value);
    }
  }
}
