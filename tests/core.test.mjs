import { test } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

import { parseLocator, parseSetlist } from '../src/core/locator-parser.js';
import { SetlistManager } from '../src/core/setlist-manager.js';
import { saveSetlist, loadSetlist, listSetlists, deleteSetlist } from '../src/core/persistence.js';
import { parseLrc, parseTxt } from '../src/core/lyrics-parser.js';

test('parseLocator: simple song title', () => {
  const r = parseLocator('Neon Signal');
  assert.deepStrictEqual(r, {
    kind: 'song',
    songName: 'Neon Signal',
    songTags: { loopCount: null, autoStop: false, autoNext: false, bpm: null, autoClick: null, skip: false }
  });
});

test('parseLocator: song with one section', () => {
  const r = parseLocator('Neon Signal > Verse 1');
  assert.deepStrictEqual(r, {
    kind: 'section',
    songName: 'Neon Signal',
    section: { name: 'Verse 1', time: 0, loopCount: null, autoStop: false, autoNext: false, bpm: null, autoClick: null, skip: false }
  });
});

test('parseLocator: section with loop count', () => {
  const r = parseLocator('Neon Signal > Chorus [loop 4x]');
  assert.deepStrictEqual(r, {
    kind: 'section',
    songName: 'Neon Signal',
    section: { name: 'Chorus', time: 0, loopCount: 4, autoStop: false, autoNext: false, bpm: null, autoClick: null, skip: false }
  });
});

test('parseLocator: section with infinite loop', () => {
  const r = parseLocator('Neon Signal > Outro [loop]');
  assert.deepStrictEqual(r, {
    kind: 'section',
    songName: 'Neon Signal',
    section: { name: 'Outro', time: 0, loopCount: -1, autoStop: false, autoNext: false, bpm: null, autoClick: null, skip: false }
  });
});

test('parseLocator: hidden anchor via prefix', () => {
  const r = parseLocator('_pre-roll');
  assert.deepStrictEqual(r, { kind: 'hidden', hiddenName: '_pre-roll' });
});

// --- SONG-LEVEL TAG TESTS ---

test('parseLocator: song-level tag [loop] strips tag from title', () => {
  const r = parseLocator('Chorus [loop]');
  assert.deepStrictEqual(r, {
    kind: 'song',
    songName: 'Chorus',
    songTags: { loopCount: -1, autoStop: false, autoNext: false, bpm: null, autoClick: null, skip: false }
  });
});

test('parseLocator: song-level tag [stop] strips tag from title', () => {
  const r = parseLocator('Outro [stop]');
  assert.deepStrictEqual(r, {
    kind: 'song',
    songName: 'Outro',
    songTags: { loopCount: null, autoStop: true, autoNext: false, bpm: null, autoClick: null, skip: false }
  });
});

test('parseLocator: song-level tag [next] strips tag from title', () => {
  const r = parseLocator('Bridge [next]');
  assert.deepStrictEqual(r, {
    kind: 'song',
    songName: 'Bridge',
    songTags: { loopCount: null, autoStop: false, autoNext: true, bpm: null, autoClick: null, skip: false }
  });
});

test('parseLocator: song-level tag [bpm] parses tempo', () => {
  const r = parseLocator('Abertura [bpm 135]');
  assert.deepStrictEqual(r, {
    kind: 'song',
    songName: 'Abertura',
    songTags: { loopCount: null, autoStop: false, autoNext: false, bpm: 135, autoClick: null, skip: false }
  });
});

test('parseLocator: song-level tag [bpm] parses floating point tempo', () => {
  const r = parseLocator('Abertura [bpm 111.11]');
  assert.deepStrictEqual(r, {
    kind: 'song',
    songName: 'Abertura',
    songTags: { loopCount: null, autoStop: false, autoNext: false, bpm: 111.11, autoClick: null, skip: false }
  });
});

test('parseLocator: song-level tag [click] parses metronome on', () => {
  const r = parseLocator('Abertura [click]');
  assert.deepStrictEqual(r, {
    kind: 'song',
    songName: 'Abertura',
    songTags: { loopCount: null, autoStop: false, autoNext: false, bpm: null, autoClick: true, skip: false }
  });
});

test('parseLocator: song-level tag [click off] parses metronome off', () => {
  const r = parseLocator('Abertura [click off]');
  assert.deepStrictEqual(r, {
    kind: 'song',
    songName: 'Abertura',
    songTags: { loopCount: null, autoStop: false, autoNext: false, bpm: null, autoClick: false, skip: false }
  });
});

test('parseLocator: song-level tag [hidden] sets kind to hidden', () => {
  const r = parseLocator('Ensaio [hidden]');
  assert.deepStrictEqual(r, { kind: 'hidden', hiddenName: 'Ensaio' });
});

// --- SECTION-LEVEL TAG TESTS ---

test('parseLocator: section with [stop] tag', () => {
  const r = parseLocator('Neon Signal > Outro [stop]');
  assert.deepStrictEqual(r, {
    kind: 'section',
    songName: 'Neon Signal',
    section: { name: 'Outro', time: 0, loopCount: null, autoStop: true, autoNext: false, bpm: null, autoClick: null, skip: false }
  });
});

test('parseLocator: section with [next] tag', () => {
  const r = parseLocator('Neon Signal > Bridge [next]');
  assert.deepStrictEqual(r, {
    kind: 'section',
    songName: 'Neon Signal',
    section: { name: 'Bridge', time: 0, loopCount: null, autoStop: false, autoNext: true, bpm: null, autoClick: null, skip: false }
  });
});

test('parseLocator: section with [bpm 140] tag', () => {
  const r = parseLocator('Neon Signal > Chorus [bpm 140]');
  assert.deepStrictEqual(r, {
    kind: 'section',
    songName: 'Neon Signal',
    section: { name: 'Chorus', time: 0, loopCount: null, autoStop: false, autoNext: false, bpm: 140, autoClick: null, skip: false }
  });
});

test('parseLocator: section with [click] tag', () => {
  const r = parseLocator('Neon Signal > Chorus [click]');
  assert.deepStrictEqual(r, {
    kind: 'section',
    songName: 'Neon Signal',
    section: { name: 'Chorus', time: 0, loopCount: null, autoStop: false, autoNext: false, bpm: null, autoClick: true, skip: false }
  });
});

test('parseLocator: section with [skip] tag', () => {
  const r = parseLocator('Neon Signal > Solo [skip]');
  assert.deepStrictEqual(r, {
    kind: 'section',
    songName: 'Neon Signal',
    section: { name: 'Solo', time: 0, loopCount: null, autoStop: false, autoNext: false, bpm: null, autoClick: null, skip: true }
  });
});

test('parseLocator: section with multiple tags [loop] [stop]', () => {
  const r = parseLocator('Song A > Chorus [loop] [stop]');
  assert.deepStrictEqual(r, {
    kind: 'section',
    songName: 'Song A',
    section: { name: 'Chorus', time: 0, loopCount: -1, autoStop: true, autoNext: false, bpm: null, autoClick: null, skip: false }
  });
});

test('parseLocator: tags are case-insensitive', () => {
  const r = parseLocator('Song A > Intro [STOP]');
  assert.deepStrictEqual(r, {
    kind: 'section',
    songName: 'Song A',
    section: { name: 'Intro', time: 0, loopCount: null, autoStop: true, autoNext: false, bpm: null, autoClick: null, skip: false }
  });
});

test('parseLocator: tags are stripped from display name', () => {
  const r = parseLocator('Song A > Chorus [loop 4x] [next] [bpm 120] [click off]');
  assert.strictEqual(r.section.name, 'Chorus');
  assert.strictEqual(r.section.loopCount, 4);
  assert.strictEqual(r.section.autoNext, true);
  assert.strictEqual(r.section.bpm, 120);
  assert.strictEqual(r.section.autoClick, false);
});

test('parseLocator: tag-only locator becomes an automation section', () => {
  const r = parseLocator('[stop]');
  assert.deepStrictEqual(r, {
    kind: 'automation',
    section: {
      name: '',
      time: 0,
      loopCount: null,
      autoStop: true,
      autoNext: false,
      bpm: null,
      autoClick: null,
      skip: false,
      automationOnly: true,
    },
  });
});

test('parseSetlist: tag-only automations belong to the preceding song', () => {
  const parsed = parseSetlist([
    { name: 'Song A', time: 0 },
    { name: '[loop]', time: 20 },
    { name: '[stop]', time: 40 },
    { name: 'Song B', time: 60 },
  ]);

  assert.deepStrictEqual(parsed.songs.map((song) => song.title), ['Song A', 'Song B']);
  assert.deepStrictEqual(
    parsed.songs[0].sections.map((section) => ({
      time: section.time,
      loopCount: section.loopCount,
      autoStop: section.autoStop,
      automationOnly: section.automationOnly,
    })),
    [
      { time: 20, loopCount: -1, autoStop: false, automationOnly: true },
      { time: 40, loopCount: null, autoStop: true, automationOnly: true },
    ],
  );
});

test('parseSetlist: tag-only automation before the first song is hidden', () => {
  const parsed = parseSetlist([
    { name: '[stop]', time: 0 },
    { name: 'Song A', time: 10 },
  ]);

  assert.deepStrictEqual(parsed.songs.map((song) => song.title), ['Song A']);
  assert.deepStrictEqual(parsed.hidden, [{ name: '[stop]', time: 0 }]);
});

// --- SETLIST MANAGER TESTS ---

test('SetlistManager: correctly tracks state and loop regions', () => {
  const manager = new SetlistManager();
  const cues = [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Verse', time: 30 },
    { name: 'Song A > Chorus [loop 4x]', time: 60 },
    { name: 'Song B', time: 100 },
    { name: '_end', time: 150 }
  ];

  manager.updateCues(cues);
  
  // Initial state check
  let state = manager.getState();
  assert.strictEqual(state.songs.length, 2);
  assert.strictEqual(state.hidden.length, 1);
  
  // Set transport time
  manager.updateTransport(10, true, 120);
  state = manager.getState();
  assert.strictEqual(state.activeSongIndex, 0); // Song A starts at time 0
  assert.strictEqual(state.activeSectionIndex, -1); // no active section yet, since Verse starts at 30
  
  manager.updateTransport(40, true);
  state = manager.getState();
  assert.strictEqual(state.activeSongIndex, 0);
  assert.strictEqual(state.activeSectionIndex, 0); // Verse starts at 30
  assert.strictEqual(manager.getActiveSection().name, 'Verse');
  
  // Check loop region calculation
  const loopRegion = manager.getLoopRegion(0, 1); // Chorus starts at 60
  assert.deepStrictEqual(loopRegion, { start: 60, end: 100, duration: 40 }); // Next cue is Song B at 100
});

test('SetlistManager: duplicate titles preserve chronological active identity', () => {
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Repeated', time: 0 },
    { name: 'Repeated > First section', time: 4 },
    { name: 'Repeated', time: 100 },
    { name: 'Repeated > Second section', time: 104 },
  ]);

  manager.updateTransport(105, true);
  const state = manager.getState();

  assert.equal(state.songs[state.activeSongIndex].time, 100);
  assert.equal(
    state.songs[state.activeSongIndex].sections[state.activeSectionIndex].name,
    'Second section',
  );
});

test('SetlistManager: new songs enter a saved order at their Arrangement position', () => {
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A', time: 0 },
    { name: 'Song D', time: 150 },
  ]);
  manager.setCustomOrder(['Song A', 'Song D']);

  manager.updateCues([
    { name: 'Song D', time: 150 },
    { name: 'Song B', time: 50 },
    { name: 'Song A', time: 0 },
    { name: 'Song C', time: 100 },
  ]);

  assert.deepStrictEqual(
    manager.getState().songs.map((song) => song.title),
    ['Song A', 'Song B', 'Song C', 'Song D'],
  );
});

test('SetlistManager: new songs do not erase an intentional manual order', () => {
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A', time: 0 },
    { name: 'Song C', time: 100 },
  ]);
  manager.setCustomOrder(['Song C', 'Song A']);

  manager.updateCues([
    { name: 'Song A', time: 0 },
    { name: 'Song B', time: 50 },
    { name: 'Song C', time: 100 },
  ]);

  assert.deepStrictEqual(
    manager.getState().songs.map((song) => song.title),
    ['Song C', 'Song A', 'Song B'],
  );
});

test('SetlistManager inserts new songs without repeated linear index searches', () => {
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A', time: 0 },
    { name: 'Song D', time: 150 },
  ]);
  manager.setCustomOrder(['Song D', 'Song A']);

  const originalIndexOf = Array.prototype.indexOf;
  let indexOfCalls = 0;
  Array.prototype.indexOf = function countedIndexOf(...args) {
    indexOfCalls++;
    return originalIndexOf.apply(this, args);
  };
  try {
    manager.updateCues([
      { name: 'Prefix', time: -50 },
      { name: 'Song A', time: 0 },
      { name: 'Song B', time: 50 },
      { name: 'Song C', time: 100 },
      { name: 'Song D', time: 150 },
    ]);
  } finally {
    Array.prototype.indexOf = originalIndexOf;
  }

  assert.equal(indexOfCalls, 0);
  assert.deepStrictEqual(
    manager.getState().songs.map((song) => song.title),
    ['Song D', 'Prefix', 'Song A', 'Song B', 'Song C'],
  );
});

test('SetlistManager: publishes song and total durations from Arrangement end', () => {
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A [bpm 120]', time: 0 },
    { name: 'Song B [bpm 60]', time: 120 },
  ]);
  manager.updateArrangementEndTime(240);

  const state = manager.getState();
  assert.equal(state.protocolVersion, 2);
  assert.equal(state.songs[0].durationSeconds, 60);
  assert.equal(state.songs[1].durationSeconds, 120);
  assert.equal(state.totalDurationSeconds, 180);
  assert.equal(state.arrangementEndTime, 240);
});

test('SetlistManager: keeps final and total durations unknown without a valid end', () => {
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A [bpm 120]', time: 0 },
    { name: 'Song B [bpm 120]', time: 120 },
  ]);
  manager.updateArrangementEndTime(Number.NaN);

  const state = manager.getState();
  assert.equal(state.songs[0].durationSeconds, 60);
  assert.equal(state.songs[1].durationSeconds, null);
  assert.equal(state.totalDurationSeconds, null);
  assert.equal(state.arrangementEndTime, null);
});

test('SetlistManager: checkAutomations fires [stop] action', () => {
  const manager = new SetlistManager();
  const cues = [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Verse', time: 10 },
    { name: 'Song A > Outro [stop]', time: 50 },
    { name: 'Song B', time: 100 },
  ];

  manager.updateCues(cues);

  // Not playing — no automations
  manager.updateTransport(55, false);
  let actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 0);

  // Playing + in [stop] section → should fire stop
  manager.updateTransport(55, true);
  actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'stop');

  // Should NOT fire again (already fired)
  actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 0);
});

test('SetlistManager: tag-only [stop] executes inside the preceding song', () => {
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A', time: 0 },
    { name: '[stop]', time: 40 },
    { name: 'Song B', time: 80 },
  ]);

  manager.updateTransport(41, true);

  assert.deepStrictEqual(manager.checkAutomations(), [{ type: 'stop' }]);
  const state = manager.getState();
  assert.equal(state.songs[state.activeSongIndex].title, 'Song A');
  assert.equal(
    state.songs[state.activeSongIndex].sections[state.activeSectionIndex].automationOnly,
    true,
  );
});

test('SetlistManager: checkAutomations fires [next] action', () => {
  const manager = new SetlistManager();
  const cues = [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Bridge [next]', time: 50 },
    { name: 'Song B', time: 100 },
  ];

  manager.updateCues(cues);
  manager.updateTransport(55, true);

  const actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'next');
  assert.strictEqual(actions[0].nextSongIndex, 1);
});

test('SetlistManager: checkAutomations fires [loop] activation', () => {
  const manager = new SetlistManager();
  const cues = [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Chorus [loop]', time: 30 },
    { name: 'Song B', time: 80 },
  ];

  manager.updateCues(cues);
  manager.updateTransport(35, true);

  const actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'activate_loop');
  assert.strictEqual(actions[0].start, 30);
  assert.strictEqual(actions[0].duration, 50); // 80 - 30
  assert.strictEqual(manager.isLoopActive(), true);

  // Manual clearLoop
  manager.clearLoop();
  assert.strictEqual(manager.isLoopActive(), false);
});

test('SetlistManager: checkAutomations fires [bpm] action', () => {
  const manager = new SetlistManager();
  const cues = [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Verse [bpm 130]', time: 10 },
  ];

  manager.updateCues(cues);
  manager.updateTransport(15, true);

  const actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'change_bpm');
  assert.strictEqual(actions[0].bpm, 130);
});

test('SetlistManager: checkAutomations fires [click] action', () => {
  const manager = new SetlistManager();
  const cues = [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Verse [click]', time: 10 },
  ];

  manager.updateCues(cues);
  manager.updateTransport(15, true);

  const actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'change_metronome');
  assert.strictEqual(actions[0].value, true);
});

test('SetlistManager: checkAutomations fires [skip] action', () => {
  const manager = new SetlistManager();
  const cues = [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Solo [skip]', time: 10 },
    { name: 'Song A > Chorus', time: 30 },
  ];

  manager.updateCues(cues);
  manager.updateTransport(15, true);

  const actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'skip');
  assert.strictEqual(actions[0].targetCue, 'Song A > Chorus');
});

test('SetlistManager: tracks counted loops iterations and fires deactivate_loop', () => {
  const manager = new SetlistManager();
  const cues = [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Chorus [loop 3x]', time: 30 },
    { name: 'Song B', time: 80 },
  ];

  manager.updateCues(cues);
  
  // Enter loop region
  manager.updateTransport(35, true);
  let actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'activate_loop');
  assert.strictEqual(manager.isLoopActive(), true);

  let state = manager.getState();
  assert.deepStrictEqual(state.loopIteration, { current: 1, total: 3 });

  // 1st wrap-around (simulated by playhead jumping back from near 80 to 30)
  manager.updateTransport(79, true); // playing inside loop
  manager.updateTransport(31, true); // wrapped around!
  
  state = manager.getState();
  assert.deepStrictEqual(state.loopIteration, { current: 2, total: 3 });
  actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 0);

  // 2nd wrap-around
  manager.updateTransport(79, true);
  manager.updateTransport(31, true); // wrapped around!
  
  state = manager.getState();
  assert.deepStrictEqual(state.loopIteration, { current: 3, total: 3 });
  
  // As soon as iteration 3 begins, pendingDeactivateLoop is set to true
  actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'deactivate_loop');
  assert.strictEqual(manager.isLoopActive(), false);
  
  state = manager.getState();
  assert.strictEqual(state.loopIteration, null);
});

test('SetlistManager: identical cue refresh does not rearm [loop 1]', () => {
  const manager = new SetlistManager();
  const cues = [
    { name: 'ELA', time: 308 },
    { name: 'ELA > Intro', time: 308 },
    { name: 'ELA > Verso [loop 1]', time: 336 },
    { name: 'ELA > Verso 2', time: 360 },
    { name: 'ELA > REFRAO', time: 384 },
    { name: 'ELA > FIM', time: 408 },
  ];

  manager.updateCues(cues);
  manager.updateTransport(337, true, 111);
  assert.deepStrictEqual(manager.checkAutomations(), [
    { type: 'activate_loop', start: 336, duration: 24 },
  ]);

  manager.updateTransport(350, true);
  manager.updateCues([...cues]);
  assert.deepStrictEqual(
    manager.checkAutomations(),
    [],
    'an unchanged AbletonOSC cue snapshot must not arm the same loop again',
  );

  manager.updateTransport(359.5, true);
  manager.updateTransport(336.5, true);
  assert.deepStrictEqual(manager.checkAutomations(), [{ type: 'deactivate_loop' }]);
  assert.strictEqual(manager.isLoopActive(), false);

  manager.updateCues([...cues]);
  assert.deepStrictEqual(
    manager.checkAutomations(),
    [],
    'the completed counted loop must remain disarmed until the section is re-entered',
  );
});

test('SetlistManager: a real cue change still resets and reparses automation state', () => {
  const manager = new SetlistManager();
  const cues = [
    { name: 'ELA', time: 308 },
    { name: 'ELA > Verso [loop 1]', time: 336 },
    { name: 'ELA > Verso 2', time: 360 },
  ];

  manager.updateCues(cues);
  manager.updateTransport(337, true);
  assert.strictEqual(manager.checkAutomations()[0].type, 'activate_loop');

  manager.updateCues([
    { name: 'ELA', time: 308 },
    { name: 'ELA > Verso [loop 1]', time: 336 },
    { name: 'ELA > Verso 2', time: 364 },
  ]);

  assert.strictEqual(manager.isLoopActive(), false);
  assert.deepStrictEqual(manager.checkAutomations(), [
    { type: 'activate_loop', start: 336, duration: 28 },
  ]);
});

// Regression: re-entering a [loop Nx] section after leaving must restart
// the iteration counter from 1 and run exactly N wraps before deactivating.
// Previously the manager kept stale iteration state from the previous entry
// when the user clicked around the setlist, so the loop either:
//   (a) re-activated with currentLoopIteration=1 mid-stream and never
//       deactivated (the user could observe the loop "never stop, but also
//       not feel right"), or
//   (b) re-entered before pendingDeactivateLoop was consumed and the
//       second entry inherited the counter at value N (never deactivate).
test('SetlistManager: re-entry of [loop Nx] section restarts counter from 1', () => {
  const manager = new SetlistManager();
  const cues = [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Verse', time: 10 },
    { name: 'Song A > Chorus [loop 3x]', time: 30 },
    { name: 'Song B', time: 80 },
  ];

  manager.updateCues(cues);

  // First entry into Chorus
  manager.updateTransport(35, true);
  let actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'activate_loop');

  let state = manager.getState();
  assert.deepStrictEqual(state.loopIteration, { current: 1, total: 3 });

  // User navigates away mid-loop (click on Song B) — manager should clear
  // loop state so the next entry is a fresh start.
  manager.updateTransport(85, true);
  // (the natural clearLoop path happens via automation when the user
  // jumped explicitly; here we simulate the click-to-jump branch which
  // calls manager.clearLoop() in the WS handler)

  // Re-enter Chorus — counter must restart at 1/3.
  manager.updateTransport(35, true);
  // Simulate the WS handler that resets loop state when the user clicks
  // a different section mid-loop. We trigger a state change that mirrors
  // the production code path in src/index.ts:390 (clearLoop on next).
  // For this test we exercise the natural re-entry instead — active
  // section changed back to Chorus without manual clearLoop.
  manager.checkAutomations();

  state = manager.getState();
  assert.deepStrictEqual(
    state.loopIteration,
    { current: 1, total: 3 },
    'second entry into a [loop Nx] section must restart at iteration 1'
  );

  // Wrap 1
  manager.updateTransport(78, true);
  manager.updateTransport(31, true);
  state = manager.getState();
  assert.deepStrictEqual(state.loopIteration, { current: 2, total: 3 });

  // Wrap 2 -> deactivate fires on next checkAutomations
  manager.updateTransport(78, true);
  manager.updateTransport(31, true);
  actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'deactivate_loop');
  assert.strictEqual(manager.isLoopActive(), false);
  state = manager.getState();
  assert.strictEqual(state.loopIteration, null);
});

test('SetlistManager: [loop -1] infinite loop is not affected by iteration state', () => {
  const manager = new SetlistManager();
  const cues = [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Outro [loop]', time: 30 },
  ];

  manager.updateCues(cues);

  manager.updateTransport(35, true);
  const actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'activate_loop');

  // Wrap several times — must never deactivate
  for (let i = 0; i < 10; i++) {
    manager.updateTransport(35, true);
    manager.updateTransport(31, true);
  }
  manager.checkAutomations();
  assert.strictEqual(manager.isLoopActive(), true, 'infinite loop must stay active');
});

// Regression: scenario where the manager's wrap detection window was too
// narrow. Real Live wraps land at loopStart, but OSC polling drift can put
// the reported time a few beats later. With a fixed 5-beat window, loops
// of 8 bars (32 beats in 4/4) or any long loop wrapped but the manager
// silently ignored the wrap, so currentLoopIteration never reached N and
// deactivate never fired.
test('SetlistManager: wrap detected anywhere in first half of loop region increments iteration', () => {
  const manager = new SetlistManager();
  // Loop region deliberately long (40 beats) — old 5-beat window
  // would have ignored wraps that landed at beats loopStart+10..+20.
  const cues = [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Chorus [loop 3x]', time: 100 },
    { name: 'Song B', time: 200 },
  ];

  manager.updateCues(cues);

  // Enter Chorus (loopStart=100, loopEnd=200, mid=150)
  manager.updateTransport(110, true);
  manager.checkAutomations();
  assert.strictEqual(manager.isLoopActive(), true);

  // First wrap from end to start lands within loop bounds but past
  // the old 5-beat window — that was the bug.
  manager.updateTransport(195, true); // playing near end
  manager.updateTransport(115, true); // wrapped to beat 115 (still within mid=150)
  manager.checkAutomations();

  let state = manager.getState();
  assert.ok(
    state.loopIteration && state.loopIteration.current === 2,
    `after first wrap iteration must be 2, got ${JSON.stringify(state.loopIteration)}`
  );

  // Second wrap drives to 3/3 -> deactivate on next checkAutomations
  manager.updateTransport(195, true);
  manager.updateTransport(115, true);
  const actions = manager.checkAutomations();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'deactivate_loop');
  assert.strictEqual(manager.isLoopActive(), false);
});

// Regression: long-loop region + song/section collision on the same beat.
// Common real-world shape: Song A starts at beat 0 and its Chorus also at
// beat 0, so rawCues has two cues sharing the same time. Previously
// getRegionFromStart returned end = 0 (it picked the first match and the
// next cue in raw order was another cue also at time 0), making
// loopEndBeat = 0. updateTransport's out-of-bounds guard then cleared the
// loop on the very next transport tick. Symptom: "[loop Nx] never stops
// the way you'd expect."
test('SetlistManager: collision — song and first section share loop start beat, loop survives across the region', () => {
  const manager = new SetlistManager();
  const cues = [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Chorus [loop 5x]', time: 0 },
    { name: 'Song B', time: 1000 },
  ];

  manager.updateCues(cues);

  manager.updateTransport(10, true);
  manager.checkAutomations();
  assert.strictEqual(manager.isLoopActive(), true);

  // Play deep into the loop region — must remain active.
  manager.updateTransport(900, true);
  assert.strictEqual(
    manager.isLoopActive(),
    true,
    'loop must NOT be cleared when playhead is inside the loop region (was the regression)'
  );

  // Wrap from end to start.
  manager.updateTransport(15, true);
  manager.checkAutomations();
  let state = manager.getState();
  assert.ok(
    state.loopIteration && state.loopIteration.current === 2,
    `expected iteration 2 after first wrap, got ${JSON.stringify(state.loopIteration)}`
  );

  // Drive to iteration 5 with a few more wraps — must deactivate exactly once.
  let sawDeactivate = false;
  for (let i = 0; i < 10 && !sawDeactivate; i++) {
    manager.updateTransport(900, true);
    manager.updateTransport(15, true);
    const actions = manager.checkAutomations();
    if (actions.some(a => a.type === 'deactivate_loop')) {
      sawDeactivate = true;
      assert.strictEqual(manager.isLoopActive(), false);
      assert.strictEqual(
        actions.filter(a => a.type === 'deactivate_loop').length, 1,
        'exactly one deactivate per loop'
      );
    }
  }
  assert.ok(sawDeactivate, 'loop 5x must deactivate within a few wraps');
});

test('Persistence: save, load, list, delete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'setlist-test-'));
  try {
    const data = {
      songs: [{ title: 'Song 1', time: 0, sections: [], loopCount: null, autoStop: false, autoNext: false, bpm: null, autoClick: null, skip: false }],
      hidden: [{ name: '_pre', time: 0 }]
    };
    saveSetlist(dir, 'test-setlist', data);
    
    const list = listSetlists(dir);
    assert.deepStrictEqual(list, ['test-setlist']);
    
    const loaded = loadSetlist(dir, 'test-setlist');
    assert.deepStrictEqual(loaded, data);
    
    deleteSetlist(dir, 'test-setlist');
    assert.deepStrictEqual(listSetlists(dir), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// --- Lyrics Parser Tests ---

test('parseLrc: parses timestamps and text correctly', () => {
  const lrc = [
    '[00:00.00] Intro',
    '[00:10.50] Signal rising through the haze',
    '[01:05.25] Every marker finds its place'
  ].join('\n');
  const lines = parseLrc(lrc);
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0].time, 0);
  assert.strictEqual(lines[0].text, 'Intro');
  assert.ok(Math.abs(lines[1].time - 10.50) < 0.01);
  assert.strictEqual(lines[1].text, 'Signal rising through the haze');
  assert.ok(Math.abs(lines[2].time - 65.25) < 0.01);
});

test('parseLrc: handles empty lines and non-timestamped lines', () => {
  const lrc = 'no timestamp here\n[00:05.00] Valid line\n\n';
  const lines = parseLrc(lrc);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].text, 'Valid line');
});

test('parseTxt: returns all non-empty lines with sequential pseudo-time', () => {
  const txt = 'Line one\nLine two\n\nLine three';
  const lines = parseTxt(txt);
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0].text, 'Line one');
  assert.strictEqual(lines[1].text, 'Line two');
  assert.strictEqual(lines[2].text, 'Line three');
  assert.ok(lines[0].time < lines[1].time);
});

test('SetlistManager: correctly tracks and updates global quantization level', () => {
  const manager = new SetlistManager();
  
  // Default value should be 4 (1 Bar)
  let state = manager.getState();
  assert.strictEqual(state.clipTriggerQuantization, 4);

  // Update value
  manager.updateQuantization(7); // 1/4 Note
  state = manager.getState();
  assert.strictEqual(state.clipTriggerQuantization, 7);
});
test('SetlistManager reuses derived songs for transport-only updates and invalidates inputs', () => {
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A', time: 0 },
    { name: 'Song B', time: 120 },
  ]);
  manager.updateArrangementEndTime(240);

  const initialSongs = manager.getState().songs;
  assert.strictEqual(manager.getState().songs, initialSongs);

  manager.updateTransport(32, true, 120);
  assert.strictEqual(manager.getState().songs, initialSongs, 'transport position must reuse derived songs');

  manager.updateTransport(33, true, 90);
  const tempoSongs = manager.getState().songs;
  assert.notStrictEqual(tempoSongs, initialSongs, 'fallback tempo affects durations');
  assert.strictEqual(manager.getState().songs, tempoSongs);

  manager.updateArrangementEndTime(300);
  const endSongs = manager.getState().songs;
  assert.notStrictEqual(endSongs, tempoSongs);

  manager.setCustomOrder(['Song B', 'Song A']);
  const orderedSongs = manager.getState().songs;
  assert.notStrictEqual(orderedSongs, endSongs);
  assert.deepStrictEqual(orderedSongs.map(({ title }) => title), ['Song B', 'Song A']);

  manager.updateCues([
    { name: 'Song A', time: 0 },
    { name: 'Song B', time: 120 },
    { name: 'Song C', time: 240 },
  ]);
  assert.notStrictEqual(manager.getState().songs, orderedSongs);
});

test('SetlistManager resolves chronological active song under custom display order', () => {
  const manager = new SetlistManager();
  manager.updateCues([
    { name: 'Song A', time: 0 },
    { name: 'Song B', time: 100 },
    { name: 'Song C', time: 200 },
  ]);
  manager.setCustomOrder(['Song C', 'Song A', 'Song B']);
  manager.updateTransport(150, true, 120);

  const state = manager.getState();
  assert.deepStrictEqual(state.songs.map(({ title }) => title), ['Song C', 'Song A', 'Song B']);
  assert.equal(state.activeSongIndex, 2);
  assert.equal(state.songs[state.activeSongIndex].title, 'Song B');
});
