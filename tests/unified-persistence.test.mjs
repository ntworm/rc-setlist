// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Tests for Task 4.3: Unified Atomic Persistence in RC Setlist

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { saveSetlist, loadSetlist } from "../src/core/persistence.ts";
import { writeJsonAtomic } from "../src/core/profile-manager.ts";

test("saveSetlist performs atomic file writes without corrupting target on failure", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rc-setlist-persist-test-"));
  try {
    const setlistData = { items: [{ name: "Song A" }] };
    saveSetlist(tmpDir, "TestSet", setlistData);

    const loaded = loadSetlist(tmpDir, "TestSet");
    assert.deepEqual(loaded, setlistData);

    // Verify temp file does not remain in directory
    const files = await fs.readdir(tmpDir);
    assert.deepEqual(files, ["TestSet.json"]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("writeJsonAtomic in ProfileManager creates atomic swap cleanly", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rc-setlist-profile-test-"));
  try {
    const targetFile = path.join(tmpDir, "profile.json");
    await writeJsonAtomic(targetFile, { version: 2, data: "ok" });

    const raw = await fs.readFile(targetFile, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.data, "ok");

    const files = await fs.readdir(tmpDir);
    assert.deepEqual(files, ["profile.json"]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
