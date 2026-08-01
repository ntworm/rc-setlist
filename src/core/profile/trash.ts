// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Profile trash & soft delete helpers (Task 6.4)

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DeletedProfileSummary, ProfileError } from "../profile-manager.js";

export async function moveToTrash(
  profileId: string,
  profilesRoot: string,
  trashRoot: string,
  deletedAt: string
): Promise<DeletedProfileSummary> {
  const profileDir = path.join(profilesRoot, profileId);
  const trashDir = path.join(trashRoot, profileId);

  await fs.mkdir(trashRoot, { recursive: true });

  try {
    await fs.rename(profileDir, trashDir);
  } catch (err) {
    throw new ProfileError("profile_io_error", `Failed to move profile ${profileId} to trash`, { cause: err });
  }

  const metaPath = path.join(trashDir, "metadata.json");
  let name = profileId;
  let createdAt = deletedAt;
  let updatedAt = deletedAt;

  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw);
    if (meta.name) name = meta.name;
    if (meta.createdAt) createdAt = meta.createdAt;
    if (meta.updatedAt) updatedAt = meta.updatedAt;
  } catch {}

  return {
    id: profileId,
    name,
    createdAt,
    updatedAt,
    deletedAt,
  };
}
