import type { OscBridgeKind, OscDebugSnapshot } from '../integration/osc-client.js';

export type OscDiagnosticState = 'stopped' | 'port-conflict' | 'no-reply' | 'responding' | 'stale';

export interface OscDiagnosticModel {
  state: OscDiagnosticState;
  listenPort: number | null;
  rxCount: number;
  txCount: number;
  lastReplyAgeMs: number | null;
  /** Which remote script the client settled on; null while stopped or undecided. */
  bridge: OscBridgeKind | null;
  bridgeVersion: string | null;
  targetPort: number | null;
}

export function buildOscDiagnosticModel({
  serverRunning,
  snapshot,
}: {
  serverRunning: boolean;
  snapshot: OscDebugSnapshot | null;
}): OscDiagnosticModel {
  if (!serverRunning || !snapshot) {
    return {
      state: 'stopped',
      listenPort: null,
      rxCount: 0,
      txCount: 0,
      lastReplyAgeMs: null,
      bridge: null,
      bridgeVersion: null,
      targetPort: null,
    };
  }

  const bridge = snapshot.oscBridge ?? null;
  const base = {
    listenPort: snapshot.oscListenPort > 0 ? snapshot.oscListenPort : null,
    rxCount: snapshot.oscRxCount,
    txCount: snapshot.oscTxCount,
    lastReplyAgeMs: snapshot.oscTimeSinceLastMessageMs,
    bridge,
    bridgeVersion: snapshot.oscBridgeVersion ?? null,
    targetPort: snapshot.oscTargetPort > 0 ? snapshot.oscTargetPort : null,
  };

  // A stock AbletonOSC answers on 11001 only. Being pushed off it by another
  // extension means silence; RC Bridge answers whichever port asked, so the
  // ephemeral port it gets is never a conflict.
  if (bridge !== 'rcbridge' && snapshot.oscRxCount === 0 && base.listenPort !== null && base.listenPort !== 11001) {
    return { state: 'port-conflict', ...base };
  }
  if (snapshot.oscRxCount === 0) {
    return { state: 'no-reply', ...base };
  }
  if (snapshot.oscIsConnected) {
    return { state: 'responding', ...base };
  }
  return { state: 'stale', ...base };
}
