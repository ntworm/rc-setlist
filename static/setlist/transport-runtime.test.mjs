import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeSource = fs.readFileSync(path.join(here, 'transport-runtime.js'), 'utf8');

function loadRuntime(extra = {}) {
  const context = { console, globalThis: null, setTimeout, clearTimeout, ...extra };
  context.globalThis = context;
  vm.runInNewContext(runtimeSource, context, { filename: 'transport-runtime.js' });
  return context.SetlistTransportRuntime;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function state(activeSongIndex, activeSectionIndex) {
  return {
    activeSongIndex,
    activeSectionIndex,
    songs: [
      { title: 'A', sections: [{ name: 'A1' }, { name: 'A2' }] },
      { title: 'B', sections: [] },
      { title: 'C', sections: [{ name: 'C1' }, { name: 'C2' }] },
    ],
  };
}

test('preRollBarBeats uses numerator and denominator in quarter-note beats', () => {
  const { preRollBarBeats } = loadRuntime();

  assert.equal(preRollBarBeats(6, 8), 3);
  assert.equal(preRollBarBeats(3, 2), 6);
  assert.equal(preRollBarBeats(4, 0), 4);
});

test('calculateSetlistProgress reports first-song show and song elapsed time', () => {
  const { calculateSetlistProgress } = loadRuntime();

  assert.deepEqual(plain(calculateSetlistProgress({
    songs: [{ durationSeconds: 120 }, { durationSeconds: 180 }],
    activeSongIndex: 0,
    totalDurationSeconds: 300,
    songElapsedSeconds: 30,
  })), {
    showElapsedSeconds: 30,
    showTotalSeconds: 300,
    songElapsedSeconds: 30,
    songDurationSeconds: 120,
  });
});

test('calculateSetlistProgress uses the visible song order instead of locator time', () => {
  const { calculateSetlistProgress } = loadRuntime();
  const songs = [
    { title: 'INTRO', time: 0, durationSeconds: 106 },
    { title: 'JULIA', time: 840, durationSeconds: 237 },
  ];

  assert.equal(calculateSetlistProgress({
    songs,
    activeSongIndex: 1,
    totalDurationSeconds: 343,
    songElapsedSeconds: 0,
  }).showElapsedSeconds, 106);
});

test('calculateSetlistProgress recomputes the offset when visible songs are reordered', () => {
  const { calculateSetlistProgress } = loadRuntime();
  const intro = { title: 'INTRO', time: 0, durationSeconds: 106 };
  const julia = { title: 'JULIA', time: 840, durationSeconds: 237 };

  assert.equal(calculateSetlistProgress({
    songs: [intro, julia],
    activeSongIndex: 1,
    totalDurationSeconds: 343,
    songElapsedSeconds: 10,
  }).showElapsedSeconds, 116);
  assert.equal(calculateSetlistProgress({
    songs: [julia, intro],
    activeSongIndex: 1,
    totalDurationSeconds: 343,
    songElapsedSeconds: 10,
  }).showElapsedSeconds, 247);
});

test('calculateSetlistProgress clamps song and show elapsed time to known durations', () => {
  const { calculateSetlistProgress } = loadRuntime();
  const progress = calculateSetlistProgress({
    songs: [{ durationSeconds: 100 }, { durationSeconds: 50 }],
    activeSongIndex: 1,
    totalDurationSeconds: 120,
    songElapsedSeconds: 80,
  });
  const beforeStart = calculateSetlistProgress({
    songs: [{ durationSeconds: 100 }],
    activeSongIndex: 0,
    totalDurationSeconds: 100,
    songElapsedSeconds: -5,
  });

  assert.equal(progress.songElapsedSeconds, 50);
  assert.equal(progress.showElapsedSeconds, 120);
  assert.equal(beforeStart.songElapsedSeconds, 0);
  assert.equal(beforeStart.showElapsedSeconds, 0);
});

test('calculateSetlistProgress keeps calculable song time while unknown durations hide only affected values', () => {
  const { calculateSetlistProgress } = loadRuntime();
  const progress = calculateSetlistProgress({
    songs: [{ durationSeconds: null }, { durationSeconds: undefined }],
    activeSongIndex: 1,
    totalDurationSeconds: null,
    songElapsedSeconds: 83,
  });

  assert.deepEqual(plain(progress), {
    showElapsedSeconds: null,
    showTotalSeconds: null,
    songElapsedSeconds: 83,
    songDurationSeconds: null,
  });
});

test('calculateSetlistProgress preserves a known total without an active displayed song', () => {
  const { calculateSetlistProgress } = loadRuntime();

  assert.deepEqual(plain(calculateSetlistProgress({
    songs: [{ durationSeconds: 100 }],
    activeSongIndex: -1,
    totalDurationSeconds: 100,
    songElapsedSeconds: 30,
  })), {
    showElapsedSeconds: null,
    showTotalSeconds: 100,
    songElapsedSeconds: null,
    songDurationSeconds: null,
  });
  assert.deepEqual(plain(calculateSetlistProgress({
    songs: null,
    activeSongIndex: -1,
    totalDurationSeconds: 180,
    songElapsedSeconds: 30,
  })), {
    showElapsedSeconds: null,
    showTotalSeconds: 180,
    songElapsedSeconds: null,
    songDurationSeconds: null,
  });
});

test('touch reorder grip is discoverable without becoming a second button', () => {
  const setlistSource = fs.readFileSync(path.join(here, 'setlist.js'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(here, 'setlist.css'), 'utf8');

  assert.match(setlistSource, /class="song-reorder-handle"[^>]*role="img"[^>]*aria-label="Reorder song"[^>]*title="Reorder song"/);
  assert.doesNotMatch(setlistSource, /song-reorder-handle"[^>]*aria-hidden/);
  assert.match(setlistCss, /\.song-reorder-handle\s*\{[\s\S]*?touch-action:\s*none/);
  assert.match(setlistCss, /\.song-reorder-handle\s*\{[\s\S]*?min-height:\s*44px/);
});

test('resolveNavigationTarget advances, restarts, and crosses song boundaries', () => {
  const { resolveNavigationTarget } = loadRuntime();

  assert.deepEqual(plain(resolveNavigationTarget(state(0, -1), 'next')), { songIndex: 0, sectionIndex: 0 });
  assert.deepEqual(plain(resolveNavigationTarget(state(0, 0), 'next')), { songIndex: 0, sectionIndex: 1 });
  assert.deepEqual(plain(resolveNavigationTarget(state(0, 1), 'next')), { songIndex: 1, sectionIndex: null });
  assert.deepEqual(plain(resolveNavigationTarget(state(1, -1), 'next')), { songIndex: 2, sectionIndex: 0 });
  assert.deepEqual(plain(resolveNavigationTarget(state(2, 0), 'previous')), { songIndex: 2, sectionIndex: null });
  assert.deepEqual(plain(resolveNavigationTarget(state(2, -1), 'previous')), { songIndex: 1, sectionIndex: null });
  assert.deepEqual(plain(resolveNavigationTarget(state(1, -1), 'previous')), { songIndex: 0, sectionIndex: 1 });
});

test('resolveNavigationTarget disables absolute boundaries and invalid state', () => {
  const { resolveNavigationTarget } = loadRuntime();

  assert.equal(resolveNavigationTarget(state(0, -1), 'previous'), null);
  assert.equal(resolveNavigationTarget(state(2, 1), 'next'), null);
  assert.equal(resolveNavigationTarget({ songs: [], activeSongIndex: -1, activeSectionIndex: -1 }, 'next'), null);
  assert.equal(resolveNavigationTarget(null, 'next'), null);
  assert.throws(() => resolveNavigationTarget(state(0, 0), 'sideways'), /direction/i);
});

test('resolveNavigationTarget rejects malformed or stale navigation state', async (t) => {
  const { resolveNavigationTarget } = loadRuntime();
  const cases = [
    { name: 'null song index', value: state(null, -1), direction: 'next' },
    { name: 'false song index', value: state(false, -1), direction: 'next' },
    { name: 'string song index', value: state('0', -1), direction: 'next' },
    {
      name: 'null current song',
      value: { activeSongIndex: 0, activeSectionIndex: -1, songs: [null] },
      direction: 'next',
    },
    { name: 'section index below song marker', value: state(0, -2), direction: 'next' },
    { name: 'fractional section index', value: state(0, 0.5), direction: 'next' },
    { name: 'non-number section index', value: state(0, '0'), direction: 'next' },
    { name: 'section index beyond current sections', value: state(0, 99), direction: 'previous' },
  ];

  for (const example of cases) {
    await t.test(example.name, () => {
      assert.equal(resolveNavigationTarget(example.value, example.direction), null);
    });
  }
});

test('resolveNavigationTarget rejects truthy malformed adjacent songs', async (t) => {
  const { resolveNavigationTarget } = loadRuntime();
  const nextNumber = state(0, 1);
  nextNumber.songs[1] = 42;
  const nextArray = state(0, 1);
  nextArray.songs[1] = [];
  const previousString = state(1, -1);
  previousString.songs[0] = 'bad';
  const previousArray = state(1, -1);
  previousArray.songs[0] = [];
  const cases = [
    { name: 'next into a number', value: nextNumber, direction: 'next' },
    { name: 'next into an array', value: nextArray, direction: 'next' },
    { name: 'previous into a string', value: previousString, direction: 'previous' },
    { name: 'previous into an array', value: previousArray, direction: 'previous' },
  ];

  for (const example of cases) {
    await t.test(example.name, () => {
      assert.equal(resolveNavigationTarget(example.value, example.direction), null);
    });
  }
});

test('resolveNavigationTarget treats a valid adjacent song without sections as a song marker', () => {
  const { resolveNavigationTarget } = loadRuntime();
  const value = state(0, 1);
  value.songs[1] = { title: 'B' };

  assert.deepEqual(plain(resolveNavigationTarget(value, 'next')), { songIndex: 1, sectionIndex: null });
});

test('resolveNavigationTarget preserves valid within-song previous navigation', () => {
  const { resolveNavigationTarget } = loadRuntime();

  assert.deepEqual(plain(resolveNavigationTarget(state(0, 1), 'previous')), { songIndex: 0, sectionIndex: 0 });
});

test('resolveNavigationTarget resolves explicit song navigation to adjacent song starts', () => {
  const { resolveNavigationTarget } = loadRuntime();

  assert.deepEqual(plain(resolveNavigationTarget(state(0, 0), 'next', 'song')), { songIndex: 1, sectionIndex: null });
  assert.deepEqual(plain(resolveNavigationTarget(state(1, -1), 'next', 'song')), { songIndex: 2, sectionIndex: null });
  assert.deepEqual(plain(resolveNavigationTarget(state(2, 1), 'previous', 'song')), { songIndex: 1, sectionIndex: null });
  assert.deepEqual(plain(resolveNavigationTarget(state(1, -1), 'previous', 'song')), { songIndex: 0, sectionIndex: null });
});

test('resolveNavigationTarget disables explicit song navigation at absolute boundaries', () => {
  const { resolveNavigationTarget } = loadRuntime();

  assert.equal(resolveNavigationTarget(state(0, 0), 'previous', 'song'), null);
  assert.equal(resolveNavigationTarget(state(2, 1), 'next', 'song'), null);
});

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.attributes = new Map();
    this.classNames = new Set();
    this.disabled = false;
    this.classList = {
      add: (...names) => names.forEach((name) => this.classNames.add(name)),
      remove: (...names) => names.forEach((name) => this.classNames.delete(name)),
      contains: (name) => this.classNames.has(name),
    };
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    const enriched = {
      target: this,
      defaultPrevented: false,
      immediatePropagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.immediatePropagationStopped = true; },
      ...event,
    };
    for (const listener of this.listeners.get(type) || []) {
      listener(enriched);
      if (enriched.immediatePropagationStopped) break;
    }
    return enriched;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

class FakeClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.timers = new Map();
  }

  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.timers.set(id, { callback, at: this.now + delay });
    return id;
  };

  clearTimeout = (id) => {
    this.timers.delete(id);
  };

  tick(ms) {
    this.now += ms;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.at <= this.now)
      .sort((a, b) => a[1].at - b[1].at);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }
}

function holdHarness(options = {}) {
  const clock = new FakeClock();
  const button = new FakeTarget();
  const documentRef = new FakeTarget();
  documentRef.visibilityState = 'visible';
  const windowRef = new FakeTarget();
  let currentState = state(0, 0);
  let allowed = true;
  const navigations = [];
  const runtime = loadRuntime({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const controller = runtime.mountHoldButton({
    button,
    direction: 'next',
    getState: () => currentState,
    canNavigate: () => allowed,
    onNavigate: (target) => navigations.push(target),
    documentRef,
    windowRef,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    ...options,
  });
  return {
    button,
    clock,
    controller,
    documentRef,
    navigations,
    setAllowed: (value) => { allowed = value; },
    setState: (value) => { currentState = value; },
    windowRef,
  };
}

function targetHoldHarness() {
  const clock = new FakeClock();
  const container = new FakeTarget();
  const documentRef = new FakeTarget();
  documentRef.visibilityState = 'visible';
  const windowRef = new FakeTarget();
  const songElement = new FakeTarget();
  const sectionElement = new FakeTarget();
  const songTarget = { element: songElement, songIndex: 1, sectionIndex: null };
  const sectionTarget = { element: sectionElement, songIndex: 1, sectionIndex: 2 };
  songElement.resolvedTarget = songTarget;
  sectionElement.resolvedTarget = sectionTarget;
  let allowed = true;
  let reorderAllowed = true;
  let active = null;
  const activations = [];
  const reorderEvents = [];
  const directGestures = [];
  const runtime = loadRuntime({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const controller = runtime.mountDirectTargetHold({
    container,
    resolveTarget: (node) => node?.resolvedTarget || null,
    canActivate: (target) => allowed && target !== active,
    onActivate: (target) => activations.push({
      songIndex: target.songIndex,
      sectionIndex: target.sectionIndex,
    }),
    canReorder: (target) => reorderAllowed && target.sectionIndex === null,
    onReorderStart: (target) => reorderEvents.push({ type: 'start', songIndex: target.songIndex }),
    onReorderMove: (target, event) => reorderEvents.push({ type: 'move', songIndex: target.songIndex, clientY: event.clientY }),
    onReorderCommit: (target) => reorderEvents.push({ type: 'commit', songIndex: target.songIndex }),
    onReorderCancel: (target) => reorderEvents.push({ type: 'cancel', songIndex: target.songIndex }),
    onDirectGestureStart: (target) => directGestures.push({ type: 'start', songIndex: target.songIndex }),
    onDirectGestureEnd: (target) => directGestures.push({ type: 'end', songIndex: target.songIndex }),
    targetKey: (target) => `${target.songIndex}:${target.sectionIndex ?? 'song'}`,
    documentRef,
    directGestures,
    reorderEvents,
    windowRef,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });
  return {
    activations,
    clock,
    container,
    controller,
    documentRef,
    directGestures,
    reorderEvents,
    sectionElement,
    sectionTarget,
    setActive: (target) => { active = target; },
    setAllowed: (value) => { allowed = value; },
    setReorderAllowed: (value) => { reorderAllowed = value; },
    songElement,
    songTarget,
    windowRef,
  };
}

test('direct target hold arms at 500 ms, activates once on release, and suppresses its synthetic click', () => {
  const harness = targetHoldHarness();
  harness.container.dispatch('pointerdown', {
    target: harness.songElement,
    pointerType: 'touch',
    pointerId: 7,
    isPrimary: true,
    button: 0,
    clientX: 10,
    clientY: 20,
  });
  harness.clock.tick(499);
  assert.deepEqual(harness.activations, []);
  assert.equal(harness.songElement.classList.contains('is-touch-holding'), true);
  harness.clock.tick(1);
  assert.deepEqual(harness.activations, []);
  assert.equal(harness.songElement.classList.contains('is-touch-holding'), false);
  harness.windowRef.dispatch('pointerup', { pointerId: 7 });
  harness.windowRef.dispatch('lostpointercapture', { pointerId: 7 });
  harness.windowRef.dispatch('pointerleave', { pointerId: 7 });
  const click = harness.container.dispatch('click', { target: harness.songElement, detail: 1 });
  assert.equal(click.defaultPrevented, true);
  assert.equal(harness.activations.length, 1);
  assert.equal(harness.songElement.classList.contains('is-touch-holding'), false);
});

test('direct target hold cancels short touch and pre-hold movement above 12 px', () => {
  const harness = targetHoldHarness();
  const begin = (pointerId) => harness.container.dispatch('pointerdown', {
    target: harness.sectionElement,
    pointerType: 'touch',
    pointerId,
    isPrimary: true,
    button: 0,
    clientX: 10,
    clientY: 10,
  });

  begin(1);
  harness.clock.tick(100);
  harness.windowRef.dispatch('pointerup', { pointerId: 1 });
  harness.container.dispatch('click', { target: harness.sectionElement, detail: 1 });
  assert.deepEqual(harness.activations, []);

  begin(2);
  harness.windowRef.dispatch('pointermove', { pointerId: 2, clientX: 10, clientY: 22 });
  harness.clock.tick(500);
  assert.deepEqual(harness.activations, []);

  begin(3);
  harness.windowRef.dispatch('pointermove', { pointerId: 3, clientX: 10, clientY: 23 });
  harness.clock.tick(500);
  harness.windowRef.dispatch('pointerup', { pointerId: 3 });
  const click = harness.container.dispatch('click', { target: harness.sectionElement, detail: 1 });
  assert.equal(click.defaultPrevented, true);
  assert.equal(harness.activations.length, 0);
});

test('armed song movement starts and commits one reorder without activation', () => {
  const harness = targetHoldHarness();
  harness.container.dispatch('pointerdown', {
    target: harness.songElement, pointerType: 'touch', pointerId: 8, isPrimary: true, button: 0, clientX: 10, clientY: 10,
  });
  harness.clock.tick(500);
  harness.windowRef.dispatch('pointermove', { pointerId: 8, clientX: 10, clientY: 23 });
  harness.windowRef.dispatch('pointermove', { pointerId: 8, clientX: 10, clientY: 45 });
  harness.windowRef.dispatch('pointerup', { pointerId: 8 });

  assert.deepEqual(harness.activations, []);
  assert.deepEqual(harness.reorderEvents, [
    { type: 'start', songIndex: 1 },
    { type: 'move', songIndex: 1, clientY: 23 },
    { type: 'move', songIndex: 1, clientY: 45 },
    { type: 'commit', songIndex: 1 },
  ]);
});

test('armed section movement cancels safely without activation or reorder', () => {
  const harness = targetHoldHarness();
  harness.container.dispatch('pointerdown', {
    target: harness.sectionElement, pointerType: 'pen', pointerId: 9, isPrimary: true, button: 0, clientX: 10, clientY: 10,
  });
  harness.clock.tick(500);
  harness.windowRef.dispatch('pointermove', { pointerId: 9, clientX: 10, clientY: 23 });
  harness.windowRef.dispatch('pointerup', { pointerId: 9 });

  assert.deepEqual(harness.activations, []);
  assert.deepEqual(harness.reorderEvents, [{ type: 'cancel', songIndex: 1 }]);
});

test('authority loss cancels an active direct-target reorder and clears its classes', () => {
  const harness = targetHoldHarness();
  harness.container.dispatch('pointerdown', {
    target: harness.songElement, pointerType: 'touch', pointerId: 10, isPrimary: true, button: 0, clientX: 10, clientY: 10,
  });
  harness.clock.tick(500);
  harness.windowRef.dispatch('pointermove', { pointerId: 10, clientX: 10, clientY: 23 });
  harness.setReorderAllowed(false);
  harness.controller.update();
  harness.windowRef.dispatch('pointerup', { pointerId: 10 });

  assert.deepEqual(harness.activations, []);
  assert.deepEqual(harness.reorderEvents, [
    { type: 'start', songIndex: 1 },
    { type: 'move', songIndex: 1, clientY: 23 },
    { type: 'cancel', songIndex: 1 },
  ]);
  assert.deepEqual(harness.directGestures, [
    { type: 'start', songIndex: 1 },
    { type: 'end', songIndex: 1 },
  ]);
  assert.equal(harness.songElement.classList.contains('is-touch-reordering'), false);
});

test('touch fallback survives the native pointer cancellation after arming and prevents the reorder move', () => {
  const harness = targetHoldHarness();
  const touch = (clientX, clientY) => ({ identifier: 31, clientX, clientY });
  harness.container.dispatch('pointerdown', {
    target: harness.songElement, pointerType: 'touch', pointerId: 31, isPrimary: true, button: 0, clientX: 10, clientY: 10,
  });
  harness.container.dispatch('touchstart', { target: harness.songElement, changedTouches: [touch(10, 10)] });
  harness.clock.tick(500);
  harness.windowRef.dispatch('pointercancel', { pointerId: 31 });
  const move = harness.container.dispatch('touchmove', { changedTouches: [touch(10, 24)] });
  harness.container.dispatch('touchend', { changedTouches: [touch(10, 24)] });

  assert.equal(move.defaultPrevented, true);
  assert.deepEqual(harness.activations, []);
  assert.deepEqual(harness.reorderEvents, [
    { type: 'start', songIndex: 1 },
    { type: 'move', songIndex: 1, clientY: 24 },
    { type: 'commit', songIndex: 1 },
  ]);
});

test('direct gesture cleanup callback fires once for pointer leave, visibility, and destroy', () => {
  for (const cancellation of ['pointerleave', 'visibilitychange', 'destroy']) {
    const harness = targetHoldHarness();
    harness.container.dispatch('pointerdown', {
      target: harness.songElement, pointerType: 'touch', pointerId: 32, isPrimary: true, button: 0, clientX: 10, clientY: 10,
    });
    if (cancellation === 'visibilitychange') {
      harness.documentRef.visibilityState = 'hidden';
      harness.documentRef.dispatch('visibilitychange');
    } else if (cancellation === 'destroy') {
      harness.controller.destroy();
    } else {
      harness.windowRef.dispatch(cancellation, { pointerId: 32 });
    }
    assert.deepEqual(harness.directGestures, [
      { type: 'start', songIndex: 1 },
      { type: 'end', songIndex: 1 },
    ], cancellation);
  }
});

test('render cancellation preserves logical click suppression across a replaced target until its bounded timeout', () => {
  const harness = targetHoldHarness();
  const replacement = new FakeTarget();
  replacement.resolvedTarget = { element: replacement, songIndex: 1, sectionIndex: 2 };
  harness.container.dispatch('pointerdown', {
    target: harness.sectionElement, pointerType: 'touch', pointerId: 33, isPrimary: true, button: 0, clientX: 10, clientY: 10,
  });
  harness.controller.cancelForRender();
  const compatibilityClick = harness.container.dispatch('click', { target: replacement, detail: 1 });
  assert.equal(compatibilityClick.defaultPrevented, true);
  assert.deepEqual(harness.activations, []);
  assert.deepEqual(harness.directGestures, [
    { type: 'start', songIndex: 1 },
    { type: 'end', songIndex: 1 },
  ]);

  harness.clock.tick(801);
  harness.container.dispatch('click', { target: replacement, detail: 1 });
  assert.deepEqual(harness.activations, [{ songIndex: 1, sectionIndex: 2 }]);
});

test('render cancellation of an armed hold sends neither activation nor reorder', () => {
  const harness = targetHoldHarness();
  harness.container.dispatch('pointerdown', {
    target: harness.songElement, pointerType: 'touch', pointerId: 34, isPrimary: true, button: 0, clientX: 10, clientY: 10,
  });
  harness.clock.tick(500);
  harness.controller.cancelForRender();
  harness.windowRef.dispatch('pointerup', { pointerId: 34 });
  assert.deepEqual(harness.activations, []);
  assert.deepEqual(harness.reorderEvents, [{ type: 'cancel', songIndex: 1 }]);
});

test('every new pointerdown cancels an earlier direct-target hold', () => {
  for (const nextPointer of [
    {
      targetName: 'non-primary touch',
      event: {
        pointerType: 'touch', pointerId: 2, isPrimary: false, button: 0, clientX: 10, clientY: 10,
      },
    },
    {
      targetName: 'touch outside a jump target',
      event: {
        target: new FakeTarget(),
        pointerType: 'touch',
        pointerId: 2,
        isPrimary: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      },
    },
  ]) {
    const harness = targetHoldHarness();
    harness.container.dispatch('pointerdown', {
      target: harness.songElement,
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    harness.clock.tick(100);
    harness.container.dispatch('pointerdown', {
      target: harness.sectionElement,
      ...nextPointer.event,
    });
    harness.clock.tick(400);
    assert.deepEqual(harness.activations, [], nextPointer.targetName);
    assert.equal(harness.songElement.classList.contains('is-touch-holding'), false, nextPointer.targetName);
  }
});

test('direct target hold keeps mouse and keyboard clicks immediate', () => {
  const harness = targetHoldHarness();
  harness.container.dispatch('pointerdown', {
    target: harness.songElement,
    pointerType: 'mouse',
    pointerId: 1,
    isPrimary: true,
    button: 0,
  });
  harness.container.dispatch('click', { target: harness.songElement, detail: 1 });
  harness.container.dispatch('click', { target: harness.sectionElement, detail: 0 });
  assert.deepEqual(harness.activations, [
    { songIndex: 1, sectionIndex: null },
    { songIndex: 1, sectionIndex: 2 },
  ]);
});

test('direct target hold revalidates active/authority state and cleans lifecycle listeners', () => {
  const harness = targetHoldHarness();
  harness.setActive(harness.songTarget);
  harness.container.dispatch('pointerdown', {
    target: harness.songElement,
    pointerType: 'pen',
    pointerId: 4,
    isPrimary: true,
    button: 0,
    clientX: 0,
    clientY: 0,
  });
  harness.clock.tick(500);
  assert.deepEqual(harness.activations, []);

  harness.setActive(null);
  harness.container.dispatch('pointerdown', {
    target: harness.sectionElement,
    pointerType: 'touch',
    pointerId: 5,
    isPrimary: true,
    button: 0,
    clientX: 0,
    clientY: 0,
  });
  harness.setAllowed(false);
  harness.controller.update();
  harness.clock.tick(500);
  assert.deepEqual(harness.activations, []);

  harness.setAllowed(true);
  harness.container.dispatch('pointerdown', {
    target: harness.sectionElement,
    pointerType: 'touch',
    pointerId: 6,
    isPrimary: true,
    button: 0,
    clientX: 0,
    clientY: 0,
  });
  harness.documentRef.visibilityState = 'hidden';
  harness.documentRef.dispatch('visibilitychange');
  harness.clock.tick(500);
  harness.controller.destroy();
  assert.equal(harness.clock.timers.size, 0);
  for (const type of ['pointerdown', 'click', 'contextmenu']) {
    assert.equal(harness.container.listeners.get(type)?.size || 0, 0, type);
  }
  for (const type of ['pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture', 'blur']) {
    assert.equal(harness.windowRef.listeners.get(type)?.size || 0, 0, type);
  }
});

test('hold button cancels a short pointer press and fires once at 500 ms', () => {
  const harness = holdHarness();
  harness.button.dispatch('pointerdown', { button: 0, pointerId: 1 });
  harness.clock.tick(499);
  harness.button.dispatch('pointerup', { pointerId: 1 });
  assert.deepEqual(plain(harness.navigations), []);

  harness.button.dispatch('pointerdown', { button: 0, pointerId: 2 });
  harness.clock.tick(500);
  harness.button.dispatch('pointerup', { pointerId: 2 });
  assert.deepEqual(plain(harness.navigations), [{ songIndex: 0, sectionIndex: 1, level: 'section' }]);
  assert.equal(harness.button.classList.contains('is-holding'), false);
});

test('hold button resolves the latest state and cancels invalidation', () => {
  const harness = holdHarness();
  harness.button.dispatch('pointerdown', { button: 0, pointerId: 1 });
  harness.setState(state(0, 1));
  harness.clock.tick(500);
  harness.button.dispatch('pointerup', { pointerId: 1 });
  assert.deepEqual(plain(harness.navigations), [{ songIndex: 1, sectionIndex: null, level: 'section' }]);

  harness.button.dispatch('pointerdown', { button: 0, pointerId: 2 });
  harness.setAllowed(false);
  harness.controller.update();
  harness.clock.tick(500);
  assert.equal(harness.navigations.length, 1);
  assert.equal(harness.button.disabled, true);
});

test('hold button uses the same safety for keyboard and lifecycle cancellation', () => {
  const harness = holdHarness();
  harness.button.dispatch('keydown', { key: 'Enter', repeat: false });
  harness.button.dispatch('keydown', { key: 'Enter', repeat: true });
  harness.clock.tick(500);
  harness.button.dispatch('keyup', { key: 'Enter' });
  assert.equal(harness.navigations.length, 1);

  harness.button.dispatch('keydown', { key: ' ', repeat: false });
  harness.windowRef.dispatch('blur');
  harness.clock.tick(500);
  assert.equal(harness.navigations.length, 1);

  harness.button.dispatch('keydown', { key: ' ', repeat: false });
  harness.documentRef.visibilityState = 'hidden';
  harness.documentRef.dispatch('visibilitychange');
  harness.clock.tick(500);
  assert.equal(harness.navigations.length, 1);
});

test('hold button cancels pointer exit, pointer cancellation, and lost capture', () => {
  for (const cancellation of ['pointerleave', 'pointercancel', 'lostpointercapture']) {
    const harness = holdHarness();
    harness.button.dispatch('pointerdown', { button: 0, pointerId: 1 });
    harness.button.dispatch(cancellation, { pointerId: 1 });
    harness.clock.tick(500);
    assert.equal(harness.navigations.length, 0, cancellation);
    assert.equal(harness.button.classList.contains('is-holding'), false, cancellation);
  }
});

test('hold button fires after holding Space for 500 ms', () => {
  const harness = holdHarness();

  harness.button.dispatch('keydown', { key: ' ', repeat: false });
  harness.clock.tick(500);
  harness.button.dispatch('keyup', { key: ' ' });

  assert.deepEqual(plain(harness.navigations), [{ songIndex: 0, sectionIndex: 1, level: 'section' }]);
});

test('hold button cancels keyboard navigation when the key is released early', () => {
  const harness = holdHarness();

  harness.button.dispatch('keydown', { key: 'Enter', repeat: false });
  harness.clock.tick(499);
  harness.button.dispatch('keyup', { key: 'Enter' });
  harness.clock.tick(1);

  assert.equal(harness.navigations.length, 0);
  assert.equal(harness.button.classList.contains('is-holding'), false);
});

test('hold button destroy cancels the hold and removes its listeners', () => {
  const harness = holdHarness();

  harness.button.dispatch('pointerdown', { button: 0, pointerId: 1 });
  harness.controller.destroy();
  harness.clock.tick(500);

  assert.equal(harness.navigations.length, 0);
  assert.equal(harness.button.classList.contains('is-holding'), false);
  assert.equal(harness.clock.timers.size, 0);
  for (const type of [
    'pointerdown',
    'pointerup',
    'pointerleave',
    'pointercancel',
    'lostpointercapture',
    'keydown',
    'keyup',
    'click',
  ]) {
    assert.equal(harness.button.listeners.get(type)?.size || 0, 0, type);
  }
  assert.equal(harness.documentRef.listeners.get('visibilitychange')?.size || 0, 0);
  assert.equal(harness.windowRef.listeners.get('blur')?.size || 0, 0);

  harness.button.dispatch('pointerdown', { button: 0, pointerId: 2 });
  harness.clock.tick(500);
  assert.equal(harness.navigations.length, 0);
});

test('hold button update cancels when the latest state has no target', () => {
  const harness = holdHarness();
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.attributes.get('aria-disabled'), 'false');

  harness.button.dispatch('pointerdown', { button: 0, pointerId: 1 });
  harness.setState(state(2, 1));
  harness.controller.update();
  harness.clock.tick(500);

  assert.equal(harness.navigations.length, 0);
  assert.equal(harness.button.disabled, true);
  assert.equal(harness.button.attributes.get('aria-disabled'), 'true');
  assert.equal(harness.button.classList.contains('is-holding'), false);
});

test('hold button ignores non-primary pointer presses', () => {
  const harness = holdHarness();

  harness.button.dispatch('pointerdown', { button: 1, pointerId: 1 });
  harness.clock.tick(500);

  assert.equal(harness.navigations.length, 0);
  assert.equal(harness.button.classList.contains('is-holding'), false);
});

test('hold button suppresses native click activation', () => {
  const harness = holdHarness();
  let prevented = false;

  harness.button.dispatch('click', {
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(prevented, true);
});

test('hold button suppresses the native long-press context menu', () => {
  const harness = holdHarness();
  let prevented = false;

  harness.button.dispatch('contextmenu', {
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(prevented, true);
});

test('hold button ignores a non-primary touch or pen pointer', () => {
  const harness = holdHarness();

  harness.button.dispatch('pointerdown', { button: 0, isPrimary: false, pointerId: 2 });
  harness.clock.tick(500);

  assert.equal(harness.navigations.length, 0);
  assert.equal(harness.button.classList.contains('is-holding'), false);
});

test('active pointer ignores end events from another pointer', async (t) => {
  for (const cancellation of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) {
    await t.test(cancellation, () => {
      const harness = holdHarness();
      harness.button.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 1 });
      harness.button.dispatch(cancellation, { pointerId: 2 });
      harness.clock.tick(500);
      harness.button.dispatch('pointerup', { pointerId: 1 });

      assert.equal(harness.navigations.length, 1);
    });
  }
});

test('active keyboard hold ignores pointer release', () => {
  const harness = holdHarness();

  harness.button.dispatch('keydown', { key: 'Enter', repeat: false });
  harness.button.dispatch('pointerup', { pointerId: 1 });
  harness.clock.tick(500);
  harness.button.dispatch('keyup', { key: 'Enter' });

  assert.equal(harness.navigations.length, 1);
});

test('active pointer hold ignores keyboard release', () => {
  const harness = holdHarness();

  harness.button.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 1 });
  harness.button.dispatch('keyup', { key: 'Enter' });
  harness.clock.tick(500);
  harness.button.dispatch('pointerup', { pointerId: 1 });

  assert.equal(harness.navigations.length, 1);
});

test('hold button always requires 500 ms before section is ready', () => {
  const harness = holdHarness({ holdMs: 1 });

  harness.button.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 1 });
  harness.clock.tick(1);
  harness.button.dispatch('pointerup', { pointerId: 1 });
  assert.equal(harness.navigations.length, 0);
  harness.button.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 2 });
  harness.clock.tick(499);
  harness.button.dispatch('pointerup', { pointerId: 2 });
  assert.equal(harness.navigations.length, 0);
  harness.button.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 3 });
  harness.clock.tick(500);
  harness.button.dispatch('pointerup', { pointerId: 3 });
  assert.equal(harness.navigations.length, 1);
});

test('hold completion rechecks authorization at the auto-fire threshold', () => {
  const harness = holdHarness();

  harness.button.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 1 });
  harness.setAllowed(false);
  harness.clock.tick(500);

  assert.equal(harness.navigations.length, 0);
  assert.equal(harness.button.disabled, true);
});

test('jump confirmation keeps old state authoritative until target observation', () => {
  const clock = new FakeClock();
  const snapshots = [];
  const timeouts = [];
  const runtime = loadRuntime({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const controller = runtime.createJumpConfirmation({
    onChange: (snapshot) => snapshots.push(snapshot),
    onTimeout: (target) => timeouts.push(target),
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  controller.pending({ songIndex: 0, sectionIndex: 1 });
  controller.executed({ songIndex: 0, sectionIndex: 1 });
  controller.observeState(state(0, 0));
  assert.deepEqual(plain(controller.snapshot()), { phase: 'confirming', target: { songIndex: 0, sectionIndex: 1 } });
  controller.observeState(state(0, 1));
  assert.deepEqual(plain(controller.snapshot()), { phase: 'idle', target: null });
  assert.equal(timeouts.length, 0);
  assert.equal(snapshots.some((snapshot) => snapshot.phase === 'confirming'), true);
});

test('jump confirmation replaces targets and times out without inventing state', () => {
  const clock = new FakeClock();
  const timeouts = [];
  const runtime = loadRuntime({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const controller = runtime.createJumpConfirmation({
    onChange() {},
    onTimeout: (target) => timeouts.push(target),
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  controller.pending({ songIndex: 0, sectionIndex: 1 });
  controller.pending({ songIndex: 1, sectionIndex: null });
  controller.executed({ songIndex: 1, sectionIndex: null });
  clock.tick(2999);
  assert.equal(timeouts.length, 0);
  clock.tick(1);
  assert.deepEqual(plain(timeouts), [{ songIndex: 1, sectionIndex: null }]);
  assert.deepEqual(plain(controller.snapshot()), { phase: 'idle', target: null });
});

test('quantization confirmation keeps the pending target until observed', () => {
  const clock = new FakeClock();
  const snapshots = [];
  const runtime = loadRuntime({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const controller = runtime.createQuantizationConfirmation({
    onChange: (snapshot) => snapshots.push(plain(snapshot)),
    onFailure() {},
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  controller.observe(4);
  controller.begin({ value: 7, commandId: 'q-1' });
  controller.observe(4);
  assert.deepEqual(plain(controller.snapshot()), {
    confirmedValue: 4,
    displayValue: 7,
    pending: { value: 7, commandId: 'q-1' },
  });
  controller.observe(7);
  assert.deepEqual(plain(controller.snapshot()), {
    confirmedValue: 7,
    displayValue: 7,
    pending: null,
  });
  assert.equal(snapshots.some((snapshot) => snapshot.pending?.commandId === 'q-1'), true);
});

test('quantization confirmation replaces requests and restores confirmed state on failure or timeout', () => {
  const clock = new FakeClock();
  const failures = [];
  const runtime = loadRuntime({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const controller = runtime.createQuantizationConfirmation({
    onChange() {},
    onFailure: (failure) => failures.push(plain(failure)),
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    timeoutMs: 4000,
  });

  controller.observe(4);
  controller.begin({ value: 7, commandId: 'q-old' });
  controller.begin({ value: 9, commandId: 'q-new' });
  assert.equal(controller.settle({ commandId: 'q-old', status: 'failed' }), false);
  assert.equal(controller.settle({ commandId: 'q-new', status: 'failed' }), true);
  assert.equal(controller.snapshot().displayValue, 4);

  controller.begin({ value: 11, commandId: 'q-timeout' });
  clock.tick(3999);
  assert.equal(controller.snapshot().displayValue, 11);
  clock.tick(1);
  assert.equal(controller.snapshot().displayValue, 4);
  assert.deepEqual(failures.map((entry) => entry.commandId), ['q-new', 'q-timeout']);
});

test('bar display stabilizer clamps sample jitter but accepts real repositioning', () => {
  const { createBarDisplayStabilizer } = loadRuntime();
  const stabilizer = createBarDisplayStabilizer();
  const formatBar = (beats) => {
    const bar = Math.floor(beats / 4) + 1;
    const remaining = beats % 4;
    const beat = Math.floor(remaining) + 1;
    const sixteenth = Math.floor((remaining % 1) * 4) + 1;
    return `${bar}.${beat}.${sixteenth}`;
  };

  const state = {
    activeSongIndex: 1,
    activeSectionIndex: 2,
    currentLoopIteration: 1,
    isPlaying: true,
  };

  assert.equal(stabilizer.observeState(null, state), true);
  assert.equal(stabilizer.observeState(state, { ...state }), false);
  assert.equal(formatBar(stabilizer.update(84.02, true)), '22.1.1');
  assert.equal(formatBar(stabilizer.update(83.98, true)), '22.1.1');
  assert.equal(stabilizer.observeState(state, { ...state, activeSectionIndex: 3 }), true);
  assert.equal(formatBar(stabilizer.update(83.98, true)), '21.4.4');
  assert.equal(stabilizer.update(84.3, true), 84.3);
  assert.equal(stabilizer.update(90, true), 90);
  assert.equal(stabilizer.update(80, true), 80);
  assert.equal(stabilizer.observeState(state, { ...state, currentLoopIteration: 2 }), true);
  assert.equal(stabilizer.update(79.8, true), 79.8);
  const stoppedState = { ...state, isPlaying: false };
  assert.equal(stabilizer.observeState(state, stoppedState), true);
  assert.equal(stabilizer.observeState(stoppedState, state), true);
  assert.equal(stabilizer.update(79.6, true), 79.6);
  assert.equal(stabilizer.update(79, false), 79);
  assert.equal(stabilizer.update(78.8, true), 78.8);
  assert.equal(stabilizer.update(80, true), 80);
  assert.equal(stabilizer.update(79.5, true), 79.5);
  assert.equal(stabilizer.update(Number.NaN, true), 79.5);
  stabilizer.reset();
  assert.equal(stabilizer.update(79.3, true), 79.3);
});

test('section hold fires once after 500 ms even when held past 1000 ms', () => {
  const harness = holdHarness();

  harness.button.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 1 });
  harness.clock.tick(1000);

  assert.deepEqual(plain(harness.navigations), [{ songIndex: 0, sectionIndex: 1, level: 'section' }]);
  assert.equal(harness.clock.timers.size, 0);
  assert.equal(harness.button.classList.contains('is-holding-section-ready'), true);
});

test('song hold fires once after 500 ms at the adjacent song start', () => {
  const harness = holdHarness({ level: 'song' });

  harness.button.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 1 });
  harness.clock.tick(499);
  assert.deepEqual(plain(harness.navigations), []);
  harness.clock.tick(1);

  assert.deepEqual(plain(harness.navigations), [{ songIndex: 1, sectionIndex: null, level: 'song' }]);
  harness.clock.tick(500);
  assert.equal(harness.navigations.length, 1);
  assert.equal(harness.clock.timers.size, 0);
  assert.equal(harness.button.classList.contains('is-holding-song'), true);
});

test('song hold disables when no adjacent song exists', () => {
  const harness = holdHarness({ direction: 'previous', level: 'song' });

  assert.equal(harness.button.disabled, true);
  assert.equal(harness.button.attributes.get('aria-disabled'), 'true');
  harness.button.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 1 });
  harness.clock.tick(1000);
  assert.deepEqual(plain(harness.navigations), []);
});

// The Arrangement position is a beat count. Converting it with Live's current
// tempo made elapsed time shrink whenever the tempo rose, and pre-jump BPM
// writes change the tempo on every jump. Song durations are derived from each
// song's declared BPM, so elapsed time has to use that same basis.

test('songElapsedSecondsFromBeats uses the declared song BPM, not the live tempo', () => {
  const { songElapsedSecondsFromBeats } = loadRuntime();

  assert.equal(songElapsedSecondsFromBeats(16, { bpm: 120 }, 120), 8);
  assert.equal(songElapsedSecondsFromBeats(16, { bpm: 120 }, 180), 8);
  assert.equal(songElapsedSecondsFromBeats(16, { bpm: 120 }, 60), 8);
});

test('songElapsedSecondsFromBeats falls back to the live tempo when a song declares none', () => {
  const { songElapsedSecondsFromBeats } = loadRuntime();

  assert.equal(songElapsedSecondsFromBeats(16, { bpm: null }, 120), 8);
  assert.equal(songElapsedSecondsFromBeats(16, {}, 240), 4);
});

test('songElapsedSecondsFromBeats returns null without a usable tempo basis', () => {
  const { songElapsedSecondsFromBeats } = loadRuntime();

  assert.equal(songElapsedSecondsFromBeats(16, { bpm: 0 }, 0), null);
  assert.equal(songElapsedSecondsFromBeats(Number.NaN, { bpm: 120 }, 120), null);
  assert.equal(songElapsedSecondsFromBeats(16, null, Number.NaN), null);
});

test('songElapsedSecondsFromBeats never reports negative elapsed time', () => {
  const { songElapsedSecondsFromBeats } = loadRuntime();

  assert.equal(songElapsedSecondsFromBeats(-4, { bpm: 120 }, 120), 0);
});
