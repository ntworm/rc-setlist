import { SessionInfo } from '../integration/mcp-client.js';
import { bridgeState, broadcastState, checkAndBroadcastLyrics } from '../core/bridge-state.js';
import { executeAutomationActions } from '../automation/executor.js';

export function syncFromMcpInfo(info: SessionInfo): void {
  if (!bridgeState.manager) return;

  const oldVersion = bridgeState.manager.getState().stateVersion;

  if (bridgeState.scheduler && typeof info.current_song_time === 'number') {
    bridgeState.scheduler.tick(info.current_song_time);
  }

  if (typeof info.current_song_time === 'number' && typeof info.is_playing === 'boolean') {
    const prevActiveSongIdx = bridgeState.manager.getState().activeSongIndex;
    const prevActiveSectionIdx = bridgeState.manager.getState().activeSectionIndex;

    bridgeState.manager.updateTransport(
      info.current_song_time,
      info.is_playing,
      typeof info.tempo === 'number' ? info.tempo : undefined
    );

    const newState = bridgeState.manager.getState();

    // Log active changes
    if (newState && (prevActiveSongIdx !== newState.activeSongIndex || prevActiveSectionIdx !== newState.activeSectionIndex)) {
      const song = newState.songs[newState.activeSongIndex];
      const msg = `Active cue changed → Song: "${song?.title}" (idx ${newState.activeSongIndex}), Section idx: ${newState.activeSectionIndex}, time: ${info.current_song_time.toFixed(1)}s`;
      console.log(`[Transport-MCP] ${msg}`);
      bridgeState.wsServer?.broadcastLog(msg, 'info');
    }

    if (info.is_playing) {
      const actions = bridgeState.manager.checkAutomations();
      if (actions.length > 0) {
        executeAutomationActions(actions, info.current_song_time);
      }
    }
  }

  if (typeof info.signature_numerator === 'number' && typeof info.signature_denominator === 'number') {
    bridgeState.manager.updateSignature(info.signature_numerator, info.signature_denominator);
  }

  const state = bridgeState.manager.getState();
  const currentSong = state.songs[state.activeSongIndex];
  if (currentSong) {
    checkAndBroadcastLyrics(currentSong.title);
  }

  if (bridgeState.manager.getState().stateVersion !== oldVersion) {
    broadcastState();
  }
}
