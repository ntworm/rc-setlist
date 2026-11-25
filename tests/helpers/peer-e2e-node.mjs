// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist

import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { setExtensionContext } from '../../src/context.ts';
import { startServer } from '../../src/index.ts';
import { clearSlaveRole, getPeerFollowMode, setPeerFollowMode } from '../../src/preferences.ts';
import { bridgeState, broadcastState, isSlaveLocked } from '../../src/runtime/bridge-state.ts';
import { generatePairingCode } from '../../src/runtime/pairing.ts';
import {
  isPeerOutOfStep,
  resetPeerFollowRuntime,
  setPeerFollowTiming,
} from '../../src/runtime/peer-follow-runtime.ts';
import { setPeerHealthTiming } from '../../src/runtime/peer-health.ts';
import { nudgeInboundHeartbeat, syncInboundSlaveRole } from '../../src/runtime/peer-inbound.ts';
import { publishPeerStatus } from '../../src/runtime/peer-link.ts';
import { createHttpRequestListener } from '../../src/server/http.ts';
import { createFakeOsc, makeTlsOptions } from './peer-link-harness.mjs';

export const MAIN_CUES = [
  { name: 'Song A', time: 0, cueIndex: 0 },
  { name: 'Song B', time: 100, cueIndex: 1 },
  { name: 'Song B > Chorus [loop]', time: 120, cueIndex: 2 },
  { name: 'Song C', time: 200, cueIndex: 3 },
];

export const PEER_CUES = [
  { name: 'Song C', time: 50, cueIndex: 0 },
  { name: 'Song A', time: 80, cueIndex: 1 },
  { name: 'Song B', time: 100.002, cueIndex: 2 },
  { name: 'Song B > Chorus [loop]', time: 120.002, cueIndex: 3 },
];

export const PEER_ORDER = ['Song B', 'Song A', 'Song C'];

export function readLogCalls(logFile) {
  if (!fs.existsSync(logFile)) return [];
  const content = fs.readFileSync(logFile, 'utf8');
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function recordOsc(logFile, name, ...args) {
  const serialized = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)));
  const line = [name, ...serialized].join(':');
  fs.appendFileSync(logFile, `${line}\n`, 'utf8');
}

export function createChildFakeOsc(logFile) {
  const log =
    (name) =>
    (...args) =>
      recordOsc(logFile, name, ...args);
  const applyTransport = (beat, isPlaying) => {
    if (!bridgeState.manager) return;
    bridgeState.manager.updateTransport(beat, isPlaying);
    bridgeState.commandBus?.resolveObservableConfirmations();
  };
  const applyCueTeleport = (cueIndex) => {
    if (!bridgeState.manager) return;
    const state = bridgeState.manager.getState();
    if (state.isPlaying && state.clipTriggerQuantization > 0) return;
    const cues =
      contextSong && Array.isArray(contextSong.cuePoints) ? contextSong.cuePoints : PEER_CUES;
    const cue = cues.find((c) => c.cueIndex === cueIndex);
    if (cue && Number.isFinite(cue.time)) {
      applyTransport(cue.time, state.isPlaying);
    }
  };
  return {
    isConnected: true,
    startPlaying: (...args) => {
      recordOsc(logFile, 'startPlaying', ...args);
      const beat = bridgeState.manager?.getState().currentSongTime ?? 0;
      applyTransport(beat, true);
    },
    continuePlaying: (...args) => {
      recordOsc(logFile, 'continuePlaying', ...args);
      const beat = bridgeState.manager?.getState().currentSongTime ?? 0;
      applyTransport(beat, true);
    },
    stopPlaying: (...args) => {
      recordOsc(logFile, 'stopPlaying', ...args);
      const beat = bridgeState.manager?.getState().currentSongTime ?? 0;
      applyTransport(beat, false);
    },
    setCurrentSongTime: (beat, ...rest) => {
      recordOsc(logFile, 'setCurrentSongTime', beat, ...rest);
      if (typeof beat === 'number' && Number.isFinite(beat)) {
        const isPlaying = bridgeState.manager?.getState().isPlaying ?? false;
        applyTransport(beat, isPlaying);
      }
    },
    setMetronome: log('setMetronome'),
    setClipTriggerQuantization: log('setClipTriggerQuantization'),
    jumpToCuePoint: (cueIndex, ...rest) => {
      recordOsc(logFile, 'jumpToCuePoint', cueIndex, ...rest);
      applyCueTeleport(cueIndex);
    },
    send: log('send'),
    getCuePoints: log('getCuePoints'),
    stopPropertyListeners() {},
    async stop() {},
  };
}

let peerHealthAckCount = 0;
let contextSong = null;
const executedCommands = [];

function replyAck(msg) {
  if (msg.requestId !== undefined) {
    process.send?.({ type: 'ack', requestId: msg.requestId });
  }
}

function wrapChildCommandBus() {
  const bus = bridgeState.commandBus;
  if (!bus) return;
  const origDispatch = bus.dispatch.bind(bus);
  bus.dispatch = (command, executeFn) => {
    origDispatch(command, async () => {
      executedCommands.push({
        commandId: command.commandId,
        type: command.type,
        sourceClientId: command.sourceClientId,
        at: performance.now(),
      });
      await executeFn();
    });
  };
}

const IPC_HANDLERS = {
  freeze(msg) {
    if (typeof msg.ms !== 'number') return;
    const end = performance.now() + msg.ms;
    while (performance.now() < end) {
      // intentionally block the event loop while keeping TCP open
    }
  },
  get_peer_status(msg) {
    process.send?.({
      type: 'peer_status',
      requestId: msg.requestId,
      peerStatus: bridgeState.peerStatus,
      peerStatuses: bridgeState.peerStatuses,
      peerHealthAckCount,
      outOfStep: isPeerOutOfStep(),
      currentSongTime: bridgeState.manager?.getState().currentSongTime ?? 0,
      followMode: bridgeState.peerFollowMode,
      slaveLock: isSlaveLocked(),
      safety: bridgeState.manager?.getState().safety ?? null,
    });
  },
  get_executed_commands(msg) {
    process.send?.({
      type: 'executed_commands',
      requestId: msg.requestId,
      commands: [...executedCommands],
    });
  },
  set_health_timing(msg) {
    if (msg.timing && typeof msg.timing === 'object') setPeerHealthTiming(msg.timing);
    replyAck(msg);
  },
  set_follow_timing(msg) {
    if (msg.timing && typeof msg.timing === 'object') setPeerFollowTiming(msg.timing);
    replyAck(msg);
  },
  set_peer_follow_mode(msg) {
    setPeerFollowMode(String(msg.mode ?? 'follow'));
    bridgeState.peerFollowMode = getPeerFollowMode();
    if (bridgeState.peerFollowMode === 'independent') resetPeerFollowRuntime();
    nudgeInboundHeartbeat();
    publishPeerStatus();
    broadcastState();
    replyAck(msg);
  },
  set_transport(msg) {
    const songTime = Number(msg.songTime ?? 0);
    const playing = Boolean(msg.isPlaying);
    const tempo = typeof msg.tempo === 'number' ? msg.tempo : undefined;
    if (typeof msg.quantization === 'number') {
      bridgeState.manager?.updateQuantization(msg.quantization);
    }
    bridgeState.manager?.updateTransport(songTime, playing, tempo);
    broadcastState();
    replyAck(msg);
  },
  set_osc_connected(msg) {
    if (bridgeState.oscClient) bridgeState.oscClient.isConnected = Boolean(msg.connected);
    publishPeerStatus();
    replyAck(msg);
  },
  clear_slave_role(msg) {
    clearSlaveRole();
    syncInboundSlaveRole();
    replyAck(msg);
  },
  update_cues(msg) {
    if (Array.isArray(msg.cues)) {
      if (contextSong) contextSong.cuePoints = msg.cues;
      bridgeState.manager?.updateCues(msg.cues);
    }
    publishPeerStatus();
    replyAck(msg);
  },
  drop_peer_sockets(msg) {
    for (const ws of bridgeState.wsServer?.peerSockets() ?? []) {
      ws.terminate();
    }
    replyAck(msg);
  },
  async flush_events(msg) {
    await bridgeState.eventLogger?.flush();
    replyAck(msg);
  },
};

function handleChildIpc(msg) {
  if (!msg || typeof msg !== 'object') return;
  const handler = IPC_HANDLERS[msg.type];
  if (handler) void handler(msg);
}

async function runChildNode() {
  const storageDir = process.argv[3] || fs.mkdtempSync(path.join(tmpdir(), 'rc-peer-child-'));
  const logFile = process.argv[2] || path.join(storageDir, 'osc-calls.log');
  fs.writeFileSync(logFile, '', 'utf8');

  contextSong = { handle: { id: 99 }, tempo: 120, cuePoints: PEER_CUES };
  setExtensionContext({
    environment: { storageDirectory: storageDir },
    application: { song: contextSong },
  });

  await startServer({ port: 0, skipOsc: true, skipProjectDetector: true });
  wrapChildCommandBus();
  bridgeState.wsServer?.on('client_message', (msg) => {
    if (msg?.type === 'peer_health_ack') peerHealthAckCount += 1;
  });
  process.on('message', handleChildIpc);
  bridgeState.oscClient = createChildFakeOsc(logFile);
  bridgeState.manager.updateCues(PEER_CUES);
  bridgeState.manager.setCustomOrder(PEER_ORDER);

  const pairingCode = generatePairingCode();
  const address = bridgeState.server?.address();
  const port = address && typeof address === 'object' ? address.port : 0;

  // The token lets a test open a phone on the second computer.
  const payload = {
    type: 'ready',
    port,
    pairingCode,
    storageDir,
    logFile,
    authToken: bridgeState.authToken,
  };
  if (process.send) process.send(payload);
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(predicate, timeoutMs = 5000, stepMs = 20) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(stepMs);
  }
  return predicate();
}

let nextChildIpcId = 0;

export function ipcRequest(child, payload, expectedType = 'ack', timeoutMs = 5000) {
  const requestId = ++nextChildIpcId;
  return new Promise((resolve, reject) => {
    const onMessage = (msg) => {
      if (!msg || msg.type !== expectedType || msg.requestId !== requestId) return;
      clearTimeout(timer);
      child.off('message', onMessage);
      resolve(msg);
    };
    const timer = setTimeout(() => {
      child.off('message', onMessage);
      reject(new Error(`IPC ${payload.type} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    child.on('message', onMessage);
    child.send({ ...payload, requestId });
  });
}

export function collectJson(ws) {
  const messages = [];
  ws.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      // ignore non-JSON frames
    }
  });
  return messages;
}

export async function openSocket(ws) {
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

export async function connectSyncedWs(port, token, clientId = 'e2e-client') {
  const ws = new WebSocket(`wss://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`, {
    rejectUnauthorized: false,
  });
  const messages = collectJson(ws);
  await openSocket(ws);
  ws.send(JSON.stringify({ type: 'handshake', clientId }));
  const ack = await waitFor(() => messages.find((m) => m.type === 'handshake_ack'), 5000);
  if (!ack) throw new Error('handshake_ack did not arrive');
  ws.send(JSON.stringify({ type: 'sync_confirm', stateVersion: ack.stateVersion }));
  await delay(30);
  return ws;
}

export function serverPort() {
  const address = bridgeState.server?.address();
  return address && typeof address === 'object' ? address.port : 0;
}

export async function setupMasterNode(mainDir, oscCalls = []) {
  setExtensionContext({
    environment: { storageDirectory: mainDir },
    application: { song: { handle: { id: 42 }, tempo: 120, cuePoints: MAIN_CUES } },
  });
  await startServer({ port: 0, skipOsc: true, skipProjectDetector: true });
  const osc = createFakeOsc(oscCalls);
  osc.setCurrentSongTime = (value) => oscCalls.push(`setCurrentSongTime:${value}`);
  bridgeState.oscClient = osc;
  bridgeState.manager.updateCues(MAIN_CUES);
}

function closeSockets(...sockets) {
  for (const ws of sockets) {
    try {
      ws.terminate();
    } catch {
      // socket already closing
    }
  }
}

export function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function wireProxyEvents(clientWs, upstreamWs, pairs) {
  const pair = { client: clientWs, upstream: upstreamWs };
  pairs.add(pair);
  const closeBoth = () => {
    pairs.delete(pair);
    closeSockets(clientWs, upstreamWs);
  };
  for (const ws of [clientWs, upstreamWs]) {
    ws.on('close', closeBoth);
    ws.on('error', closeBoth);
  }
  clientWs.on('ping', (d) => upstreamWs.readyState === WebSocket.OPEN && upstreamWs.ping(d));
  clientWs.on('pong', (d) => upstreamWs.readyState === WebSocket.OPEN && upstreamWs.pong(d));
  upstreamWs.on('ping', (d) => clientWs.readyState === WebSocket.OPEN && clientWs.ping(d));
  upstreamWs.on('pong', (d) => clientWs.readyState === WebSocket.OPEN && clientWs.pong(d));
}

function bridgePair(clientWs, upstreamWs, state, pairs, onFrame) {
  const early = [];
  wireProxyEvents(clientWs, upstreamWs, pairs);
  upstreamWs.on('open', () => {
    if (state.paused || clientWs.readyState !== WebSocket.OPEN) return;
    for (const frame of early.splice(0)) onFrame('c2s', frame, upstreamWs);
  });
  clientWs.on('message', (data) => {
    const text = data.toString('utf8');
    if (upstreamWs.readyState === WebSocket.CONNECTING) {
      early.push(text);
    } else if (upstreamWs.readyState === WebSocket.OPEN) {
      onFrame('c2s', text, upstreamWs);
    }
  });
  upstreamWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      onFrame('s2c', data.toString('utf8'), clientWs);
    }
  });
}

export async function createWsTlsProxy(targetPort, onFrame) {
  const tls = await makeTlsOptions();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const pairs = new Set();
  const state = { paused: false };
  const server = https.createServer(tls, createHttpRequestListener());
  server.on('upgrade', (req, socket, head) => {
    if (state.paused) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const url = `wss://127.0.0.1:${targetPort}${req.url ?? '/ws'}`;
      const up = new WebSocket(url, { rejectUnauthorized: false });
      bridgePair(clientWs, up, state, pairs, onFrame);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dropAll = () => {
    for (const p of [...pairs]) closeSockets(p.client, p.upstream);
    pairs.clear();
  };
  return {
    port: server.address()?.port ?? 0,
    tls,
    sendUpstream: (frame) => {
      const target = [...pairs].find((p) => p.upstream.readyState === WebSocket.OPEN)?.upstream;
      target?.send(frame);
    },
    setPaused: (paused) => {
      state.paused = paused;
      if (paused) dropAll();
    },
    close: async () => {
      state.paused = true;
      dropAll();
      wss.close();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

export function spawnPeerChild(logFile, storageDir) {
  const helperPath = fileURLToPath(import.meta.url);
  const child = fork(helperPath, [logFile, storageDir, '--child-node'], {
    execArgv: ['--import', 'tsx'],
    stdio: ['inherit', 'pipe', 'inherit', 'ipc'],
  });

  const readyPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Peer child process start timed out')), 20000);
    timer.unref?.();

    child.on('message', (msg) => {
      if (msg && msg.type === 'ready') {
        clearTimeout(timer);
        resolve(msg);
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Peer child process exited unexpectedly with code ${code}`));
    });
  });

  return { child, readyPromise };
}

if (process.argv.includes('--child-node')) {
  runChildNode().catch((err) => {
    console.error('Child node failed to start:', err);
    process.exit(1);
  });
}
