export interface RawCue {
  name?: string;
  time?: number;
}

/**
 * Computes a stable fingerprint string for a collection of cues/locators.
 *
 * Sorting:
 * Live or OSC may report cues out-of-order or in insertion order. Sorting by time
 * ensures the fingerprint is deterministic regardless of reception sequence.
 *
 * Quantization:
 * Math.round(t * 100) / 100 quantizes the locator beat position to 2 decimal places (1/100th beat).
 * Live's internal clock and OSC telemetry can emit floating-point jitter/rounding micro-variations
 * on locator positions (e.g. 120.00000000000001 vs 120.0). Without rounding to 1/100th beat,
 * micro-jitter produces distinct fingerprint strings, triggering unnecessary full-setlist
 * reparsing and disruptive UI redraws during playback.
 */
export function computeCuesFingerprint(cues: RawCue[]): string {
  const sorted = [...cues].sort((a, b) => (a.time || 0) - (b.time || 0));
  return sorted
    .map(
      (c) =>
        `${c.name || ''}@${typeof c.time === 'number' && Number.isFinite(c.time) ? Math.round(c.time * 100) / 100 : 0}`,
    )
    .join('|');
}
