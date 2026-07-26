/**
 * Tests for src/core/click-preview.ts (WAV synth).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClickPreviewWav,
  clickPreviewFilename,
} from '../src/core/click-preview.ts';

test('buildClickPreviewWav: produces valid RIFF/WAVE header', () => {
  const wav = buildClickPreviewWav({ bpm: 120, beats: 4 });
  assert.equal(wav.slice(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.slice(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wav.slice(12, 16).toString('ascii'), 'fmt ');
  assert.equal(wav.slice(36, 40).toString('ascii'), 'data');
});

test('buildClickPreviewWav: PCM16 mono @ 44100', () => {
  const wav = buildClickPreviewWav({ bpm: 120, beats: 4 });
  // fmt chunk: PCM(1) mono(1) sampleRate(44100) byteRate(88200) blockAlign(2) bitsPerSample(16)
  assert.equal(wav.readUInt16LE(20), 1, 'PCM format');
  assert.equal(wav.readUInt16LE(22), 1, 'mono');
  assert.equal(wav.readUInt32LE(24), 44100, 'sample rate');
  assert.equal(wav.readUInt32LE(28), 44100 * 2, 'byte rate');
  assert.equal(wav.readUInt16LE(32), 2, 'block align');
  assert.equal(wav.readUInt16LE(34), 16, 'bits per sample');
});

test('buildClickPreviewWav: shorter buffer at higher BPM', () => {
  const wav60 = buildClickPreviewWav({ bpm: 60, beats: 4 });
  const wav120 = buildClickPreviewWav({ bpm: 120, beats: 4 });
  assert.ok(
    wav60.length > wav120.length,
    `60bpm wav (${wav60.length}B) should be longer than 120bpm (${wav120.length}B)`
  );
});

test('buildClickPreviewWav: respects beat count', () => {
  const wav1 = buildClickPreviewWav({ bpm: 120, beats: 1 });
  const wav4 = buildClickPreviewWav({ bpm: 120, beats: 4 });
  assert.ok(wav4.length > wav1.length);
});

test('buildClickPreviewWav: clamps invalid BPM/beats', () => {
  // Should not throw; should return a sane WAV
  const wav = buildClickPreviewWav({ bpm: 500, beats: -5 });
  assert.equal(wav.slice(0, 4).toString('ascii'), 'RIFF');
  // Clamped bpm=300, beats=1 → ~0.2s of audio
  assert.ok(wav.length > 44, 'data chunk present');
});

test('buildClickPreviewWav: contains audio samples (non-zero near beat-1)', () => {
  const wav = buildClickPreviewWav({ bpm: 120, beats: 4 });
  // Data starts at byte 44. Sample #0 should be a click (not silence).
  const firstSample = wav.readInt16LE(44);
  // Beat 1 click starts immediately — envelope at t=0 is full amplitude.
  // Allow small tolerance but expect near-full scale.
  assert.ok(Math.abs(firstSample) > 1000, `first sample near full scale (got ${firstSample})`);
});

test('clickPreviewFilename: stable shape', () => {
  assert.equal(clickPreviewFilename(120, 4), 'click-preview-120bpm-4beats.wav');
  assert.equal(clickPreviewFilename(90.7, 8), 'click-preview-91bpm-8beats.wav');
});
