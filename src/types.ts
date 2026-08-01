export interface Section {
  name: string;
  time: number;
  automationOnly?: true;
  loopCount: number | null;
  autoStop: boolean;
  autoNext: boolean;
  bpm: number | null;
  autoClick: boolean | null; // null = no change, true = click on, false = click off
  skip: boolean;
}

export interface Song {
  title: string;
  time: number;
  durationSeconds?: number | null;
  sections: Section[];
  loopCount: number | null;
  autoStop: boolean;
  autoNext: boolean;
  bpm: number | null;
  autoClick: boolean | null;
  skip: boolean;
}

export interface Setlist {
  songs: Song[];
  hidden: { name: string; time: number }[];
}

export interface SetlistState {
  protocolVersion?: 2;
  setlistVersion?: number;
  songs: Song[];
  hidden: { name: string; time: number }[];
  activeSongIndex: number;
  activeSectionIndex: number;
  isPlaying: boolean;
  tempo: number;
  currentSongTime: number;
  metronome: boolean;
  signatureNumerator: number;
  signatureDenominator: number;
  loopIteration?: { current: number; total: number } | null;
  loopActive: boolean;
  loopCount: number | null;
  currentLoopIteration: number;
  clipTriggerQuantization: number;
  totalDurationSeconds?: number | null;
  arrangementEndTime?: number | null;

  // Reliability Core state fields
  stateVersion: number;
  connection: {
    ableton: 'disconnected' | 'connecting' | 'synced' | 'degraded';
    osc: 'disconnected' | 'connecting' | 'synced' | 'degraded';
  };
  transport: {
    isPlaying: boolean;
    position: number;
    tempo?: number;
  };
  currentSongId?: string;
  currentSectionId?: string;
  pendingCommands: string[];
  mode: 'rehearsal' | 'show';
  safety: {
    panicActive: boolean;
    criticalCommandsLocked: boolean;
  };
}

export type CommandStatus =
  | 'created'
  | 'sent'
  | 'confirmed'
  | 'failed'
  | 'expired'
  | 'cancelled';

export type CommandFailureReason =
  | 'panic_active'
  | 'critical_commands_locked'
  | 'execution_failed'
  | 'timeout';

export interface ShowCommand<TPayload = unknown> {
  commandId: string;
  type: string;
  payload: TPayload;
  sourceClientId: string;
  createdAt: number;
  status: CommandStatus;
  timeoutMs: number;
  reason?: CommandFailureReason;
}

import { WebSocket } from 'ws';

export interface AugmentedWebSocket extends WebSocket {
  isController?: boolean;
  isAlive?: boolean;
  clientId?: string;
  synchronized?: boolean;
  handshakeStateVersion?: number;
  skipHandshakeCheck?: boolean;
  remoteAddress?: string;
}
