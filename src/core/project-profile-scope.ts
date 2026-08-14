import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import {
  ProfileManager,
  isValidUUID,
  profileNameKey,
  writeJsonAtomic,
  type ProfileSummary,
  type ProfileManagerOptions,
  type ProfilePaths,
} from './profile-manager.js';
import { LEGACY_PROFILE_STORAGE_NAMES } from './profile-migration.js';
import type { ProjectIdentity } from './project-identity.js';

export interface ProjectProfileScope {
  identity: ProjectIdentity;
  root: string;
  manager: ProfileManager;
}

export class ProjectProfilePromotionCancelledError extends Error {
  public constructor() {
    super('Project profile scope promotion was cancelled.');
    this.name = 'ProjectProfilePromotionCancelledError';
  }
}

type PromotionGuard = (() => boolean) | undefined;

function ensurePromotionAuthorized(guard: PromotionGuard): void {
  if (guard && !guard()) throw new ProjectProfilePromotionCancelledError();
}

interface InitializeProjectProfileScopeOptions {
  storageRoot: string;
  identity: ProjectIdentity;
  managerOptions?: ProfileManagerOptions;
  promoteFrom?: ProjectProfileScope;
  promotionGuard?: PromotionGuard;
}

async function copyIfMissing(source: string, destination: string): Promise<void> {
  try {
    await fs.access(destination);
    return;
  } catch {}
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function copyLegacyPayload(sourceRoot: string, target: ProfilePaths): Promise<void> {
  try {
    const entries = await fs.readdir(path.join(sourceRoot, 'lyrics'), { withFileTypes: true });
    await fs.mkdir(target.lyrics, { recursive: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isFile() && /\.(lrc|txt)$/iu.test(entry.name)) {
        await copyIfMissing(
          path.join(sourceRoot, 'lyrics', entry.name),
          path.join(target.lyrics, entry.name),
        );
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  try {
    await copyIfMissing(path.join(sourceRoot, 'custom-order.json'), target.customOrder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function hasLegacyPayload(sourceRoot: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(path.join(sourceRoot, 'lyrics'), { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && /\.(lrc|txt)$/iu.test(entry.name))) return true;
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

async function payloadContents(paths: ProfilePaths): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  try {
    const entries = await fs.readdir(paths.lyrics, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !/\.(lrc|txt)$/iu.test(entry.name)) continue;
      contents.set(
        `lyrics/${entry.name.toLocaleLowerCase('und')}`,
        await fs.readFile(path.join(paths.lyrics, entry.name), 'utf8'),
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    contents.set('custom-order.json', await fs.readFile(paths.customOrder, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return contents;
}

async function payloadsConflict(source: ProfilePaths, target: ProfilePaths): Promise<boolean> {
  const [sourceContents, targetContents] = await Promise.all([
    payloadContents(source),
    payloadContents(target),
  ]);
  for (const [key, sourceValue] of sourceContents) {
    const targetValue = targetContents.get(key);
    if (targetValue !== undefined && targetValue !== sourceValue) return true;
  }
  return false;
}

function recoveredProfileName(sourceName: string, existing: ProfileSummary[]): string {
  const keys = new Set(existing.map(({ name }) => profileNameKey(name)));
  for (let suffix = 1; suffix < 1000; suffix++) {
    const marker = suffix === 1 ? ' (Recovered)' : ` (Recovered ${suffix})`;
    const candidate = `${sourceName.slice(0, Math.max(1, 80 - marker.length))}${marker}`;
    if (!keys.has(profileNameKey(candidate))) return candidate;
  }
  throw new Error(`Could not create a recovered profile name for ${sourceName}`);
}

async function mergeProjectProfiles(
  source: ProjectProfileScope,
  target: ProfileManager,
  promotionGuard: PromotionGuard,
): Promise<void> {
  ensurePromotionAuthorized(promotionGuard);
  const sourceIsPristine = await isPristineDefaultManager(source.manager);
  ensurePromotionAuthorized(promotionGuard);
  const targetIsPristine = await isPristineDefaultManager(target);
  ensurePromotionAuthorized(promotionGuard);
  if (sourceIsPristine && !targetIsPristine) {
    return;
  }

  const sourceToTarget = new Map<string, string>();
  let reusableTarget = targetIsPristine ? target.getActive() : null;
  for (const sourceProfile of source.manager.list()) {
    ensurePromotionAuthorized(promotionGuard);
    const migrationSource = `provisional-scope:${source.identity.key}:${sourceProfile.id}`;
    const migratedTargetId = target.getLegacySourceProfileId(migrationSource);
    if (migratedTargetId) {
      if (target.list().some(({ id }) => id === migratedTargetId)) {
        sourceToTarget.set(sourceProfile.id, migratedTargetId);
      }
      continue;
    }
    const sourcePaths = source.manager.getPaths(sourceProfile.id);
    let targetProfile = target.list().find(({ name }) => profileNameKey(name) === profileNameKey(sourceProfile.name));

    if (targetProfile) {
      if (reusableTarget?.id === targetProfile.id) reusableTarget = null;
      const hasConflict = await payloadsConflict(sourcePaths, target.getPaths(targetProfile.id));
      ensurePromotionAuthorized(promotionGuard);
      if (hasConflict) {
        ensurePromotionAuthorized(promotionGuard);
        targetProfile = await target.create(recoveredProfileName(sourceProfile.name, target.list()));
        ensurePromotionAuthorized(promotionGuard);
      }
    } else if (reusableTarget) {
      ensurePromotionAuthorized(promotionGuard);
      targetProfile = await target.rename(reusableTarget.id, sourceProfile.name);
      ensurePromotionAuthorized(promotionGuard);
      reusableTarget = null;
    } else {
      ensurePromotionAuthorized(promotionGuard);
      targetProfile = await target.create(sourceProfile.name);
      ensurePromotionAuthorized(promotionGuard);
    }

    sourceToTarget.set(sourceProfile.id, targetProfile.id);
    if (!target.hasLegacySource(migrationSource)) {
      ensurePromotionAuthorized(promotionGuard);
      await copyLegacyPayload(sourcePaths.root, target.getPaths(targetProfile.id));
      ensurePromotionAuthorized(promotionGuard);
      await target.recordLegacySource(migrationSource, targetProfile.id);
      ensurePromotionAuthorized(promotionGuard);
    }
  }

  const activeTargetId = sourceToTarget.get(source.manager.getActive().id);
  if (activeTargetId) {
    ensurePromotionAuthorized(promotionGuard);
    await target.select(activeTargetId);
    ensurePromotionAuthorized(promotionGuard);
  }
}

async function isPristineDefaultManager(manager: ProfileManager): Promise<boolean> {
  const profiles = manager.list();
  return profiles.length === 1
    && profiles[0]?.name === 'Main Setlist'
    && !await hasLegacyPayload(manager.getPaths(profiles[0]!.id).root);
}

function candidateStorageRoots(storageRoot: string): string[] {
  const resolved = path.resolve(storageRoot);
  const parent = path.dirname(resolved);
  return Array.from(new Set([
    resolved,
    ...LEGACY_PROFILE_STORAGE_NAMES.map((name) => path.join(parent, name)),
  ]));
}

function normalizedSongTitle(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('und');
}

function safeSongFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim();
}

function exactSongSet(order: unknown, songTitles: string[]): order is string[] {
  if (!Array.isArray(order) || order.some((value) => typeof value !== 'string')) return false;
  const expected = new Set(songTitles.map(normalizedSongTitle));
  const actual = new Set(order.map((value) => normalizedSongTitle(value)));
  return songTitles.length === expected.size
    && order.length === expected.size
    && expected.size === actual.size
    && expected.size > 0
    && Array.from(expected).every((value) => actual.has(value));
}

export interface CompatibleLegacyRecoveryResult {
  recovered: boolean;
  customOrder: string[];
  profileId: string | null;
}

interface CompatibleLegacyRecoveryOptions {
  storageRoot: string;
  manager: ProfileManager;
  songTitles: string[];
  candidateRoots?: string[];
}

export async function recoverCompatibleLegacyPayload({
  storageRoot,
  manager,
  songTitles,
  candidateRoots = candidateStorageRoots(storageRoot),
}: CompatibleLegacyRecoveryOptions): Promise<CompatibleLegacyRecoveryResult> {
  const targetProfile = manager.list().find(({ name }) => name === 'Main Setlist');
  if (!targetProfile || songTitles.length === 0) {
    return { recovered: false, customOrder: [], profileId: null };
  }

  const candidates: Array<{
    source: string;
    orderPath: string;
    order: string[];
    files: Array<{ source: string; name: string; content: string }>;
    fingerprint: string;
  }> = [];

  for (const root of candidateRoots) {
    let registry: { profiles?: Array<{ id?: unknown }> };
    try {
      registry = JSON.parse(await fs.readFile(path.join(root, 'profiles', 'index.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(registry.profiles)) continue;

    for (const profile of registry.profiles) {
      if (!isValidUUID(profile?.id)) continue;
      const profileRoot = path.join(root, 'profiles', profile.id);
      const orderPath = path.join(profileRoot, 'custom-order.json');
      let order: unknown;
      try {
        order = JSON.parse(await fs.readFile(orderPath, 'utf8'));
      } catch {
        continue;
      }
      if (!exactSongSet(order, songTitles)) continue;

      let entries: import('node:fs').Dirent[] = [];
      try {
        entries = await fs.readdir(path.join(profileRoot, 'lyrics'), { withFileTypes: true });
      } catch {}
      const fileByKey = new Map<string, import('node:fs').Dirent>();
      for (const entry of entries) {
        if (!entry.isFile() || !/\.(lrc|txt)$/iu.test(entry.name)) continue;
        fileByKey.set(entry.name.toLocaleLowerCase('und'), entry);
      }

      const files: Array<{ source: string; name: string; content: string }> = [];
      for (const title of songTitles) {
        const base = safeSongFilename(title);
        const lrc = fileByKey.get(`${base}.lrc`.toLocaleLowerCase('und'));
        const txt = fileByKey.get(`${base}.txt`.toLocaleLowerCase('und'));
        const selected = lrc ?? txt;
        if (!selected) continue;
        const source = path.join(profileRoot, 'lyrics', selected.name);
        const extension = lrc ? '.lrc' : '.txt';
        files.push({ source, name: `${base}${extension}`, content: await fs.readFile(source, 'utf8') });
      }
      if (files.length === 0) continue;

      const fingerprintValue = JSON.stringify({
        order,
        files: files.map(({ name, content }) => [name.toLocaleLowerCase('und'), content]),
      });
      candidates.push({
        source: `compatible-profile:${path.basename(root)}:${profile.id}`,
        orderPath,
        order: order as string[],
        files,
        fingerprint: createHash('sha256').update(fingerprintValue).digest('hex'),
      });
    }
  }

  const uniquePayloads = new Map<string, typeof candidates[number]>();
  for (const candidate of candidates) uniquePayloads.set(candidate.fingerprint, candidate);
  if (uniquePayloads.size !== 1) return { recovered: false, customOrder: [], profileId: targetProfile.id };

  const selected = uniquePayloads.values().next().value as typeof candidates[number];
  const target = manager.getPaths(targetProfile.id);
  await fs.mkdir(target.lyrics, { recursive: true });
  for (const file of selected.files) {
    await copyIfMissing(file.source, path.join(target.lyrics, file.name));
  }
  await copyIfMissing(selected.orderPath, target.customOrder);

  let effectiveOrder = selected.order;
  try {
    const persistedOrder = JSON.parse(await fs.readFile(target.customOrder, 'utf8')) as unknown;
    if (Array.isArray(persistedOrder) && persistedOrder.every((value) => typeof value === 'string')) {
      effectiveOrder = persistedOrder;
    }
  } catch {
    // copyIfMissing already preserved the source order when no target existed.
  }

  const sourceKey = `${selected.source}:${selected.fingerprint.slice(0, 16)}`;
  if (!manager.hasLegacySource(sourceKey)) await manager.recordLegacySource(sourceKey, targetProfile.id);
  return { recovered: true, customOrder: [...effectiveOrder], profileId: targetProfile.id };
}

async function migrateExactLegacyProject(
  storageRoot: string,
  identity: ProjectIdentity,
  manager: ProfileManager,
): Promise<void> {
  if (!identity.legacyProjectKey) return;

  for (const candidateRoot of candidateStorageRoots(storageRoot)) {
    const source = `project-scope:${path.basename(candidateRoot)}:${identity.legacyProjectKey}`;
    if (manager.hasLegacySource(source)) return;
    const legacyRoot = path.join(candidateRoot, 'projects', identity.legacyProjectKey);
    if (!await hasLegacyPayload(legacyRoot)) continue;

    const primary = await manager.ensureDefaultProfile();
    await copyLegacyPayload(legacyRoot, manager.getPaths(primary.id));
    await manager.recordLegacySource(source, primary.id);
    return;
  }
}

async function initializeScopeAtRoot({
  root,
  storageRoot,
  identity,
  managerOptions,
  promoteFrom,
  promotionGuard,
}: InitializeProjectProfileScopeOptions & { root: string }): Promise<ProjectProfileScope> {
  const manager = new ProfileManager(root, managerOptions);
  await manager.initialize({ migrateLegacy: false });
  await migrateExactLegacyProject(storageRoot, identity, manager);
  if (promoteFrom && promoteFrom.identity.key !== identity.key) {
    ensurePromotionAuthorized(promotionGuard);
    await mergeProjectProfiles(promoteFrom, manager, promotionGuard);
    ensurePromotionAuthorized(promotionGuard);
  }
  await writeJsonAtomic(path.join(root, 'project-info.json'), {
    schemaVersion: 1,
    key: identity.key,
    displayName: identity.displayName,
    filePath: identity.filePath,
    source: identity.source,
    persistent: identity.persistent,
    updatedAt: new Date().toISOString(),
  });
  return { identity, root, manager };
}

function transactionPaths(storageRoot: string, root: string): { staging: string; backup: string } {
  const projectSetlistsRoot = path.resolve(storageRoot, 'project-setlists');
  if (path.dirname(root) !== projectSetlistsRoot || path.resolve(projectSetlistsRoot, path.basename(root)) !== root) {
    throw new Error('Project profile transaction target is outside project-setlists.');
  }
  const prefix = `.${path.basename(root)}.promotion-${randomUUID()}`;
  return {
    staging: path.resolve(projectSetlistsRoot, `${prefix}.staging`),
    backup: path.resolve(projectSetlistsRoot, `${prefix}.backup`),
  };
}

async function preparePromotionStage(
  root: string,
  staging: string,
  promotionGuard: PromotionGuard,
): Promise<void> {
  await fs.mkdir(path.dirname(root), { recursive: true });
  ensurePromotionAuthorized(promotionGuard);
  try {
    await fs.cp(root, staging, { recursive: true, force: false, errorOnExist: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await fs.mkdir(staging, { recursive: true });
  }
  ensurePromotionAuthorized(promotionGuard);
}

function commitPromotionStage(root: string, staging: string, backup: string): boolean {
  const hadTarget = fsSync.existsSync(root);
  let movedTarget = false;
  try {
    if (hadTarget) {
      fsSync.renameSync(root, backup);
      movedTarget = true;
    }
    fsSync.renameSync(staging, root);
    return hadTarget;
  } catch (error) {
    if (movedTarget && !fsSync.existsSync(root) && fsSync.existsSync(backup)) {
      fsSync.renameSync(backup, root);
    }
    throw error;
  }
}

async function initializePromotedProjectProfileScope(
  options: InitializeProjectProfileScopeOptions,
  root: string,
): Promise<ProjectProfileScope> {
  const { staging, backup } = transactionPaths(options.storageRoot, root);
  let committed = false;
  let hadTarget = false;
  try {
    await preparePromotionStage(root, staging, options.promotionGuard);
    await initializeScopeAtRoot({ ...options, root: staging });
    ensurePromotionAuthorized(options.promotionGuard);

    // The final guard and sibling-directory renames are synchronous: no queued
    // Song-handle observer can interleave between authorization and commit.
    hadTarget = commitPromotionStage(root, staging, backup);
    committed = true;

    const manager = new ProfileManager(root, options.managerOptions);
    await manager.initialize({ migrateLegacy: false });
    if (hadTarget) await fs.rm(backup, { recursive: true, force: true });
    return { identity: options.identity, root, manager };
  } finally {
    if (!committed) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function initializeProjectProfileScope(options: InitializeProjectProfileScopeOptions): Promise<ProjectProfileScope> {
  const root = path.resolve(options.storageRoot, 'project-setlists', options.identity.key);
  if (options.promoteFrom && options.promoteFrom.identity.key !== options.identity.key) {
    return initializePromotedProjectProfileScope(options, root);
  }
  return initializeScopeAtRoot({ ...options, root });
}
