import { StartServerOptions } from '../index.js';
import {
  bridgeState,
  broadcastState,
  checkAndBroadcastLyrics,
  observePreRollPosition,
  observePreRollTransport,
} from '../core/bridge-state.js';
import { executeAutomationActions } from '../automation/executor.js';

const MCP_TRANSPORT_FRESHNESS_MS = 500;

function hasFreshMcpTransportObservation(): boolean {
  const age = bridgeState.mcpFallbackSync?.getSnapshot().timeSinceLastSessionInfoMs;
  return typeof age === 'number' && age <= MCP_TRANSPORT_FRESHNESS_MS;
}

export function registerOscListeners(options: StartServerOptions = {}) {
  if (!bridgeState.oscClient) return;

  bridgeState.oscClient.on('tempo', (bpm) => {
    bridgeState.manager?.updateTransport(
      bridgeState.manager.getState().currentSongTime,
      bridgeState.manager.getState().isPlaying,
      bpm
    );
    broadcastState();
  });

  bridgeState.oscClient.on('is_playing_sample', (isPlaying) => {
    observePreRollTransport(isPlaying);
  });

  bridgeState.oscClient.on('is_playing', (isPlaying) => {
    bridgeState.manager?.updateTransport(
      bridgeState.manager.getState().currentSongTime,
      isPlaying
    );
    broadcastState();
  });

  bridgeState.oscClient.on('current_song_time', (time) => {
    // MCP and OSC sample the same playhead independently. When MCP is healthy,
    // a slightly older OSC reply can otherwise overwrite the newer sample for
    // one browser frame and make Bars.Beats.Sixteenths visibly jump backward.
    // Keep one clock authority at a time; OSC resumes automatically if MCP is
    // stale for more than the fallback window.
    if (hasFreshMcpTransportObservation()) return;
    bridgeState.scheduler?.tick(time);
    if (bridgeState.isCreatingTestSession) {
      broadcastState();
      return;
    }
    const prevState = bridgeState.manager?.getState();
    bridgeState.manager?.updateTransport(time, bridgeState.manager.getState().isPlaying);
    observePreRollPosition(time);
    const newState = bridgeState.manager?.getState();

    if (newState) {
      const activeSong = newState.songs[newState.activeSongIndex];
      if (activeSong) {
        checkAndBroadcastLyrics(activeSong.title);
      }
    }

    // Log when active song/section changes
    if (prevState && newState && (prevState.activeSongIndex !== newState.activeSongIndex || prevState.activeSectionIndex !== newState.activeSectionIndex)) {
      const song = newState.songs[newState.activeSongIndex];
      const msg = `Active cue changed → Song: "${song?.title}" (idx ${newState.activeSongIndex}), Section idx: ${newState.activeSectionIndex}, time: ${time.toFixed(1)}s`;
      console.log(`[Transport] ${msg}`);
      bridgeState.wsServer?.broadcastLog(msg, 'info');
    }

    // Check and execute automations
    if (bridgeState.manager && bridgeState.oscClient) {
      const actions = bridgeState.manager.checkAutomations();
      executeAutomationActions(actions, time);
    }

    broadcastState();
  });

  bridgeState.oscClient.on('cue_points', (cues) => {
    const sorted = [...cues].sort((a, b) => a.time - b.time);
    const fingerprint = sorted.map(c => `${c.name}@${c.time}`).join('|');
    const fingerprintChanged = fingerprint !== bridgeState.lastCuesFingerprint;

    if (fingerprintChanged) {
      bridgeState.lastCuesFingerprint = fingerprint;
    }

    bridgeState.manager?.updateCues(cues);
    const state = bridgeState.manager?.getState();
    if (state) {
      console.log(`[Setlist] Loaded ${state.songs.length} songs:`);
      state.songs.forEach((s, i) => {
        const tags = [];
        if (s.loopCount !== null) tags.push(`loop${s.loopCount === -1 ? '∞' : `:${s.loopCount}x`}`);
        if (s.autoStop) tags.push('stop');
        if (s.autoNext) tags.push('next');
        const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
        console.log(`  ${i + 1}. "${s.title}"${tagStr} @ ${s.time.toFixed(1)}s (${s.sections.length} sections)`);
      });
    }
    broadcastState();
  });

  bridgeState.oscClient.on('last_event_time', (value) => {
    bridgeState.manager?.updateArrangementEndTime(value);
    broadcastState();
  });

  bridgeState.oscClient.on('metronome', (metronome) => {
    bridgeState.manager?.updateMetronome(metronome);
    broadcastState();
  });

  bridgeState.oscClient.on('signature_numerator', (val) => {
    const currentState = bridgeState.manager?.getState();
    if (currentState) {
      bridgeState.manager?.updateSignature(val, currentState.signatureDenominator);
    }
    broadcastState();
  });

  bridgeState.oscClient.on('signature_denominator', (val) => {
    const currentState = bridgeState.manager?.getState();
    if (currentState) {
      bridgeState.manager?.updateSignature(currentState.signatureNumerator, val);
    }
    broadcastState();
  });

  bridgeState.oscClient.on('clip_trigger_quantization', (val) => {
    bridgeState.manager?.updateQuantization(val);
    broadcastState();
  });
}
