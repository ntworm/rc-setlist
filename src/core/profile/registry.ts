// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Profile registry state & index operations (Task 6.4)

import { ProfileSummary, DeletedProfileSummary } from "../profile-manager.js";

export interface ProfileRegistryData {
  schemaVersion: 2;
  activeProfileId: string;
  profiles: ProfileSummary[];
  deletedProfiles: DeletedProfileSummary[];
  legacySources: Record<string, string>;
  migrationVersion: number;
}

export function createInitialRegistry(defaultId: string, defaultName: string, nowIso: string): ProfileRegistryData {
  return {
    schemaVersion: 2,
    activeProfileId: defaultId,
    profiles: [
      {
        id: defaultId,
        name: defaultName,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    deletedProfiles: [],
    legacySources: {},
    migrationVersion: 1,
  };
}

export function validateRegistryData(data: unknown): data is ProfileRegistryData {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, any>;
  return (
    obj.schemaVersion === 2 &&
    typeof obj.activeProfileId === "string" &&
    Array.isArray(obj.profiles)
  );
}
