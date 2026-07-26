import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  isValidUUID,
  normalizeProfileName,
  type ProfileManager,
  type ProfilePaths,
} from './profile-manager.js';

const GLOBAL_SOURCE = 'global';
const PREVIOUS_STORAGE_NAMES = [
  'ntworm.rc-setlist',
  'worm.ableton-setlist-bridge',
] as const;

async function copyIfMissing(source: string, destination: string): Promise<void> {
  try {
    await fs.access(destination);
    return;
  } catch {}
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function copyLyrics(sourceDir: string, destinationDir: string): Promise<void> {
  let entries;
  try { entries = await fs.readdir(sourceDir, { withFileTypes: true }); }
  catch (error) {
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

async function populateLegacy(sourceRoot: string, target: ProfilePaths): Promise<void> {
  await copyLyrics(path.join(sourceRoot, 'lyrics'), target.lyrics);
  try { await copyIfMissing(path.join(sourceRoot, 'custom-order.json'), target.customOrder); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function hasLegacyPayload(sourceRoot: string): Promise<boolean> {
  try {
    const lyrics = await fs.readdir(path.join(sourceRoot, 'lyrics'), { withFileTypes: true });
    if (lyrics.some((entry) => entry.isFile() && /\.(lrc|txt)$/i.test(entry.name))) return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    await fs.access(path.join(sourceRoot, 'custom-order.json'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
}

async function migratePreviousInstallations(storageRoot: string, manager: ProfileManager): Promise<void> {
  const resolvedRoot = path.resolve(storageRoot);
  const storageParent = path.dirname(resolvedRoot);
  const currentStorageName = path.basename(resolvedRoot).toLocaleLowerCase('en-US');

  for (const previousStorageName of PREVIOUS_STORAGE_NAMES) {
    if (previousStorageName.toLocaleLowerCase('en-US') === currentStorageName) continue;

    const previousRoot = path.join(storageParent, previousStorageName);
    const globalSource = `previous:${previousStorageName}:global`;

    if (!manager.hasLegacySource(globalSource) && await hasLegacyPayload(previousRoot)) {
      try {
        const primary = await manager.ensureDefaultProfile();
        await populateLegacy(previousRoot, manager.getPaths(primary.id));
        await manager.recordLegacySource(globalSource, primary.id);
      } catch {
        console.warn(`[Profiles] Previous installation ${previousStorageName} global migration will be retried.`);
      }
    }

    let rawProfiles: unknown[] = [];
    try {
      const registry = JSON.parse(
        await fs.readFile(path.join(previousRoot, 'profiles', 'index.json'), 'utf8'),
      ) as Record<string, unknown>;
      if (Array.isArray(registry.profiles)) rawProfiles = registry.profiles;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[Profiles] Previous installation ${previousStorageName} profile index could not be read.`);
      }
    }

    for (const rawProfile of rawProfiles) {
      if (!rawProfile || typeof rawProfile !== 'object') continue;
      const candidate = rawProfile as Record<string, unknown>;
      if (!isValidUUID(candidate.id) || typeof candidate.name !== 'string') continue;

      const source = `previous:${previousStorageName}:profile:${candidate.id}`;
      if (manager.hasLegacySource(source)) continue;

      const previousProfileRoot = path.join(previousRoot, 'profiles', candidate.id);
      if (!await hasLegacyPayload(previousProfileRoot)) continue;

      try {
        const profileName = normalizeProfileName(candidate.name);
        if (profileName.toLocaleLowerCase('und') === 'setlist principal') {
          const primary = await manager.ensureDefaultProfile();
          await populateLegacy(previousProfileRoot, manager.getPaths(primary.id));
          await manager.recordLegacySource(source, primary.id);
        } else {
          await manager.importLegacyProfile(
            source,
            profileName,
            (paths) => populateLegacy(previousProfileRoot, paths),
          );
        }
      } catch {
        console.warn(`[Profiles] Previous installation ${previousStorageName} profile migration will be retried.`);
      }
    }

    let previousProjects: Array<{ name: string; isDirectory(): boolean }> = [];
    try {
      previousProjects = await fs.readdir(path.join(previousRoot, 'projects'), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[Profiles] Previous installation ${previousStorageName} project index could not be read.`);
      }
    }

    for (const entry of previousProjects.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const source = `previous:${previousStorageName}:project:${entry.name}`;
      if (manager.hasLegacySource(source)) continue;

      const previousProjectRoot = path.join(previousRoot, 'projects', entry.name);
      if (!await hasLegacyPayload(previousProjectRoot)) continue;

      try {
        const projectInfo = JSON.parse(
          await fs.readFile(path.join(previousProjectRoot, 'project-info.json'), 'utf8'),
        ) as Record<string, unknown>;
        if (typeof projectInfo.projectName !== 'string') continue;

        await manager.importLegacyProfile(
          source,
          normalizeProfileName(projectInfo.projectName),
          (paths) => populateLegacy(previousProjectRoot, paths),
        );
      } catch {
        console.warn(`[Profiles] Previous installation ${previousStorageName} project migration will be retried.`);
      }
    }
  }
}

export async function migrateLegacyData(storageRoot: string, manager: ProfileManager): Promise<void> {
  await migratePreviousInstallations(storageRoot, manager);

  if (!manager.hasLegacySource(GLOBAL_SOURCE) && await hasLegacyPayload(storageRoot)) {
    try {
      const primary = await manager.ensureDefaultProfile();
      await populateLegacy(storageRoot, manager.getPaths(primary.id));
      await manager.recordLegacySource(GLOBAL_SOURCE, primary.id);
    } catch {
      console.warn('[Profiles] Global legacy migration will be retried on next startup.');
    }
  }

  const projectsRoot = path.join(storageRoot, 'projects');
  let projectEntries: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    projectEntries = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  for (const entry of projectEntries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const source = `project:${entry.name}`;
    if (manager.hasLegacySource(source)) continue;
    const sourceRoot = path.join(projectsRoot, entry.name);
    try {
      const raw = JSON.parse(await fs.readFile(path.join(sourceRoot, 'project-info.json'), 'utf8')) as Record<string, unknown>;
      if (typeof raw.projectName !== 'string' || !raw.projectName.trim()) {
        console.warn(`[Profiles] Skipping legacy project ${entry.name}: invalid metadata.`);
        continue;
      }
      await manager.importLegacyProfile(source, raw.projectName, (paths) => populateLegacy(sourceRoot, paths));
    } catch {
      console.warn(`[Profiles] Legacy project ${entry.name} will be retried on next startup.`);
    }
  }

  await manager.setMigrationVersion(1);
}
