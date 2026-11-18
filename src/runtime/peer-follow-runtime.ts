// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The follower of the second computer, wired to this computer's Live.

import { bridgeState, broadcastState } from './bridge-state.js';
import {
  PeerFollower,
  type FollowAction,
  type LocalTransport,
  type PeerClock,
} from './peer-follow.js';
import { WebSocket } from 'ws';
import { log } from '../util/log.js';

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
  };
}

/** How often the main computer tells the second one where its playhead is. */
const PEER_CLOCK_INTERVAL_MS = 500;

/** The main computer's transport, as the second computer reads it. */
function localPeerClock(): Record<string, unknown> | null {
  const state = bridgeState.manager?.getState();
  if (!state) return null;
  return {
    type: 'peer_clock',
    isPlaying: state.isPlaying,
    songTime: state.currentSongTime,
    tempo: state.tempo,
    jumpPending: bridgeState.scheduler?.hasPending() ?? false,
    loopActive: state.loopActive,
  };
}

/**
 * Sends the clock while the link is in sync, so the second computer can find
 * a launch that landed a bar late or a command that never arrived. The
 * socket getter answers null once the link is no longer in sync.
 */
export function startPeerClock(socket: () => WebSocket | null): NodeJS.Timeout {
  const timer = setInterval(() => {
    const target = socket();
    // A clock behind a full socket would be old by the time it is read.
    if (!target || target.readyState !== WebSocket.OPEN || target.bufferedAmount > 0) return;
    const clock = localPeerClock();
    if (!clock) return;
    try {
      target.send(JSON.stringify(clock));
    } catch {
      // swallow: the next clock tries again.
    }
  }, PEER_CLOCK_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

let follower: PeerFollower | null = null;

function getFollower(): PeerFollower {
  follower ??= new PeerFollower({
    moveTo(beat) {
      bridgeState.oscClient?.setCurrentSongTime(beat);
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
  });
  return follower;
}

/** A relayed transport command arrived from the main computer. */
export function notePeerCommand(): void {
  getFollower().noteCommand();
}

/** A clock arrived from the main computer. */
export function handlePeerClock(clock: PeerClock): FollowAction {
  const local = localTransport();
  if (!local || !bridgeState.oscClient) return { kind: 'none' };
  return getFollower().onClock(clock, local);
}
