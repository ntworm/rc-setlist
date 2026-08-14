import assert from 'node:assert/strict';
import test from 'node:test';
import * as commandBusModule from '../src/core/command-bus.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';

const { CommandBus } = commandBusModule;

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

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('condition was not reached');
}

test('CommandBus does not require an unused OSC client dependency', () => {
  assert.equal(CommandBus.length, 2);
});

test('command behavior is declared in one immutable metadata table', () => {
  const policies = commandBusModule.COMMAND_POLICIES;
  assert.ok(policies);
  assert.equal(Object.isFrozen(policies), true);
  for (const policy of Object.values(policies)) {
    assert.equal(Object.isFrozen(policy), true);
  }
});

test('toggle_play, next_cue, and prev_cue remain local actions without policies', () => {
  const policies = commandBusModule.COMMAND_POLICIES;
  assert.equal(Object.hasOwn(policies, 'toggle_play'), false);
  assert.equal(Object.hasOwn(policies, 'next_cue'), false);
  assert.equal(Object.hasOwn(policies, 'prev_cue'), false);
});

test('pre-roll toggle is an explicit local command policy', () => {
  assert.deepEqual(commandBusModule.COMMAND_POLICIES.set_pre_roll, {
    completion: 'local',
    timeoutMs: 2_000,
  });
});

test('local commands confirm only after their handler promise resolves', async () => {
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

test('rejected local handlers settle with only the stable execution_failed reason', async () => {
  const { bus, events } = createBus();
  const command = bus.registerCommand('failed-local', 'export_csv', {}, 'test');
  const result = settled(bus, command.commandId);

  bus.dispatch(command, async () => { throw new Error('disk unavailable: C:\\private\\secret.txt'); });
  const settledCommand = await result;

  assert.equal(settledCommand.status, 'failed');
  assert.equal(settledCommand.reason, 'execution_failed');
  assert.equal(events.at(-1)?.message.includes('disk unavailable'), false);
  assert.equal(bus.getPending().length, 0);
  bus.stop();
});

test('metronome confirmation reads state.metronome rather than transport.state', async () => {
  let pending = [];
  const manager = {
    getState: () => ({
      metronome: true,
      transport: { state: false },
      safety: { panicActive: false, criticalCommandsLocked: false },
    }),
    setPendingCommands: (ids) => { pending = ids; },
  };
  const bus = new CommandBus(manager, { log() {} });
  const command = bus.registerCommand('metronome-on', 'metronome', { value: true }, 'test');
  const result = settled(bus, command.commandId);

  bus.dispatch(command, () => undefined);

  assert.equal((await result).status, 'confirmed');
  assert.deepEqual(pending, []);
  bus.stop();
});

test('stop and active panic bypass a blocked normal mutation', async () => {
  const { bus, manager } = createBus();
  let releaseLong;
  const longHandler = new Promise((resolve) => { releaseLong = resolve; });
  const order = [];

  const long = bus.registerCommand('long', 'create_test_session', {}, 'test');
  const longResult = settled(bus, long.commandId);
  bus.dispatch(long, async () => {
    order.push('long-start');
    await longHandler;
    order.push('long-end');
  });
  await waitFor(() => order.length === 1);

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
  assert.equal((await longResult).status, 'confirmed');
  bus.stop();
});

test('safety-lane commands still execute while panic is already active', async () => {
  const { bus, manager } = createBus();
  manager.setPanic(true);
  let stopExecutions = 0;

  const stop = bus.registerCommand('stop-in-panic', 'stop', {}, 'test');
  const stopResult = settled(bus, stop.commandId);
  bus.dispatch(stop, () => { stopExecutions++; });

  const clearPanic = bus.registerCommand('clear-panic', 'set_panic', { active: false }, 'test');
  const clearPanicResult = settled(bus, clearPanic.commandId);
  bus.dispatch(clearPanic, () => manager.setPanic(false));

  assert.equal((await stopResult).status, 'confirmed');
  assert.equal((await clearPanicResult).status, 'confirmed');
  assert.equal(stopExecutions, 1);
  assert.equal(manager.getState().safety.panicActive, false);
  bus.stop();
});

test('queued critical play revalidates panic immediately before execution', async () => {
  const { bus, manager } = createBus();
  let releaseBlocker;
  const blockerPromise = new Promise((resolve) => { releaseBlocker = resolve; });
  const blocker = bus.registerCommand('panic-blocker', 'save_lyrics', {}, 'test');
  const blockerResult = settled(bus, blocker.commandId);
  bus.dispatch(blocker, () => blockerPromise);

  let playExecutions = 0;
  let playSettlements = 0;
  bus.on('command_settled', (command) => {
    if (command.commandId === 'play-after-panic') playSettlements++;
  });
  const play = bus.registerCommand('play-after-panic', 'play', {}, 'test');
  const playResult = settled(bus, play.commandId);
  bus.dispatch(play, () => {
    playExecutions++;
    throw new Error('the queued play effect must not run');
  });

  const panic = bus.registerCommand('panic-during-blocker', 'set_panic', { active: true }, 'test');
  const panicResult = settled(bus, panic.commandId);
  bus.dispatch(panic, () => manager.setPanic(true));
  assert.equal((await panicResult).status, 'confirmed');

  releaseBlocker();
  assert.equal((await blockerResult).status, 'confirmed');
  const playSettled = await playResult;

  assert.equal(playSettled.status, 'failed');
  assert.equal(playSettled.reason, 'panic_active');
  assert.equal(playExecutions, 0);
  assert.equal(playSettlements, 1);
  await waitFor(() => bus.getQueueLength() === 0);
  assert.equal(bus.getQueueLength(), 0);
  bus.stop();
});

test('queued critical jump revalidates the lock and lets following noncritical work continue', async () => {
  const { bus, manager } = createBus();
  let releaseBlocker;
  const blockerPromise = new Promise((resolve) => { releaseBlocker = resolve; });
  const blocker = bus.registerCommand('lock-blocker', 'save_lyrics', {}, 'test');
  const blockerResult = settled(bus, blocker.commandId);
  bus.dispatch(blocker, () => blockerPromise);

  let jumpExecutions = 0;
  let jumpSettlements = 0;
  const jump = bus.registerCommand('jump-after-lock', 'jump', { songIndex: 1 }, 'test');
  const jumpResult = settled(bus, jump.commandId);
  bus.on('command_settled', (command) => {
    if (command.commandId === jump.commandId) jumpSettlements++;
  });
  bus.dispatch(jump, () => {
    jumpExecutions++;
    throw new Error('the queued jump effect must not run');
  });

  let followerExecutions = 0;
  const follower = bus.registerCommand('after-locked-jump', 'save_lyrics', {}, 'test');
  const followerResult = settled(bus, follower.commandId);
  bus.dispatch(follower, () => { followerExecutions++; });

  manager.setCriticalCommandsLocked(true);
  releaseBlocker();
  assert.equal((await blockerResult).status, 'confirmed');
  const jumpSettled = await jumpResult;
  const followerSettled = await followerResult;

  assert.equal(jumpSettled.status, 'failed');
  assert.equal(jumpSettled.reason, 'critical_commands_locked');
  assert.equal(jumpExecutions, 0);
  assert.equal(jumpSettlements, 1);
  assert.equal(followerSettled.status, 'confirmed');
  assert.equal(followerExecutions, 1);
  await waitFor(() => bus.getQueueLength() === 0);
  assert.equal(bus.getQueueLength(), 0);
  bus.stop();
});

test('expired commands remain deduped while their handler is in flight and age from handler settlement', async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  const { bus } = createBus();
  bus.stop();
  let releaseHandler;
  const handlerPromise = new Promise((resolve) => { releaseHandler = resolve; });

  try {
    const command = bus.registerCommand('slow-expired', 'save_lyrics', {}, 'test');
    bus.dispatch(command, () => handlerPromise);

    now += command.timeoutMs + 1;
    bus.checkTimeouts();
    assert.equal(command.status, 'expired');

    now += 60_001;
    bus.cleanHistory();
    assert.equal(bus.isDuplicate(command.commandId), true);

    releaseHandler();
    await new Promise((resolve) => setImmediate(resolve));

    now += 59_999;
    bus.cleanHistory();
    assert.equal(bus.isDuplicate(command.commandId), true);

    now += 2;
    bus.cleanHistory();
    assert.equal(bus.isDuplicate(command.commandId), false);
  } finally {
    releaseHandler?.();
    bus.stop();
    Date.now = originalNow;
  }
});

test('a late handler settlement cannot settle a newer command with the same ID', async () => {
  const { bus } = createBus();
  let releaseOld;
  const oldHandler = new Promise((resolve) => { releaseOld = resolve; });
  const oldCommand = bus.registerCommand('reused-id', 'save_lyrics', {}, 'old-client');
  bus.dispatch(oldCommand, () => oldHandler);

  let releaseNew;
  let newExecutions = 0;
  const newHandler = new Promise((resolve) => { releaseNew = resolve; });
  const newCommand = bus.registerCommand('reused-id', 'save_lyrics', {}, 'new-client');
  bus.dispatch(newCommand, () => {
    newExecutions++;
    return newHandler;
  });

  releaseOld();
  await waitFor(() => newExecutions === 1);
  assert.equal(newCommand.status, 'sent');

  releaseNew();
  await waitFor(() => newCommand.status === 'confirmed');
  assert.equal(newCommand.status, 'confirmed');
  bus.stop();
});

for (const terminalStatus of ['expired', 'cancelled']) {
  test(`${terminalStatus} commands never execute when dequeued`, async () => {
    const { bus } = createBus();
    let releaseBlocker;
    const blockerPromise = new Promise((resolve) => { releaseBlocker = resolve; });
    const blocker = bus.registerCommand(`blocker-${terminalStatus}`, 'save_lyrics', {}, 'test');
    const blockerResult = settled(bus, blocker.commandId);
    bus.dispatch(blocker, () => blockerPromise);

    let executed = false;
    const skipped = bus.registerCommand(`skipped-${terminalStatus}`, 'save_lyrics', {}, 'test');
    bus.dispatch(skipped, () => { executed = true; });
    bus.updateStatus(skipped.commandId, terminalStatus, terminalStatus === 'expired' ? 'timeout' : undefined);

    releaseBlocker();
    await blockerResult;
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(skipped.status, terminalStatus);
    assert.equal(executed, false);
    bus.stop();
  });
}

test('timeouts expire once without emitting retry_required', async () => {
  const { bus, events } = createBus();
  const retries = [];
  bus.on('retry_required', (command) => retries.push(command));
  const command = bus.registerCommand('no-retry', 'metronome', { value: true }, 'test');
  command.createdAt -= command.timeoutMs + 1;
  const result = settled(bus, command.commandId);

  bus.dispatch(command, () => undefined);
  bus.checkTimeouts();
  const settledCommand = await result;

  assert.equal(settledCommand.status, 'expired');
  assert.equal(settledCommand.reason, 'timeout');
  assert.deepEqual(retries, []);
  assert.equal(events.some((event) => event.type === 'command_retry' || event.result === 'retry_required'), false);
  bus.stop();
});
