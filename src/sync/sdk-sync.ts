import { type ExtensionContext } from '../context.js';
import { attemptCompatibleLegacyRecovery, bridgeState, broadcastState } from '../core/bridge-state.js';

export function syncFromSdkContext(context: ExtensionContext): void {
  if (!bridgeState.manager) return;

  const oldVersion = bridgeState.manager.getState().stateVersion;
  const song = context.application?.song;

  if (song) {
    try {
      if (typeof song.tempo === 'number') {
        bridgeState.manager.updateTransport(
          bridgeState.manager.getState().currentSongTime,
          bridgeState.manager.getState().isPlaying,
          song.tempo
        );
      }
    } catch {}

    try {
      const sdkCues = song.cuePoints || [];
      const cues = sdkCues.map((c: { name?: string; time?: number }) => ({
        name: c.name || '',
        time: c.time || 0
      }));

      const sorted = [...cues].sort((a, b) => a.time - b.time);
      const fingerprint = sorted.map(c => `${c.name}@${c.time}`).join('|');
      if (fingerprint !== bridgeState.lastCuesFingerprint) {
        bridgeState.lastCuesFingerprint = fingerprint;
        bridgeState.manager.updateCues(cues);
        void attemptCompatibleLegacyRecovery();
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
