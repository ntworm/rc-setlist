import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const DEFAULT_PROFILE_NAME = 'Main Setlist';
const LEGACY_DEFAULT_PROFILE_NAME = 'Setlist Principal';

export type ProfileErrorCode =
  | 'invalid_profile'
  | 'duplicate_profile_name'
  | 'profile_io_error'
  | 'future_schema';

export class ProfileError extends Error {
  constructor(public readonly code: ProfileErrorCode, message: string, options?: ErrorOptions) {
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

interface ProfileMetadata extends ProfileSummary {
  legacySource?: string;
}

interface ProfileRegistry {
  schemaVersion: 2;
  activeProfileId: string;
  profiles: ProfileSummary[];
  deletedProfiles: DeletedProfileSummary[];
  legacySources: Record<string, string>;
  migrationVersion: number;
}

interface ParsedRegistry {
  registry: ProfileRegistry;
  upgraded: boolean;
}

export interface ProfilePaths {
  root: string;
  metadata: string;
  lyrics: string;
  customOrder: string;
  exports: string;
  audio: string;
}

export interface ProfileManagerOptions {
  randomUUID?: () => string;
  now?: () => string;
  writeJsonAtomic?: (filePath: string, value: unknown) => Promise<void>;
}

export interface ProfileManagerInitializeOptions {
  migrateLegacy?: boolean;
}

export function normalizeProfileName(input: unknown): string {
  if (typeof input !== 'string') throw new ProfileError('invalid_profile', 'Profile name must be text.');
  const normalized = input.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 80 || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
    throw new ProfileError('invalid_profile', 'Profile name must contain 1 to 80 characters without control characters.');
  }
  return normalized;
}

export function profileNameKey(name: string): string {
  return normalizeProfileName(name).toLocaleLowerCase('und');
}

export function isValidUUID(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export function isValidISODate(date: unknown): date is string {
  if (typeof date !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/i.test(date)) return false;
  const parsed = Date.parse(date);
  return !isNaN(parsed);
}

export function safeRandomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = `${filePath}.${safeRandomUUID()}.tmp`;
  const backupPath = `${filePath}.bak`;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  let hadTarget = false;
  try {
    await fs.copyFile(filePath, backupPath);
    hadTarget = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    if (hadTarget) await fs.rm(filePath);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    if (hadTarget) await fs.copyFile(backupPath, filePath).catch(() => undefined);
    throw error;
  }
}

function validateProfileEntries(input: unknown, deleted: false): ProfileSummary[];
function validateProfileEntries(input: unknown, deleted: true): DeletedProfileSummary[];
function validateProfileEntries(input: unknown, deleted: boolean): Array<ProfileSummary | DeletedProfileSummary> {
  if (!Array.isArray(input)) throw new Error('Invalid profiles array');
  const profiles: ProfileSummary[] = [];
  const nameKeys = new Set<string>();

  for (const p of input) {
    if (
      !p || typeof p !== 'object' ||
      typeof p.id !== 'string' || !isValidUUID(p.id) ||
      typeof p.name !== 'string' ||
      typeof p.createdAt !== 'string' || !isValidISODate(p.createdAt) ||
      typeof p.updatedAt !== 'string' || !isValidISODate(p.updatedAt) ||
      (deleted && (typeof p.deletedAt !== 'string' || !isValidISODate(p.deletedAt)))
    ) {
      throw new Error('Invalid profile entry');
    }
    const normalized = normalizeProfileName(p.name);
    if (!deleted) {
      const key = profileNameKey(normalized);
      if (nameKeys.has(key)) {
        throw new Error(`Duplicate profile name: ${normalized}`);
      }
      nameKeys.add(key);
    }

    const profile: ProfileSummary | DeletedProfileSummary = {
      id: p.id,
      name: normalized,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    };
    if (deleted) {
      (profile as DeletedProfileSummary).deletedAt = p.deletedAt;
    }
    profiles.push(profile);
  }
  return profiles;
}

function validateRegistry(parsed: Record<string, unknown>): ParsedRegistry {
  if (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) {
    throw new Error('Invalid schema version');
  }
  const profiles = validateProfileEntries(parsed.profiles, false);
  const deletedProfiles = parsed.schemaVersion === 2
    ? validateProfileEntries(parsed.deletedProfiles, true)
    : [];
  const allIds = new Set<string>();
  for (const profile of [...profiles, ...deletedProfiles]) {
    if (allIds.has(profile.id)) throw new Error(`Duplicate profile ID: ${profile.id}`);
    allIds.add(profile.id);
  }

  const legacySources: Record<string, string> = {};
  if (parsed.legacySources && typeof parsed.legacySources === 'object') {
    for (const [key, value] of Object.entries(parsed.legacySources)) {
      if (typeof key === 'string' && key.trim().length > 0 && typeof value === 'string' && isValidUUID(value)) {
        if (allIds.has(value)) {
          legacySources[key] = value;
        }
      }
    }
  }

  const migrationVersion = typeof parsed.migrationVersion === 'number' ? parsed.migrationVersion : 0;
  const activeProfileId = typeof parsed.activeProfileId === 'string' ? parsed.activeProfileId : '';

  return {
    registry: {
      schemaVersion: 2,
      activeProfileId,
      profiles,
      deletedProfiles,
      legacySources,
      migrationVersion
    },
    upgraded: parsed.schemaVersion === 1
  };
}

export class ProfileManager {
  private readonly storageRoot: string;
  private readonly profilesRoot: string;
  private readonly trashRoot: string;
  private readonly indexPath: string;
  private readonly randomUUID: () => string;
  private readonly now: () => string;
  private readonly atomicWrite: (filePath: string, value: unknown) => Promise<void>;
  private registry: ProfileRegistry | null = null;

  constructor(storageRoot: string, options: ProfileManagerOptions = {}) {
    this.storageRoot = path.resolve(storageRoot);
    this.profilesRoot = path.resolve(this.storageRoot, 'profiles');
    this.trashRoot = path.resolve(this.profilesRoot, '.trash');
    this.indexPath = path.resolve(this.profilesRoot, 'index.json');
    this.randomUUID = options.randomUUID ?? safeRandomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
    this.atomicWrite = options.writeJsonAtomic ?? writeJsonAtomic;
  }

  private requireRegistry(): ProfileRegistry {
    if (!this.registry) {
      throw new ProfileError('profile_io_error', 'Profile manager is not initialized.');
    }
    return this.registry;
  }

  public list(): ProfileSummary[] {
    return this.requireRegistry().profiles.map((profile) => ({ ...profile }));
  }

  public listDeleted(): DeletedProfileSummary[] {
    return this.requireRegistry().deletedProfiles.map((profile) => ({ ...profile }));
  }

  public getActive(): ProfileSummary {
    const registry = this.requireRegistry();
    const profile = registry.profiles.find((candidate) => candidate.id === registry.activeProfileId);
    if (!profile) throw new ProfileError('invalid_profile', 'The active profile is not registered.');
    return { ...profile };
  }

  public getPaths(id: string): ProfilePaths {
    if (!isValidUUID(id)) {
      throw new ProfileError('invalid_profile', 'Invalid profile ID format.');
    }
    const profile = this.requireRegistry().profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new ProfileError('invalid_profile', 'The requested profile does not exist.');

    return this.buildPaths(this.profilesRoot, profile.id);
  }

  private buildPaths(parentRoot: string, id: string): ProfilePaths {
    if (!isValidUUID(id)) {
      throw new ProfileError('invalid_profile', 'Invalid profile ID format.');
    }
    const root = path.resolve(parentRoot, id);
    const metadata = path.resolve(root, 'profile.json');
    const lyrics = path.resolve(root, 'lyrics');
    const customOrder = path.resolve(root, 'custom-order.json');
    const exports = path.resolve(root, 'exports');
    const audio = path.resolve(root, 'audio');

    const parentRootWithSlash = parentRoot.endsWith(path.sep) ? parentRoot : parentRoot + path.sep;
    if (!root.startsWith(parentRootWithSlash)) {
      throw new ProfileError('profile_io_error', 'Path traversal detected in profile root.');
    }

    const rootWithSlash = root.endsWith(path.sep) ? root : root + path.sep;
    for (const p of [metadata, lyrics, customOrder, exports, audio]) {
      if (!p.startsWith(rootWithSlash)) {
        throw new ProfileError('profile_io_error', 'Path traversal detected in profile subpaths.');
      }
    }

    return { root, metadata, lyrics, customOrder, exports, audio };
  }

  public getActivePaths(): ProfilePaths {
    return this.getPaths(this.getActive().id);
  }

  public hasName(name: string): boolean {
    const key = profileNameKey(name);
    return this.requireRegistry().profiles.some((p) => profileNameKey(p.name) === key);
  }

  private async parseRegistry(filePath: string): Promise<ParsedRegistry> {
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    if (typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > 2) {
      throw new ProfileError('future_schema', `Profile schema ${parsed.schemaVersion} is newer than supported schema 2.`);
    }
    return validateRegistry(parsed);
  }

  private async commitRegistry(next: ProfileRegistry): Promise<void> {
    try {
      await this.atomicWrite(this.indexPath, next);
      this.registry = {
        ...next,
        profiles: next.profiles.map((profile) => ({ ...profile })),
        deletedProfiles: next.deletedProfiles.map((profile) => ({ ...profile })),
        legacySources: { ...next.legacySources }
      };
    } catch (cause) {
      throw cause instanceof ProfileError
        ? cause
        : new ProfileError('profile_io_error', 'Could not persist the profile registry.', { cause });
    }
  }

  private async loadAndValidateMetadataAt(paths: ProfilePaths, profile: ProfileSummary): Promise<ProfileMetadata> {
    const { id } = profile;
    const filesToTry = [paths.metadata, `${paths.metadata}.bak`];
    let lastError: Error | null = null;

    for (const filePath of filesToTry) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(content);
        if (
          parsed.id !== id ||
          typeof parsed.name !== 'string' ||
          normalizeProfileName(parsed.name) !== profile.name ||
          typeof parsed.createdAt !== 'string' ||
          !isValidISODate(parsed.createdAt) ||
          parsed.createdAt !== profile.createdAt ||
          typeof parsed.updatedAt !== 'string' ||
          !isValidISODate(parsed.updatedAt)
        ) {
          throw new Error('Mismatched or invalid metadata values.');
        }
        return parsed as ProfileMetadata;
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw new ProfileError('profile_io_error', `Failed to load or validate profile metadata for profile ID ${id}.`, {
      cause: lastError || new Error('No metadata file found.')
    });
  }

  private async loadAndValidateMetadata(id: string): Promise<ProfileMetadata> {
    const registry = this.requireRegistry();
    const profile = registry.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new ProfileError('invalid_profile', 'Profile does not exist.');
    return this.loadAndValidateMetadataAt(this.getPaths(id), profile);
  }

  public async create(name: string): Promise<ProfileSummary> {
    const normalizedName = normalizeProfileName(name);
    if (this.hasName(normalizedName)) {
      throw new ProfileError('duplicate_profile_name', `A profile named "${normalizedName}" already exists.`);
    }

    const id = this.randomUUID();
    const timestamp = this.now();
    const newProfile: ProfileSummary = {
      id,
      name: normalizedName,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const paths = {
      root: path.join(this.profilesRoot, id),
      metadata: path.join(this.profilesRoot, id, 'profile.json'),
      lyrics: path.join(this.profilesRoot, id, 'lyrics'),
      exports: path.join(this.profilesRoot, id, 'exports'),
      audio: path.join(this.profilesRoot, id, 'audio')
    };

    let dirCreated = false;
    try {
      await fs.mkdir(paths.lyrics, { recursive: true });
      await fs.mkdir(paths.exports, { recursive: true });
      await fs.mkdir(paths.audio, { recursive: true });
      dirCreated = true;

      const metadata: ProfileMetadata = { ...newProfile };
      await this.atomicWrite(paths.metadata, metadata);

      const nextRegistry: ProfileRegistry = {
        ...this.requireRegistry(),
        profiles: [...this.requireRegistry().profiles, newProfile]
      };

      await this.commitRegistry(nextRegistry);
    } catch (err) {
      if (dirCreated) {
        await fs.rm(paths.root, { recursive: true, force: true }).catch(() => undefined);
      }
      throw err instanceof ProfileError
        ? err
        : new ProfileError('profile_io_error', 'Failed to create profile.', { cause: err });
    }

    return newProfile;
  }

  public async rename(id: string, name: string): Promise<ProfileSummary> {
    const registry = this.requireRegistry();
    const profileIndex = registry.profiles.findIndex((p) => p.id === id);
    if (profileIndex === -1) {
      throw new ProfileError('invalid_profile', 'The profile to rename does not exist.');
    }

    const normalizedName = normalizeProfileName(name);
    const existing = registry.profiles[profileIndex]!;
    if (profileNameKey(existing.name) !== profileNameKey(normalizedName)) {
      if (this.hasName(normalizedName)) {
        throw new ProfileError('duplicate_profile_name', `A profile named "${normalizedName}" already exists.`);
      }
    }

    const oldMeta = await this.loadAndValidateMetadata(id);

    const timestamp = this.now();
    const updatedProfile: ProfileSummary = {
      ...existing,
      name: normalizedName,
      updatedAt: timestamp
    };

    const paths = this.getPaths(id);
    const newMetadata: ProfileMetadata = {
      ...updatedProfile
    };
    if (oldMeta.legacySource !== undefined) {
      newMetadata.legacySource = oldMeta.legacySource;
    }

    try {
      await this.atomicWrite(paths.metadata, newMetadata);
    } catch (err) {
      throw err instanceof ProfileError
        ? err
        : new ProfileError('profile_io_error', 'Failed to write rename metadata.', { cause: err });
    }

    const nextProfiles = [...registry.profiles];
    nextProfiles[profileIndex] = updatedProfile;
    const nextRegistry: ProfileRegistry = {
      ...registry,
      profiles: nextProfiles
    };

    try {
      await this.commitRegistry(nextRegistry);
    } catch (err) {
      try {
        await this.atomicWrite(paths.metadata, oldMeta);
      } catch (rollbackErr) {
        throw new ProfileError('profile_io_error', 'Failed to rename profile and failed to rollback metadata.', {
          cause: new AggregateError([err, rollbackErr], 'Rename commit and rollback both failed.')
        });
      }
      throw err instanceof ProfileError
        ? err
        : new ProfileError('profile_io_error', 'Failed to rename profile.', { cause: err });
    }

    return updatedProfile;
  }

  public async select(id: string): Promise<ProfileSummary> {
    const registry = this.requireRegistry();
    const profile = registry.profiles.find((p) => p.id === id);
    if (!profile) {
      throw new ProfileError('invalid_profile', 'The requested profile does not exist.');
    }

    try {
      await this.loadAndValidateMetadata(id);
    } catch (err) {
      throw new ProfileError('profile_io_error', `Could not access or validate profile metadata for "${profile.name}".`, { cause: err });
    }

    const nextRegistry: ProfileRegistry = {
      ...registry,
      activeProfileId: id
    };

    await this.commitRegistry(nextRegistry);
    return profile;
  }

  public async remove(id: string, confirmationName: string): Promise<DeletedProfileSummary> {
    if (!isValidUUID(id)) {
      throw new ProfileError('invalid_profile', 'Invalid profile ID format.');
    }
    const registry = this.requireRegistry();
    const profile = registry.profiles.find((candidate) => candidate.id === id);
    if (!profile) {
      throw new ProfileError('invalid_profile', 'The profile to remove does not exist.');
    }
    if (registry.profiles.length <= 1) {
      throw new ProfileError('invalid_profile', 'The only profile cannot be removed.');
    }
    if (registry.activeProfileId === id) {
      throw new ProfileError('invalid_profile', 'The active profile cannot be removed.');
    }
    if (normalizeProfileName(confirmationName) !== profile.name) {
      throw new ProfileError('invalid_profile', 'The profile name confirmation does not match exactly.');
    }

    const sourcePaths = this.getPaths(id);
    const trashPaths = this.buildPaths(this.trashRoot, id);
    await this.loadAndValidateMetadataAt(sourcePaths, profile);
    await fs.mkdir(this.trashRoot, { recursive: true });
    try {
      await fs.access(trashPaths.root);
      throw new ProfileError('profile_io_error', 'A recoverable profile with this ID already exists.');
    } catch (error) {
      if (error instanceof ProfileError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new ProfileError('profile_io_error', 'Could not inspect the recoverable profile location.', { cause: error });
      }
    }

    const deletedProfile: DeletedProfileSummary = {
      ...profile,
      deletedAt: this.now()
    };
    const nextRegistry: ProfileRegistry = {
      ...registry,
      profiles: registry.profiles.filter((candidate) => candidate.id !== id),
      deletedProfiles: [...registry.deletedProfiles, deletedProfile]
    };

    try {
      await fs.rename(sourcePaths.root, trashPaths.root);
    } catch (cause) {
      throw new ProfileError('profile_io_error', `Could not move "${profile.name}" to recoverable trash.`, { cause });
    }

    try {
      await this.commitRegistry(nextRegistry);
    } catch (commitError) {
      try {
        await fs.rename(trashPaths.root, sourcePaths.root);
      } catch (rollbackError) {
        throw new ProfileError('profile_io_error', 'Profile removal failed and the directory move could not be rolled back.', {
          cause: new AggregateError([commitError, rollbackError], 'Remove commit and rollback both failed.')
        });
      }
      throw commitError;
    }

    return { ...deletedProfile };
  }

  public async restore(id: string): Promise<ProfileSummary> {
    if (!isValidUUID(id)) {
      throw new ProfileError('invalid_profile', 'Invalid profile ID format.');
    }
    const registry = this.requireRegistry();
    const deletedProfile = registry.deletedProfiles.find((candidate) => candidate.id === id);
    if (!deletedProfile) {
      throw new ProfileError('invalid_profile', 'The recoverable profile does not exist.');
    }
    if (this.hasName(deletedProfile.name)) {
      throw new ProfileError('duplicate_profile_name', `A profile named "${deletedProfile.name}" already exists.`);
    }

    const trashPaths = this.buildPaths(this.trashRoot, id);
    const restoredPaths = this.buildPaths(this.profilesRoot, id);
    await this.loadAndValidateMetadataAt(trashPaths, deletedProfile);
    try {
      await fs.access(restoredPaths.root);
      throw new ProfileError('profile_io_error', 'An active profile directory with this ID already exists.');
    } catch (error) {
      if (error instanceof ProfileError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new ProfileError('profile_io_error', 'Could not inspect the active profile location.', { cause: error });
      }
    }

    const restoredProfile: ProfileSummary = {
      id: deletedProfile.id,
      name: deletedProfile.name,
      createdAt: deletedProfile.createdAt,
      updatedAt: deletedProfile.updatedAt
    };
    const nextRegistry: ProfileRegistry = {
      ...registry,
      profiles: [...registry.profiles, restoredProfile],
      deletedProfiles: registry.deletedProfiles.filter((candidate) => candidate.id !== id)
    };

    try {
      await fs.rename(trashPaths.root, restoredPaths.root);
    } catch (cause) {
      throw new ProfileError('profile_io_error', `Could not restore "${deletedProfile.name}" from recoverable trash.`, { cause });
    }

    try {
      await this.commitRegistry(nextRegistry);
    } catch (commitError) {
      try {
        await fs.rename(restoredPaths.root, trashPaths.root);
      } catch (rollbackError) {
        throw new ProfileError('profile_io_error', 'Profile restore failed and the directory move could not be rolled back.', {
          cause: new AggregateError([commitError, rollbackError], 'Restore commit and rollback both failed.')
        });
      }
      throw commitError;
    }

    return { ...restoredProfile };
  }

  private async readMetadataForScan(parentRoot: string, id: string): Promise<ProfileMetadata | null> {
    const metadataPath = this.buildPaths(parentRoot, id).metadata;
    for (const candidate of [metadataPath, `${metadataPath}.bak`]) {
      try {
        const data = await fs.readFile(candidate, 'utf8');
        const parsed = JSON.parse(data);
        if (
          parsed.id === id &&
          isValidUUID(parsed.id) &&
          typeof parsed.name === 'string' &&
          isValidISODate(parsed.createdAt) &&
          isValidISODate(parsed.updatedAt)
        ) {
          return {
            id,
            name: normalizeProfileName(parsed.name),
            createdAt: parsed.createdAt,
            updatedAt: parsed.updatedAt,
            ...(typeof parsed.legacySource === 'string' ? { legacySource: parsed.legacySource } : {})
          };
        }
      } catch {
        // Try the backup after any read, parse, or validation failure.
      }
    }
    return null;
  }

  public async initialize(options: ProfileManagerInitializeOptions = {}): Promise<void> {
    await fs.mkdir(this.profilesRoot, { recursive: true });
    let loaded = false;
    let registryUpgraded = false;

    // 1. Try index.json
    try {
      const parsed = await this.parseRegistry(this.indexPath);
      this.registry = parsed.registry;
      registryUpgraded = parsed.upgraded;
      loaded = true;
    } catch (err) {
      if (err instanceof ProfileError && err.code === 'future_schema') {
        throw err;
      }
    }

    // 2. Try index.json.bak
    if (!loaded) {
      try {
        const parsed = await this.parseRegistry(`${this.indexPath}.bak`);
        this.registry = parsed.registry;
        registryUpgraded = parsed.upgraded;
        await fs.copyFile(`${this.indexPath}.bak`, this.indexPath);
        loaded = true;
      } catch (err) {
        if (err instanceof ProfileError && err.code === 'future_schema') {
          throw err;
        }
      }
    }

    if (loaded && this.registry) {
      const activeExists = this.registry.profiles.some(p => p.id === this.registry!.activeProfileId);
      if (!activeExists || !isValidUUID(this.registry.activeProfileId)) {
        if (this.registry.profiles.length > 0) {
          const sorted = [...this.registry.profiles].sort((a, b) => {
            const cmp = a.createdAt.localeCompare(b.createdAt);
            if (cmp !== 0) return cmp;
            return a.id.localeCompare(b.id);
          });
          const nextRegistry: ProfileRegistry = {
            ...this.registry,
            activeProfileId: sorted[0]!.id
          };
          await this.commitRegistry(nextRegistry);
          registryUpgraded = false;
        } else {
          loaded = false;
        }
      }
      if (loaded && registryUpgraded) {
        await this.commitRegistry(this.registry);
        registryUpgraded = false;
      }
    }

    // 3. Scan directory to rebuild
    if (!loaded) {
      try {
        const entries = await fs.readdir(this.profilesRoot, { withFileTypes: true });
        const recoveredProfiles: ProfileSummary[] = [];
        const recoveredDeletedProfiles: DeletedProfileSummary[] = [];
        const legacySources: Record<string, string> = {};

        for (const entry of entries) {
          if (entry.isDirectory() && isValidUUID(entry.name)) {
            const meta = await this.readMetadataForScan(this.profilesRoot, entry.name);

            if (meta) {
              recoveredProfiles.push({
                id: meta.id,
                name: meta.name,
                createdAt: meta.createdAt,
                updatedAt: meta.updatedAt
              });
              if (typeof meta.legacySource === 'string') {
                legacySources[meta.legacySource] = meta.id;
              }
            }
          }
        }

        try {
          const trashEntries = await fs.readdir(this.trashRoot, { withFileTypes: true });
          for (const entry of trashEntries) {
            if (!entry.isDirectory() || !isValidUUID(entry.name)) continue;
            const meta = await this.readMetadataForScan(this.trashRoot, entry.name);
            if (!meta) continue;
            const stats = await fs.stat(path.join(this.trashRoot, entry.name));
            recoveredDeletedProfiles.push({
              id: meta.id,
              name: meta.name,
              createdAt: meta.createdAt,
              updatedAt: meta.updatedAt,
              deletedAt: stats.mtime.toISOString()
            });
            if (meta.legacySource) legacySources[meta.legacySource] = meta.id;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }

        if (recoveredProfiles.length > 0) {
          recoveredProfiles.sort((a, b) => {
            const cmp = a.createdAt.localeCompare(b.createdAt);
            if (cmp !== 0) return cmp;
            return a.id.localeCompare(b.id);
          });

          const activeId = recoveredProfiles[0]!.id;
          const rebuiltRegistry: ProfileRegistry = {
            schemaVersion: 2,
            activeProfileId: activeId,
            profiles: recoveredProfiles,
            deletedProfiles: recoveredDeletedProfiles,
            legacySources,
            migrationVersion: 0
          };

          await this.atomicWrite(this.indexPath, rebuiltRegistry);
          this.registry = rebuiltRegistry;
          loaded = true;
        }
      } catch (scanErr) {
        throw scanErr instanceof ProfileError
          ? scanErr
          : new ProfileError('profile_io_error', 'Failed to rebuild profile index from directory scan.', { cause: scanErr });
      }
    }

    // 4. Default Main Setlist creation
    if (!loaded) {
      const defaultId = this.randomUUID();
      const timestamp = this.now();
      const defaultProfile: ProfileSummary = {
        id: defaultId,
        name: DEFAULT_PROFILE_NAME,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      const defaultPaths = {
        root: path.join(this.profilesRoot, defaultId),
        metadata: path.join(this.profilesRoot, defaultId, 'profile.json'),
        lyrics: path.join(this.profilesRoot, defaultId, 'lyrics'),
        exports: path.join(this.profilesRoot, defaultId, 'exports'),
        audio: path.join(this.profilesRoot, defaultId, 'audio')
      };

      let dirCreated = false;
      try {
        await fs.mkdir(defaultPaths.lyrics, { recursive: true });
        await fs.mkdir(defaultPaths.exports, { recursive: true });
        await fs.mkdir(defaultPaths.audio, { recursive: true });
        dirCreated = true;

        const profileMeta: ProfileMetadata = { ...defaultProfile };
        await this.atomicWrite(defaultPaths.metadata, profileMeta);

        const defaultRegistry: ProfileRegistry = {
          schemaVersion: 2,
          activeProfileId: defaultId,
          profiles: [defaultProfile],
          deletedProfiles: [],
          legacySources: {},
          migrationVersion: 0
        };

        await this.atomicWrite(this.indexPath, defaultRegistry);
        this.registry = defaultRegistry;
      } catch (err) {
        if (dirCreated) {
          await fs.rm(defaultPaths.root, { recursive: true, force: true }).catch(() => undefined);
        }
        throw err instanceof ProfileError
          ? err
          : new ProfileError('profile_io_error', 'Failed to create default profile.', { cause: err });
      }
    }

    // Run migration
    if (options.migrateLegacy !== false) {
      const { migrateLegacyData } = await import('./profile-migration.js');
      await migrateLegacyData(this.storageRoot, this);
    }
  }

  public hasLegacySource(source: string): boolean {
    return typeof this.requireRegistry().legacySources[source] === 'string';
  }

  public getLegacySourceProfileId(source: string): string | null {
    return this.requireRegistry().legacySources[source] ?? null;
  }

  public async recordLegacySource(source: string, profileId: string): Promise<void> {
    const registry = this.requireRegistry();
    const profileIndex = registry.profiles.findIndex((p) => p.id === profileId);
    if (profileIndex === -1) {
      throw new ProfileError('invalid_profile', 'Profile does not exist.');
    }
    const paths = this.getPaths(profileId);

    const oldMeta = await this.loadAndValidateMetadata(profileId);

    const newMetadata: ProfileMetadata = {
      ...oldMeta,
      legacySource: source
    };

    try {
      await this.atomicWrite(paths.metadata, newMetadata);
    } catch (err) {
      throw err instanceof ProfileError
        ? err
        : new ProfileError('profile_io_error', 'Failed to write legacy source metadata.', { cause: err });
    }

    const nextRegistry: ProfileRegistry = {
      ...registry,
      legacySources: {
        ...registry.legacySources,
        [source]: profileId
      }
    };

    try {
      await this.commitRegistry(nextRegistry);
    } catch (err) {
      try {
        await this.atomicWrite(paths.metadata, oldMeta);
      } catch (rollbackErr) {
        throw new ProfileError('profile_io_error', 'Failed to record legacy source and failed to rollback metadata.', {
          cause: new AggregateError([err, rollbackErr], 'Record legacy source commit and rollback both failed.')
        });
      }
      throw err instanceof ProfileError
        ? err
        : new ProfileError('profile_io_error', 'Failed to record legacy source.', { cause: err });
    }
  }

  public async ensureDefaultProfile(): Promise<ProfileSummary> {
    const registry = this.requireRegistry();
    const defaultKeys = new Set([
      profileNameKey(DEFAULT_PROFILE_NAME),
      profileNameKey(LEGACY_DEFAULT_PROFILE_NAME),
    ]);
    const existing = registry.profiles.find((profile) => defaultKeys.has(profileNameKey(profile.name)));
    if (existing) {
      return existing;
    }
    return this.create(DEFAULT_PROFILE_NAME);
  }

  public async setMigrationVersion(version: number): Promise<void> {
    const registry = this.requireRegistry();
    if (registry.migrationVersion === version) {
      return;
    }
    const nextRegistry = {
      ...registry,
      migrationVersion: version
    };
    await this.commitRegistry(nextRegistry);
  }

  private uniqueLegacyName(requested: string): string {
    const base = normalizeProfileName(requested);
    if (!this.hasName(base)) return base;
    for (let suffix = 2; ; suffix += 1) {
      const suffixStr = ` (${suffix})`;
      const truncatedBase = base.slice(0, Math.max(1, 80 - suffixStr.length));
      const candidate = `${truncatedBase}${suffixStr}`;
      if (!this.hasName(candidate)) return candidate;
    }
  }

  public async importLegacyProfile(
    source: string,
    requestedName: string,
    populate: (paths: ProfilePaths) => Promise<void>
  ): Promise<ProfileSummary> {
    const normalizedName = this.uniqueLegacyName(requestedName);
    const id = this.randomUUID();
    const timestamp = this.now();

    const profile: ProfileSummary = {
      id,
      name: normalizedName,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const stagingRoot = path.join(this.profilesRoot, `.migrating-${id}`);
    const finalRoot = path.join(this.profilesRoot, id);

    const stagingPaths: ProfilePaths = {
      root: stagingRoot,
      metadata: path.join(stagingRoot, 'profile.json'),
      lyrics: path.join(stagingRoot, 'lyrics'),
      customOrder: path.join(stagingRoot, 'custom-order.json'),
      exports: path.join(stagingRoot, 'exports'),
      audio: path.join(stagingRoot, 'audio')
    };

    let stagingCreated = false;
    let renamed = false;

    try {
      await fs.mkdir(stagingPaths.lyrics, { recursive: true });
      await fs.mkdir(stagingPaths.exports, { recursive: true });
      await fs.mkdir(stagingPaths.audio, { recursive: true });
      stagingCreated = true;

      await populate(stagingPaths);

      const metadata: ProfileMetadata = {
        ...profile,
        legacySource: source
      };
      await this.atomicWrite(stagingPaths.metadata, metadata);

      await fs.rename(stagingRoot, finalRoot);
      renamed = true;

      const nextRegistry: ProfileRegistry = {
        ...this.requireRegistry(),
        profiles: [...this.requireRegistry().profiles, profile],
        legacySources: {
          ...this.requireRegistry().legacySources,
          [source]: id
        }
      };

      await this.commitRegistry(nextRegistry);
    } catch (err) {
      if (renamed) {
        await fs.rm(finalRoot, { recursive: true, force: true }).catch(() => undefined);
      } else if (stagingCreated) {
        await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      }
      throw err instanceof ProfileError
        ? err
        : new ProfileError('profile_io_error', 'Failed to import legacy profile.', { cause: err });
    }

    return profile;
  }
}
