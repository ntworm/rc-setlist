// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Tests for EventLogger secret redaction and sentinel check (Task 4.1)

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

test("EventLogger: Redacts secrets in key names (token, password, secret, key) and string values", async () => {
  const { EventLogger } = await import("../src/core/event-log.ts");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "setlist-logger-test-"));

  try {
    const logger = new EventLogger(tmpDir, { dedupWindowMs: 0 });

    const TOKEN_SENTINEL = "SECRET_TOKEN_SENTINEL_12345";
    const PASSWORD_SENTINEL = "SECRET_PASSWORD_SENTINEL_67890";

    logger.log({
      type: "auth_attempt",
      token: TOKEN_SENTINEL,
      password: PASSWORD_SENTINEL,
      nested: {
        secret: "NESTED_SECRET_999",
        query: `param=123&token=${TOKEN_SENTINEL}&other=val`,
      },
    });

    await logger.flush();

    const logFile = path.join(tmpDir, "events.log");
    assert.ok(fs.existsSync(logFile), "events.log must be created");

    const content = fs.readFileSync(logFile, "utf8");

    // SENTINELS MUST NOT APPEAR IN LOG FILE
    assert.equal(content.includes(TOKEN_SENTINEL), false, "TOKEN_SENTINEL must NOT appear in log file!");
    assert.equal(content.includes(PASSWORD_SENTINEL), false, "PASSWORD_SENTINEL must NOT appear in log file!");
    assert.equal(content.includes("NESTED_SECRET_999"), false, "NESTED_SECRET_999 must NOT appear in log file!");

    assert.ok(content.includes("[REDACTED]"), "log content must contain [REDACTED]");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
