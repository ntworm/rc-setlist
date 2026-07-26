import { test } from 'node:test';
import assert from 'node:assert';
import { nextDownbeat, JumpScheduler, getQuantizationBeats } from '../src/core/next-downbeat-jump.ts';

const STATE = { tempo: 120, isPlaying: true, signatureNumerator: 4, currentSongTime: 10.0 };

test('nextDownbeat: rounds up to next bar boundary at 120 BPM, 4/4', () => {
  // barLength = (60/120)*4 = 2s; bars at 0,2,4,6,8,10,12,...
  assert.strictEqual(nextDownbeat(10.0, 120, 4), 10.0);
  assert.strictEqual(nextDownbeat(10.1, 120, 4), 12.0);
  assert.strictEqual(nextDownbeat(10.99, 120, 4), 12.0);
  assert.strictEqual(nextDownbeat(11.0, 120, 4), 12.0);
});

test('nextDownbeat: 100 BPM 4/4 → barLength 2.4s, rounds up correctly', () => {
  // 60/100*4 = 2.4 → bars at 0, 2.4, 4.8, 7.2, 9.6, 12.0, ...
  assert.strictEqual(nextDownbeat(2.5, 100, 4), 4.8);
  assert.strictEqual(nextDownbeat(9.7, 100, 4), 12.0);
});

test('nextDownbeat: clamps malformed input to safe defaults', () => {
  // tempo=0 → safeTempo=120; signature=0 → safeSig=4
  assert.strictEqual(nextDownbeat(5.0, 0, 0), 6.0);
  // behaves like 120 BPM, 4/4 in default branch
});

test('JumpScheduler.schedule: Live stopped → immediate=true, landingTime=currentSongTime', () => {
  const s = new JumpScheduler();
  const events = [];
  s.on((e) => events.push(e.type));
  const r = s.schedule(0, 1, 'Verse 1', 50.0, {
    tempo: 120, isPlaying: false, signatureNumerator: 4, currentSongTime: 12.0,
  });
  assert.strictEqual(r.immediate, true);
  assert.strictEqual(r.landingTime, 12.0);
  assert.strictEqual(r.replaced, false);
  assert.deepStrictEqual(events, ['replaced']);
});

test('JumpScheduler.schedule: Live playing → lands on next downbeat, never >1 bar away', () => {
  const s = new JumpScheduler();
  // currentSongTime=10.0, targetTime=10.5 → nextDownbeat(10.5) = 12.0
  const r = s.schedule(0, 1, 'Verse 1', 10.5, STATE);
  assert.strictEqual(r.immediate, false);
  assert.strictEqual(r.landingTime, 12.0);
  // The crucial property from the user report: jump NEVER takes 8+ bars.
  // Worst case is exactly 1 bar (2s at 120 BPM, 4/4); the previous version
  // could wait 185 seconds. This test fails immediately if we ever regress.
  const wait = r.landingTime - STATE.currentSongTime;
  assert.ok(wait <= 2.0, `wait was ${wait}s, expected <=1 bar (2s @ 120BPM)`);
});

test('JumpScheduler.schedule: target in past uses currentSongTime as anchor', () => {
  const s = new JumpScheduler();
  // target=5 (past), current=10 → ceil(10/4)*4 = 12
  const r = s.schedule(0, null, 'Intro', 5.0, STATE);
  assert.strictEqual(r.landingTime, 12.0);
});

test('JumpScheduler.schedule: second call during pending REPLACES (no rejection)', () => {
  const s = new JumpScheduler();
  const events = [];
  s.on((e) => events.push(e.pending.cueName));
  s.schedule(0, 1, 'Verse 1', 50.0, STATE);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0], 'Verse 1');

  s.schedule(0, 2, 'Chorus', 80.0, STATE);
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[1], 'Chorus');
  assert.strictEqual(s.getPending().cueName, 'Chorus');
});

test('JumpScheduler.tick: advances but does not execute before landingTime', () => {
  const s = new JumpScheduler();
  const events = [];
  s.on((e) => events.push(e.type));
  s.schedule(0, 1, 'Verse 1', 10.5, STATE); // landingTime = 12.0
  s.tick(11.5);
  assert.deepStrictEqual(events, ['replaced']); // no execution yet
  assert.ok(s.hasPending());
});

test('JumpScheduler.tick: executes at landingTime and returns executed Pending', () => {
  const s = new JumpScheduler();
  const events = [];
  s.on((e) => events.push(e.type));
  s.schedule(0, 1, 'Verse 1', 10.5, STATE);
  const executed = s.tick(12.0);
  assert.ok(executed);
  assert.strictEqual(executed.cueName, 'Verse 1');
  assert.deepStrictEqual(events, ['replaced', 'executed']);
  assert.ok(!s.hasPending());
});

test('JumpScheduler.tick: tick after landingTime also fires (small overshoot is OK)', () => {
  const s = new JumpScheduler();
  let fired = 0;
  s.on((e) => { if (e.type === 'executed') fired++; });
  s.schedule(0, 1, 'Verse 1', 10.5, STATE);
  // Live scheduler latency — first tick after landingTime can be slightly past 12.
  s.tick(12.3);
  assert.strictEqual(fired, 1);
});

test('JumpScheduler.getPending/hasPending: reflect current state', () => {
  const s = new JumpScheduler();
  assert.ok(!s.hasPending());
  assert.strictEqual(s.getPending(), null);
  s.schedule(0, 0, 'Intro', 0.0, STATE);
  assert.ok(s.hasPending());
  assert.ok(s.getPending());
});

test('getQuantizationBeats: correctly maps all quantization settings to beat values', () => {
  // 4/4 signature (sig = 4)
  assert.strictEqual(getQuantizationBeats('none', 4), 0);
  assert.strictEqual(getQuantizationBeats('q_no_q', 4), 0);
  assert.strictEqual(getQuantizationBeats(0, 4), 0);
  assert.strictEqual(getQuantizationBeats('q_8_bars', 4), 32);
  assert.strictEqual(getQuantizationBeats('q_4_bars', 4), 16);
  assert.strictEqual(getQuantizationBeats('q_2_bars', 4), 8);
  assert.strictEqual(getQuantizationBeats('q_bar', 4), 4);
  assert.strictEqual(getQuantizationBeats('q_half', 4), 2);
  assert.strictEqual(getQuantizationBeats('q_half_triplet', 4), 4 / 3);
  assert.strictEqual(getQuantizationBeats('q_quarter', 4), 1);
  assert.strictEqual(getQuantizationBeats(7, 4), 1);
  assert.strictEqual(getQuantizationBeats('q_quarter_triplet', 4), 2 / 3);
  assert.strictEqual(getQuantizationBeats('q_eight', 4), 0.5);
  assert.strictEqual(getQuantizationBeats('q_eighth', 4), 0.5);
  assert.strictEqual(getQuantizationBeats(9, 4), 0.5);
  assert.strictEqual(getQuantizationBeats('q_eight_triplet', 4), 1 / 3);
  assert.strictEqual(getQuantizationBeats('q_sixteenth', 4), 0.25);
  assert.strictEqual(getQuantizationBeats('q_sixteenth_triplet', 4), 1 / 6);
  assert.strictEqual(getQuantizationBeats('q_thirtysecond', 4), 0.125);

  // 3/4 signature (sig = 3)
  assert.strictEqual(getQuantizationBeats('q_bar', 3), 3);
  assert.strictEqual(getQuantizationBeats('q_half_triplet', 3), 1);
});
