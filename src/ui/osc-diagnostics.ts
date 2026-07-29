import type { OscDebugSnapshot } from '../integration/osc-client.js';

export type OscDiagnosticState = 'stopped' | 'port-conflict' | 'no-reply' | 'responding' | 'stale';

export interface OscDiagnosticModel {
  state: OscDiagnosticState;
  listenPort: number | null;
  rxCount: number;
  txCount: number;
  lastReplyAgeMs: number | null;
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
    };
  }

  const base = {
    listenPort: snapshot.oscListenPort > 0 ? snapshot.oscListenPort : null,
    rxCount: snapshot.oscRxCount,
    txCount: snapshot.oscTxCount,
    lastReplyAgeMs: snapshot.oscTimeSinceLastMessageMs,
  };

  if (snapshot.oscRxCount === 0 && base.listenPort !== null && base.listenPort !== 11001) {
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
