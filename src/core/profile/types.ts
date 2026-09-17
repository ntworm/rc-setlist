// Shared types used by the profile helpers (storage, trash, registry),
// the manager and the migration code. Lives here so that those files do not
// have to import from `profile-manager.ts` to reach them — which kept three
// circular imports in the dependency graph until 1.0.

export type ProfileErrorCode =
  'invalid_profile' | 'duplicate_profile_name' | 'profile_io_error' | 'future_schema';

/**
 * Manages the lifecycle and public surface of ProfileError.
 */
export class ProfileError extends Error {
  constructor(
    public readonly code: ProfileErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProfileError';
  }
}

export interface ProfileSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeletedProfileSummary extends ProfileSummary {
  deletedAt: string;
}

export interface ProfilePaths {
  root: string;
  metadata: string;
  lyrics: string;
  customOrder: string;
  /** Song identities and the side data keyed to them. See song-book.ts. */
  songBook: string;
  exports: string;
  audio: string;
}

/**
 * Minimal surface of `ProfileManager` that `profile-migration.ts` relies on.
 * Defined here (rather than imported from `profile-manager.ts`) so the
 * migration module never has to depend on the manager and the cycle stays
 * broken. `ProfileManager` is a structural subtype of this interface.
 */
export interface ProfileManager {
  ensureDefaultProfile(): Promise<{ id: string }>;
  getPaths(id: string): ProfilePaths;
  hasLegacySource(source: string): boolean;
  recordLegacySource(source: string, profileId: string): Promise<void>;
  setMigrationVersion(version: number): Promise<void>;
  importLegacyProfile(
    source: string,
    projectName: string,
    populate: (paths: ProfilePaths) => Promise<void>,
  ): Promise<ProfileSummary>;
}
