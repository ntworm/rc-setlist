// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The other side of the link, as a test fixture.
//
// The paired computer is a second server with its own setlist, its own
// certificate and its own credential. The tests need one that answers the
// handshake, records what the link sends it, and holds the songs in another
// order — the point of the link is that the other side is another computer.

import * as https from 'node:https';
import { X509Certificate } from 'node:crypto';
import selfsigned from 'selfsigned';
import { SetlistManager } from '../../src/core/setlist-manager.ts';
import { SetlistWSServer } from '../../src/server/ws.ts';
import { createHttpRequestListener } from '../../src/server/http.ts';
import { peerCommandRejection, resolvePeerJump } from '../../src/commands/handlers/peer.ts';
import { certificateFingerprint } from '../../src/runtime/pairing.ts';

export const MAIN_CUES = [
  { name: 'Song A', time: 0 },
  { name: 'Song B', time: 100 },
  // A section that starts exactly where its song starts: one beat, two
  // levels, and the level of the jump is what tells them apart.
  { name: 'Song B > Chorus', time: 100 },
  { name: 'Song C', time: 200 },
];
// The second computer holds the same markers in another order, and does not
// know the third song at all.
const PEER_CUES = [
  { name: 'Song A', time: 0 },
  { name: 'Song B', time: 100 },
  { name: 'Song B > Chorus', time: 100 },
];
const PEER_ORDER = ['Song B', 'Song A'];
export const PEER_TOKEN = 'peer-token-of-the-second-computer';

const COMMAND_SAMPLES = {
  play: { type: 'play' },
  stop: { type: 'stop' },
  jump: { type: 'jump', songIndex: 1 },
  metronome: { type: 'metronome', value: true },
  set_quantization: { type: 'set_quantization', value: 4 },
  trigger_count_in: { type: 'trigger_count_in', sendPlayOffsetMs: 10 },
  refresh: { type: 'refresh' },
  set_panic: { type: 'set_panic', active: false },
  reorder: { type: 'reorder', songTitles: ['Song B'] },
};

export function makeTlsOptions() {
  // The library builds the certificate in a worker: the promise has to be
  // awaited before the PEMs are read, or the certificate is undefined.
  return selfsigned
    .generate([{ name: 'commonName', value: 'localhost' }], {
      algorithm: 'sha256',
      keySize: 2048,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
          ],
        },
      ],
    })
    .then((pems) => ({ key: pems.private, cert: pems.cert }));
}

export function fingerprintOf(tls) {
  return certificateFingerprint(new X509Certificate(tls.cert).raw);
}

export function makeCommand(type, commandId = `cmd-${type}-1`, payload = null) {
  return {
    commandId,
    type,
    payload: payload ?? { ...COMMAND_SAMPLES[type] },
    sourceClientId: 'test',
    createdAt: Date.now(),
    status: 'created',
    retryCount: 0,
    maxRetries: 0,
    timeoutMs: 2000,
  };
}

export function createFakeOsc(calls) {
  const record =
    (name) =>
    (...args) =>
      calls.push([name, ...args].join(':'));
  return {
    isConnected: true,
    startPlaying: record('startPlaying'),
    continuePlaying: record('continuePlaying'),
    stopPlaying: record('stopPlaying'),
    setMetronome: record('setMetronome'),
    setClipTriggerQuantization: record('setQuantization'),
    jumpToCuePoint: record('jumpToCuePoint'),
    send: record('send'),
    getCuePoints: record('getCuePoints'),
    stopPropertyListeners() {},
    async stop() {},
  };
}

function describeAction(message, original, manager) {
  const action = {
    type: message.type,
    source: original.type,
    time: original.time ?? null,
    id: original.commandId ?? null,
  };
  if (message.type !== 'jump') return action;
  const song = manager.getState().songs[message.songIndex];
  return {
    ...action,
    title: song ? song.title : null,
    songIndex: message.songIndex,
    sectionIndex: message.sectionIndex ?? null,
  };
}

const IGNORED_PEER_TYPES = new Set(['peer_clock', 'peer_hb_ack', 'peer_health_ack']);

function replyPeerHeartbeat(message, ws, manager) {
  const t1 = performance.now();
  const view = {
    linkHealth: 'ok',
    canAcknowledge: false,
    oscConnected: true,
    liveReady: true,
    cuesFingerprint: manager.getState().cuesFingerprint ?? '',
    outOfStep: false,
  };
  const t2 = performance.now();
  ws.send(
    JSON.stringify({ type: 'peer_hb_ack', hbId: message.hbId, t0: message.t0, t1, t2, view }),
  );
}

function sendPeerAck(ws, commandId, result, reason = '') {
  ws.send(
    JSON.stringify({
      type: 'peer_ack',
      commandId,
      result,
      reason,
      isPlaying: false,
      beat: 0,
    }),
  );
}

function handlePeerCommandEnvelope(message, ws, manager, actions) {
  const inner = { ...message.command, commandId: message.commandId };
  const jump = resolvePeerJump(inner, manager.getState());
  if (jump.kind === 'error') {
    ws.send(JSON.stringify({ type: 'error', code: jump.code, message: jump.message }));
    sendPeerAck(ws, message.commandId, 'failed', jump.code);
    return;
  }
  const effective = jump.kind === 'jump' ? jump.message : inner;
  actions.push(describeAction(effective, inner, manager));
  sendPeerAck(ws, message.commandId, 'confirmed');
}

function handlePeerMessage(message, ws, manager, actions) {
  const rejection = peerCommandRejection(message, ws.isPeer === true);
  if (rejection) {
    ws.send(JSON.stringify({ type: 'error', code: rejection.code, message: rejection.message }));
    return;
  }
  if (message.type === 'handshake') {
    const state = manager.getState();
    ws.clientId = message.clientId;
    ws.handshakeStateVersion = state.stateVersion;
    ws.send(
      JSON.stringify({
        type: 'handshake_ack',
        stateVersion: state.stateVersion,
        linkProtocol: 2,
        extensionVersion: '1.2.1',
        state,
      }),
    );
    return;
  }
  if (message.type === 'sync_confirm') {
    ws.synchronized = true;
    return;
  }
  if (message.type === 'peer_hb') {
    replyPeerHeartbeat(message, ws, manager);
    return;
  }
  if (message.type === 'peer_command') {
    handlePeerCommandEnvelope(message, ws, manager, actions);
    return;
  }
  // Heartbeat acknowledgements and the main computer's clock are not show commands.
  if (IGNORED_PEER_TYPES.has(message.type)) return;
  const jump = resolvePeerJump(message, manager.getState());
  if (jump.kind === 'error') {
    ws.send(JSON.stringify({ type: 'error', code: jump.code, message: jump.message }));
    return;
  }
  const effective = jump.kind === 'jump' ? jump.message : message;
  actions.push(describeAction(effective, message, manager));
}

export async function createPeerComputer() {
  const manager = new SetlistManager();
  manager.updateCues(PEER_CUES);
  manager.setCustomOrder(PEER_ORDER);
  const actions = [];
  const messages = [];
  const wsServer = new SetlistWSServer('auth-token-of-the-second-computer', {
    peerToken: PEER_TOKEN,
  });
  wsServer.init();
  const tlsOptions = await makeTlsOptions();
  const server = https.createServer(tlsOptions, createHttpRequestListener());
  server.on('upgrade', (req, socket, head) => {
    wsServer.handleUpgrade(req, socket, head);
  });
  wsServer.on('client_message', (message, ws) => {
    messages.push(message);
    handlePeerMessage(message, ws, manager, actions);
  });
  return { server, wsServer, actions, messages, tls: tlsOptions };
}
