// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Profile storage primitives for Setlist (Task 6.4)

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWriteFile } from '../../util/atomic-write.js';
import { ProfileError } from './types.js';

/**
 * Writes `value` as JSON, replacing the file atomically through `writer` and
 * keeping the previous content in `<file>.bak`. A failed write leaves the
 * previous file in place. The error message carries no path, because profile
 * errors reach the client; the path stays in `cause`.
 */
export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  writer: (targetPath: string, data: string) => Promise<void> = atomicWriteFile,
): Promise<void> {
  const backupPath = `${filePath}.bak`;
  const jsonStr = JSON.stringify(value, null, 2) + '\n';

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.copyFile(filePath, backupPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await writer(filePath, jsonStr);
  } catch (err) {
    throw new ProfileError('profile_io_error', 'Failed to atomically write a profile file', {
      cause: err,
    });
  }
}
