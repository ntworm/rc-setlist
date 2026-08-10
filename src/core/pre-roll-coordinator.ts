const POSITION_EPSILON_BEATS = 0.001;

export type PreRollStartDecision =
  | {
      kind: 'passthrough';
      shortened: boolean;
      reason?: 'disabled' | 'playing' | 'invalid' | 'no_room';
    }
  | {
      kind: 'pre_roll';
      targetBeat: number;
      startBeat: number;
      enableMetronome: boolean;
      shortened: boolean;
    };

export interface PreRollFinishAction {
  restoreMetronome: boolean;
}

export interface PreRollState {
  pending: null | {
    targetBeat: number;
    startBeat: number;
    metronomeWasEnabled: boolean;
    metronomeOverridden: boolean;
    temporaryMetronomeObserved: boolean;
    rewindObserved: boolean;
    playingObserved: boolean;
  };
}

type PendingPreRoll = NonNullable<PreRollState['pending']>;

export class PreRollCoordinator {
  private pending: PendingPreRoll | null = null;

  public start(input: {
    enabled: boolean;
    isPlaying: boolean;
    targetBeat: number;
    signatureNumerator: number;
    metronome: boolean;
  }): PreRollStartDecision {
    this.pending = null;

    if (!input.enabled) {
      return { kind: 'passthrough', shortened: false, reason: 'disabled' };
    }
    if (input.isPlaying) {
      return { kind: 'passthrough', shortened: false, reason: 'playing' };
    }
    if (
      !Number.isFinite(input.targetBeat)
      || input.targetBeat < 0
      || !Number.isFinite(input.signatureNumerator)
      || input.signatureNumerator <= 0
    ) {
      return { kind: 'passthrough', shortened: false, reason: 'invalid' };
    }

    const requestedStartBeat = input.targetBeat - input.signatureNumerator;
    const startBeat = Math.max(0, requestedStartBeat);
    const shortened = startBeat !== requestedStartBeat;
    if (input.targetBeat - startBeat <= POSITION_EPSILON_BEATS) {
      return { kind: 'passthrough', shortened, reason: 'no_room' };
    }

    this.pending = {
      targetBeat: input.targetBeat,
      startBeat,
      metronomeWasEnabled: input.metronome,
      metronomeOverridden: false,
      temporaryMetronomeObserved: false,
      rewindObserved: false,
      playingObserved: false,
    };

    return {
      kind: 'pre_roll',
      targetBeat: input.targetBeat,
      startBeat,
      enableMetronome: !input.metronome,
      shortened,
    };
  }

  public observePosition(currentBeat: number): PreRollFinishAction | null {
    if (!this.pending || !Number.isFinite(currentBeat)) return null;

    if (currentBeat < this.pending.targetBeat - POSITION_EPSILON_BEATS) {
      this.pending.rewindObserved = true;
      return null;
    }

    if (!this.pending.rewindObserved) return null;
    return this.finish();
  }

  public observeTransport(isPlaying: boolean): PreRollFinishAction | null {
    if (!this.pending) return null;
    if (isPlaying) {
      this.pending.playingObserved = true;
      return null;
    }
    if (!this.pending.playingObserved && !this.pending.rewindObserved) return null;
    return this.finish();
  }

  public markMetronomeOverridden(): void {
    if (this.pending) this.pending.metronomeOverridden = true;
  }

  public observeMetronome(metronome: boolean): void {
    if (!this.pending) return;

    if (!this.pending.metronomeWasEnabled && !this.pending.temporaryMetronomeObserved) {
      // Ignore an in-flight stale Click-off sample until Live acknowledges the
      // temporary Click-on requested by this pre-roll.
      if (metronome) this.pending.temporaryMetronomeObserved = true;
      return;
    }

    this.pending.metronomeOverridden = true;
  }

  public cancel(): PreRollFinishAction | null {
    if (!this.pending) return null;
    return this.finish();
  }

  public hasPending(): boolean {
    return this.pending !== null;
  }

  private finish(): PreRollFinishAction {
    const pending = this.pending!;
    this.pending = null;
    return {
      restoreMetronome: !pending.metronomeWasEnabled && !pending.metronomeOverridden,
    };
  }
}
