import {
  bridgeState,
  broadcastState,
  checkAndBroadcastLyrics,
  refreshSongBook,
} from '../runtime/bridge-state.js';
import { executeAutomationActions } from '../automation/executor.js';
import { computeCuesFingerprint } from '../core/locator-parser.js';
import { log } from '../util/log.js';

const MCP_TRANSPORT_FRESHNESS_MS = 500;

function hasFreshMcpTransportObservation(): boolean {
  const age = bridgeState.mcpFallbackSync?.getSnapshot().timeSinceLastSessionInfoMs;
  return typeof age === 'number' && age <= MCP_TRANSPORT_FRESHNESS_MS;
}

/**
 * Registers the osc listeners.
 */
export function registerOscListeners() {
  if (!bridgeState.oscClient) return;

  bridgeState.oscClient.on('tempo', (raw: unknown) => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
    bridgeState.manager?.updateTempo(raw);
    broadcastState();
  });

  bridgeState.oscClient.on('is_playing', (raw: unknown) => {
    if (typeof raw !== 'boolean') return;
    bridgeState.manager?.updateTransport(bridgeState.manager.getState().currentSongTime, raw);
    broadcastState();
  });

  bridgeState.oscClient.on('current_song_time', (raw: unknown) => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
    const time = raw;
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
    const newState = bridgeState.manager?.getState();

    if (newState) {
      const activeSong = newState.songs[newState.activeSongIndex];
      if (activeSong) {
        checkAndBroadcastLyrics(activeSong.title);
      }
    }

    // Log when active song/section changes
    if (
      prevState &&
      newState &&
      (prevState.activeSongIndex !== newState.activeSongIndex ||
        prevState.activeSectionIndex !== newState.activeSectionIndex)
    ) {
      const song = newState.songs[newState.activeSongIndex];
      const msg = `Active cue changed → Song: "${song?.title}" (idx ${newState.activeSongIndex}), Section idx: ${newState.activeSectionIndex}, time: ${time.toFixed(1)}s`;
      log.info('osc', msg);
      bridgeState.wsServer?.broadcastLog(msg, 'info');
    }

    // Check and execute automations
    if (bridgeState.manager && bridgeState.oscClient) {
      const actions = bridgeState.manager.checkAutomations();
      executeAutomationActions(actions, time);
    }

    broadcastState();
  });

  bridgeState.oscClient.on('cue_points', (raw: unknown) => {
    const cues = toCuePoints(raw);
    if (!cues) return;
    const fingerprint = computeCuesFingerprint(cues);
    const fingerprintChanged = fingerprint !== bridgeState.lastCuesFingerprint;

    if (!fingerprintChanged) return;

    bridgeState.lastCuesFingerprint = fingerprint;
    bridgeState.manager?.updateCues(cues);
    refreshSongBook();
    const state = bridgeState.manager?.getState();
    if (state) {
      log.info('core', 'Loaded songs', { count: state.songs.length });
      state.songs.forEach((s, i) => {
        const tags = [];
        if (s.loopCount !== null) tags.push(`loop${s.loopCount === -1 ? '∞' : `:${s.loopCount}x`}`);
        if (s.autoStop) tags.push('stop');
        if (s.autoNext) tags.push('next');
        const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
        log.info('core', 'song entry', {
          index: i + 1,
          title: s.title,
          tags: tagStr,
          time: s.time.toFixed(1),
          sections: s.sections.length,
        });
      });
    }
    broadcastState();
  });

  bridgeState.oscClient.on('last_event_time', (raw: unknown) => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
    const value: number | null = raw;
    bridgeState.manager?.updateArrangementEndTime(value);
    broadcastState();
  });

  bridgeState.oscClient.on('metronome', (raw: unknown) => {
    if (typeof raw !== 'boolean') return;
    const metronome = raw;
    bridgeState.manager?.updateMetronome(metronome);
    broadcastState();
  });

  bridgeState.oscClient.on('signature_numerator', (raw: unknown) => {
    if (typeof raw !== 'number') return;
    const val = raw;
    const currentState = bridgeState.manager?.getState();
    if (currentState) {
      bridgeState.manager?.updateSignature(val, currentState.signatureDenominator);
    }
    broadcastState();
  });

  bridgeState.oscClient.on('signature_denominator', (raw: unknown) => {
    if (typeof raw !== 'number') return;
    const val = raw;
    const currentState = bridgeState.manager?.getState();
    if (currentState) {
      bridgeState.manager?.updateSignature(currentState.signatureNumerator, val);
    }
    broadcastState();
  });

  bridgeState.oscClient.on('clip_trigger_quantization', (raw: unknown) => {
    if (typeof raw !== 'number') return;
    const val = raw;
    bridgeState.manager?.updateQuantization(val);
    broadcastState();
  });
}

function toCuePoints(raw: unknown): Array<{ name: string; time: number }> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<{ name: string; time: number }> = [];
  for (const item of raw) {
    if (!isPlainObject(item)) return null;
    const name = item['name'];
    const time = item['time'];
    if (typeof name !== 'string') return null;
    if (typeof time !== 'number' || !Number.isFinite(time)) return null;
    out.push({ name, time });
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
