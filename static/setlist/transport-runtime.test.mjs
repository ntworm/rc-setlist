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
    const enriched = { preventDefault() {}, ...event };
    for (const listener of this.listeners.get(type) || []) listener(enriched);
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

test('hold button cancels a short pointer press and fires once at 500 ms', () => {
  const harness = holdHarness();
  harness.button.dispatch('pointerdown', { button: 0, pointerId: 1 });
  harness.clock.tick(499);
  harness.button.dispatch('pointerup', { pointerId: 1 });
  assert.deepEqual(plain(harness.navigations), []);

  harness.button.dispatch('pointerdown', { button: 0, pointerId: 2 });
  harness.clock.tick(500);
  harness.clock.tick(500);
  assert.deepEqual(plain(harness.navigations), [{ songIndex: 0, sectionIndex: 1 }]);
  harness.button.dispatch('pointerup', { pointerId: 2 });
  assert.equal(harness.button.classList.contains('is-holding'), false);
});

test('hold button resolves the latest state and cancels invalidation', () => {
  const harness = holdHarness();
  harness.button.dispatch('pointerdown', { button: 0, pointerId: 1 });
  harness.setState(state(0, 1));
  harness.clock.tick(500);
  assert.deepEqual(plain(harness.navigations), [{ songIndex: 1, sectionIndex: null }]);

  harness.button.dispatch('pointerup', { pointerId: 1 });
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
  assert.equal(harness.navigations.length, 1);

  harness.button.dispatch('keyup', { key: 'Enter' });
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

  assert.deepEqual(plain(harness.navigations), [{ songIndex: 0, sectionIndex: 1 }]);
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

      assert.equal(harness.navigations.length, 1);
    });
  }
});

test('active keyboard hold ignores pointer release', () => {
  const harness = holdHarness();

  harness.button.dispatch('keydown', { key: 'Enter', repeat: false });
  harness.button.dispatch('pointerup', { pointerId: 1 });
  harness.clock.tick(500);

  assert.equal(harness.navigations.length, 1);
});

test('active pointer hold ignores keyboard release', () => {
  const harness = holdHarness();

  harness.button.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 1 });
  harness.button.dispatch('keyup', { key: 'Enter' });
  harness.clock.tick(500);

  assert.equal(harness.navigations.length, 1);
});

test('hold button always requires 500 ms even when a caller requests less', () => {
  const harness = holdHarness({ holdMs: 1 });

  harness.button.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 1 });
  harness.clock.tick(1);
  assert.equal(harness.navigations.length, 0);
  harness.clock.tick(498);
  assert.equal(harness.navigations.length, 0);
  harness.clock.tick(1);
  assert.equal(harness.navigations.length, 1);
});

test('hold completion rechecks authorization without an update call', () => {
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
