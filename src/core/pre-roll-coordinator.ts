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
    preRollObserved: boolean;
  };
}

type PendingPreRoll = NonNullable<PreRollState['pending']>;

/**
 * Schedules a one-bar count-in without ever holding back playback.
 *
 * AbletonOSC owns a fixed reply port, so a second Control Surface can leave
 * this extension able to send setters while no reply ever comes back. The
 * caller therefore issues the position write, the temporary Click and Play
 * immediately; this coordinator only decides whether the Click it borrowed has
 * to be handed back, and it decides that from playhead samples alone.
 */
export class PreRollCoordinator {
  private pending: PendingPreRoll | null = null;

  public start(input: {
    enabled: boolean;
    isPlaying: boolean;
    targetBeat: number;
    signatureNumerator: number;
    signatureDenominator?: number;
    metronome: boolean;
  }): PreRollStartDecision {
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

    const signatureDenominator = Number.isFinite(input.signatureDenominator)
      && input.signatureDenominator! > 0
      ? input.signatureDenominator!
      : 4;
    const beatsPerBar = input.signatureNumerator * 4 / signatureDenominator;
    if (!Number.isFinite(beatsPerBar) || beatsPerBar <= 0) {
      return { kind: 'passthrough', shortened: false, reason: 'invalid' };
    }
    const requestedStartBeat = input.targetBeat - beatsPerBar;
    const startBeat = Math.max(0, requestedStartBeat);
    const shortened = startBeat !== requestedStartBeat;
    if (input.targetBeat - startBeat <= POSITION_EPSILON_BEATS) {
      return { kind: 'passthrough', shortened, reason: 'no_room' };
    }

    // A repeated Play supersedes the armed pre-roll instead of being swallowed:
    // a stale pending state must never be able to make Play do nothing.
    this.pending = {
      targetBeat: input.targetBeat,
      startBeat,
      metronomeWasEnabled: input.metronome,
      metronomeOverridden: false,
      preRollObserved: false,
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

    if (!this.pending.preRollObserved) {
      // Only a sample inside the count-in window proves the playhead actually
      // moved back. Samples still in flight from the target would otherwise
      // restore Click before the count-in was ever heard.
      if (currentBeat >= this.pending.startBeat - POSITION_EPSILON_BEATS
        && currentBeat < this.pending.targetBeat - POSITION_EPSILON_BEATS) {
        this.pending.preRollObserved = true;
      }
      return null;
    }

    if (currentBeat >= this.pending.targetBeat - POSITION_EPSILON_BEATS) {
      return this.finish();
    }
    return null;
  }

  public observeTransport(isPlaying: boolean): PreRollFinishAction | null {
    if (!this.pending || isPlaying) return null;
    return this.finish();
  }

  public markMetronomeOverridden(): void {
    if (this.pending) this.pending.metronomeOverridden = true;
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
