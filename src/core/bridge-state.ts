import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SetlistManager } from './setlist-manager.js';
import { JumpScheduler } from './next-downbeat-jump.js';
import { OSCClient } from '../integration/osc-client.js';
import { SetlistWSServer } from '../server/ws.js';
import { ProfileManager, ProfileError } from './profile-manager.js';
import { EventLogger } from './event-log.js';
import { CommandBus } from './command-bus.js';
import { McpTcpClient } from '../integration/mcp-client.js';
import { parseLrc, parseTxt } from './lyrics-parser.js';

export interface BridgeState {
  manager: SetlistManager | null;
  scheduler: JumpScheduler | null;
  oscClient: OSCClient | null;
  wsServer: SetlistWSServer | null;
  profileManager: ProfileManager | null;
  eventLogger: EventLogger | null;
  commandBus: CommandBus | null;
  server: http.Server | https.Server | null;
  mcpClient: McpTcpClient | null;

  pollInterval: NodeJS.Timeout | null;
  sdkSyncInterval: NodeJS.Timeout | null;
  mcpSyncInterval: NodeJS.Timeout | null;

  serverRunning: boolean;
  lastActiveSongTitle: string;
  lastCuesFingerprint: string;
  isCreatingTestSession: boolean;
  authToken: string;
  globalPersistenceDir: string;
}

export const bridgeState: BridgeState = {
  manager: null,
  scheduler: null,
  oscClient: null,
  wsServer: null,
  profileManager: null,
  eventLogger: null,
  commandBus: null,
  server: null,
  mcpClient: null,

  pollInterval: null,
  sdkSyncInterval: null,
  mcpSyncInterval: null,

  serverRunning: false,
  lastActiveSongTitle: '',
  lastCuesFingerprint: '__init__',
  isCreatingTestSession: false,
  authToken: '',
  globalPersistenceDir: '',
};

export function requireProfileManager(): ProfileManager {
  if (!bridgeState.profileManager) {
    throw new ProfileError('profile_io_error', 'Profiles are not initialized.');
  }
  return bridgeState.profileManager;
}

export function getActiveProfilePaths() {
  return requireProfileManager().getActivePaths();
}

export function broadcastState(): void {
  if (bridgeState.manager && bridgeState.wsServer) {
    bridgeState.commandBus?.resolveObservableConfirmations();
    bridgeState.wsServer.broadcastState(bridgeState.manager.getState());
  }
}

export function profileStatePayload() {
  const profiles = requireProfileManager().list().map(({ id, name }) => ({ id, name }));
  return {
    type: 'profiles_state',
    version: 1,
    activeProfileId: requireProfileManager().getActive().id,
    profiles,
    canMutate: bridgeState.manager ? !bridgeState.manager.getState().isPlaying : false,
  } as const;
}

export function broadcastProfileState(): void {
  bridgeState.wsServer?.broadcast(profileStatePayload());
}

export function loadLyricsForSong(songTitle: string) {
  try {
    const cleanTitle = songTitle.replace(/[\\/:*?"<>|]/g, '_').trim();
    const lyricsDir = getActiveProfilePaths().lyrics;
    const lrcPath = path.join(lyricsDir, `${cleanTitle}.lrc`);
    const txtPath = path.join(lyricsDir, `${cleanTitle}.txt`);

    if (fs.existsSync(lrcPath)) {
      const content = fs.readFileSync(lrcPath, 'utf-8');
      return { type: 'lrc' as const, lines: parseLrc(content) };
    } else if (fs.existsSync(txtPath)) {
      const content = fs.readFileSync(txtPath, 'utf-8');
      return { type: 'txt' as const, lines: parseTxt(content) };
    }
  } catch (err) {
    console.error(`[Lyrics] Error loading lyrics for "${songTitle}":`, err);
  }
  return { type: 'none' as const, lines: [] };
}

export function checkAndBroadcastLyrics(activeSongTitle: string): void {
  if (activeSongTitle !== bridgeState.lastActiveSongTitle) {
    bridgeState.lastActiveSongTitle = activeSongTitle;
    const lyrics = loadLyricsForSong(activeSongTitle);
    bridgeState.wsServer?.broadcast({
      type: 'lyrics',
      song: activeSongTitle,
      format: lyrics.type,
      lines: lyrics.lines
    });
  }
}

export function loadCustomOrder(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new ProfileError('profile_io_error', 'Custom order is invalid.');
  }
  return parsed;
}

export async function selectProfile(id: string): Promise<void> {
  const profiles = requireProfileManager();
  const nextPaths = profiles.getPaths(id);
  const nextOrder = loadCustomOrder(nextPaths.customOrder);
  await profiles.select(id);
  bridgeState.manager!.setCustomOrder(nextOrder);
  bridgeState.lastActiveSongTitle = '';
  broadcastProfileState();
  broadcastState();
  const state = bridgeState.manager!.getState();
  const currentSong = state.songs[state.activeSongIndex];
  if (currentSong) {
    checkAndBroadcastLyrics(currentSong.title);
  }
}

export function runPreflightCheck(): { status: 'ready' | 'attention' | 'blocking'; reports: string[] } {
  const reports: string[] = [];
  let status: 'ready' | 'attention' | 'blocking' = 'ready';

  if (!bridgeState.oscClient || !bridgeState.oscClient.isConnected) {
    status = 'blocking';
    reports.push('Ableton Live is not connected via OSC.');
  }

  if (!bridgeState.profileManager || !bridgeState.profileManager.getActive()) {
    status = 'blocking';
    reports.push('No active setlist profile is selected.');
  }

  if (!bridgeState.serverRunning) {
    status = 'blocking';
    reports.push('The HTTP/WebSocket server is not running.');
  }

  if (bridgeState.manager) {
    const state = bridgeState.manager.getState();
    if (state.songs.length === 0) {
      if (status !== 'blocking') status = 'attention';
      reports.push('The setlist is empty (no locators parsed).');
    }

    const titles = state.songs.map(s => s.title);
    const unique = new Set(titles);
    if (unique.size !== titles.length) {
      if (status !== 'blocking') status = 'attention';
      reports.push('The setlist has songs with duplicate titles.');
    }

    for (const song of state.songs) {
      const lyrics = loadLyricsForSong(song.title);
      if (lyrics.type === 'none') {
        if (status !== 'blocking') status = 'attention';
        reports.push(`Missing lyrics for song: "${song.title}"`);
      }
    }
  }

  return { status, reports };
}
