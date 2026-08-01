// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Tests for Task 6.4: Profile Types & Barrel Exports in RC Setlist

import test from "node:test";
import assert from "node:assert/strict";

test("src/core/profile-types.ts exports cleanly", async () => {
  const typesModule = await import("../src/core/profile-types.ts");
  assert.ok(typesModule, "profile-types module must exist and be importable");
});

test("src/core/index.ts proxy barrel re-exports core managers", async () => {
  const coreModule = await import("../src/core/index.ts");
  assert.ok(coreModule.ProfileManager, "ProfileManager must be re-exported by core/index.ts");
  assert.ok(coreModule.SetlistManager, "SetlistManager must be re-exported by core/index.ts");
  assert.ok(coreModule.CommandBus, "CommandBus must be re-exported by core/index.ts");
});
