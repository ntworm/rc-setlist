// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Shared fixtures for the slave follow-mode unit tests.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { clearExtensionContext, setExtensionContext } from '../../src/context.ts';

/** Runs `fn` with a fresh temporary extension storage directory. */
export function withTempStorage(fn) {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'rc-follow-mode-unit-'));
  setExtensionContext({ environment: { storageDirectory: dir } });
  try {
    return fn(dir);
  } finally {
    clearExtensionContext();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
