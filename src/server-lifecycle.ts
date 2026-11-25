import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import type { StartServerOptions, AugmentedWebSocket, ConnectionRole } from './types.js';
import {
  bridgeState,
  activateProjectProfileScope,
  broadcastState,
  broadcastProfileState,
  getActiveProfilePaths,
  isSlaveLocked,
  profileStatePayload,
  loadLyricsForSong,
  resetMasterTransportSeq,
  resetSignatureTimelineForIdentity,
  runPreflightCheck,
} from './runtime/bridge-state.js';
import { getExtensionContext } from './context.js';
import { SetlistManager } from './core/setlist-manager.js';
import { JumpScheduler, type PendingJump } from './core/next-downbeat-jump.js';
import { isStringArray, parseJson } from './util/json.js';
import { atomicWriteFileSync } from './util/atomic-write.js';
import { EventLogger } from './core/event-log.js';
import { CommandBus } from './core/command-bus.js';
import { OSCClient } from './integration/osc-client.js';
import { SetlistWSServer } from './server/ws.js';
import { loadCerts, useHttps, httpsOptions, hasLocalCa, getLocalCaDer } from './server/cert.js';
import { createCaDownloadListener } from './server/ca-download.js';
import {
  createHttpRequestListener,
  setCsvExportResolver,
  setAudioResolver,
  setDebugSnapshotProvider,
  setHttpAuthToken,
  setPeerToken,
} from './server/http.js';
import { setDirectHost, setDirectToken } from './server/http-peer.js';
import { getOrGenerateDirectToken, resolveServerDirectHost } from './runtime/direct-token.js';
import { McpTcpClient } from './integration/mcp-client.js';
import { McpFallbackSync, McpUnavailableError } from './integration/mcp-fallback-sync.js';
import { syncFromSdkContext } from './sync/sdk-sync.js';
import { syncFromMcpInfo } from './sync/mcp-sync.js';
import { registerOscListeners } from './osc/registration.js';
import { executeCommandAction } from './commands/handlers/index.js';
import { immediateJumpRefused } from './commands/handlers/transport.js';
import { peerCommandRejection, resolvePeerJump } from './commands/handlers/peer.js';
import {
  PEER_RELAY_TYPES,
  handlePeerHealthAck,
  publishPeerStatus,
  relayToPeer,
  setPeerUpstreamHandler,
  startPeerLinks,
  stopPeerLink,
  type PeerUpstreamReply,
} from './runtime/peer-link.js';
import {
  isActiveInboundPeer,
  markInboundVersionMismatch,
  onInboundPeerClosed,
  onInboundPeerMessage,
  onInboundPeerSyncConfirm,
  resetInboundPeerState,
  syncInboundSlaveRole,
} from './runtime/peer-inbound.js';
import { resetMasterRelayIntent } from './runtime/peer-link-commands.js';
import {
  createMasterSessionId,
  EXTENSION_VERSION,
  isSafetyStopCommand,
  LINK_PROTOCOL_VERSION,
  type DirectCommandMessage,
  type PeerCommandEnvelope,
  type SlaveCommandExecutionMeta,
  type SlaveCommandExecutionResult,
} from './runtime/peer-protocol.js';
import {
  getLastExecutedTransportSeq,
  onPeerHandshakeSession,
  receiveDirectCommand,
  receivePeerCommand,
  resetSlaveCommandState,
} from './runtime/peer-slave-commands.js';
import { OperatorError } from './core/operator-error.js';
import {
  adoptUpstreamEcho,
  failAdoptedEcho,
  forwardToMaster,
  handleUpstreamRefusal,
  noteRanWithoutMaster,
  resetPeerUpstream,
} from './runtime/peer-upstream.js';
import { receiveSetlistChunk } from './runtime/peer-setlist.js';
import {
  handlePeerTarget,
  notePeerCommand,
  resetPeerFollowRuntime,
} from './runtime/peer-follow-runtime.js';
import { shouldRejectSlaveLocked } from './runtime/peer-follow-mode.js';
import { getOrGeneratePeerToken } from './runtime/pairing.js';
import { startPeerDiscovery, stopPeerDiscovery } from './runtime/peer-discovery.js';
import { startEventLoopWatch, warnIfSlow } from './runtime/event-loop-watch.js';
import { getPeerFollowMode, readPeerConfigs } from './preferences.js';
import { applyJumpTargetTempo } from './commands/jump-tempo.js';
import type { ClientMessage, ShowCommand } from './types.js';
import {
  resolveProjectIdentity,
  projectIdentityFromMetadata,
  projectSessionIdForSong,
  type ProjectIdentity,
} from './core/project-identity.js';
import { log } from './util/log.js';

const PORT = 4444;
/** The port the certificate authority is served on. */
const CA_PORT = PORT + 1;
let projectRefreshPending = false;
/** The server that hands the certificate authority to the phone. */
let caDownloadServer: http.Server | null = null;

/**
 * Closes the http server.
 */
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

/**
 * Starts the place where the phone gets the certificate authority, over
 * plain HTTP on a port of its own: a phone that has to trust a certificate
 * cannot be asked to trust the page that carries it. A port that is taken
 * is no reason to stop the server.
 */
function startCaDownloadServer(): void {
  if (!hasLocalCa()) return;
  const server = http.createServer(createCaDownloadListener(getLocalCaDer, PORT));
  server.on('error', (err: Error) => {
    log.warn('lifecycle', 'the certificate download server could not start', {
      error: err.message,
    });
  });
  caDownloadServer = server;
  server.listen(CA_PORT);
}

/** Closes the place where the phone gets the certificate authority. */
async function stopCaDownloadServer(): Promise<void> {
  const server = caDownloadServer;
  caDownloadServer = null;
  if (server) await closeHttpServer(server);
}

function currentSongHandleId(context: ReturnType<typeof getExtensionContext>): string {
  try {
    return context?.application?.song?.handle?.id?.toString() ?? '';
  } catch {
    return '';
  }
}

function invalidateProjectPromotionForSongHandle(songHandleId: string): void {
  bridgeState.projectSessionId = projectSessionIdForSong(
    process.pid,
    songHandleId,
    newProjectSessionId(),
  );
  bridgeState.promotionBlockedProjectSessionId = bridgeState.projectSessionId;
}

/**
 * Returns the project metadata request token.
 */
export function getProjectMetadataRequestToken(): string | null {
  const identity = bridgeState.projectIdentity;
  const sessionId = bridgeState.projectSessionId;
  if (!identity || !sessionId || bridgeState.promotionBlockedProjectSessionId === sessionId)
    return null;
  return `${sessionId}:${identity.key}`;
}

async function resolveActiveProjectIdentity(options: StartServerOptions): Promise<ProjectIdentity> {
  if (options.projectIdentity) return options.projectIdentity;
  if (options.skipProjectDetector) {
    return resolveProjectIdentity({
      platform: 'linux',
      sessionId: bridgeState.projectSessionId,
      getProjectMetadata: () => Promise.resolve(null),
      readWindowTitle: () => Promise.resolve(''),
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
    const sessionId = bridgeState.projectSessionId;
    const identity = await resolveProjectIdentity({
      platform: 'linux',
      sessionId,
      getProjectMetadata: () => Promise.resolve(null),
      readWindowTitle: () => Promise.resolve(''),
    });
    if (bridgeState.projectSessionId !== sessionId) return;
    console.log(
      `[Persistence] Live Set scope changed to temporary session: ${identity.displayName}`,
    );
    await activateProjectProfileScope(
      identity,
      undefined,
      undefined,
      () => bridgeState.projectSessionId === sessionId,
    );
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
  let existing = '';
  try {
    if (fs.existsSync(tokenPath)) {
      existing = fs.readFileSync(tokenPath, 'utf8').trim();
    }
  } catch (err) {
    console.error('[Security] Failed to read token:', err);
  }
  if (existing) {
    // A file written before the mode was set keeps working; failing to
    // tighten it must not replace the token the clients already hold.
    try {
      fs.chmodSync(tokenPath, 0o600);
    } catch (err) {
      console.error('[Security] Failed to restrict token file mode:', err);
    }
    return existing;
  }

  const token = randomBytes(16).toString('hex'); // 32 hex characters
  try {
    // A replaced file gets the mode too: the rename swaps in a new owner-only file.
    atomicWriteFileSync(tokenPath, token, { mode: 0o600 });
    console.log('[Security] Generated new security token.');
  } catch (err) {
    console.error('[Security] Failed to write token:', err);
  }
  return token;
}

/**
 * Handles the jump scheduler event.
 */
export function handleJumpSchedulerEvent(event: {
  type: 'replaced' | 'executed';
  pending: PendingJump;
}): void {
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

  // The cue jump itself went to Live when it was requested; Live lands it on
  // its grid line, which is the beat this side computed. What is left for the
  // landing is the destination's tempo and loop, and telling the page.
  applyJumpTargetTempo(event.pending.songIndex, event.pending.sectionIndex);

  if (event.pending.sectionIndex !== null && event.pending.sectionIndex !== undefined) {
    const song = bridgeState.manager.getState().songs[event.pending.songIndex];
    const section = song?.sections[event.pending.sectionIndex];
    if (section && section.loopCount !== null) {
      const loopRegion = bridgeState.manager.getLoopRegion(
        event.pending.songIndex,
        event.pending.sectionIndex,
      );
      if (loopRegion) {
        bridgeState.oscClient.send('/live/song/set/loop', [{ type: 'integer', value: 1 }]);
        bridgeState.oscClient.send('/live/song/set/loop_start', [
          { type: 'float', value: loopRegion.start },
        ]);
        bridgeState.oscClient.send('/live/song/set/loop_length', [
          { type: 'float', value: loopRegion.duration },
        ]);
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

/**
 * Whether this computer refuses the command, so the paired computer must not
 * run it either.
 *
 * The relay runs before the command does, so the rule is asked before the
 * command answers it.
 */
function refusedByThisComputer(command: ShowCommand<ClientMessage>): boolean {
  if (command.type !== 'jump') return false;
  const payload = command.payload;
  if (payload.type !== 'jump') return false;
  return immediateJumpRefused(payload);
}

function connectionRole(ws: AugmentedWebSocket): ConnectionRole {
  if (ws.isPeer === true) return 'peer';
  if (ws.isDirect === true) return 'direct';
  return 'browser';
}

function stripDirectMeta(msg: ClientMessage): ClientMessage {
  if (
    msg.type !== 'play' &&
    msg.type !== 'stop' &&
    msg.type !== 'jump_time' &&
    msg.type !== 'set_panic'
  ) {
    return msg;
  }
  if (
    !Object.prototype.hasOwnProperty.call(msg, 'ttlMs') &&
    !Object.prototype.hasOwnProperty.call(msg, 'transportSeq')
  ) {
    return msg;
  }
  const clean = { ...msg };
  delete clean.ttlMs;
  delete clean.transportSeq;
  return clean;
}

/**
 * Runs a command a second computer handed up, as if a page of this computer
 * had sent it: every lock of this computer applies, and the command goes down
 * to every paired computer, the one that handed it up included. A command
 * that does not go down is refused, so the second computer tells its phone.
 */
function runUpstreamCommand(message: ClientMessage, refuse: PeerUpstreamReply): void {
  const manager = bridgeState.manager;
  const bus = bridgeState.commandBus;
  if (!manager || !bus) {
    refuse({ reason: 'not_ready' });
    return;
  }
  const stripped = stripDirectMeta(message);
  const peerJump = resolvePeerJump(stripped, manager.getState());
  if (peerJump.kind === 'error') {
    refuse({ reason: peerJump.code });
    return;
  }
  const effectiveMsg = peerJump.kind === 'jump' ? peerJump.message : stripped;
  const commandId = effectiveMsg.commandId;
  if (!commandId || bus.isDuplicate(commandId)) {
    refuse({ reason: 'duplicate' });
    return;
  }
  const command = bus.registerCommand(
    commandId,
    effectiveMsg.type,
    effectiveMsg,
    'rc-peer-upstream',
  );
  bus.dispatch(command, async () => {
    await executeCommandAction(command);
  });
  if (refusedByThisComputer(command) || !relayToPeer(command)) {
    refuse({ reason: command.reason ?? 'refused' });
  }
}

function handleClientHandshake(
  msg: Extract<ClientMessage, { type: 'handshake' }>,
  ws: AugmentedWebSocket,
  isController: boolean,
  role: ConnectionRole,
): void {
  if (!bridgeState.manager) return;
  if (role === 'peer') {
    const remoteProtocol = msg.linkProtocol ?? 1;
    if (remoteProtocol !== LINK_PROTOCOL_VERSION) {
      markInboundVersionMismatch(true);
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'version_mismatch',
          message: 'Link protocol mismatch.',
          linkProtocol: LINK_PROTOCOL_VERSION,
          extensionVersion: EXTENSION_VERSION,
        }),
      );
      ws.close(4002, 'version_mismatch');
      return;
    }
    markInboundVersionMismatch(false);
    onPeerHandshakeSession(msg.sessionId);
  }
  ws.clientId = msg.clientId;
  ws.synchronized = false;
  const state = bridgeState.manager.getState();
  ws.handshakeStateVersion = state.stateVersion;
  const ackBase = {
    type: 'handshake_ack',
    stateVersion: state.stateVersion,
    extensionVersion: EXTENSION_VERSION,
    linkProtocol: LINK_PROTOCOL_VERSION,
  };
  if (role === 'direct') {
    ws.send(JSON.stringify({ ...ackBase, transportSeq: getLastExecutedTransportSeq() }));
    return;
  }
  ws.send(
    JSON.stringify({
      ...ackBase,
      state: {
        ...state,
        peerStatus: bridgeState.peerStatus,
        peerStatuses: bridgeState.peerStatuses,
        peerAlerts: bridgeState.peerAlerts,
        slaveLock: isSlaveLocked(),
      },
    }),
  );
  if (isController) {
    ws.send(JSON.stringify(profileStatePayload()));
  }
}

function resolvePeerSenderId(ws: AugmentedWebSocket): string {
  return ws.clientId || ws.remoteAddress || 'unknown';
}

function duplicatePeerOutcome(bus: CommandBus, commandId: string): SlaveCommandExecutionResult {
  const saved = bus.getStatus(commandId);
  if (!saved) return { result: 'confirmed' };
  const failed =
    saved.status === 'failed' || saved.status === 'expired' || saved.status === 'cancelled';
  if (failed) return { result: 'failed', reason: saved.reason ?? saved.status };
  return { result: 'confirmed' };
}

function reportPeerJumpError(
  ws: AugmentedWebSocket,
  outerCommandId: string,
  inner: ClientMessage,
  peerJump: { code: string; message: string },
  errorCommandId?: string,
): SlaveCommandExecutionResult {
  if (errorCommandId === undefined && inner.commandId && inner.commandId !== outerCommandId) {
    failAdoptedEcho(inner.commandId, `The jump did not land on this computer: ${peerJump.message}`);
  }
  const replyId = errorCommandId ?? outerCommandId;
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'error',
        code: peerJump.code,
        message: peerJump.message,
        ...(replyId ? { commandId: replyId } : {}),
      }),
    );
  }
  return { result: 'failed', reason: peerJump.code };
}

const PEER_OSC_COMMAND_TYPES = new Set([
  'play',
  'stop',
  'metronome',
  'refresh',
  'jump',
  'set_quantization',
  'trigger_count_in',
]);

function requiresConnectedOsc(command: ShowCommand<ClientMessage>): boolean {
  if (PEER_OSC_COMMAND_TYPES.has(command.type)) return true;
  if (command.type === 'set_panic') {
    const payload = command.payload as { active?: unknown } | null;
    return payload?.active === true;
  }
  return false;
}

function dispatchPeerLocalCommand(
  command: ShowCommand<ClientMessage>,
  ws: AugmentedWebSocket,
  meta?: SlaveCommandExecutionMeta,
): Promise<SlaveCommandExecutionResult> {
  const bus = bridgeState.commandBus;
  if (!bus) return Promise.resolve({ result: 'failed', reason: 'not_ready' });
  return new Promise<SlaveCommandExecutionResult>((resolve) => {
    let settled = false;
    const finish = (outcome: SlaveCommandExecutionResult): void => {
      if (settled) return;
      settled = true;
      bus.off('command_settled', onSettled);
      resolve(outcome);
    };
    const onSettled = (cmd: { commandId: string; status: string; reason?: string }): void => {
      if (cmd.commandId !== command.commandId) return;
      if (cmd.status === 'confirmed') {
        finish({ result: 'confirmed' });
        return;
      }
      if (cmd.status === 'expired') {
        finish({ result: 'expired', reason: 'expired' });
        return;
      }
      finish({ result: 'failed', reason: cmd.reason ?? cmd.status });
    };
    bus.on('command_settled', onSettled);
    bus.dispatch(command, async () => {
      if (meta?.isExpired()) {
        bus.updateStatus(command.commandId, 'expired', 'timeout');
        finish({ result: 'expired', reason: 'expired' });
        return;
      }
      if (requiresConnectedOsc(command) && bridgeState.oscClient?.isConnected !== true) {
        throw new OperatorError('OSC client is not connected.');
      }
      await executeCommandAction(command, ws);
      // A quantized jump waiting for its grid line is accepted by Live now; the landing
      // follows the grid, so confirming here keeps the delivery deadline honest.
      if (command.type === 'jump' && bridgeState.scheduler?.hasPending()) {
        finish({ result: 'confirmed' });
      }
    });
  });
}

function executeInboundPeerInner(
  ws: AugmentedWebSocket,
  outerCommandId: string,
  inner: ClientMessage,
  meta?: SlaveCommandExecutionMeta,
  errorCommandId?: string,
): Promise<SlaveCommandExecutionResult> {
  const manager = bridgeState.manager;
  const bus = bridgeState.commandBus;
  if (!manager || !bus) return Promise.resolve({ result: 'failed', reason: 'not_ready' });
  const stripped = stripDirectMeta(inner);
  const peerJump = resolvePeerJump(stripped, manager.getState());
  if (peerJump.kind === 'error') {
    return Promise.resolve(
      reportPeerJumpError(ws, outerCommandId, stripped, peerJump, errorCommandId),
    );
  }
  const effectiveMsg = peerJump.kind === 'jump' ? peerJump.message : stripped;
  const commandId = effectiveMsg.commandId || outerCommandId;
  if (bus.isDuplicate(commandId)) {
    const isSafety = isSafetyStopCommand(effectiveMsg);
    if (!isSafety || !bus.releaseFailedRetry(commandId)) {
      return Promise.resolve(duplicatePeerOutcome(bus, commandId));
    }
  }
  const command = bus.registerCommand(
    commandId,
    effectiveMsg.type,
    effectiveMsg,
    resolvePeerSenderId(ws),
  );
  return dispatchPeerLocalCommand(command, ws, meta);
}

function runInboundPeerOrIndependent(
  ws: AugmentedWebSocket,
  outerCommandId: string,
  inner: ClientMessage,
  meta?: SlaveCommandExecutionMeta,
  errorCommandId?: string,
): Promise<SlaveCommandExecutionResult> {
  if (bridgeState.peerFollowMode === 'independent') {
    return Promise.resolve({ result: 'failed', reason: 'independent' });
  }
  return executeInboundPeerInner(ws, outerCommandId, inner, meta, errorCommandId);
}

function handleInboundPeerCommand(ws: AugmentedWebSocket, msg: PeerCommandEnvelope): Promise<void> {
  return receivePeerCommand(ws, msg, (inner, meta) =>
    runInboundPeerOrIndependent(ws, msg.commandId, inner, meta),
  ).then(() => undefined);
}

function isDirectActionMessage(msg: ClientMessage): msg is DirectCommandMessage {
  return (
    (msg.type === 'jump_time' ||
      msg.type === 'play' ||
      msg.type === 'stop' ||
      msg.type === 'set_panic') &&
    typeof msg.commandId === 'string' &&
    msg.commandId.trim() !== ''
  );
}

function handleInboundDirectCommand(
  ws: AugmentedWebSocket,
  msg: DirectCommandMessage,
): Promise<void> {
  return receiveDirectCommand(ws, msg, (inner, meta) =>
    runInboundPeerOrIndependent(ws, inner.commandId || msg.commandId, inner, meta, msg.commandId),
  ).then(() => undefined);
}

/**
 * The port the server listens on right now.
 *
 * The port may be one the system chose (port 0 asks for a free one), so the
 * address of the server is the truth and not the number that was asked for.
 */
function servingPort(): number {
  const address = bridgeState.server?.address();
  return address && typeof address === 'object' ? address.port : PORT;
}

/**
 * Starts the server.
 */
export async function startServer(options: StartServerOptions = {}): Promise<void> {
  if (bridgeState.server) return;

  const listenPort = options.port ?? PORT;

  try {
    bridgeState.masterSessionId = createMasterSessionId();
    resetMasterTransportSeq();
    bridgeState.peerAlerts = {};
    bridgeState.directToken = '';
    bridgeState.directHost = '';
    resetMasterRelayIntent();
    resetSlaveCommandState();
    bridgeState.manager = new SetlistManager();
    bridgeState.lastCuesFingerprint = '__init__';
    bridgeState.scheduler = new JumpScheduler();
    bridgeState.scheduler.on(handleJumpSchedulerEvent);

    const context = getExtensionContext();
    if (context && context.environment.storageDirectory) {
      bridgeState.globalPersistenceDir = context.environment.storageDirectory;
      console.log('[Persistence] Storage directory available.');
    } else {
      bridgeState.globalPersistenceDir =
        typeof __dirname !== 'undefined' ? path.join(__dirname, '../.setlist') : './.setlist';
    }
    bridgeState.authToken = getOrGenerateToken();
    setHttpAuthToken(bridgeState.authToken);
    bridgeState.peerToken = getOrGeneratePeerToken();
    setPeerToken(bridgeState.peerToken);
    bridgeState.directToken = getOrGenerateDirectToken();
    setDirectToken(bridgeState.directToken);
    bridgeState.peerFollowMode = getPeerFollowMode();

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

    bridgeState.commandBus.on(
      'command_settled',
      (cmd: { commandId: string; status: string; reason?: string; error?: string }) => {
        bridgeState.wsServer?.broadcast({
          type: 'command_status',
          commandId: cmd.commandId,
          status: cmd.status,
          ...(cmd.reason ? { reason: cmd.reason } : {}),
          ...(cmd.error ? { error: cmd.error } : {}),
        });
      },
    );

    const hasContext = Boolean(context);
    bridgeState.manager?.setConnectionStatus('ableton', hasContext ? 'synced' : 'disconnected');
    bridgeState.lastSongHandleId = currentSongHandleId(context);

    const activePaths = getActiveProfilePaths();
    const orderFilePath = activePaths.customOrder;

    try {
      if (fs.existsSync(orderFilePath)) {
        const raw = fs.readFileSync(orderFilePath, 'utf-8');
        const order = parseJson(raw, isStringArray);
        if (order) {
          bridgeState.manager.setCustomOrder(order);
          console.log('[Persistence] Custom song order loaded.');
        }
      }
    } catch {
      console.error('[Persistence] Failed to load custom song order.');
    }

    setCsvExportResolver(async (rawName: string) => {
      const safeName = rawName.replace(/[^A-Za-z0-9_.-]/g, '_');
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
      const osc = bridgeState.oscClient?.getDebugSnapshot() ?? {
        error: 'osc client not initialized',
      };
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
        managerActiveSection:
          state?.songs[state.activeSongIndex]?.sections[state.activeSectionIndex]?.name ?? null,
        pendingJump: bridgeState.scheduler?.getPending() ?? null,
        mcp: bridgeState.mcpFallbackSync?.getSnapshot() ?? null,
      };
    });

    if (!options.skipOsc) {
      bridgeState.oscClient = new OSCClient();

      // Without a listener, EventEmitter turns every 'error' into a throw from
      // whichever socket callback raised it.
      bridgeState.oscClient.on('error', (err: unknown) => {
        console.error('[OSC]', err instanceof Error ? err.message : String(err));
      });

      bridgeState.oscClient.on('connect', () => {
        console.log(
          '[OSC] Connection established. Registering listeners and fetching cue points...',
        );
        bridgeState.wsServer?.broadcastLog('Connected to Ableton Live.', 'info');

        bridgeState.oscClient?.startPropertyListeners();
        bridgeState.oscClient?.startPolling();
        bridgeState.oscClient?.requestInitialState();
        bridgeState.oscClient?.getCuePoints();

        bridgeState.manager?.setConnectionStatus('osc', 'synced');
        bridgeState.eventLogger?.log({
          type: 'osc_connected',
          message: 'OSC connection to Ableton Live established',
        });
        publishPeerStatus();
      });

      bridgeState.oscClient.on('disconnect', () => {
        console.warn('[OSC] Connection to Ableton Live lost.');
        bridgeState.lastCuesFingerprint = '__init__';
        bridgeState.wsServer?.broadcastLog(
          '⚠ Lost connection to Ableton Live. Reconnecting...',
          'warn',
        );

        bridgeState.manager?.setConnectionStatus('osc', 'disconnected');
        bridgeState.eventLogger?.log({
          type: 'osc_disconnected',
          message: 'OSC connection to Ableton Live lost',
        });
        publishPeerStatus();
      });

      await bridgeState.oscClient.start();

      registerOscListeners();

      bridgeState.pollInterval = setInterval(() => {
        bridgeState.oscClient?.getCurrentSongTime();
      }, 100);
    }

    bridgeState.wsServer = new SetlistWSServer(bridgeState.authToken, {
      peerToken: bridgeState.peerToken,
      directToken: bridgeState.directToken,
    });
    bridgeState.wsServer.init();
    bridgeState.wsServer.on('peer_closed', (ws: AugmentedWebSocket) => onInboundPeerClosed(ws));
    syncInboundSlaveRole();

    if (!options.skipCerts) {
      await loadCerts();
    }

    const tlsOptions = useHttps && httpsOptions && !options.skipCerts ? httpsOptions : null;
    bridgeState.serverUsesTls = tlsOptions !== null;
    bridgeState.directHost = await resolveServerDirectHost(options, tlsOptions);
    setDirectHost(bridgeState.directHost);
    const srv = tlsOptions
      ? https.createServer(tlsOptions, createHttpRequestListener())
      : http.createServer(createHttpRequestListener());
    bridgeState.server = srv;

    srv.on('upgrade', (req, socket, head) => {
      bridgeState.wsServer?.handleUpgrade(req, socket, head);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        srv.off('listening', onListening);
        reject(err);
      };

      const onListening = (): void => {
        srv.off('error', onError);
        console.log(
          `[HTTP] Server running over ${tlsOptions ? 'HTTPS' : 'HTTP'} on port ${listenPort}`,
        );
        resolve();
      };

      srv.once('error', onError);
      srv.once('listening', onListening);

      srv.listen(listenPort);
    });

    // The phone that opens the setlist needs the authority of this
    // computer before it trusts the certificate: it is served on a port of
    // its own, next to the server that answers.
    if (tlsOptions !== null) startCaDownloadServer();

    // The paired computers, if there are any, follow from here on.
    startPeerLinks(readPeerConfigs());
    // A phone on a second computer drives the show through this one.
    setPeerUpstreamHandler(runUpstreamCommand);

    // The computers of the network announce themselves, so the main one
    // finds them without an address to type.
    startPeerDiscovery(servingPort, () => bridgeState.serverUsesTls);

    bridgeState.wsServer.on('client_message', (msg: ClientMessage, ws: AugmentedWebSocket) => {
      if (!bridgeState.manager) return;

      const role = connectionRole(ws);
      const isController = ws.isController === true;
      const isPeerConnection = role === 'peer';
      const isDirectConnection = role === 'direct';
      const isSynchronized =
        ws.synchronized === true || ws.skipHandshakeCheck || process.env.NODE_ENV === 'test';
      const allowedBeforeSync = new Set([
        'handshake',
        'sync_confirm',
        'auth',
        'get_lyrics',
        'rtt_ping',
      ]);

      if (!allowedBeforeSync.has(msg.type) && !isSynchronized) {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'not_synchronized',
            message: 'Client is not synchronized.',
            ...(msg.commandId ? { commandId: msg.commandId } : {}),
          }),
        );
        return;
      }

      if (msg.type === 'handshake') {
        handleClientHandshake(msg, ws, isController, role);
        return;
      }

      if (msg.type === 'sync_confirm') {
        if (msg.stateVersion === ws.handshakeStateVersion) {
          ws.synchronized = true;
          delete ws.handshakeStateVersion;
          if (isPeerConnection) onInboundPeerSyncConfirm(ws);
          bridgeState.eventLogger?.log({
            type: 'client_synchronized',
            clientId: ws.clientId,
            message: `Client synchronized at state version ${msg.stateVersion}`,
          });
        }
        return;
      }

      // A peer connection runs the transport commands and nothing else, and a
      // jump by beat belongs to a peer connection alone: the beat is what
      // travels between two computers, because the songs may sit in another
      // order on the other side.
      const peerRejection = peerCommandRejection(msg, role);
      if (peerRejection) {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: peerRejection.code,
            message: peerRejection.message,
            ...(msg.commandId ? { commandId: msg.commandId } : {}),
          }),
        );
        return;
      }

      if (msg.type === 'rtt_ping') {
        ws.send(JSON.stringify({ type: 'rtt_pong', t0: msg.t0 }));
        return;
      }

      // A superseded or unpaired inbound peer socket must not drive this computer.
      if (
        isPeerConnection &&
        (msg.type === 'peer_target' ||
          msg.type === 'peer_command' ||
          msg.type === 'peer_health_ack') &&
        !isActiveInboundPeer(ws)
      ) {
        return;
      }

      // The target of the main computer is not a command: it changes nothing
      // unless this computer has fallen off the main computer's beat or needs
      // stopped-state convergence.
      if (msg.type === 'peer_target') {
        handlePeerTarget(msg, getLastExecutedTransportSeq());
        return;
      }
      // The setlist of the main computer travels in pieces: it is a setlist
      // of its own here, not a command of this computer.
      if (msg.type === 'setlist_chunk') {
        receiveSetlistChunk(msg);
        return;
      }
      // The main computer refused a command this one handed up.
      if (msg.type === 'peer_upstream_result') {
        if (!msg.ok && msg.commandId) {
          handleUpstreamRefusal({ commandId: msg.commandId, reason: msg.reason ?? 'refused' });
        }
        return;
      }
      if (msg.type === 'peer_hb' || msg.type === 'peer_hb_ack') {
        onInboundPeerMessage(ws, msg);
        return;
      }
      if (msg.type === 'peer_command') {
        void handleInboundPeerCommand(ws, msg);
        return;
      }
      if (isDirectConnection && isDirectActionMessage(msg)) {
        void handleInboundDirectCommand(ws, msg);
        return;
      }
      if (isPeerConnection && msg.type !== 'peer_health_ack') {
        if (bridgeState.peerFollowMode === 'independent') return;
        notePeerCommand(msg.type);
      }

      const readOnlyTypes = new Set(['get_lyrics', 'profiles_get', 'preflight_check']);
      if (!readOnlyTypes.has(msg.type) && !isController && role === 'browser') {
        console.warn(
          `[Security] WS client tried to execute command '${msg.type}' without controller permissions.`,
        );
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'unauthorized',
            message: 'Unauthorized: controller permission is required.',
            ...(msg.commandId ? { commandId: msg.commandId } : {}),
          }),
        );
        return;
      }

      if (msg.type === 'peer_health_ack') {
        handlePeerHealthAck(msg.peerKey, isPeerConnection);
        return;
      }

      if (msg.type === 'get_lyrics') {
        const requestedTitle =
          typeof msg.song === 'string' && msg.song.length
            ? msg.song
            : bridgeState.manager.getState().songs[bridgeState.manager.getState().activeSongIndex]
                ?.title;
        if (!requestedTitle) {
          ws.send(JSON.stringify({ type: 'lyrics', song: '', format: 'none', lines: [] }));
          return;
        }
        const lyrics = loadLyricsForSong(requestedTitle);
        ws.send(
          JSON.stringify({
            type: 'lyrics',
            song: requestedTitle,
            format: lyrics.type,
            lines: lyrics.lines,
          }),
        );
        return;
      }

      // A jump that arrived by beat becomes a jump of this computer before it
      // is registered: the marker it names is the one under the playhead here.
      // A command the main computer sends back down carries the id the phone
      // of this computer gave it, when it was handed up from here.
      const incoming = isPeerConnection ? adoptUpstreamEcho(msg) : msg;
      const peerJump = resolvePeerJump(incoming, bridgeState.manager.getState());
      if (peerJump.kind === 'error') {
        // The phone that handed the jump up learns it did not land here.
        if (incoming !== msg && incoming.commandId) {
          failAdoptedEcho(
            incoming.commandId,
            `The jump did not land on this computer: ${peerJump.message}`,
          );
        }
        ws.send(
          JSON.stringify({
            type: 'error',
            code: peerJump.code,
            message: peerJump.message,
            ...(msg.commandId ? { commandId: msg.commandId } : {}),
          }),
        );
        return;
      }
      const effectiveMsg = stripDirectMeta(peerJump.kind === 'jump' ? peerJump.message : incoming);

      const commandId =
        effectiveMsg.commandId || `legacy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const senderId = ws.clientId || ws.remoteAddress || 'unknown';
      if (bridgeState.commandBus?.isDuplicate(commandId)) {
        console.warn(`[CommandBus] Discarding duplicate command ID: ${commandId}`);
        // The sender of a retry learns the saved status; nobody else does.
        const saved = bridgeState.commandBus.getStatus(commandId);
        if (saved && saved.sourceClientId === senderId) {
          ws.send(
            JSON.stringify({
              type: 'command_status',
              commandId,
              status: saved.status,
              ...(saved.reason ? { reason: saved.reason } : {}),
              ...(saved.error ? { error: saved.error } : {}),
            }),
          );
        }
        return;
      }

      if (shouldRejectSlaveLocked(role, effectiveMsg.type)) {
        ws.send(
          JSON.stringify({
            type: 'command_status',
            commandId,
            status: 'failed',
            reason: 'slave_locked',
          }),
        );
        return;
      }

      // On a second computer the show is driven by the main one: the command
      // goes up, and lands here when it comes back down. In Independent mode
      // or without the main computer it runs here alone.
      if (
        role === 'browser' &&
        bridgeState.peerFollowMode !== 'independent' &&
        PEER_RELAY_TYPES.has(effectiveMsg.type)
      ) {
        if (forwardToMaster(effectiveMsg, commandId)) return;
        noteRanWithoutMaster(effectiveMsg.type);
      }

      const command = bridgeState.commandBus?.registerCommand(
        commandId,
        effectiveMsg.type,
        effectiveMsg,
        senderId,
      );

      if (command) {
        bridgeState.commandBus?.dispatch(command, async () => {
          if (command.type === 'profiles_get') {
            ws.send(JSON.stringify(profileStatePayload()));
            return;
          }
          if (command.type === 'preflight_check') {
            const preflight = runPreflightCheck();
            ws.send(
              JSON.stringify({
                type: 'preflight_result',
                status: preflight.status,
                reports: preflight.reports,
              }),
            );
            return;
          }

          await executeCommandAction(command, ws);
        });
        // The paired computer follows the show. A command that came from a
        // peer is not forwarded again: the link is one hop, not a loop. A
        // jump this computer refuses is not forwarded either.
        if (role === 'browser' && !refusedByThisComputer(command)) relayToPeer(command);
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
            invalidateProjectPromotionForSongHandle(nextSongHandleId);
            void refreshProjectScope(options);
          } else if (nextSongHandleId && !bridgeState.lastSongHandleId) {
            bridgeState.lastSongHandleId = nextSongHandleId;
          }
          const syncStartedAt = performance.now();
          syncFromSdkContext(context);
          warnIfSlow('sdk', 'SDK sync', syncStartedAt);
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
        getProjectMetadataRequestToken,
        onProjectMetadata: async (metadata, requestToken) => {
          if (requestToken !== getProjectMetadataRequestToken()) return;
          const identity = projectIdentityFromMetadata(metadata);
          if (!identity || identity.key === bridgeState.projectIdentity?.key) return;
          // The Live Set changed: the time signatures of the set that is no
          // longer on screen must not survive it.
          resetSignatureTimelineForIdentity(identity);
          if (bridgeState.profileScopeSwitching) {
            projectRefreshPending = true;
            return;
          }
          bridgeState.profileScopeSwitching = true;
          broadcastProfileState();
          try {
            console.log(
              `[Persistence] Delayed Live Set metadata resolved: ${identity.displayName}`,
            );
            const sourceIdentityKey = bridgeState.projectIdentity?.key;
            const projectSessionId = bridgeState.projectSessionId;
            if (!sourceIdentityKey || requestToken !== getProjectMetadataRequestToken()) return;
            await activateProjectProfileScope(identity, undefined, {
              sourceIdentityKey,
              projectSessionId,
            });
          } catch (err) {
            console.error('[Persistence] Failed to promote the Live Set scope:', err);
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
        void bridgeState.mcpFallbackSync?.tick().catch((err: unknown) => {
          // MCP is optional: an absent bridge is silence, not an error. A
          // failure inside our own callbacks is neither, and must be seen.
          if (!(err instanceof McpUnavailableError)) console.error('[MCP] tick failed:', err);
        });
      }, 100);
    }

    bridgeState.eventLoopWatchInterval = startEventLoopWatch();
    bridgeState.serverRunning = true;
  } catch (err) {
    console.error('[rc-setlist] server startup failed; cleaning up.');
    await stopServer();
    throw err;
  }
}

/**
 * Stops the server.
 */
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

  if (bridgeState.eventLoopWatchInterval) {
    clearInterval(bridgeState.eventLoopWatchInterval);
    bridgeState.eventLoopWatchInterval = null;
  }
  bridgeState.transportClockSource = null;

  if (bridgeState.mcpClient) {
    try {
      bridgeState.mcpClient.stop();
    } catch {
      // swallow: nothing to do here on purpose
    }
    bridgeState.mcpClient = null;
  }

  if (bridgeState.wsServer) {
    bridgeState.wsServer.stop();
    bridgeState.wsServer = null;
  }

  resetInboundPeerState();
  resetPeerFollowRuntime();
  resetSlaveCommandState();
  resetMasterRelayIntent();
  stopPeerLink();
  setPeerUpstreamHandler(null);
  resetPeerUpstream();
  resetMasterTransportSeq();
  bridgeState.peerAlerts = {};
  bridgeState.peerFollowMode = 'follow';
  bridgeState.inboundSlaveSynced = false;
  bridgeState.directToken = '';
  bridgeState.directHost = '';
  setDirectToken('');
  setDirectHost('');

  // The computers of the network stop saying hello with the server.
  stopPeerDiscovery();

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

  await stopCaDownloadServer();

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
  bridgeState.songBook = null;
  bridgeState.projectIdentity = null;
  bridgeState.profileScopeSwitching = false;
  bridgeState.lastSongHandleId = '';
  bridgeState.promotionBlockedProjectSessionId = '';
  bridgeState.legacyRecoveryKey = '';
  bridgeState.legacyRecoveryPending = false;
  bridgeState.legacyRecoveryPromise = null;
  projectRefreshPending = false;
  bridgeState.serverRunning = false;
}
