import { type ExtensionContext } from '../context.js';
import { attemptCompatibleLegacyRecovery, bridgeState, broadcastState, refreshSongBook } from '../core/bridge-state.js';
import { computeCuesFingerprint } from '../core/locator-parser.js';

export function syncFromSdkContext(context: ExtensionContext): void {
  if (!bridgeState.manager) return;

  const oldVersion = bridgeState.manager.getState().stateVersion;
  const song = context.application?.song;

  if (song) {
    try {
      if (typeof song.tempo === 'number') {
        bridgeState.manager.updateTempo(song.tempo);
      }
    } catch {}

    try {
      const sdkCues = song.cuePoints;
      if (Array.isArray(sdkCues)) {
        // An empty array is a valid snapshot (new empty Set or last locator
        // deleted). Only unavailable/non-array data may retain the old cues.
        const cues = sdkCues.map((c: { name?: string; time?: number }) => ({
          name: c.name || '',
          time: c.time || 0
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
      console.error('[SDK-Sync] Failed to sync cue points:', err);
    }
  }

  if (bridgeState.commandBus) {
    bridgeState.commandBus.resolveObservableConfirmations();
  }

  if (bridgeState.manager.getState().stateVersion !== oldVersion) {
    broadcastState();
  }
}
