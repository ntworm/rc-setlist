// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Tests for Task 4.2: Command Bus Queue Bounds & WS Broadcast Backpressure in RC Setlist

import test from "node:test";
import assert from "node:assert/strict";
import { CommandBus } from "../src/core/command-bus.ts";
import { SetlistWSServer } from "../src/server/ws.ts";

test("CommandBus rejects item 101 without losing the existing 100 queued items", () => {
  const dummyManager = {
    getState: () => ({ safety: { panicActive: false, criticalCommandsLocked: false } }),
    updateState: () => {},
    setPendingCommands: () => {},
  };
  const dummyLogger = { log: () => {} };
  const bus = new CommandBus(dummyManager, dummyLogger);

  try {
    // Fill queue to 100 capacity (handlers don't resolve immediately to hold queue)
    for (let i = 0; i < 100; i++) {
      const cmd = bus.registerCommand(`cmd-${i}`, "test_cmd", {}, "client1");
      bus.dispatch(cmd, () => new Promise(() => {}));
    }

    assert.equal(bus.getQueueLength(), 100);

    // 101st command should throw capacity error
    const overflowCmd = bus.registerCommand("cmd-overflow", "test_cmd", {}, "client1");

    assert.throws(
      () => bus.dispatch(overflowCmd, () => {}),
      /capacity/i,
      "should reject command when queue exceeds 100 items"
    );
    assert.equal(overflowCmd.status, 'failed');
    assert.equal(bus.getQueueLength(), 100);
    assert.equal(bus.getPending().length, 100);
  } finally {
    bus.stop();
  }
});

test("SetlistWSServer applies backpressure thresholds on broadcast", () => {
  const server = new SetlistWSServer();

  let terminated = false;

  const mockClientSlow = {
    readyState: 1, // OPEN
    bufferedAmount: 600 * 1024, // 600 KB > 512 KB
    send: () => {},
    terminate: () => { terminated = true; },
    close: () => { terminated = true; },
  };

  const mockClientStuck = {
    readyState: 1,
    bufferedAmount: 3 * 1024 * 1024, // 3 MB > 2 MB
    send: () => {},
    terminate: () => { terminated = true; },
    close: () => { terminated = true; },
  };

  // Manually add mock clients
  server["clients"].add(mockClientSlow);
  server["clients"].add(mockClientStuck);

  // Broadcast state update
  server.broadcastState({ setlist: [], activeIndex: 0 });

  assert.ok(terminated, "stuck client (>2MB) must be terminated");
});
