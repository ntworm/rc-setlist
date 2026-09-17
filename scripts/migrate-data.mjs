#!/usr/bin/env node
// Migrate RC Setlist data from the 0.x layout to the 1.0 layout.
//
// Source: <Extensions Data>/ntworm.ableton-rc-setlist
// Destination: <Extensions Data>/ntworm.rc-setlist
//
// Behaviour (matches the kit .ps1 and .command wrappers):
//   - If destination directory does not exist OR lacks `profiles/`, copy
//     `profiles/`, `project-setlists/`, `token`, `ui-locale`, `auto-start`
//     and `certs/` from source to destination. Never move. Never overwrite
//     an existing file in the destination. Skip files that already exist.
//   - Print what was copied and what was skipped.
//   - Exit 0 on success, 1 on user error, 2 on unexpected error.
//
// Usage:
//   node scripts/migrate-data.mjs [--source <dir>] [--dest <dir>] [--dry-run] [--json]
//
// When --source and --dest are omitted, the script auto-detects from
// platform-specific Extensions Data locations, requiring both source and
// destination to resolve; otherwise it exits 1 with a clear message.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';

const ENTRIES = ['profiles', 'project-setlists', 'token', 'ui-locale', 'auto-start', 'certs'];

function parseArgs(argv) {
  const out = { source: null, dest: null, dryRun: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') {
      out.source = argv[++i] ?? null;
    } else if (arg === '--dest') {
      out.dest = argv[++i] ?? null;
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    } else if (arg === '--json') {
      out.json = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: node scripts/migrate-data.mjs [--source <dir>] [--dest <dir>] [--dry-run] [--json]',
      '',
      'When --source and --dest are omitted the script auto-detects both',
      'locations from the platform Extensions Data directory. If either',
      'auto-detected path does not exist the script exits 1 with a message.',
      '',
      'Exit codes: 0 success, 1 user error (paths missing), 2 unexpected.',
      '',
    ].join('\n'),
  );
}

function detectExtensionsData() {
  const platform = process.platform;
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return null;
    return path.join(localAppData, 'Ableton', 'Extensions Data');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Ableton', 'Extensions Data');
  }
  return null;
}

function resolvePaths(args) {
  const dataDir = detectExtensionsData();
  const oldName = 'ntworm.ableton-rc-setlist';
  const newName = 'ntworm.rc-setlist';
  let source = args.source;
  let dest = args.dest;
  if (!source) {
    if (!dataDir)
      return {
        error:
          'Could not auto-detect Extensions Data directory on this platform; pass --source explicitly.',
      };
    source = path.join(dataDir, oldName);
  }
  if (!dest) {
    if (!dataDir)
      return {
        error:
          'Could not auto-detect Extensions Data directory on this platform; pass --dest explicitly.',
      };
    dest = path.join(dataDir, newName);
  }
  return { source, dest };
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

async function copyEntry(sourceRoot, destRoot, entry, dryRun) {
  const sourcePath = path.join(sourceRoot, entry);
  const destPath = path.join(destRoot, entry);
  const sourceExists = await exists(sourcePath);
  if (!sourceExists) {
    return { entry, action: 'absent', copied: [], skipped: [] };
  }
  const sourceStat = await stat(sourcePath);
  const destExists = await exists(destPath);
  const copied = [];
  const skipped = [];
  if (sourceStat.isDirectory()) {
    if (destExists) {
      // Merge directory: never overwrite, copy leaf files one by one.
      const leafFiles = [];
      await collectFiles(sourcePath, sourcePath, leafFiles);
      for (const rel of leafFiles) {
        const srcLeaf = path.join(sourcePath, rel);
        const dstLeaf = path.join(destPath, rel);
        if (await exists(dstLeaf)) {
          skipped.push(path.posix.join(entry, rel.split(path.sep).join(path.posix.sep)));
          continue;
        }
        if (!dryRun) {
          await mkdir(path.dirname(dstLeaf), { recursive: true });
          await copyFile(srcLeaf, dstLeaf);
        }
        copied.push(path.posix.join(entry, rel.split(path.sep).join(path.posix.sep)));
      }
      return { entry, action: 'merged', copied, skipped };
    }
    if (!dryRun) {
      await mkdir(destPath, { recursive: true });
      const leafFiles = [];
      await collectFiles(sourcePath, sourcePath, leafFiles);
      for (const rel of leafFiles) {
        const srcLeaf = path.join(sourcePath, rel);
        const dstLeaf = path.join(destPath, rel);
        await mkdir(path.dirname(dstLeaf), { recursive: true });
        await copyFile(srcLeaf, dstLeaf);
      }
    }
    // For dry-run reporting, list leaf files that would be copied.
    const leafFiles = [];
    await collectFiles(sourcePath, sourcePath, leafFiles);
    return {
      entry,
      action: 'copied',
      copied: leafFiles.map((rel) =>
        path.posix.join(entry, rel.split(path.sep).join(path.posix.sep)),
      ),
      skipped: [],
    };
  }
  // Single file.
  if (destExists) {
    return { entry, action: 'skipped', copied: [], skipped: [entry] };
  }
  if (!dryRun) {
    await mkdir(path.dirname(destPath), { recursive: true });
    await copyFile(sourcePath, destPath);
  }
  return { entry, action: 'copied', copied: [entry], skipped: [] };
}

async function collectFiles(root, current, out) {
  const items = await readdir(current, { withFileTypes: true });
  for (const item of items) {
    const abs = path.join(current, item.name);
    if (item.isDirectory()) {
      await collectFiles(root, abs, out);
    } else if (item.isFile()) {
      out.push(path.relative(root, abs));
    }
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`migrate-data: ${err.message}\n`);
    printHelp();
    process.exit(1);
  }

  const resolved = resolvePaths(args);
  if (resolved.error) {
    process.stderr.write(`migrate-data: ${resolved.error}\n`);
    process.exit(1);
  }
  const { source, dest } = resolved;

  if (!existsSync(source)) {
    const msg = `Source directory not found: ${source}\nNothing to migrate.`;
    if (args.json)
      process.stdout.write(
        `${JSON.stringify({ ok: false, reason: 'source-missing', source, dest })}\n`,
      );
    else process.stderr.write(`migrate-data: ${msg}\n`);
    process.exit(1);
  }

  const destExists = existsSync(dest);
  const destHasProfiles = destExists && existsSync(path.join(dest, 'profiles'));

  if (destExists && destHasProfiles) {
    const summary = {
      ok: true,
      action: 'no-op',
      source,
      dest,
      reason: 'destination already has profiles/; nothing to copy.',
      entries: [],
    };
    if (args.json) process.stdout.write(`${JSON.stringify(summary)}\n`);
    else
      process.stdout.write(
        `migrate-data: destination already initialised; nothing to copy.\n  source: ${source}\n  dest:   ${dest}\n`,
      );
    process.exit(0);
  }

  const results = [];
  for (const entry of ENTRIES) {
    const result = await copyEntry(source, dest, entry, args.dryRun);
    results.push(result);
  }

  const summary = {
    ok: true,
    action: args.dryRun ? 'dry-run' : 'migrated',
    source,
    dest,
    entries: results,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(
      `migrate-data: ${args.dryRun ? 'dry run' : 'migrated'} ${source} -> ${dest}\n`,
    );
    for (const r of results) {
      process.stdout.write(`  ${r.entry}: ${r.action}\n`);
      for (const c of r.copied) process.stdout.write(`    + ${c}\n`);
      for (const s of r.skipped) process.stdout.write(`    = ${s} (already present)\n`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(
    `migrate-data: unexpected error: ${err && err.stack ? err.stack : String(err)}\n`,
  );
  process.exit(2);
});
