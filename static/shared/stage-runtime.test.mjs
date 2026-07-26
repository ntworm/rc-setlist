import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeSource = fs.readFileSync(path.join(here, 'stage-runtime.js'), 'utf8');

function loadRuntime() {
  const context = { console, globalThis: null, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.runInNewContext(runtimeSource, context, { filename: 'stage-runtime.js' });
  return context.StageRuntime;
}

class FakeTarget {
  constructor() {
    this.listeners = new Map();
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
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

function createHarness({ fullscreenRejects = false, wakeLockRejects = false } = {}) {
  const documentRef = new FakeTarget();
  documentRef.fullscreenElement = null;
  documentRef.visibilityState = 'visible';
  documentRef.documentElement = {
    requestFullscreen: async () => {
      if (fullscreenRejects) throw new Error('fullscreen denied');
      documentRef.fullscreenElement = documentRef.documentElement;
      documentRef.dispatch('fullscreenchange');
    },
  };
  documentRef.exitFullscreen = async () => {
    documentRef.fullscreenElement = null;
    documentRef.dispatch('fullscreenchange');
  };

  const button = new FakeTarget();
  button.attributes = new Map();
  button.setAttribute = (name, value) => button.attributes.set(name, String(value));
  button.textContent = '';

  const notice = { hidden: true, textContent: '' };
  const locks = [];
  const navigatorRef = {
    wakeLock: {
      request: async () => {
        if (wakeLockRejects) throw new Error('wake lock denied');
        const lock = new FakeTarget();
        lock.released = false;
        lock.release = async () => {
          lock.released = true;
          lock.dispatch('release');
        };
        locks.push(lock);
        return lock;
      },
    },
  };

  return { button, documentRef, locks, navigatorRef, notice };
}

test('Stage runtime couples fullscreen and Wake Lock without duplicate locks', async () => {
  const runtime = loadRuntime();
  const harness = createHarness();
  const controller = runtime.mount(harness);

  await controller.toggleFullscreen();
  await controller.sync();
  assert.equal(harness.documentRef.fullscreenElement, harness.documentRef.documentElement);
  assert.equal(harness.locks.length, 1);
  assert.equal(harness.button.attributes.get('aria-pressed'), 'true');

  await controller.sync();
  assert.equal(harness.locks.length, 1, 'sync must not acquire a duplicate lock');

  await controller.toggleFullscreen();
  await controller.sync();
  assert.equal(harness.documentRef.fullscreenElement, null);
  assert.equal(harness.locks[0].released, true);
  assert.equal(harness.button.attributes.get('aria-pressed'), 'false');

  await controller.destroy();
});

test('Stage runtime keeps the page usable when fullscreen is denied', async () => {
  const runtime = loadRuntime();
  const harness = createHarness({ fullscreenRejects: true });
  const controller = runtime.mount(harness);

  await assert.doesNotReject(() => controller.toggleFullscreen());
  assert.equal(harness.documentRef.fullscreenElement, null);
  assert.equal(harness.button.attributes.get('aria-pressed'), 'false');
  assert.equal(harness.notice.hidden, false);
  assert.match(harness.notice.textContent, /full screen/i);

  await controller.destroy();
});

test('Stage runtime reports when Wake Lock is unavailable', async () => {
  const runtime = loadRuntime();
  const harness = createHarness();
  delete harness.navigatorRef.wakeLock;
  const controller = runtime.mount(harness);

  await controller.toggleFullscreen();
  assert.equal(harness.documentRef.fullscreenElement, harness.documentRef.documentElement);
  assert.equal(harness.notice.hidden, false);
  assert.match(harness.notice.textContent, /does not support Screen Wake Lock/i);

  await controller.destroy();
});

test('Stage runtime ignores the F shortcut while editing text', async () => {
  const runtime = loadRuntime();
  const harness = createHarness();
  const controller = runtime.mount(harness);

  await controller.handleKeydown({ key: 'f', target: { tagName: 'INPUT' } });
  assert.equal(harness.documentRef.fullscreenElement, null);

  let prevented = false;
  await controller.handleKeydown({
    key: 'f',
    target: { tagName: 'DIV' },
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(harness.documentRef.fullscreenElement, harness.documentRef.documentElement);

  await controller.destroy();
});

test('Stage runtime reacquires Wake Lock after returning to a visible fullscreen page', async () => {
  const runtime = loadRuntime();
  const harness = createHarness();
  const controller = runtime.mount(harness);

  await controller.toggleFullscreen();
  await controller.sync();
  assert.equal(harness.locks.length, 1);
  await harness.locks[0].release();

  harness.documentRef.visibilityState = 'hidden';
  harness.documentRef.dispatch('visibilitychange');
  harness.documentRef.visibilityState = 'visible';
  harness.documentRef.dispatch('visibilitychange');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.locks.length, 2);
  await controller.destroy();
});
