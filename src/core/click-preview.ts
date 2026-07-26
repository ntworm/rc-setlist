/**
 * Click-track synth helper.
 *
 * Generates a short WAV buffer in memory: a measure of N beats at the given
 * BPM. Beat 1 is a higher pitch (accent), the others are lower. The output is
 * 16-bit mono PCM at 44.1 kHz — small enough for caching (<50 KB per minute
 * worth of beats) and playable by every modern browser without codecs.
 */

const SAMPLE_RATE = 44100;

export interface ClickPreviewOptions {
  bpm: number;
  beats?: number;        // number of clicks (default 4 = one measure of 4/4)
  accentHz?: number;     // beat-1 frequency (default 1000)
  normalHz?: number;     // other beats (default 800)
  amplitude?: number;    // 0..1 (default 0.5)
  clickDurationMs?: number; // each click length (default 30ms)
}

export function buildClickPreviewWav(opts: ClickPreviewOptions): Buffer {
  const bpm = Math.max(20, Math.min(300, Math.round(opts.bpm)));
  const beats = Math.max(1, Math.min(64, Math.round(opts.beats ?? 4)));
  const accentHz = opts.accentHz ?? 1000;
  const normalHz = opts.normalHz ?? 800;
  const amplitude = Math.max(0, Math.min(1, opts.amplitude ?? 0.5));
  const clickDur = Math.max(5, Math.min(200, opts.clickDurationMs ?? 30));
  const totalDurationSec = (60 / bpm) * beats;
  const totalSamples = Math.ceil(totalDurationSec * SAMPLE_RATE);
  const clickSamples = Math.min(
    Math.ceil((clickDur / 1000) * SAMPLE_RATE),
    totalSamples
  );
  const samples = new Int16Array(totalSamples);
  const beatIntervalSec = 60 / bpm;

  for (let beat = 0; beat < beats; beat++) {
    const startSample = Math.floor(beat * beatIntervalSec * SAMPLE_RATE);
    const endSample = Math.min(startSample + clickSamples, totalSamples);
    if (startSample >= totalSamples) break;
    const freqHz = beat === 0 ? accentHz : normalHz;
    // Apply a short exponential decay envelope (factor ~8 over the click).
    for (let i = startSample; i < endSample; i++) {
      const t = (i - startSample) / SAMPLE_RATE;
      const env = Math.exp(-t * (1000 / clickDur) * 8);
      // Phase-offset by π/2 so the click starts at the sine peak instead of a
      // zero-crossing (avoids a silent first sample at high click frequencies).
      const sample = amplitude * env * Math.sin(2 * Math.PI * freqHz * t + Math.PI / 2);
      // Mix with whatever else is at this sample, then clip to int16.
      const mixed = samples[i]! / 32768 + sample;
      const clipped = Math.max(-1, Math.min(1, mixed));
      samples[i] = Math.round(clipped * 32767);
    }
  }

  return encodeWavPcm16Mono(samples, SAMPLE_RATE);
}

function encodeWavPcm16Mono(samples: Int16Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  // fmt chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);          // chunk size
  buf.writeUInt16LE(1, 20);           // PCM
  buf.writeUInt16LE(1, 22);           // mono
  buf.writeUInt32LE(sampleRate, 24);  // sample rate
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate (sampleRate * channels * bytesPerSample)
  buf.writeUInt16LE(2, 32);           // block align
  buf.writeUInt16LE(16, 34);          // bits per sample
  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i]!, 44 + i * 2);
  }
  return buf;
}

/** Filename for caching / serving the WAV. */
export function clickPreviewFilename(bpm: number, beats: number): string {
  return `click-preview-${Math.round(bpm)}bpm-${beats}beats.wav`;
}
