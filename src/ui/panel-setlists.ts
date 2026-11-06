/**
 * The setlist actions of the panel: create, rename, delete, restore, and
 * the packages that carry setlists in and out of the project.
 *
 * The page disables what cannot be done, but a disabled button is a
 * promise, not a lock: the state of Live is read again here before any
 * setlist changes. The outcome comes back as a notice the page shows.
 */

import {
  bridgeState,
  broadcastProfileState,
  profileStatePayload,
} from '../runtime/bridge-state.js';
import {
  executeProfileSelect,
  executeProfileCreate,
  executeProfileDelete,
  executeProfileRename,
  executeProfileRestore,
} from '../commands/handlers/profiles.js';
import {
  exportPackage,
  importPackage,
  listPackages,
  packagesDirectory,
  type PackageFileEntry,
} from '../core/setlist-package.js';
import type { PanelEnvelope } from './panel-session.js';

/** What the page says after an action. */
export interface PanelNotice {
  tone: 'ok' | 'error';
  key: string;
  params: Record<string, string>;
}

/** The packages folder and what is in it. */
export interface PanelPackagesModel {
  dir: string;
  files: PackageFileEntry[];
}

/** The actions this module carries out. */
const SETLIST_ACTIONS: ReadonlySet<string> = new Set([
  'select-profile',
  'create-profile',
  'rename-profile',
  'delete-profile',
  'restore-profile',
  'export-package',
  'import-package',
]);

/**
 * Whether an action belongs to this module.
 */
export function isSetlistAction(action: string): boolean {
  return SETLIST_ACTIONS.has(action);
}

/**
 * The folder of the packages, or nothing when the extension has no folder yet.
 */
function packagesDir(): string | null {
  const root = bridgeState.globalPersistenceDir;
  return root ? packagesDirectory(root) : null;
}

/**
 * The packages folder as the panel shows it.
 */
export async function readPackagesModel(): Promise<PanelPackagesModel> {
  const dir = packagesDir();
  if (!dir) return { dir: '', files: [] };
  return { dir, files: await listPackages(dir) };
}

/**
 * A notice of failure.
 */
function failure(key: string, params: Record<string, string> = {}): PanelNotice {
  return { tone: 'error', key, params };
}

/**
 * Why no setlist may change right now, or nothing when it may.
 */
function blockedReason(): PanelNotice | null {
  const manager = bridgeState.manager;
  const profileManager = bridgeState.profileManager;
  if (!manager || !profileManager) return failure('notice.unavailable');
  if (bridgeState.profileScopeSwitching) return failure('notice.switching');
  if (manager.getState().isPlaying) return failure('notice.playing');
  // The same checks the page makes, in the same order: a project that is not
  // open, or setlists the extension says it cannot change, stay untouched.
  if (!readCanMutate()) return failure('notice.unavailable');
  if (!bridgeState.projectIdentity?.displayName) return failure('notice.noProject');
  return null;
}

/**
 * Whether the extension says the setlists may change, as the page reads it.
 */
function readCanMutate(): boolean {
  try {
    return profileStatePayload().canMutate;
  } catch {
    return false;
  }
}

/**
 * The name of a setlist of the project, or nothing when it is not one.
 */
function profileName(id: string | undefined): string | null {
  if (!id) return null;
  const profile = bridgeState.profileManager?.list().find((entry) => entry.id === id);
  return profile ? profile.name : null;
}

/**
 * The name of a deleted setlist, or nothing when it is not one.
 */
function deletedName(id: string | undefined): string | null {
  if (!id) return null;
  const profile = bridgeState.profileManager?.listDeleted().find((entry) => entry.id === id);
  return profile ? profile.name : null;
}

/**
 * Carries out an action on a setlist that already exists.
 */
async function runProfileAction(envelope: PanelEnvelope): Promise<PanelNotice> {
  if (envelope.action === 'create-profile') {
    if (!envelope.name) return failure('notice.nameMissing');
    await executeProfileCreate(envelope.name);
    return { tone: 'ok', key: 'notice.created', params: { name: envelope.name } };
  }
  if (envelope.action === 'restore-profile') {
    const name = deletedName(envelope.profileId);
    if (!name) return failure('notice.unknown');
    await executeProfileRestore(envelope.profileId!);
    return { tone: 'ok', key: 'notice.restored', params: { name } };
  }
  const name = profileName(envelope.profileId);
  if (!name) return failure('notice.unknown');
  if (envelope.action === 'select-profile') {
    await executeProfileSelect(envelope.profileId!);
    return { tone: 'ok', key: 'notice.selected', params: { name } };
  }
  if (envelope.action === 'rename-profile') {
    if (!envelope.name) return failure('notice.nameMissing');
    await executeProfileRename(envelope.profileId!, envelope.name);
    return { tone: 'ok', key: 'notice.renamed', params: { name: envelope.name } };
  }
  // The name the operator confirmed on the page: a setlist renamed in the
  // meantime is not deleted under its old name.
  if (!envelope.name) return failure('notice.nameMissing');
  await executeProfileDelete(envelope.profileId!, envelope.name);
  return { tone: 'ok', key: 'notice.deleted', params: { name } };
}

/**
 * Carries out an action on the packages.
 */
async function runPackageAction(envelope: PanelEnvelope): Promise<PanelNotice> {
  const dir = packagesDir();
  const profileManager = bridgeState.profileManager;
  if (!dir || !profileManager) return failure('notice.unavailable');
  if (envelope.action === 'export-package') {
    const projectName = bridgeState.projectIdentity?.displayName ?? '';
    const file = await exportPackage(profileManager, { dir, projectName });
    return { tone: 'ok', key: 'notice.exported', params: { file } };
  }
  if (!envelope.packageFile) return failure('notice.packageMissing');
  let count: number;
  try {
    count = await importPackage(profileManager, { dir, file: envelope.packageFile });
  } finally {
    // The phones see the setlists as they are, also after an import undone.
    broadcastProfileState();
  }
  return {
    tone: 'ok',
    key: 'notice.imported',
    params: { count: String(count), file: envelope.packageFile },
  };
}

/**
 * Carries out a setlist action of the panel and says how it went.
 */
export async function runSetlistAction(envelope: PanelEnvelope): Promise<PanelNotice> {
  const blocked = blockedReason();
  if (blocked) return blocked;
  try {
    if (envelope.action === 'export-package' || envelope.action === 'import-package') {
      return await runPackageAction(envelope);
    }
    return await runProfileAction(envelope);
  } catch (err) {
    // A name that is taken is said in the language of the panel.
    if ((err as { code?: unknown } | null)?.code === 'duplicate_profile_name') {
      return failure('notice.duplicate', { name: envelope.name ?? '' });
    }
    return failure('notice.failed', { detail: err instanceof Error ? err.message : String(err) });
  }
}
