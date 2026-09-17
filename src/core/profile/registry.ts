// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Profile registry state & index operations (Task 6.4)

import type { ProfileSummary, DeletedProfileSummary } from './types.js';

export interface ProfileRegistryData {
  schemaVersion: 2;
  activeProfileId: string;
  profiles: ProfileSummary[];
  deletedProfiles: DeletedProfileSummary[];
  legacySources: Record<string, string>;
  migrationVersion: number;
}

/**
 * Creates the initial registry.
 */
export function createInitialRegistry(
  defaultId: string,
  defaultName: string,
  nowIso: string,
): ProfileRegistryData {
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
