/**
 * next-downbeat-jump — minimal click-to-jump scheduler.
 */

export interface JumpState {
  tempo: number;
  isPlaying: boolean;
  signatureNumerator: number;
  currentSongTime: number;
  clipTriggerQuantization?: number | string;
}

export interface PendingJump {
  songIndex: number;
  sectionIndex: number | null;
  cueName: string;
  cueIndex: number;
  targetTime: number;
  landingTime: number; // next quantization boundary in beats
  scheduledAt: number;
}

/**
 * Compute the next downbeat at or after `anchor` seconds.
 * Retained for backwards compatibility with tests.
 */
export function nextDownbeat(
  anchor: number,
  tempo: number,
  signatureNumerator: number
): number {
  const safeTempo = tempo > 0 ? tempo : 120;
  const safeSig = signatureNumerator > 0 ? signatureNumerator : 4;
  const barLength = (60 / safeTempo) * safeSig;
  return Math.ceil(anchor / barLength) * barLength;
}

/**
 * Compute the next quantization boundary in beats at or after `anchor` beats.
 */
export function nextQuantizationBoundary(
  anchor: number,
  quantizationBeats: number
): number {
  if (quantizationBeats <= 0) return anchor;
  return Math.ceil(anchor / quantizationBeats) * quantizationBeats;
}

/**
 * Maps Ableton's clip trigger quantization enum (number or string) to beats.
 */
export function getQuantizationBeats(
  quantVal: number | string | undefined | null,
  signatureNumerator: number
): number {
  let val: number = 4; // default to 1 bar
  if (typeof quantVal === 'number') {
    val = quantVal;
  } else if (typeof quantVal === 'string') {
    const map: Record<string, number> = {
      'none': 0,
      'q_no_q': 0,
      'q_8_bars': 1,
      'q_4_bars': 2,
      'q_2_bars': 3,
      'q_bar': 4,
      'q_half': 5,
      'q_half_triplet': 6,
      'q_quarter': 7,
      'q_quarter_triplet': 8,
      'q_eight': 9,
      'q_eighth': 9,
      'q_eight_triplet': 10,
      'q_eighth_triplet': 10,
      'q_sixteenth': 11,
      'q_sixteenth_triplet': 12,
      'q_thirtysecond': 13,
      'q_thirtysecond_triplet': 14,
      'q_sixtyfourth': 15,
      'q_sixtyfourth_triplet': 16,
    };
    val = map[quantVal.toLowerCase()] ?? 4;
  } else if (quantVal === undefined || quantVal === null) {
    val = 4;
  }

  const sig = signatureNumerator > 0 ? signatureNumerator : 4;
  switch (val) {
    case 0: return 0; // None
    case 1: return 8 * sig; // 8 Bars
    case 2: return 4 * sig; // 4 Bars
    case 3: return 2 * sig; // 2 Bars
    case 4: return sig; // 1 Bar
    case 5: return 0.5 * sig; // 1/2 Bar
    case 6: return (1 / 3) * sig; // 1/2 Triplet
    case 7: return 1; // 1/4 Bar (1 Beat)
    case 8: return 2 / 3; // 1/4 Triplet
    case 9: return 0.5; // 1/8 Bar (0.5 Beat)
    case 10: return 1 / 3; // 1/8 Triplet
    case 11: return 0.25; // 1/16 Bar (0.25 Beat)
    case 12: return 1 / 6; // 1/16 Triplet
    case 13: return 0.125; // 1/32 Bar
    case 14: return 1 / 12; // 1/32 Triplet
    case 15: return 0.0625; // 1/64 Bar
    case 16: return 1 / 24; // 1/64 Triplet
    default: return sig; // default 1 bar
  }
}

export class JumpScheduler {
  private pending: PendingJump | null = null;
  private listeners: Set<(event: { type: 'replaced' | 'executed'; pending: PendingJump }) => void> = new Set();

  hasPending(): boolean {
    return this.pending !== null;
  }

  getPending(): PendingJump | null {
    return this.pending;
  }

  clearPending(): void {
    this.pending = null;
  }

  on(listener: (event: { type: 'replaced' | 'executed'; pending: PendingJump }) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Schedule a jump to a target. Supports optional cueIndex for index-based jumps.
   */
  schedule(
    songIndex: number,
    sectionIndex: number | null,
    cueName: string,
    targetTime: number,
    state: JumpState,
    cueIndex: number = -1
  ): { immediate: boolean; landingTime: number; replaced: boolean } {
    const quantBeats = getQuantizationBeats(state.clipTriggerQuantization, state.signatureNumerator);
    
    // Immediate if not playing or quantization is None (0)
    const immediate = !state.isPlaying || quantBeats === 0;
    
    // We calculate landingTime in beats.
    // To support tests where targetTime is treated as seconds/beats:
    // nextQuantizationBoundary behaves identically.
    const landingTime = immediate ? state.currentSongTime : nextQuantizationBoundary(
      state.currentSongTime,
      quantBeats
    );

    const pending: PendingJump = {
      songIndex,
      sectionIndex,
      cueName,
      cueIndex,
      targetTime,
      landingTime,
      scheduledAt: Date.now(),
    };
    const isReplacement = this.pending !== null;
    this.pending = pending;
    this.emit({ type: 'replaced', pending });
    return { immediate, landingTime, replaced: isReplacement };
  }

  tick(currentSongTime: number): PendingJump | null {
    if (!this.pending) return null;
    if (currentSongTime >= this.pending.landingTime) {
      const executed = this.pending;
      this.pending = null;
      this.emit({ type: 'executed', pending: executed });
      return executed;
    }
    return null;
  }

  private emit(event: { type: 'replaced' | 'executed'; pending: PendingJump }): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.error('[JumpScheduler] listener threw:', err);
      }
    }
  }
}
