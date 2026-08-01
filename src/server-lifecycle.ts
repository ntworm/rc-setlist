import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { StartServerOptions } from './index.js';
import {
  bridgeState,
  activateProjectProfileScope,
  broadcastState,
  broadcastProfileState,
  checkAndBroadcastLyrics,
  getActiveProfilePaths,
  requireProfileManager,
  profileStatePayload,
  selectProfile,
  loadLyricsForSong,
  runPreflightCheck,
} from './core/bridge-state.js';
import { getExtensionContext } from './context.js';
import { SetlistManager } from './core/setlist-manager.js';
import { JumpScheduler, type PendingJump } from './core/next-downbeat-jump.js';
import { EventLogger } from './core/event-log.js';
import { CommandBus } from './core/command-bus.js';
import { OSCClient } from './integration/osc-client.js';
import { SetlistWSServer } from './server/ws.js';
import { loadCerts, useHttps, httpsOptions } from './server/cert.js';
import {
  createHttpRequestListener,
  setCsvExportResolver,
  setAudioResolver,
  setDebugSnapshotProvider,
  setHttpAuthToken,
} from './server/http.js';
import { McpTcpClient } from './integration/mcp-client.js';
import { McpFallbackSync } from './integration/mcp-fallback-sync.js';
import { syncFromSdkContext } from './sync/sdk-sync.js';
import { syncFromMcpInfo } from './sync/mcp-sync.js';
import { registerOscListeners } from './osc/registration.js';
import { executeCommandAction } from './commands/handlers.js';
import type { ClientMessage } from './types.js';
import {
  resolveProjectIdentity,
  projectIdentityFromMetadata,
  projectSessionIdForSong,
  type ProjectIdentity,
} from './core/project-identity.js';

const PORT = 4444;
let projectRefreshPending = false;

export async function closeHttpServer(server: http.Server | https.Server): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  try {
    server.closeAllConnections?.();
  } catch {
    console.warn('[HTTP] Failed to close all connections.');
  }
  await closed;
}

function newProjectSessionId(): string {
  return randomBytes(16).toString('hex');
}

function currentSongHandleId(context: ReturnType<typeof getExtensionContext>): string {
  try {
    return context?.application?.song?.handle?.id?.toString() ?? '';
  } catch {
    return '';
  }
}

async function resolveActiveProjectIdentity(options: StartServerOptions): Promise<ProjectIdentity> {
  if (options.projectIdentity) return options.projectIdentity;
  if (options.skipProjectDetector) {
    return resolveProjectIdentity({
      platform: 'linux',
      sessionId: bridgeState.projectSessionId,
      getProjectMetadata: async () => null,
      readWindowTitle: async () => '',
    });
  }
  return resolveProjectIdentity({
    sessionId: bridgeState.projectSessionId,
    getProjectMetadata: async () => bridgeState.mcpClient?.getProjectMetadata() ?? null,
  });
}

async function refreshProjectScope(options: StartServerOptions): Promise<void> {
  if (options.projectIdentity || options.skipProjectDetector || !bridgeState.server) return;
  if (bridgeState.profileScopeSwitching) {
    projectRefreshPending = true;
    return;
  }

  bridgeState.profileScopeSwitching = true;
  broadcastProfileState();
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 350));
    const context = getExtensionContext();
    bridgeState.projectSessionId = projectSessionIdForSong(
      process.pid,
      currentSongHandleId(context),
      newProjectSessionId(),
    );
    const identity = await resolveActiveProjectIdentity(options);
    if (identity.key !== bridgeState.projectIdentity?.key) {
      console.log(`[Persistence] Live Set scope changed to: ${identity.displayName}`);
      await activateProjectProfileScope(identity);
    }
  } catch {
    console.error('[Persistence] Failed to switch Live Set scope.');
  } finally {
    bridgeState.profileScopeSwitching = false;
    broadcastProfileState();
    if (projectRefreshPending) {
      projectRefreshPending = false;
      void refreshProjectScope(options);
    }
  }
}

function getOrGenerateToken(): string {
  if (!fs.existsSync(bridgeState.globalPersistenceDir)) {
    fs.mkdirSync(bridgeState.globalPersistenceDir, { recursive: true });
  }
  const tokenPath = path.join(bridgeState.globalPersistenceDir, 'token');
  try {
    if (fs.existsSync(tokenPath)) {
      const tok = fs.readFileSync(tokenPath, 'utf8').trim();
      if (tok) return tok;
    }
  } catch (err) {
    console.error('[Security] Failed to read token:', err);
  }

  const token = randomBytes(16).toString('hex'); // 32 hex characters
  try {
    fs.writeFileSync(tokenPath, token, 'utf8');
    console.log('[Security] Generated new security token.');
  } catch (err) {
    console.error('[Security] Failed to write token:', err);
  }
  return token;
}

export function handleJumpSchedulerEvent(event: { type: 'replaced' | 'executed'; pending: PendingJump }): void {
  if (!bridgeState.oscClient || !bridgeState.manager) return;
  if (event.type === 'replaced') {
    bridgeState.wsServer?.broadcast({
      type: 'jump_pending',
      songIndex: event.pending.songIndex,
      sectionIndex: event.pending.sectionIndex,
      landingTime: event.pending.landingTime,
    });
    return;
  }

  const cueIndex = event.pending.cueIndex;
  if (cueIndex >= 0) bridgeState.oscClient.jumpToCuePoint(cueIndex);
  else bridgeState.oscClient.jumpToCuePoint(event.pending.cueName);

  if (event.pending.sectionIndex !== null && event.pending.sectionIndex !== undefined) {
    const song = bridgeState.manager.getState().songs[event.pending.songIndex];
    const section = song?.sections[event.pending.sectionIndex];
    if (section && section.loopCount !== null) {
      const loopRegion = bridgeState.manager.getLoopRegion(event.pending.songIndex, event.pending.sectionIndex);
      if (loopRegion) {
        bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 1 }]);
        bridgeState.oscClient.send('/live/song/set/loop_start', [{ type: 'float', value: loopRegion.start }]);
        bridgeState.oscClient.send('/live/song/set/loop_length', [{ type: 'float', value: loopRegion.duration }]);
      }
    } else {
      bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
    }
  } else {
    bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 0 }]);
  }

  bridgeState.manager.clearLoop();
  bridgeState.manager.resetFiredAutomations();
  bridgeState.wsServer?.broadcast({
    type: 'jump_executed',
    songIndex: event.pending.songIndex,
    sectionIndex: event.pending.sectionIndex,
  });
}

export async function startServer(options: StartServerOptions = {}): Promise<void> {
  if (bridgeState.server) return;

  const listenPort = options.port ?? PORT;

  try {
    bridgeState.manager = new SetlistManager();
    bridgeState.lastCuesFingerprint = '__init__';
    bridgeState.scheduler = new JumpScheduler();
    bridgeState.scheduler.on(handleJumpSchedulerEvent);

    const context = getExtensionContext();
    if (context && context.environment.storageDirectory) {
      bridgeState.globalPersistenceDir = context.environment.storageDirectory;
      console.log('[Persistence] Storage directory available.');
    } else {
      bridgeState.globalPersistenceDir = typeof __dirname !== 'undefined' ? path.join(__dirname, '../.setlist') : './.setlist';
    }
    bridgeState.authToken = getOrGenerateToken();
    setHttpAuthToken(bridgeState.authToken);

    const fallbackSessionId = bridgeState.projectSessionId || newProjectSessionId();
    bridgeState.projectSessionId = projectSessionIdForSong(
      process.pid,
      currentSongHandleId(context),
      fallbackSessionId,
    );
    bridgeState.mcpClient = options.skipProjectDetector ? null : new McpTcpClient();
    const projectIdentity = await resolveActiveProjectIdentity(options);
    await activateProjectProfileScope(projectIdentity);

    bridgeState.eventLogger = new EventLogger(bridgeState.globalPersistenceDir);
    bridgeState.commandBus = new CommandBus(bridgeState.manager, bridgeState.eventLogger);

    bridgeState.commandBus.on('command_settled', (cmd) => {
      bridgeState.wsServer?.broadcast({
        type: 'command_status',
        commandId: cmd.commandId,
        status: cmd.status,
        ...(cmd.reason ? { reason: cmd.reason } : {}),
      });
    });

    const hasContext = Boolean(context);
    bridgeState.manager?.setConnectionStatus('ableton', hasContext ? 'synced' : 'disconnected');
    bridgeState.lastSongHandleId = currentSongHandleId(context);

    const activePaths = getActiveProfilePaths();
    const orderFilePath = activePaths.customOrder;

    try {
      if (fs.existsSync(orderFilePath)) {
        const raw = fs.readFileSync(orderFilePath, 'utf-8');
        const order = JSON.parse(raw) as string[];
        bridgeState.manager.setCustomOrder(order);
        console.log('[Persistence] Custom song order loaded.');
      }
    } catch {
      console.error('[Persistence] Failed to load custom song order.');
    }

    setCsvExportResolver(async (rawName: string) => {
      const safeName = rawName.replace(/[^A-Za-z0-9_.\-]/g, '_');
      if (!safeName.endsWith('.csv')) return null;
      const p = path.join(getActiveProfilePaths().exports, safeName);
      try {
        await fs.promises.access(p, fs.constants.R_OK);
        return { absolutePath: p, friendlyName: safeName };
      } catch {
        return null;
      }
    });

    setAudioResolver(async (rawName: string) => {
      if (!/^click-preview-\d{2,3}bpm-\d{1,2}beats\.wav$/.test(rawName)) return null;
      const p = path.join(getActiveProfilePaths().audio, rawName);
      try {
        await fs.promises.access(p, fs.constants.R_OK);
        return { absolutePath: p, mimeType: 'audio/wav' };
      } catch {
        return null;
      }
    });

    setDebugSnapshotProvider(() => {
      const osc = bridgeState.oscClient?.getDebugSnapshot() ?? { error: 'osc client not initialized' };
      const state = bridgeState.manager?.getState();
      return {
        ...osc,
        managerTempo: state?.tempo ?? null,
        managerMetronome: state?.metronome ?? null,
        managerCurrentSongTime: state?.currentSongTime ?? null,
        managerIsPlaying: state?.isPlaying ?? null,
        managerClipTriggerQuantization: state?.clipTriggerQuantization ?? null,
        managerArrangementEndTime: state?.arrangementEndTime ?? null,
        managerActiveSong: state?.songs[state.activeSongIndex]?.title ?? null,
        managerActiveSection: state?.songs[state.activeSongIndex]?.sections[state.activeSectionIndex]?.name ?? null,
        pendingJump: bridgeState.scheduler?.getPending() ?? null,
        mcp: bridgeState.mcpFallbackSync?.getSnapshot() ?? null,
      };
    });

    if (!options.skipOsc) {
      bridgeState.oscClient = new OSCClient();

      bridgeState.oscClient.on('connect', () => {
        console.log('[OSC] Connection established. Registering listeners and fetching cue points...');
        bridgeState.wsServer?.broadcastLog('Connected to Ableton Live.', 'info');

        bridgeState.oscClient?.startPropertyListeners();
        bridgeState.oscClient?.startPolling();
        bridgeState.oscClient?.requestInitialState();
        bridgeState.oscClient?.getCuePoints();

        bridgeState.manager?.setConnectionStatus('osc', 'synced');
        bridgeState.eventLogger?.log({ type: 'osc_connected', message: 'OSC connection to Ableton Live established' });
      });

      bridgeState.oscClient.on('disconnect', () => {
        console.warn('[OSC] Connection to Ableton Live lost.');
        bridgeState.lastCuesFingerprint = '__init__';
        bridgeState.wsServer?.broadcastLog('⚠ Lost connection to Ableton Live. Reconnecting...', 'warn');

        bridgeState.manager?.setConnectionStatus('osc', 'disconnected');
        bridgeState.eventLogger?.log({ type: 'osc_disconnected', message: 'OSC connection to Ableton Live lost' });
      });

      await bridgeState.oscClient.start();

      registerOscListeners(options);

      bridgeState.pollInterval = setInterval(() => {
        bridgeState.oscClient?.getCurrentSongTime();
      }, 100);
    }

    bridgeState.wsServer = new SetlistWSServer(bridgeState.authToken);
    bridgeState.wsServer.init();

    if (!options.skipCerts) {
      await loadCerts();
    }

    const srv = (useHttps && httpsOptions && !options.skipCerts)
      ? https.createServer(httpsOptions, createHttpRequestListener())
      : http.createServer(createHttpRequestListener());
    bridgeState.server = srv;

    srv.on('upgrade', (req, socket, head) => {
      bridgeState.wsServer?.handleUpgrade(req, socket, head);
    });

    await new Promise<void>((resolve, reject) => {
      let onError: (err: Error) => void;
      let onListening: () => void;

      onError = (err: Error) => {
        srv.off('listening', onListening);
        reject(err);
      };

      onListening = () => {
        srv.off('error', onError);
        console.log(`[HTTP] Server running over ${useHttps && httpsOptions && !options.skipCerts ? 'HTTPS' : 'HTTP'} on port ${listenPort}`);
        resolve();
      };

      srv.once('error', onError);
      srv.once('listening', onListening);

      srv.listen(listenPort);
    });

    bridgeState.wsServer.on('client_message', async (msg: ClientMessage, ws) => {
      if (!bridgeState.manager) return;

      const isController = ws.isController === true;
      const isSynchronized = ws.synchronized === true || ws.skipHandshakeCheck || process.env.NODE_ENV === 'test';
      const allowedBeforeSync = new Set(['handshake', 'sync_confirm', 'auth', 'get_lyrics']);

      if (!allowedBeforeSync.has(msg.type) && !isSynchronized) {
        ws.send(JSON.stringify({ type: 'error', code: 'not_synchronized', message: 'Client is not synchronized.' }));
        return;
      }

      if (msg.type === 'handshake') {
        ws.clientId = msg.clientId;
        ws.synchronized = false;
        const state = bridgeState.manager.getState();
        ws.handshakeStateVersion = state.stateVersion;
        ws.send(JSON.stringify({
          type: 'handshake_ack',
          stateVersion: state.stateVersion,
          state,
        }));
        if (isController) {
          ws.send(JSON.stringify(profileStatePayload()));
        }
        return;
      }

      if (msg.type === 'sync_confirm') {
        if (msg.stateVersion === ws.handshakeStateVersion) {
          ws.synchronized = true;
          ws.handshakeStateVersion = undefined;
          bridgeState.eventLogger?.log({ type: 'client_synchronized', clientId: ws.clientId, message: `Client synchronized at state version ${msg.stateVersion}` });
        }
        return;
      }

      const readOnlyTypes = new Set(['get_lyrics', 'profiles_get', 'preflight_check']);
      if (!readOnlyTypes.has(msg.type) && !isController) {
        console.warn(`[Security] WS client tried to execute command '${msg.type}' without controller permissions.`);
        ws.send(JSON.stringify({ type: 'error', code: 'unauthorized', message: 'Unauthorized: controller permission is required.' }));
        return;
      }

      if (msg.type === 'get_lyrics') {
        const requestedTitle = (typeof msg.song === 'string' && msg.song.length)
          ? msg.song
          : bridgeState.manager.getState().songs[bridgeState.manager.getState().activeSongIndex]?.title;
        if (!requestedTitle) {
          ws.send(JSON.stringify({ type: 'lyrics', song: '', format: 'none', lines: [] }));
          return;
        }
        const lyrics = loadLyricsForSong(requestedTitle);
        ws.send(JSON.stringify({
          type: 'lyrics',
          song: requestedTitle,
          format: lyrics.type,
          lines: lyrics.lines
        }));
        return;
      }

      const commandId = msg.commandId || `legacy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      if (bridgeState.commandBus?.isDuplicate(commandId)) {
        console.warn(`[CommandBus] Discarding duplicate command ID: ${commandId}`);
        return;
      }

      const command = bridgeState.commandBus?.registerCommand(
        commandId,
        msg.type,
        msg,
        ws.clientId || ws.remoteAddress || 'unknown'
      );

      if (command) {
        bridgeState.commandBus?.dispatch(command, async () => {
          if (command.type === 'profiles_get') {
            ws.send(JSON.stringify(profileStatePayload()));
            return;
          }
          if (command.type === 'preflight_check') {
            const preflight = runPreflightCheck();
            ws.send(JSON.stringify({
              type: 'preflight_result',
              status: preflight.status,
              reports: preflight.reports,
            }));
            return;
          }

          await executeCommandAction(command, ws);
        });
      }
    });

    if (context) {
      bridgeState.sdkSyncInterval = setInterval(() => {
        try {
          const nextSongHandleId = currentSongHandleId(context);
          if (
            nextSongHandleId &&
            bridgeState.lastSongHandleId &&
            nextSongHandleId !== bridgeState.lastSongHandleId
          ) {
            bridgeState.lastSongHandleId = nextSongHandleId;
            void refreshProjectScope(options);
          } else if (nextSongHandleId && !bridgeState.lastSongHandleId) {
            bridgeState.lastSongHandleId = nextSongHandleId;
          }
          syncFromSdkContext(context);
        } catch (err) {
          console.error('[SDK-Sync] Error during polling sync:', err);
        }
      }, 100);
    }

    if (bridgeState.mcpClient) {
      bridgeState.mcpFallbackSync = new McpFallbackSync({
        client: bridgeState.mcpClient,
        onSessionInfo: (info) => syncFromMcpInfo(info),
        onSongLength: (length) => {
          if (!bridgeState.manager) return;
          const oldVersion = bridgeState.manager.getState().stateVersion;
          bridgeState.manager.updateArrangementEndTime(length);
          if (bridgeState.manager.getState().stateVersion !== oldVersion) broadcastState();
        },
        needsProjectMetadata: () => bridgeState.projectIdentity?.source !== 'mcp-path',
        onProjectMetadata: async (metadata) => {
          const identity = projectIdentityFromMetadata(metadata);
          if (!identity || identity.key === bridgeState.projectIdentity?.key) return;
          if (bridgeState.profileScopeSwitching) {
            projectRefreshPending = true;
            return;
          }
          bridgeState.profileScopeSwitching = true;
          broadcastProfileState();
          try {
            console.log(`[Persistence] Delayed Live Set metadata resolved: ${identity.displayName}`);
            await activateProjectProfileScope(identity);
          } finally {
            bridgeState.profileScopeSwitching = false;
            broadcastProfileState();
            if (projectRefreshPending) {
              projectRefreshPending = false;
              void refreshProjectScope(options);
            }
          }
        },
      });
      bridgeState.mcpSyncInterval = setInterval(() => {
        void bridgeState.mcpFallbackSync?.tick().catch(() => {
          // MCP is optional. Keep OSC/SDK operation quiet while the bridge is absent.
        });
      }, 100);
    }

    bridgeState.serverRunning = true;
  } catch (err) {
    console.error('[rc-setlist] server startup failed; cleaning up.');
    await stopServer();
    throw err;
  }
}

export async function stopServer(): Promise<void> {
  if (bridgeState.pollInterval) {
    clearInterval(bridgeState.pollInterval);
    bridgeState.pollInterval = null;
  }

  if (bridgeState.sdkSyncInterval) {
    clearInterval(bridgeState.sdkSyncInterval);
    bridgeState.sdkSyncInterval = null;
  }

  if (bridgeState.mcpSyncInterval) {
    clearInterval(bridgeState.mcpSyncInterval);
    bridgeState.mcpSyncInterval = null;
  }
  bridgeState.mcpFallbackSync = null;

  if (bridgeState.mcpClient) {
    try {
      bridgeState.mcpClient.stop();
    } catch {}
    bridgeState.mcpClient = null;
  }

  if (bridgeState.wsServer) {
    bridgeState.wsServer.stop();
    bridgeState.wsServer = null;
  }

  if (bridgeState.oscClient) {
    try {
      bridgeState.oscClient.stopPropertyListeners();
    } catch (err) {
      console.error('[OSC] Failed to stop property listeners:', err);
    }
    await bridgeState.oscClient.stop();
    bridgeState.oscClient = null;
  }

  if (bridgeState.server) {
    const server = bridgeState.server;
    bridgeState.server = null;
    await closeHttpServer(server);
  }

  if (bridgeState.commandBus) {
    bridgeState.commandBus.stop();
    bridgeState.commandBus = null;
  }
  if (bridgeState.eventLogger) {
    const eventLogger = bridgeState.eventLogger;
    bridgeState.eventLogger = null;
    try {
      await eventLogger.flush();
    } catch {
      console.error('[EventLogger] Failed to flush during shutdown.');
    }
  }

  bridgeState.manager = null;
  bridgeState.scheduler = null;
  bridgeState.profileManager = null;
  bridgeState.projectIdentity = null;
  bridgeState.profileScopeSwitching = false;
  bridgeState.lastSongHandleId = '';
  bridgeState.legacyRecoveryKey = '';
  bridgeState.legacyRecoveryPending = false;
  bridgeState.legacyRecoveryPromise = null;
  projectRefreshPending = false;
  bridgeState.serverRunning = false;
}
