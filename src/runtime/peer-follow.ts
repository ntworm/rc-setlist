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
// So the main computer also sends its target twice a second: whether it plays,
// where its playhead sits, whether that beat is a section, and its tempo. The
// second computer compares that with its own transport and acts on what it
// knows for sure:
//
// - Both play, and the gap is a whole number of beats (Link keeps the phase,
//   so a late launch is always whole beats): the playhead moves by that gap.
// - The main computer plays and this one is stopped: it starts on a bar line
//   of the main computer's position, and the first rule settles the rest.
// - The main computer is stopped and this one plays: it stops.
// - Both are stopped at different beats: when auto-correct is on, converge to
//   the marker at that beat (or move directly between markers); when off,
//   alert without moving the playhead.
//
// Each case must hold for several targets in a row before anything happens,
// and nothing happens while a jump waits for its grid, while a loop runs or
// right after a relayed command, when the two sides are expected to differ
// for a moment. Sustained mismatches outside those windows flag `outOfStep`.

/** What the main computer says about its transport and target position. */
export interface PeerTarget {
  transportSeq: number;
  /** The playhead, in beats. */
  beat: number;
  /** Whether the active marker at `beat` is a section. */
  section: boolean;
  isPlaying: boolean;
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
  /** Whether automatic stopped-state convergence is enabled. Defaults to `true`. */
  autoCorrect?: boolean;
}

export type FollowAction =
  | { kind: 'none' }
  | { kind: 'shift'; beats: number; to: number }
  | { kind: 'start'; at: number }
  | { kind: 'stop' }
  | { kind: 'seek_stopped'; beat: number; section: boolean }
  | { kind: 'phase_mismatch'; gap: number };

/** Tunable timing thresholds for peer following and out-of-step detection. */
export interface PeerFollowTiming {
  settleAfterCommandMs: number;
  settleAfterCorrectionMs: number;
  clockGapResetMs: number;
  outOfStepMs: number;
}

/** How far a gap may sit from a whole beat and still be called whole. */
export const WHOLE_BEAT_TOLERANCE = 0.35;
/** How far apart stopped or playing beats may sit without mismatching. */
export const STOPPED_BEAT_TOLERANCE = 0.5;
/** How many targets in a row a case must hold before it is acted on. */
export const STABLE_CLOCKS = 3;
/** How long after a relayed command the follower keeps still, in ms. */
export const SETTLE_AFTER_COMMAND_MS = 2_500;
/** A silence between two targets longer than this starts the count again, in ms. */
export const CLOCK_GAP_RESET_MS = 2_000;
/** How long after a correction the follower keeps still, in ms. */
export const SETTLE_AFTER_CORRECTION_MS = 3_000;
/** How long a sustained mismatch must hold before flagging `outOfStep`, in ms. */
export const OUT_OF_STEP_MS = 3_000;
/** Two tempos closer than this are the same tempo. */
const SAME_TEMPO_BPM = 0.5;
/** How close two stopped targets must be to count toward the same streak. */
const SAME_STOPPED_TARGET_TOLERANCE = 0.05;
/**
 * How late a position reading may be, in ms: the poll of each side is up to
 * a tenth of a second old, and a target waits on the network too.
 */
export const READING_JITTER_MS = 150;

const DEFAULT_FOLLOW_TIMING: PeerFollowTiming = {
  settleAfterCommandMs: SETTLE_AFTER_COMMAND_MS,
  settleAfterCorrectionMs: SETTLE_AFTER_CORRECTION_MS,
  clockGapResetMs: CLOCK_GAP_RESET_MS,
  outOfStepMs: OUT_OF_STEP_MS,
};

let currentTiming: PeerFollowTiming = { ...DEFAULT_FOLLOW_TIMING };

/** Returns the active peer follow timing thresholds. */
export function peerFollowTiming(): PeerFollowTiming {
  return currentTiming;
}

/** Overrides one or more peer follow timing thresholds. */
export function setPeerFollowTiming(next: Partial<PeerFollowTiming>): void {
  currentTiming = { ...currentTiming, ...next };
}

/** Restores peer follow timing thresholds to their default values. */
export function resetPeerFollowTiming(): void {
  currentTiming = { ...DEFAULT_FOLLOW_TIMING };
}

interface Sample {
  time: number;
  at: number;
}

/**
 * Whether a playing transport moved as far as its tempo says since the last
 * target. A transport that froze (Live stopped answering while the server
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

function stoppedAction(remote: PeerTarget, local: LocalTransport): FollowAction {
  if (local.isPlaying) return { kind: 'stop' };
  if (local.transportLocked || remote.jumpPending || local.jumpPending) return { kind: 'none' };
  if (Math.abs(remote.beat - local.songTime) > STOPPED_BEAT_TOLERANCE) {
    return { kind: 'seek_stopped', beat: remote.beat, section: remote.section };
  }
  return { kind: 'none' };
}

/**
 * Decides what one target asks for, without any memory of the ones before.
 */
export function assessPeerTarget(remote: PeerTarget, local: LocalTransport): FollowAction {
  if (!remote.isPlaying) return stoppedAction(remote, local);
  if (local.transportLocked || remote.jumpPending || local.jumpPending) return { kind: 'none' };
  if (!local.isPlaying) return startAction(remote, local);
  return gapAction(remote, local);
}

function startAction(remote: PeerTarget, local: LocalTransport): FollowAction {
  const bar = local.beatsPerBar > 0 ? local.beatsPerBar : 4;
  // The next bar line of the main computer's position: Live waits for the
  // quantum boundary anyway, and a bar line keeps the phase whole beats.
  return { kind: 'start', at: Math.ceil(remote.beat / bar) * bar };
}

function gapAction(remote: PeerTarget, local: LocalTransport): FollowAction {
  if (remote.loopActive || local.loopActive) return { kind: 'none' };
  if (Math.abs(remote.tempo - local.tempo) > SAME_TEMPO_BPM) return { kind: 'none' };
  const gap = remote.beat - local.songTime;
  const beats = Math.round(gap);
  if (Math.abs(gap - beats) > WHOLE_BEAT_TOLERANCE) return { kind: 'phase_mismatch', gap };
  if (beats === 0) return { kind: 'none' };
  return { kind: 'shift', beats, to: local.songTime + beats };
}

function sameAction(a: FollowAction, b: FollowAction): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'shift' && b.kind === 'shift') return a.beats === b.beats;
  if (a.kind === 'seek_stopped' && b.kind === 'seek_stopped') {
    return a.section === b.section && Math.abs(a.beat - b.beat) <= SAME_STOPPED_TARGET_TOLERANCE;
  }
  return true;
}

function isFollowSuppressed(remote: PeerTarget, local: LocalTransport): boolean {
  return remote.jumpPending || local.jumpPending || remote.loopActive || local.loopActive;
}

function hasRawMismatch(remote: PeerTarget, local: LocalTransport): boolean {
  if (remote.isPlaying !== local.isPlaying) return true;
  return Math.abs(remote.beat - local.songTime) > STOPPED_BEAT_TOLERANCE;
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
  seekStopped(beat: number, section: boolean): void;
  startAt(beat: number): void;
  stop(): void;
  report(message: string): void;
  onOutOfStepChange?(outOfStep: boolean): void;
}

/**
 * Remembers the targets that came before, so that only a case that holds acts.
 */
export class PeerFollower {
  private candidate: FollowAction = { kind: 'none' };
  private streak = 0;
  private commandQuietUntil = 0;
  private correctionQuietUntil = 0;
  private reportedMismatch = false;
  private reportedStoppedMismatch = false;
  private lastRemote: Sample | null = null;
  private lastLocal: Sample | null = null;
  private mismatchSince: number | null = null;
  private outOfStepState = false;
  private readonly timing: () => PeerFollowTiming;

  constructor(
    private readonly effects: FollowEffects,
    private readonly now: () => number = Date.now,
    timing: () => PeerFollowTiming = () => currentTiming,
  ) {
    this.timing = timing;
  }

  /** Whether a sustained transport mismatch has crossed `outOfStepMs`. */
  isOutOfStep(): boolean {
    return this.outOfStepState;
  }

  /** A relayed command arrived: the two sides differ for a moment. */
  noteCommand(): void {
    this.commandQuietUntil = Math.max(
      this.commandQuietUntil,
      this.now() + this.timing().settleAfterCommandMs,
    );
    this.clearOutOfStep();
    this.reset();
  }

  /** The link went down or came back: nothing seen before still counts. */
  reset(): void {
    this.candidate = { kind: 'none' };
    this.streak = 0;
  }

  /** Clears all follower state across a reconnect, link drop, or server stop. */
  resetSession(): void {
    this.reset();
    this.commandQuietUntil = 0;
    this.correctionQuietUntil = 0;
    this.reportedMismatch = false;
    this.reportedStoppedMismatch = false;
    this.lastRemote = null;
    this.lastLocal = null;
    this.clearOutOfStep();
  }

  /** Reads one target and acts when its case has held long enough. */
  onTarget(remote: PeerTarget, local: LocalTransport): FollowAction {
    const at = this.now();
    // A link that was quiet for a while came back: what was counted before
    // it is not counted on top of the first target after it.
    if (this.lastRemote && at - this.lastRemote.at > this.timing().clockGapResetMs) {
      this.reset();
    }
    const steady = this.steady(remote, local, at);
    this.lastRemote = { time: remote.beat, at };
    this.lastLocal = { time: local.songTime, at };
    this.updateOutOfStep(remote, local, at);
    const action = assessPeerTarget(remote, local);
    if (!this.canPursueAction(action, steady, at)) {
      this.reset();
      return { kind: 'none' };
    }
    return this.advanceActionStreak(action, local);
  }

  private canPursueAction(action: FollowAction, steady: boolean, at: number): boolean {
    // A playhead that did not move at its tempo since the last target is not
    // a reading to correct against: only a stop or stopped seek goes on without it.
    if (!steady && action.kind !== 'stop' && action.kind !== 'none') return false;
    if (at < this.commandQuietUntil || at < this.correctionQuietUntil) return false;
    return true;
  }

  private advanceActionStreak(action: FollowAction, local: LocalTransport): FollowAction {
    if (action.kind === 'none') {
      this.reset();
      this.reportedMismatch = false;
      this.reportedStoppedMismatch = false;
      return action;
    }
    if (sameAction(action, this.candidate)) this.streak += 1;
    else {
      this.candidate = action;
      this.streak = 1;
    }
    if (this.streak < STABLE_CLOCKS) return { kind: 'none' };
    this.reset();
    return this.apply(action, local.autoCorrect !== false);
  }

  private updateOutOfStep(remote: PeerTarget, local: LocalTransport, at: number): void {
    const suppressed = at < this.commandQuietUntil || isFollowSuppressed(remote, local);
    if (suppressed || !hasRawMismatch(remote, local)) {
      this.clearOutOfStep();
      return;
    }
    if (this.mismatchSince === null) this.mismatchSince = at;
    if (at - this.mismatchSince >= this.timing().outOfStepMs) {
      this.setOutOfStep(true);
    }
  }

  private clearOutOfStep(): void {
    this.mismatchSince = null;
    this.setOutOfStep(false);
  }

  private setOutOfStep(next: boolean): void {
    if (this.outOfStepState === next) return;
    this.outOfStepState = next;
    this.effects.onOutOfStepChange?.(next);
  }

  private steady(remote: PeerTarget, local: LocalTransport, at: number): boolean {
    if (!remote.isPlaying || remote.loopActive) return remote.isPlaying === false;
    if (!advancesAtTempo(this.lastRemote, remote.beat, remote.tempo, at)) return false;
    if (!local.isPlaying || local.loopActive) return true;
    return advancesAtTempo(this.lastLocal, local.songTime, local.tempo, at);
  }

  private apply(action: FollowAction, autoCorrect: boolean): FollowAction {
    if (action.kind === 'phase_mismatch') return this.applyPhaseMismatch(action.gap);
    if (action.kind === 'none') return action;
    if (!autoCorrect) return this.reportAutoCorrectOff(action);
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
      case 'seek_stopped':
        this.effects.seekStopped(action.beat, action.section);
        this.effects.report(
          `The second computer moved to beat ${action.beat.toFixed(2)} to match the main computer.`,
        );
        break;
    }
    this.correctionQuietUntil = this.now() + this.timing().settleAfterCorrectionMs;
    this.clearOutOfStep();
    return action;
  }

  private reportAutoCorrectOff(action: FollowAction): FollowAction {
    if (!this.reportedStoppedMismatch) {
      this.reportedStoppedMismatch = true;
      const detail =
        action.kind === 'seek_stopped'
          ? 'The second computer is at a different beat from the main computer while stopped (auto-correct is off).'
          : 'The second computer is out of step with the main computer (auto-correct is off).';
      this.effects.report(detail);
    }
    return { kind: 'none' };
  }

  private applyPhaseMismatch(gap: number): FollowAction {
    if (!this.reportedMismatch) {
      this.reportedMismatch = true;
      this.effects.report(
        `The second computer is ${gap.toFixed(2)} beats from the main computer and not on its beat. Check that Link is on on both computers.`,
      );
    }
    return { kind: 'phase_mismatch', gap };
  }
}
