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
import { bridgeState } from '../../src/runtime/bridge-state.ts';
import { generatePairingCode } from '../../src/runtime/pairing.ts';

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
    setMetronome: log('setMetronome'),
    setClipTriggerQuantization: log('setClipTriggerQuantization'),
    jumpToCuePoint: log('jumpToCuePoint'),
    send: log('send'),
    getCuePoints: log('getCuePoints'),
    stopPropertyListeners() {},
    async stop() {},
  };
}

async function runChildNode() {
  const storageDir = process.argv[3] || fs.mkdtempSync(path.join(tmpdir(), 'rc-peer-child-'));
  const logFile = process.argv[2] || path.join(storageDir, 'osc-calls.log');
  fs.writeFileSync(logFile, '', 'utf8');

  setExtensionContext({
    environment: { storageDirectory: storageDir },
    application: { song: { handle: { id: 99 }, tempo: 120, cuePoints: PEER_CUES } },
  });

  await startServer({ port: 0, skipOsc: true, skipProjectDetector: true });
  bridgeState.oscClient = createChildFakeOsc(logFile);
  bridgeState.manager.updateCues(PEER_CUES);
  bridgeState.manager.setCustomOrder(PEER_ORDER);

  const pairingCode = generatePairingCode();
  const address = bridgeState.server?.address();
  const port = address && typeof address === 'object' ? address.port : 0;

  const payload = { type: 'ready', port, pairingCode, storageDir, logFile };
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
