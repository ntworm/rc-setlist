import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandBus } from '../src/core/command-bus.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';

function createBus() {
  const manager = new SetlistManager();
  const events = [];
  const bus = new CommandBus(manager, { log: (event) => events.push(event) });
  return { bus, events, manager };
}

function settled(bus, commandId) {
  return new Promise((resolve) => {
    const listener = (command) => {
      if (command.commandId !== commandId) return;
      bus.off('command_settled', listener);
      resolve(command);
    };
    bus.on('command_settled', listener);
  });
}

test('command bus no longer accepts an unused OSC client dependency', () => {
  assert.equal(CommandBus.length, 2);
  const { bus } = createBus();
  bus.stop();
});

test('local commands confirm only after their handler resolves', async () => {
  const { bus } = createBus();
  let release;
  const handler = new Promise((resolve) => { release = resolve; });
  const command = bus.registerCommand('local-1', 'save_lyrics', {}, 'test');
  const result = settled(bus, command.commandId);

  bus.dispatch(command, () => handler);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(command.status, 'sent');
  assert.equal(bus.getPending().length, 1);

  release();
  assert.equal((await result).status, 'confirmed');
  assert.equal(bus.getPending().length, 0);
  bus.stop();
});

test('every successful local command family settles instead of expiring', async () => {
  const localTypes = [
    'refresh', 'reorder', 'save_lyrics', 'click_preview', 'export_csv',
    'create_test_session', 'set_panic', 'set_critical_lock', 'set_mode',
    'profiles_get', 'preflight_check', 'profile_create', 'profile_select',
    'profile_rename', 'profile_delete', 'profile_restore',
  ];

  for (const type of localTypes) {
    const { bus } = createBus();
    const command = bus.registerCommand(`local-${type}`, type, { active: false }, 'test');
    const result = settled(bus, command.commandId);
    bus.dispatch(command, () => undefined);
    assert.equal((await result).status, 'confirmed', type);
    bus.stop();
  }
});

test('rejected local handlers settle as failed', async () => {
  const { bus } = createBus();
  const command = bus.registerCommand('failed-local', 'export_csv', {}, 'test');
  const result = settled(bus, command.commandId);
  bus.dispatch(command, async () => { throw new Error('disk unavailable'); });
  const settledCommand = await result;
  assert.equal(settledCommand.status, 'failed');
  assert.equal(settledCommand.reason, 'execution_failed');
  assert.equal(bus.getPending().length, 0);
  bus.stop();
});

test('metronome uses its real command name and payload for observable confirmation', async () => {
  const { bus, manager } = createBus();
  const command = bus.registerCommand('metronome-on', 'metronome', { value: true }, 'test');
  const result = settled(bus, command.commandId);
  bus.dispatch(command, () => manager.updateMetronome(true));
  assert.equal((await result).status, 'confirmed');
  bus.stop();
});

test('stop and panic bypass a blocked ordered command', async () => {
  const { bus, manager } = createBus();
  let releaseLong;
  const longHandler = new Promise((resolve) => { releaseLong = resolve; });
  const order = [];

  const long = bus.registerCommand('long', 'create_test_session', {}, 'test');
  bus.dispatch(long, async () => {
    order.push('long-start');
    await longHandler;
    order.push('long-end');
  });
  await new Promise((resolve) => setImmediate(resolve));

  const stop = bus.registerCommand('stop-now', 'stop', {}, 'test');
  const stopResult = settled(bus, stop.commandId);
  bus.dispatch(stop, () => order.push('stop'));

  const panic = bus.registerCommand('panic-now', 'set_panic', { active: true }, 'test');
  const panicResult = settled(bus, panic.commandId);
  bus.dispatch(panic, () => {
    order.push('panic');
    manager.setPanic(true);
  });

  assert.equal((await stopResult).status, 'confirmed');
  assert.equal((await panicResult).status, 'confirmed');
  assert.deepEqual(order, ['long-start', 'stop', 'panic']);

  releaseLong();
  await settled(bus, long.commandId);
  bus.stop();
});

test('panic can be released and stop remains available while critical commands are locked', async () => {
  const { bus, manager } = createBus();
  manager.setPanic(true);
  const release = bus.registerCommand('panic-off', 'set_panic', { active: false }, 'test');
  const releaseResult = settled(bus, release.commandId);
  bus.dispatch(release, () => manager.setPanic(false));
  assert.equal((await releaseResult).status, 'confirmed');

  manager.setCriticalCommandsLocked(true);
  const stop = bus.registerCommand('locked-stop', 'stop', {}, 'test');
  const stopResult = settled(bus, stop.commandId);
  let executed = false;
  bus.dispatch(stop, () => { executed = true; });
  assert.equal((await stopResult).status, 'confirmed');
  assert.equal(executed, true);
  bus.stop();
});

test('an expired mutation keeps later ordered work behind its underlying handler', async () => {
  const { bus } = createBus();
  let releaseFirst;
  const firstHandler = new Promise((resolve) => { releaseFirst = resolve; });
  const first = bus.registerCommand('slow-save', 'save_lyrics', {}, 'test');
  first.timeoutMs = 10;
  const second = bus.registerCommand('next-save', 'save_lyrics', {}, 'test');
  let secondExecuted = false;

  bus.dispatch(first, () => firstHandler);
  bus.dispatch(second, () => { secondExecuted = true; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  bus.checkTimeouts();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(first.status, 'expired');
  assert.equal(second.status, 'sent');
  assert.equal(secondExecuted, false);

  const secondResult = settled(bus, second.commandId);
  releaseFirst();
  assert.equal((await secondResult).status, 'confirmed');
  assert.equal(secondExecuted, true);
  bus.stop();
});
