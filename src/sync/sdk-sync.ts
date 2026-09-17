import { type ExtensionContext } from '../context.js';
import {
  attemptCompatibleLegacyRecovery,
  bridgeState,
  broadcastState,
  refreshSongBook,
} from '../runtime/bridge-state.js';
import { computeCuesFingerprint } from '../core/locator-parser.js';
import { log } from '../util/log.js';

/**
 * SyncFromSdkContext — implementation detail.
 */
export function syncFromSdkContext(context: ExtensionContext): void {
  if (!bridgeState.manager) return;

  const oldVersion = bridgeState.manager.getState().stateVersion;
  const song = context.application?.song;

  if (song) {
    try {
      if (typeof song.tempo === 'number') {
        bridgeState.manager.updateTempo(song.tempo);
      }
    } catch {
      // swallow: nothing to do here on purpose
    }

    try {
      const sdkCues = song.cuePoints;
      if (Array.isArray(sdkCues)) {
        // An empty array is a valid snapshot (new empty Set or last locator
        // deleted). Only unavailable/non-array data may retain the old cues.
        const cues = sdkCues.map((c: { name?: string; time?: number }) => ({
          name: c.name || '',
          time: c.time || 0,
        }));
        const fingerprint = computeCuesFingerprint(cues);
        if (fingerprint !== bridgeState.lastCuesFingerprint) {
          bridgeState.lastCuesFingerprint = fingerprint;
          bridgeState.manager.updateCues(cues);
          refreshSongBook();
          void attemptCompatibleLegacyRecovery();
        }
      }
    } catch (err) {
      log.error('sdk', 'Failed to sync cue points', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (bridgeState.commandBus) {
    bridgeState.commandBus.resolveObservableConfirmations();
  }

  if (bridgeState.manager.getState().stateVersion !== oldVersion) {
    broadcastState();
  }
}
