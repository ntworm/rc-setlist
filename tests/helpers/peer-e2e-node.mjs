// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist

import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setExtensionContext } from '../../src/context.ts';
import { startServer } from '../../src/index.ts';
import { clearSlaveRole } from '../../src/preferences.ts';
import { bridgeState } from '../../src/runtime/bridge-state.ts';
import { generatePairingCode } from '../../src/runtime/pairing.ts';
import { setPeerHealthTiming } from '../../src/runtime/peer-health.ts';
import { syncInboundSlaveRole } from '../../src/runtime/peer-inbound.ts';
import { publishPeerStatus } from '../../src/runtime/peer-link.ts';

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
  return {
    isConnected: true,
    startPlaying: log('startPlaying'),
    continuePlaying: log('continuePlaying'),
    stopPlaying: log('stopPlaying'),
    setCurrentSongTime: log('setCurrentSongTime'),
    setMetronome: log('setMetronome'),
    setClipTriggerQuantization: log('setClipTriggerQuantization'),
    jumpToCuePoint: log('jumpToCuePoint'),
    send: log('send'),
    getCuePoints: log('getCuePoints'),
    stopPropertyListeners() {},
    async stop() {},
  };
}

let peerHealthAckCount = 0;
let contextSong = null;

function replyAck(msg) {
  if (msg.requestId !== undefined) {
    process.send?.({ type: 'ack', requestId: msg.requestId });
  }
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
    });
  },
  set_health_timing(msg) {
    if (msg.timing && typeof msg.timing === 'object') setPeerHealthTiming(msg.timing);
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
