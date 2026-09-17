// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Profile trash & soft delete helpers (Task 6.4)

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DeletedProfileSummary } from './types.js';
import { ProfileError } from './types.js';
import { isPlainObject, parseJson } from '../../util/json.js';

/**
 * MoveToTrash — implementation detail.
 */
export async function moveToTrash(
  profileId: string,
  profilesRoot: string,
  trashRoot: string,
  deletedAt: string,
): Promise<DeletedProfileSummary> {
  const profileDir = path.join(profilesRoot, profileId);
  const trashDir = path.join(trashRoot, profileId);

  await fs.mkdir(trashRoot, { recursive: true });

  try {
    await fs.rename(profileDir, trashDir);
  } catch (err) {
    throw new ProfileError('profile_io_error', `Failed to move profile ${profileId} to trash`, {
      cause: err,
    });
  }

  const metaPath = path.join(trashDir, 'metadata.json');
  let name = profileId;
  let createdAt = deletedAt;
  let updatedAt = deletedAt;

  try {
    const raw = await fs.readFile(metaPath, 'utf-8');
    const meta = parseJson(raw, isPlainObject);
    if (meta) {
      if (typeof meta.name === 'string' && meta.name) name = meta.name;
      if (typeof meta.createdAt === 'string' && meta.createdAt) createdAt = meta.createdAt;
      if (typeof meta.updatedAt === 'string' && meta.updatedAt) updatedAt = meta.updatedAt;
    }
  } catch {
    // swallow: nothing to do here on purpose
  }

  return {
    id: profileId,
    name,
    createdAt,
    updatedAt,
    deletedAt,
  };
}
