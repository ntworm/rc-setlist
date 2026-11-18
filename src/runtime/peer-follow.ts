// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The second computer keeps itself on the main computer's beat.
//
// The main computer relays every transport command, but a relayed command can
// still leave the two Lives apart. With Link on, Live launches Play and a
// quantized jump on the next quantum boundary, so a command that crosses the
// network while that boundary passes lands one bar late on the second
// computer, and stays a bar late for the rest of the song. A command written
// while the link was down never arrives at all, because nothing is queued.
//
// So the main computer also sends its clock twice a second: whether it plays,
// where its playhead is and its tempo. The second computer compares that with
// its own transport and corrects only what it can tell for sure:
//
// - Both play, and the gap is a whole number of beats (Link keeps the phase,
//   so a late launch is always whole beats): the playhead moves by that gap.
// - The main computer plays and this one is stopped: it starts on a bar line
//   of the main computer's position, and the first rule settles the rest.
// - The main computer is stopped and this one plays: it stops.
//
// Each case must hold for several clocks in a row before anything happens,
// and nothing happens while a jump waits for its grid, while a loop runs or
// right after a relayed command, when the two sides are expected to differ
// for a moment. A gap that is not whole beats means the phases differ (Link
// off, another tempo): that is reported, never corrected.

/** What the main computer says about its transport. */
export interface PeerClock {
  isPlaying: boolean;
  /** The playhead, in beats. */
  songTime: number;
  /** The tempo, in beats per minute. */
  tempo: number;
  /** Whether a quantized jump waits for its grid over there. */
  jumpPending: boolean;
  /** Whether a loop holds the playhead over there. */
  loopActive: boolean;
}

/** What this computer knows about its own transport. */
export interface LocalTransport {
  isPlaying: boolean;
  songTime: number;
  tempo: number;
  jumpPending: boolean;
  loopActive: boolean;
  /** Beats in a bar of this computer's set. */
  beatsPerBar: number;
  /** Whether panic or a lock refuses a transport command here. */
  transportLocked: boolean;
}

export type FollowAction =
  | { kind: 'none' }
  | { kind: 'shift'; beats: number; to: number }
  | { kind: 'start'; at: number }
  | { kind: 'stop' }
  | { kind: 'phase_mismatch'; gap: number };

/** How far a gap may sit from a whole beat and still be called whole. */
export const WHOLE_BEAT_TOLERANCE = 0.35;
/** How many clocks in a row a case must hold before it is acted on. */
export const STABLE_CLOCKS = 3;
/** How long after a relayed command the follower keeps still, in ms. */
export const SETTLE_AFTER_COMMAND_MS = 2_500;
/** How long after a correction the follower keeps still, in ms. */
export const SETTLE_AFTER_CORRECTION_MS = 3_000;
/** Two tempos closer than this are the same tempo. */
const SAME_TEMPO_BPM = 0.5;
/**
 * How late a position reading may be, in ms: the poll of each side is up to
 * a tenth of a second old, and a clock waits on the network too.
 */
export const READING_JITTER_MS = 150;

interface Sample {
  time: number;
  at: number;
}

/**
 * Whether a playing transport moved as far as its tempo says since the last
 * clock. A transport that froze (Live stopped answering while the server
 * still runs) or that just jumped is not a reading to correct against.
 */
function advancesAtTempo(prev: Sample | null, time: number, tempo: number, at: number): boolean {
  if (!prev || at <= prev.at) return false;
  const expected = ((at - prev.at) / 60_000) * tempo;
  // The tolerance stays below the movement itself, so a frozen playhead
  // never passes for a moving one, even at a slow tempo.
  const tolerance = (READING_JITTER_MS / 60_000) * tempo + 0.05;
  return Math.abs(time - prev.time - expected) <= tolerance;
}

/**
 * Decides what one clock asks for, without any memory of the ones before.
 */
export function assessPeerClock(remote: PeerClock, local: LocalTransport): FollowAction {
  if (!remote.isPlaying) return local.isPlaying ? { kind: 'stop' } : { kind: 'none' };
  if (local.transportLocked || remote.jumpPending || local.jumpPending) return { kind: 'none' };
  if (!local.isPlaying) return startAction(remote, local);
  return gapAction(remote, local);
}

function startAction(remote: PeerClock, local: LocalTransport): FollowAction {
  const bar = local.beatsPerBar > 0 ? local.beatsPerBar : 4;
  // The next bar line of the main computer's position: Live waits for the
  // quantum boundary anyway, and a bar line keeps the phase whole beats.
  return { kind: 'start', at: Math.ceil(remote.songTime / bar) * bar };
}

function gapAction(remote: PeerClock, local: LocalTransport): FollowAction {
  if (remote.loopActive || local.loopActive) return { kind: 'none' };
  if (Math.abs(remote.tempo - local.tempo) > SAME_TEMPO_BPM) return { kind: 'none' };
  const gap = remote.songTime - local.songTime;
  const beats = Math.round(gap);
  if (Math.abs(gap - beats) > WHOLE_BEAT_TOLERANCE) return { kind: 'phase_mismatch', gap };
  if (beats === 0) return { kind: 'none' };
  return { kind: 'shift', beats, to: local.songTime + beats };
}

function sameAction(a: FollowAction, b: FollowAction): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'shift' && b.kind === 'shift') return a.beats === b.beats;
  return true;
}

/**
 * Whether a relayed command moves the transport: the two sides differ for a
 * moment after one of them. A metronome or a quantization change moves
 * nothing, so it must not hold the follower back.
 */
export function movesTransport(type: string): boolean {
  return type === 'play' || type === 'stop' || type === 'jump_time' || type === 'trigger_count_in';
}

/** What the follower does to this computer's Live. */
export interface FollowEffects {
  moveTo(beat: number): void;
  startAt(beat: number): void;
  stop(): void;
  report(message: string): void;
}

/**
 * Remembers the clocks that came before, so that only a case that holds acts.
 */
export class PeerFollower {
  private candidate: FollowAction = { kind: 'none' };
  private streak = 0;
  private quietUntil = 0;
  private reportedMismatch = false;
  private lastRemote: Sample | null = null;
  private lastLocal: Sample | null = null;

  constructor(
    private readonly effects: FollowEffects,
    private readonly now: () => number = Date.now,
  ) {}

  /** A relayed command arrived: the two sides differ for a moment. */
  noteCommand(): void {
    this.quietUntil = Math.max(this.quietUntil, this.now() + SETTLE_AFTER_COMMAND_MS);
    this.reset();
  }

  /** The link went down or came back: nothing seen before still counts. */
  reset(): void {
    this.candidate = { kind: 'none' };
    this.streak = 0;
  }

  /** Reads one clock and acts when its case has held long enough. */
  onClock(remote: PeerClock, local: LocalTransport): FollowAction {
    const at = this.now();
    const steady = this.steady(remote, local, at);
    this.lastRemote = { time: remote.songTime, at };
    this.lastLocal = { time: local.songTime, at };
    const action = assessPeerClock(remote, local);
    // A playhead that did not move at its tempo since the last clock is not
    // a reading to correct against: only a stop goes on without it.
    if (!steady && action.kind !== 'stop' && action.kind !== 'none') {
      this.reset();
      return { kind: 'none' };
    }
    // A stop waits too: right after a relayed Play the main computer may not
    // have reported its own Play yet, and the relayed Stop itself is what
    // stops this side in the normal case.
    if (this.now() < this.quietUntil) {
      this.reset();
      return { kind: 'none' };
    }
    if (action.kind === 'none') {
      this.reset();
      this.reportedMismatch = false;
      return action;
    }
    if (sameAction(action, this.candidate)) this.streak += 1;
    else {
      this.candidate = action;
      this.streak = 1;
    }
    if (this.streak < STABLE_CLOCKS) return { kind: 'none' };
    this.reset();
    return this.apply(action);
  }

  private steady(remote: PeerClock, local: LocalTransport, at: number): boolean {
    if (!remote.isPlaying || remote.loopActive) return remote.isPlaying === false;
    if (!advancesAtTempo(this.lastRemote, remote.songTime, remote.tempo, at)) return false;
    if (!local.isPlaying || local.loopActive) return true;
    return advancesAtTempo(this.lastLocal, local.songTime, local.tempo, at);
  }

  private apply(action: FollowAction): FollowAction {
    switch (action.kind) {
      case 'shift':
        this.effects.moveTo(action.to);
        this.effects.report(
          `The second computer was ${Math.abs(action.beats)} beat(s) ${
            action.beats > 0 ? 'behind' : 'ahead of'
          } the main computer; its playhead moved to match.`,
        );
        break;
      case 'start':
        this.effects.startAt(action.at);
        this.effects.report(
          'The main computer is playing and this one was stopped; it started on the next bar.',
        );
        break;
      case 'stop':
        this.effects.stop();
        this.effects.report('The main computer is stopped; this one stopped too.');
        break;
      case 'phase_mismatch':
        if (!this.reportedMismatch) {
          this.reportedMismatch = true;
          this.effects.report(
            `The second computer is ${action.gap.toFixed(2)} beats from the main computer and not on its beat. Check that Link is on on both computers.`,
          );
        }
        return action;
      default:
        return action;
    }
    this.quietUntil = this.now() + SETTLE_AFTER_CORRECTION_MS;
    return action;
  }
}
