import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'count-in.js'), 'utf8');
const scope = {};
vm.runInNewContext(source, { globalThis: scope });
const countIn = scope.RcCountIn;

test('the count uses the tempo the setlist declares, not the one Live is sitting at', () => {
  // This is the defect that moved the count into the browser: starting a
  // 160 BPM song after a 110 BPM one counted at 110, because Live was still
  // sitting where the previous song left it.
  assert.equal(countIn.countInTempo({ declaredTempo: 160, tempo: 110 }), 160);
});

test('Live tempo is the fallback only when the setlist declares nothing', () => {
  assert.equal(countIn.countInTempo({ declaredTempo: null, tempo: 110 }), 110);
  assert.equal(countIn.countInTempo({ tempo: 128 }), 128);
  assert.equal(countIn.countInTempo({ declaredTempo: 0, tempo: 128 }), 128);
  assert.equal(countIn.countInTempo({ declaredTempo: null, tempo: null }), null);
  assert.equal(countIn.countInTempo(null), null);
});

test('four beats at 120 BPM fall every half second, with the downbeat after them', () => {
  const plan = countIn.planCountIn({ bpm: 120, beatsPerBar: 4, latencyMs: 0 });
  // Array.from rebuilds the list in this realm: the module runs inside a vm
  // context, so its arrays fail a strict deep comparison on their prototype.
  assert.deepEqual(Array.from(plan.beats, (beat) => beat.offsetMs), [0, 500, 1000, 1500]);
  assert.equal(plan.downbeatOffsetMs, 2000);
  assert.equal(plan.beats[0].accent, true);
  assert.equal(Array.from(plan.beats).slice(1).every((beat) => !beat.accent), true);
});

test('Play is sent ahead of the downbeat by the latency, so Live lands on it', () => {
  const plan = countIn.planCountIn({ bpm: 120, beatsPerBar: 4, latencyMs: 90 });
  assert.equal(plan.downbeatOffsetMs, 2000);
  assert.equal(plan.sendPlayOffsetMs, 1910);
});

test('Play is never sent before the count starts', () => {
  // A very slow count and an implausible latency would otherwise start
  // playback underneath the count instead of after it.
  const plan = countIn.planCountIn({ bpm: 120, beatsPerBar: 1, latencyMs: 5000 });
  assert.equal(plan.sendPlayOffsetMs, 0);
});

test('the bar follows the signature, not a hardcoded four', () => {
  assert.equal(countIn.planCountIn({ bpm: 120, beatsPerBar: 3 }).beats.length, 3);
  assert.equal(countIn.planCountIn({ bpm: 120, beatsPerBar: 7 }).beats.length, 7);
  assert.equal(countIn.planCountIn({ bpm: 120, beatsPerBar: 6 }).downbeatOffsetMs, 3000);
});

test('inputs that cannot describe a bar return null instead of a guess', () => {
  // The caller starts playback with no count rather than inventing one.
  for (const bad of [
    { bpm: 0, beatsPerBar: 4 },
    { bpm: -120, beatsPerBar: 4 },
    { bpm: Number.NaN, beatsPerBar: 4 },
    { bpm: 5, beatsPerBar: 4 },
    { bpm: 900, beatsPerBar: 4 },
    { bpm: 120, beatsPerBar: 0 },
    { bpm: 120, beatsPerBar: 40 },
    { bpm: 120, beatsPerBar: Number.NaN },
    { bpm: 120 },
    {},
  ]) {
    assert.equal(countIn.planCountIn(bad), null, JSON.stringify(bad));
  }
  assert.equal(countIn.planCountIn(), null);
});

test('a negative or nonsense latency is treated as none rather than shifting Play early', () => {
  assert.equal(countIn.planCountIn({ bpm: 120, beatsPerBar: 4, latencyMs: -500 }).sendPlayOffsetMs, 2000);
  assert.equal(countIn.planCountIn({ bpm: 120, beatsPerBar: 4, latencyMs: Number.NaN }).sendPlayOffsetMs, 2000);
});

test('a fractional tempo keeps its precision across the bar', () => {
  const plan = countIn.planCountIn({ bpm: 111.11, beatsPerBar: 4 });
  assert.ok(Math.abs(plan.intervalMs - 60000 / 111.11) < 1e-9);
  assert.ok(Math.abs(plan.downbeatOffsetMs - 4 * (60000 / 111.11)) < 1e-9);
});
