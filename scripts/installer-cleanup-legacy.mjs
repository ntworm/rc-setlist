// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
/**
 * @module installer-cleanup-legacy
 * @description Removes pre-1.0 "Ableton RC Setlist" .ablx files from the legacy
 * locations Ableton Live reads, so that only the new "RC Setlist" package appears
 * in Live's Extensions menu after a 1.0.x install.
 *
 * Safe by design:
 *  - Only touches .ablx files whose names match the legacy pattern.
 *  - Never deletes files matching the new "RC-Setlist-*" pattern.
 *  - Refuses to run if the resolved root looks like a filesystem root.
 *  - Returns a structured result object so callers can log what changed.
 *
 * Called automatically by Install-RC-Bridge.ps1 and "Install RC Bridge.command".
 * Also bundled in the kit as the standalone uninstall-pre-1.0-extensions.ps1 for
 * manual recovery.
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

/** @typedef {{ removed: string[], kept: string[], skipped: string[] }} CleanupResult */

const LEGACY_RE = /^Ableton[ _-]?RC[ _-]?Setlist.*\.ablx$/i;
const NEW_RE = /^RC-Setlist.*\.ablx$/i;

/**
 * Returns the candidate directories where pre-1.0 .ablx files may live.
 * @param {string | undefined} overrideUserLibrary - optional override for the
 *   Ableton User Library path (used in tests).
 * @returns {string[]}
 */
export function legacyCandidateRoots(overrideUserLibrary) {
  const home = homedir();
  if (platform() === 'win32') {
    const docs = process.env.USERPROFILE
      ? join(process.env.USERPROFILE, 'Documents')
      : join(home, 'Documents');
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    const programData = process.env.PROGRAMDATA ?? join(home, 'AppData', 'Local', 'ProgramData');
    return [
      overrideUserLibrary ?? join(docs, 'Ableton', 'User Library', 'Extensions'),
      join(localAppData, 'Ableton', 'Extensions'),
      join(localAppData, 'Ableton', 'Live 12', 'Resources', 'Extensions'),
      join(localAppData, 'Ableton', 'Live 11', 'Resources', 'Extensions'),
      join(programData, 'Ableton', 'Live 12', 'Resources', 'Extensions'),
    ];
  }
  // macOS: pre-1.0 RC Setlist was Windows-only, but we check the documented path
  // anyway so a user who manually copied an .ablx there is covered.
  const musicLib = join(home, 'Music', 'Ableton', 'User Library', 'Extensions');
  return [overrideUserLibrary ?? musicLib];
}

const LEGACY_DIR_RE = /^ntworm\.ableton-rc-setlist$/i;

/**
 * Scans `roots` for legacy .ablx files and legacy unpacked folders and removes them.
 *
 * @param {{ roots?: string[], dryRun?: boolean }} [options]
 * @returns {CleanupResult}
 */
export function cleanupLegacyAblx({ roots, dryRun = false } = {}) {
  const candidateRoots = roots ?? legacyCandidateRoots();
  /** @type {CleanupResult} */
  const result = { removed: [], kept: [], skipped: [] };

  for (const root of candidateRoots) {
    // Guard: refuse to touch filesystem roots.
    const abs = resolve(root);
    if (abs.replace(/[\\/]+$/, '').split(/[\\/]/).length <= 1) {
      result.skipped.push(`${root} (refused: resolves to filesystem root)`);
      continue;
    }
    if (!existsSync(abs)) {
      result.skipped.push(`${abs} (not present)`);
      continue;
    }

    let entries;
    try {
      entries = readdirSync(abs);
    } catch {
      result.skipped.push(`${abs} (unreadable)`);
      continue;
    }

    for (const name of entries) {
      const full = join(abs, name);
      let isDirectory;
      let isFile;
      try {
        const s = statSync(full);
        isDirectory = s.isDirectory();
        isFile = s.isFile();
      } catch {
        isDirectory = false;
        isFile = false;
      }

      // Legacy unpacked extension folder
      if (isDirectory && LEGACY_DIR_RE.test(name)) {
        if (!dryRun) {
          process.stderr.write(`[installer-cleanup] removing legacy folder: ${full}\n`);
          rmSync(full, { recursive: true, force: true });
        } else {
          process.stderr.write(`[installer-cleanup] dry-run would remove folder: ${full}\n`);
        }
        result.removed.push(full);
        continue;
      }

      if (!isFile || !name.endsWith('.ablx')) continue;

      if (NEW_RE.test(name)) {
        // Never touch the new package.
        result.kept.push(full);
        continue;
      }

      if (LEGACY_RE.test(name)) {
        if (!dryRun) {
          // Log to stderr so the user sees what was removed when running interactively.
          process.stderr.write(`[installer-cleanup] removing legacy package: ${full}\n`);
          rmSync(full, { force: true });
        } else {
          process.stderr.write(`[installer-cleanup] dry-run would remove: ${full}\n`);
        }
        result.removed.push(full);
      }
    }
  }

  return result;
}

// Allow running directly: node scripts/installer-cleanup-legacy.mjs [--dry-run]
if (
  process.argv[1] &&
  new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  const dryRun = process.argv.includes('--dry-run');
  const result = cleanupLegacyAblx({ dryRun });
  if (result.removed.length === 0 && !dryRun) {
    process.stderr.write('[installer-cleanup] no legacy Ableton RC Setlist package found.\n');
  }
  process.exit(0);
}
