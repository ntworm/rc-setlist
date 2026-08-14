import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SetlistManager } from './setlist-manager.js';
import { JumpScheduler } from './next-downbeat-jump.js';
import { PreRollCoordinator, type PreRollFinishAction } from './pre-roll-coordinator.js';
import { OSCClient } from '../integration/osc-client.js';
import { SetlistWSServer } from '../server/ws.js';
import { ProfileManager, ProfileError } from './profile-manager.js';
import { EventLogger } from './event-log.js';
import { CommandBus } from './command-bus.js';
import { McpTcpClient } from '../integration/mcp-client.js';
import { McpFallbackSync } from '../integration/mcp-fallback-sync.js';
import { parseLrc, parseTxt } from './lyrics-parser.js';
import {
  initializeProjectProfileScope,
  recoverCompatibleLegacyPayload,
  ProjectProfilePromotionCancelledError,
  type ProjectProfileScope,
} from './project-profile-scope.js';
import type { ProjectIdentity } from './project-identity.js';
import type { ProfileManagerOptions } from './profile-manager.js';

export interface BridgeState {
  manager: SetlistManager | null;
  scheduler: JumpScheduler | null;
  preRollCoordinator: PreRollCoordinator | null;
  oscClient: OSCClient | null;
  wsServer: SetlistWSServer | null;
  profileManager: ProfileManager | null;
  eventLogger: EventLogger | null;
  commandBus: CommandBus | null;
  server: http.Server | https.Server | null;
  mcpClient: McpTcpClient | null;
  mcpFallbackSync: McpFallbackSync | null;

  pollInterval: NodeJS.Timeout | null;
  sdkSyncInterval: NodeJS.Timeout | null;
  mcpSyncInterval: NodeJS.Timeout | null;

  serverRunning: boolean;
  lastActiveSongTitle: string;
  lastCuesFingerprint: string;
  isCreatingTestSession: boolean;
  authToken: string;
  globalPersistenceDir: string;
  projectIdentity: ProjectIdentity | null;
  profileScopeSwitching: boolean;
  lastSongHandleId: string;
  projectSessionId: string;
  promotionBlockedProjectSessionId: string;
  legacyRecoveryKey: string;
  legacyRecoveryPending: boolean;
  legacyRecoveryPromise: Promise<void> | null;
}

export const bridgeState: BridgeState = {
  manager: null,
  scheduler: null,
  preRollCoordinator: null,
  oscClient: null,
  wsServer: null,
  profileManager: null,
  eventLogger: null,
  commandBus: null,
  server: null,
  mcpClient: null,
  mcpFallbackSync: null,

  pollInterval: null,
  sdkSyncInterval: null,
  mcpSyncInterval: null,

  serverRunning: false,
  lastActiveSongTitle: '',
  lastCuesFingerprint: '__init__',
  isCreatingTestSession: false,
  authToken: '',
  globalPersistenceDir: '',
  projectIdentity: null,
  profileScopeSwitching: false,
  lastSongHandleId: '',
  projectSessionId: '',
  promotionBlockedProjectSessionId: '',
  legacyRecoveryKey: '',
  legacyRecoveryPending: false,
  legacyRecoveryPromise: null,
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

function applyPreRollFinish(action: PreRollFinishAction | null): PreRollFinishAction | null {
  if (action?.restoreMetronome) {
    bridgeState.oscClient?.setMetronome(false);
    bridgeState.manager?.updateMetronome(false);
  }
  return action;
}

export function observePreRollPosition(currentBeat: number): void {
  applyPreRollFinish(bridgeState.preRollCoordinator?.observePosition(currentBeat) ?? null);
}

export function observePreRollTransport(isPlaying: boolean): void {
  applyPreRollFinish(bridgeState.preRollCoordinator?.observeTransport(isPlaying) ?? null);
}

export function cancelActivePreRoll(): PreRollFinishAction | null {
  return applyPreRollFinish(bridgeState.preRollCoordinator?.cancel() ?? null);
}

export function profileStatePayload() {
  const manager = requireProfileManager();
  const profiles = manager.list().map(({ id, name }) => ({ id, name }));
  const deletedProfiles = manager.listDeleted().map(({ id, name, deletedAt }) => ({ id, name, deletedAt }));
  return {
    type: 'profiles_state',
    version: 2,
    activeProfileId: manager.getActive().id,
    profiles,
    deletedProfiles,
    canMutate: bridgeState.manager
      ? !bridgeState.manager.getState().isPlaying && !bridgeState.profileScopeSwitching
      : false,
    projectName: bridgeState.projectIdentity?.displayName ?? '',
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

export function attemptCompatibleLegacyRecovery(): Promise<void> {
  if (bridgeState.legacyRecoveryPending) {
    return bridgeState.legacyRecoveryPromise ?? Promise.resolve();
  }
  if (
    bridgeState.projectIdentity?.source !== 'session'
    || !bridgeState.manager
    || !bridgeState.profileManager
  ) return Promise.resolve();

  const state = bridgeState.manager.getState();
  const setlistManager = bridgeState.manager;
  const profileManager = bridgeState.profileManager;
  const identityKey = bridgeState.projectIdentity.key;
  const songTitles = state.songs.map(({ title }) => title);
  if (songTitles.length === 0) return Promise.resolve();
  const key = `${identityKey}:${profileManager.getActive().id}:${songTitles
    .map((title) => title.normalize('NFKC').trim().toLocaleLowerCase('und'))
    .sort()
    .join('|')}`;
  if (key === bridgeState.legacyRecoveryKey) return Promise.resolve();

  bridgeState.legacyRecoveryPending = true;
  const recovery = recoverCompatibleLegacyPayload({
    storageRoot: bridgeState.globalPersistenceDir,
    manager: profileManager,
    songTitles,
  }).then((result) => {
    if (
      !result.recovered
      || bridgeState.manager !== setlistManager
      || bridgeState.profileManager !== profileManager
      || bridgeState.projectIdentity?.key !== identityKey
    ) return;
    const recoveredIsActive = profileManager.getActive().id === result.profileId;
    if (recoveredIsActive) setlistManager.setCustomOrder(result.customOrder);
    bridgeState.lastActiveSongTitle = '';
    broadcastProfileState();
    broadcastState();
    const nextState = setlistManager.getState();
    const currentSong = nextState.songs[nextState.activeSongIndex];
    if (recoveredIsActive && currentSong) checkAndBroadcastLyrics(currentSong.title);
  }).catch((error) => {
    console.error(`[Lyrics] Compatible legacy recovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }).finally(() => {
    if (
      bridgeState.profileManager === profileManager
      && bridgeState.projectIdentity?.key === identityKey
    ) {
      bridgeState.legacyRecoveryKey = key;
      bridgeState.legacyRecoveryPending = false;
    }
    if (bridgeState.legacyRecoveryPromise === recovery) {
      bridgeState.legacyRecoveryPromise = null;
    }
  });
  bridgeState.legacyRecoveryPromise = recovery;
  return recovery;
}

export function loadCustomOrder(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new ProfileError('profile_io_error', 'Custom order is invalid.');
  }
  return parsed;
}

export interface ProfileScopePromotionAuthorization {
  sourceIdentityKey: string;
  projectSessionId: string;
}

export async function activateProjectProfileScope(
  identity: ProjectIdentity,
  managerOptions?: ProfileManagerOptions,
  promotionAuthorization?: ProfileScopePromotionAuthorization,
  activationGuard?: () => boolean,
): Promise<ProjectProfileScope> {
  const previousScope = bridgeState.profileManager && bridgeState.projectIdentity
    ? {
        identity: bridgeState.projectIdentity,
        root: path.resolve(bridgeState.globalPersistenceDir, 'project-setlists', bridgeState.projectIdentity.key),
        manager: bridgeState.profileManager,
      }
    : null;
  const promoteFrom = previousScope
    && promotionAuthorization
    && promotionAuthorization.sourceIdentityKey === previousScope.identity.key
    && promotionAuthorization.projectSessionId === bridgeState.projectSessionId
    ? previousScope
    : undefined;
  const promotionGuard = promoteFrom
    ? () => bridgeState.projectSessionId === promotionAuthorization!.projectSessionId
      && bridgeState.projectIdentity?.key === promotionAuthorization!.sourceIdentityKey
      && bridgeState.profileManager === previousScope!.manager
    : undefined;
  const ensureActivationAllowed = () => {
    if (activationGuard && !activationGuard()) {
      throw new Error('Project profile scope activation was cancelled.');
    }
  };
  ensureActivationAllowed();
  if (promoteFrom && bridgeState.legacyRecoveryPromise) {
    await bridgeState.legacyRecoveryPromise;
  }
  ensureActivationAllowed();
  if (promotionGuard && !promotionGuard()) {
    throw new ProjectProfilePromotionCancelledError();
  }
  const scope = await initializeProjectProfileScope({
    storageRoot: bridgeState.globalPersistenceDir,
    identity,
    ...(promoteFrom ? { promoteFrom } : {}),
    ...(promotionGuard ? { promotionGuard } : {}),
    ...(managerOptions ? { managerOptions } : {}),
  });
  ensureActivationAllowed();
  if (promotionGuard && !promotionGuard()) {
    throw new ProjectProfilePromotionCancelledError();
  }
  const nextOrder = loadCustomOrder(scope.manager.getActivePaths().customOrder);
  ensureActivationAllowed();
  if (promotionGuard && !promotionGuard()) {
    throw new Error('Project profile scope promotion was cancelled.');
  }

  bridgeState.profileManager = scope.manager;
  bridgeState.projectIdentity = identity;
  bridgeState.manager?.setCustomOrder(nextOrder);
  bridgeState.lastActiveSongTitle = '';
  bridgeState.legacyRecoveryKey = '';
  bridgeState.legacyRecoveryPending = false;
  bridgeState.legacyRecoveryPromise = null;
  broadcastProfileState();
  broadcastState();
  const currentSong = bridgeState.manager?.getState().songs[bridgeState.manager.getState().activeSongIndex];
  if (currentSong) checkAndBroadcastLyrics(currentSong.title);
  return scope;
}

export async function selectProfile(id: string): Promise<void> {
  const profiles = requireProfileManager();
  const nextPaths = profiles.getPaths(id);
  const nextOrder = loadCustomOrder(nextPaths.customOrder);
  await profiles.select(id);
  bridgeState.manager!.setCustomOrder(nextOrder);
  bridgeState.lastActiveSongTitle = '';
  bridgeState.legacyRecoveryKey = '';
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
