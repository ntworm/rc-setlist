export interface Section {
  name: string;
  time: number;
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
  | 'acknowledged'
  | 'confirmed'
  | 'failed'
  | 'expired'
  | 'cancelled';

export interface ShowCommand<TPayload = any> {
  commandId: string;
  type: string;
  payload: TPayload;
  sourceClientId: string;
  createdAt: number;
  status: CommandStatus;
  retryCount: number;
  maxRetries: number;
  timeoutMs: number;
}

import { WebSocket } from 'ws';

export interface AugmentedWebSocket extends WebSocket {
  isController?: boolean;
  clientId?: string;
  synchronized?: boolean;
  handshakeStateVersion?: number;
  skipHandshakeCheck?: boolean;
  remoteAddress?: string;
}
