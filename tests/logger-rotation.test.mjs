// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Tests for Task 4.1: Asynchronous, Rotated, Deduplicated & Redacted EventLogger in RC Setlist

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { EventLogger } from "../src/core/event-log.ts";

test("EventLogger rotates files when exceeding 10 MB limit", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rc-setlist-logger-test-"));
  try {
    const logger = new EventLogger(tmpDir, { maxSizeBytes: 1024 * 1024 }); // 1MB for fast test

    // Write enough payload to trigger rotation
    const largeMessage = "A".repeat(100_000);
    for (let i = 0; i < 15; i++) {
      logger.log({ type: "TEST", message: `${largeMessage}-${i}` });
    }
    await logger.flush();

    const files = await fs.readdir(tmpDir);
    const rotatedFiles = files.filter((f) => f.startsWith("events.log"));
    assert.ok(rotatedFiles.length > 1, `should have created rotated log files, found: ${rotatedFiles.join(", ")}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("EventLogger deduplicates identical entries within window", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rc-setlist-logger-dedup-"));
  try {
    const logger = new EventLogger(tmpDir, { dedupWindowMs: 5000 });

    for (let i = 0; i < 10; i++) {
      logger.log({ type: "REPEAT_ERROR", message: "Same failure occurred" });
    }
    await logger.flush();

    const content = await fs.readFile(logger.getLogPath(), "utf8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Should have compressed 10 identical logs into fewer lines (e.g., 1 line with repeat_count or initial log)
    assert.ok(lines.length < 10, `expected deduplication, but got ${lines.length} lines`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("EventLogger redacts sensitive fields like token and password", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rc-setlist-logger-redact-"));
  try {
    const logger = new EventLogger(tmpDir);

    logger.log({
      type: "AUTH",
      message: "Connected with token=secretToken123&password=mySuperSecretPassword",
    });
    await logger.flush();

    const content = await fs.readFile(logger.getLogPath(), "utf8");
    assert.ok(!content.includes("secretToken123"), "token value must be redacted");
    assert.ok(!content.includes("mySuperSecretPassword"), "password value must be redacted");
    assert.ok(content.includes("[REDACTED]"), "redact placeholder must be present");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
