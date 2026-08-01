// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Profile storage primitives for Setlist (Task 6.4)

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ProfileError } from "../profile-manager.js";

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tempPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const backupPath = `${filePath}.bak`;
  const jsonStr = JSON.stringify(value, null, 2) + "\n";

  try {
    await fs.writeFile(tempPath, jsonStr, "utf-8");
    try {
      await fs.copyFile(filePath, backupPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await fs.rename(tempPath, filePath);
  } catch (err) {
    try {
      await fs.unlink(tempPath);
    } catch {}
    throw new ProfileError("profile_io_error", `Failed to atomically write ${filePath}`, { cause: err });
  }
}
