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

interface ProfileMetadata extends ProfileSummary {
  legacySource?: string;
}

interface ProfileRegistry {
  schemaVersion: 1;
  activeProfileId: string;
  profiles: ProfileSummary[];
  legacySources: Record<string, string>;
  migrationVersion: number;
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

function validateRegistryV1(parsed: Record<string, unknown>): ProfileRegistry {
  if (parsed.schemaVersion !== 1) {
    throw new Error('Invalid schema version');
  }
  if (!Array.isArray(parsed.profiles)) {
    throw new Error('Invalid profiles array');
  }
  const profiles: ProfileSummary[] = [];
  const nameKeys = new Set<string>();

  for (const p of parsed.profiles) {
    if (
      typeof p.id !== 'string' || !isValidUUID(p.id) ||
      typeof p.name !== 'string' ||
      typeof p.createdAt !== 'string' || !isValidISODate(p.createdAt) ||
      typeof p.updatedAt !== 'string' || !isValidISODate(p.updatedAt)
    ) {
      throw new Error('Invalid profile entry');
    }
    const normalized = normalizeProfileName(p.name);
    const key = profileNameKey(normalized);
    if (nameKeys.has(key)) {
      throw new Error(`Duplicate profile name: ${normalized}`);
    }
    nameKeys.add(key);

    profiles.push({
      id: p.id,
      name: normalized,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    });
  }

  const legacySources: Record<string, string> = {};
  if (parsed.legacySources && typeof parsed.legacySources === 'object') {
    for (const [key, value] of Object.entries(parsed.legacySources)) {
      if (typeof key === 'string' && key.trim().length > 0 && typeof value === 'string' && isValidUUID(value)) {
        if (profiles.some((p) => p.id === value)) {
          legacySources[key] = value;
        }
      }
    }
  }

  const migrationVersion = typeof parsed.migrationVersion === 'number' ? parsed.migrationVersion : 0;
  const activeProfileId = typeof parsed.activeProfileId === 'string' ? parsed.activeProfileId : '';

  return {
    schemaVersion: 1,
    activeProfileId,
    profiles,
    legacySources,
    migrationVersion
  };
}

export class ProfileManager {
  private readonly storageRoot: string;
  private readonly profilesRoot: string;
  private readonly indexPath: string;
  private readonly randomUUID: () => string;
  private readonly now: () => string;
  private readonly atomicWrite: (filePath: string, value: unknown) => Promise<void>;
  private registry: ProfileRegistry | null = null;

  constructor(storageRoot: string, options: ProfileManagerOptions = {}) {
    this.storageRoot = path.resolve(storageRoot);
    this.profilesRoot = path.resolve(this.storageRoot, 'profiles');
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

    const root = path.resolve(this.profilesRoot, profile.id);
    const metadata = path.resolve(root, 'profile.json');
    const lyrics = path.resolve(root, 'lyrics');
    const customOrder = path.resolve(root, 'custom-order.json');
    const exports = path.resolve(root, 'exports');
    const audio = path.resolve(root, 'audio');

    const profilesRootWithSlash = this.profilesRoot.endsWith(path.sep) ? this.profilesRoot : this.profilesRoot + path.sep;
    if (!root.startsWith(profilesRootWithSlash)) {
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

  private async parseRegistry(filePath: string): Promise<ProfileRegistry> {
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    if (typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > 1) {
      throw new ProfileError('future_schema', `Profile schema ${parsed.schemaVersion} is newer than supported schema 1.`);
    }
    return validateRegistryV1(parsed);
  }

  private async commitRegistry(next: ProfileRegistry): Promise<void> {
    try {
      await this.atomicWrite(this.indexPath, next);
      this.registry = {
        ...next,
        profiles: next.profiles.map((profile) => ({ ...profile })),
        legacySources: { ...next.legacySources }
      };
    } catch (cause) {
      throw cause instanceof ProfileError
        ? cause
        : new ProfileError('profile_io_error', 'Could not persist the profile registry.', { cause });
    }
  }

  private async loadAndValidateMetadata(id: string): Promise<ProfileMetadata> {
    const paths = this.getPaths(id);
    const registry = this.requireRegistry();
    const profile = registry.profiles.find((p) => p.id === id);
    if (!profile) {
      throw new ProfileError('invalid_profile', 'Profile does not exist.');
    }

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

  public async initialize(): Promise<void> {
    await fs.mkdir(this.profilesRoot, { recursive: true });
    let loaded = false;

    // 1. Try index.json
    try {
      this.registry = await this.parseRegistry(this.indexPath);
      loaded = true;
    } catch (err) {
      if (err instanceof ProfileError && err.code === 'future_schema') {
        throw err;
      }
    }

    // 2. Try index.json.bak
    if (!loaded) {
      try {
        this.registry = await this.parseRegistry(`${this.indexPath}.bak`);
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
        } else {
          loaded = false;
        }
      }
    }

    // 3. Scan directory to rebuild
    if (!loaded) {
      try {
        const entries = await fs.readdir(this.profilesRoot, { withFileTypes: true });
        const recoveredProfiles: ProfileSummary[] = [];
        const legacySources: Record<string, string> = {};

        for (const entry of entries) {
          if (entry.isDirectory() && isValidUUID(entry.name)) {
            const metaPath = path.join(this.profilesRoot, entry.name, 'profile.json');
            let meta: Record<string, unknown> | null = null;

            // Try profile.json first, then .bak on any failure (read, parse, or validation)
            for (const candidate of [metaPath, `${metaPath}.bak`]) {
              try {
                const data = await fs.readFile(candidate, 'utf8');
                const parsed = JSON.parse(data);
                if (
                  parsed.id === entry.name &&
                  isValidUUID(parsed.id) &&
                  typeof parsed.name === 'string' &&
                  isValidISODate(parsed.createdAt) &&
                  isValidISODate(parsed.updatedAt)
                ) {
                  meta = parsed;
                  break;
                }
              } catch {
                // try next candidate
              }
            }

            if (meta) {
              recoveredProfiles.push({
                id: meta.id as string,
                name: normalizeProfileName(meta.name as string),
                createdAt: meta.createdAt as string,
                updatedAt: meta.updatedAt as string
              });
              if (typeof meta.legacySource === 'string') {
                legacySources[meta.legacySource] = meta.id as string;
              }
            }
          }
        }

        if (recoveredProfiles.length > 0) {
          recoveredProfiles.sort((a, b) => {
            const cmp = a.createdAt.localeCompare(b.createdAt);
            if (cmp !== 0) return cmp;
            return a.id.localeCompare(b.id);
          });

          const activeId = recoveredProfiles[0]!.id;
          const rebuiltRegistry: ProfileRegistry = {
            schemaVersion: 1,
            activeProfileId: activeId,
            profiles: recoveredProfiles,
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
          schemaVersion: 1,
          activeProfileId: defaultId,
          profiles: [defaultProfile],
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
    const { migrateLegacyData } = await import('./profile-migration.js');
    await migrateLegacyData(this.storageRoot, this);
  }

  public hasLegacySource(source: string): boolean {
    return typeof this.requireRegistry().legacySources[source] === 'string';
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
