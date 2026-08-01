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
  | 'acknowledged'
  | 'confirmed'
  | 'failed'
  | 'expired'
  | 'cancelled';

export type CommandFailureReason =
  | 'panic_active'
  | 'critical_commands_locked'
  | 'execution_failed'
  | 'timeout';

type ClientMessageBase = {
  type: string;
  commandId?: string;
};

export type ClientMessage =
  | (ClientMessageBase & { type: 'handshake'; clientId: string })
  | (ClientMessageBase & { type: 'sync_confirm'; stateVersion: number })
  | (ClientMessageBase & { type: 'get_lyrics'; song?: string })
  | (ClientMessageBase & { type: 'profiles_get' })
  | (ClientMessageBase & { type: 'preflight_check' })
  | (ClientMessageBase & { type: 'play' })
  | (ClientMessageBase & { type: 'stop' })
  | (ClientMessageBase & { type: 'refresh' })
  | (ClientMessageBase & { type: 'export_csv' })
  | (ClientMessageBase & { type: 'create_test_session' })
  | (ClientMessageBase & { type: 'metronome'; value: boolean })
  | (ClientMessageBase & { type: 'set_quantization'; value: number })
  | (ClientMessageBase & { type: 'jump'; songIndex: number; sectionIndex?: number | null })
  | (ClientMessageBase & { type: 'reorder'; songTitles: string[] })
  | (ClientMessageBase & { type: 'save_lyrics'; song: string; text: string })
  | (ClientMessageBase & { type: 'click_preview'; bpm?: number; beats?: number })
  | (ClientMessageBase & { type: 'set_panic'; active: boolean })
  | (ClientMessageBase & { type: 'set_critical_lock'; locked: boolean })
  | (ClientMessageBase & { type: 'set_mode'; mode: 'rehearsal' | 'show' })
  | (ClientMessageBase & { type: 'profile_create'; name: string })
  | (ClientMessageBase & { type: 'profile_select'; id: string })
  | (ClientMessageBase & { type: 'profile_restore'; id: string })
  | (ClientMessageBase & { type: 'profile_rename'; id: string; name: string })
  | (ClientMessageBase & { type: 'profile_delete'; id: string; confirmationName: string });

export interface ShowCommand<TPayload = unknown> {
  commandId: string;
  type: string;
  payload: TPayload;
  sourceClientId: string;
  createdAt: number;
  status: CommandStatus;
  retryCount: number;
  maxRetries: number;
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
