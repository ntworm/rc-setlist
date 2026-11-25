// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The follower of the second computer, wired to this computer's Live.

import { WebSocket } from 'ws';
import { resolveJumpTime } from '../commands/handlers/peer.js';
import { resolveCueAtTime } from '../commands/handlers/shared.js';
import type { SetlistState } from '../types.js';
import { log } from '../util/log.js';
import { bridgeState, broadcastState } from './bridge-state.js';
import {
  PeerFollower,
  movesTransport,
  resetPeerFollowTiming,
  setPeerFollowTiming,
  type FollowAction,
  type LocalTransport,
  type PeerTarget,
} from './peer-follow.js';
import { STALLED_SOCKET_BYTES } from './peer-message.js';

export { resetPeerFollowTiming, setPeerFollowTiming };

function beatsPerBar(numerator: number, denominator: number): number {
  if (!(numerator > 0) || !(denominator > 0)) return 4;
  return (numerator * 4) / denominator;
}

function localTransport(): LocalTransport | null {
  const state = bridgeState.manager?.getState();
  if (!state) return null;
  return {
    isPlaying: state.isPlaying,
    songTime: state.currentSongTime,
    tempo: state.tempo,
    jumpPending: bridgeState.scheduler?.hasPending() ?? false,
    loopActive: state.loopActive,
    beatsPerBar: beatsPerBar(state.signatureNumerator, state.signatureDenominator),
    transportLocked: bridgeState.commandBus?.wouldRejectForSafety('play') ?? false,
    followMode: bridgeState.peerFollowMode,
  };
}

/** How often the main computer tells the second one where its playhead is. */
const PEER_TARGET_INTERVAL_MS = 500;
const SECTION_BEAT_MATCH_TOLERANCE = 0.01;

function isAtActiveSection(state: SetlistState): boolean {
  if (state.activeSongIndex < 0 || state.activeSectionIndex < 0) return false;
  const song = state.songs[state.activeSongIndex];
  const section = song?.sections[state.activeSectionIndex];
  if (!section || section.automationOnly) return false;
  return Math.abs(section.time - state.currentSongTime) < SECTION_BEAT_MATCH_TOLERANCE;
}

/** The main computer's target position and transport, as the second computer reads it. */
function localPeerTarget(): Record<string, unknown> | null {
  const state = bridgeState.manager?.getState();
  // A Live that stopped answering leaves an old playhead behind: no target
  // is better than one the second computer would correct against.
  if (!state || bridgeState.oscClient?.isConnected !== true) return null;
  return {
    type: 'peer_target',
    transportSeq: bridgeState.masterTargetSeq,
    beat: Math.max(0, state.currentSongTime),
    section: isAtActiveSection(state),
    isPlaying: state.isPlaying,
    tempo: state.tempo,
    jumpPending: bridgeState.scheduler?.hasPending() ?? false,
    loopActive: state.loopActive,
  };
}

/**
 * Sends one target immediately (right after `sync_confirm`) and every 500 ms
 * thereafter while the link is in sync, so the second computer can converge
 * after a lost jump, a late launch, or a missed command. The socket getter
 * answers null once the link is no longer in sync.
 */
export function startPeerTarget(socket: () => WebSocket | null): NodeJS.Timeout {
  const sendNow = (): void => {
    const target = socket();
    // A target behind a full socket would be old by the time it is read.
    if (!target || target.readyState !== WebSocket.OPEN) return;
    if (target.bufferedAmount >= STALLED_SOCKET_BYTES) return;
    const frame = localPeerTarget();
    if (!frame) return;
    try {
      target.send(JSON.stringify(frame));
    } catch {
      // swallow: the next target tries again.
    }
  };
  sendNow();
  const timer = setInterval(sendNow, PEER_TARGET_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

let follower: PeerFollower | null = null;
let outOfStepListener: ((outOfStep: boolean) => void) | null = null;

function resolveTargetCue(
  state: SetlistState,
  songIndex: number,
  sectionIndex: number | null,
): { name: string; time: number; cueIndex: number } | null {
  const song = state.songs[songIndex];
  if (!song) return null;
  const section = sectionIndex !== null ? song.sections[sectionIndex] : undefined;
  const time = section ? section.time : song.time;
  return resolveCueAtTime(time);
}

function seekStoppedTarget(beat: number, section: boolean): void {
  const manager = bridgeState.manager;
  const osc = bridgeState.oscClient;
  if (!manager || !osc) return;
  const state = manager.getState();
  const target = resolveJumpTime(state, beat, section);
  if (target) {
    const cue = resolveTargetCue(state, target.songIndex, target.sectionIndex);
    if (cue) {
      osc.jumpToCuePoint(cue.cueIndex);
      manager.updateTransport(cue.time, false);
      manager.clearLoop();
      manager.resetFiredAutomations();
      broadcastState();
      return;
    }
  }
  osc.setCurrentSongTime(beat);
  manager.updateTransport(beat, false);
  broadcastState();
}

function createFollower(): PeerFollower {
  return new PeerFollower({
    moveTo(beat) {
      bridgeState.oscClient?.setCurrentSongTime(beat);
    },
    seekStopped(beat, section) {
      seekStoppedTarget(beat, section);
    },
    startAt(beat) {
      const osc = bridgeState.oscClient;
      if (!osc) return;
      // While stopped, the position written here is where Live starts from,
      // and Link holds the launch for the next quantum boundary.
      osc.setCurrentSongTime(beat);
      bridgeState.manager?.updateTransport(beat, false);
      osc.startPlaying();
      broadcastState();
    },
    stop() {
      bridgeState.oscClient?.stopPlaying();
    },
    report(message) {
      log.warn('peer', message);
      bridgeState.wsServer?.broadcastLog(message, 'warn');
    },
    onOutOfStepChange(outOfStep) {
      outOfStepListener?.(outOfStep);
    },
  });
}

function getFollower(): PeerFollower {
  follower ??= createFollower();
  return follower;
}

/** Registers a listener invoked whenever local `outOfStep` changes. */
export function setPeerOutOfStepListener(cb: ((outOfStep: boolean) => void) | null): void {
  outOfStepListener = cb;
}

/** Reports whether the slave playhead has a sustained mismatch against the master. */
export function isPeerOutOfStep(): boolean {
  return follower?.isOutOfStep() ?? false;
}

/** Clears follower state on link reconnect, disconnect, or server stop. */
export function resetPeerFollowRuntime(): void {
  follower?.resetSession();
}

/** A relayed command arrived from the main computer. */
export function notePeerCommand(type: string): void {
  if (movesTransport(type)) getFollower().noteCommand();
}

/** A target arrived from the main computer. */
export function handlePeerTarget(target: PeerTarget, minTransportSeq = 0): FollowAction {
  if (target.transportSeq < minTransportSeq) return { kind: 'none' };
  const local = localTransport();
  if (!local || !bridgeState.oscClient) return { kind: 'none' };
  return getFollower().onTarget(target, local);
}
