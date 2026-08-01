// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Profile migration module extracted for clean decomposition (Task 6.4)

import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export interface LegacyMigrationOptions {
  profilesRoot: string;
  storageRoot: string;
}

export async function copyIfMissing(source: string, destination: string): Promise<void> {
  try {
    await fs.access(destination);
    return;
  } catch {}
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

export async function copyLyricsDirectory(sourceDir: string, destinationDir: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await fs.mkdir(destinationDir, { recursive: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && /\.(lrc|txt)$/i.test(entry.name)) {
      await copyIfMissing(path.join(sourceDir, entry.name), path.join(destinationDir, entry.name));
    }
  }
}
