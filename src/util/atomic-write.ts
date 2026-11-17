import { randomUUID } from 'node:crypto';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  atomicWriteFileWithDependencies,
  isFsyncDisabledByPermissionModel,
  isUnsupportedWindowsDirectorySync,
} from './atomic-write-internal.js';

/**
 * Atomically replaces a file from a unique temporary sibling. The new file and,
 * where the platform supports it, the containing directory are flushed before
 * the promise resolves. Some Windows filesystems reject directory fsync; there
 * the guarantee is atomic visibility plus a flushed file, not crash-durable
 * persistence of the renamed directory entry. Under Node's Permission Model,
 * as in Live's ExtensionHost, fsync is disabled: the replacement stays atomic
 * but nothing is flushed before the promise resolves.
 */
export async function atomicWriteFile(
  targetPath: string,
  data: string | Uint8Array,
): Promise<void> {
  await atomicWriteFileWithDependencies(targetPath, data, {
    fileSystem: fs,
    createToken: randomUUID,
    platform: process.platform,
  });
}

// Same tolerance as the asynchronous path: only fsync may fail with the
// Permission Model's ERR_ACCESS_DENIED, never open, write or rename.
function fsyncUnlessDisabled(fd: number): void {
  try {
    fsSync.fsyncSync(fd);
  } catch (error) {
    if (!isFsyncDisabledByPermissionModel(error)) throw error;
  }
}

function syncDirectoryBestEffort(directory: string): void {
  let fd: number | undefined;
  try {
    fd = fsSync.openSync(directory, 'r');
    fsyncUnlessDisabled(fd);
  } catch (error) {
    if (!isUnsupportedWindowsDirectorySync(error, process.platform)) throw error;
  } finally {
    if (fd !== undefined) fsSync.closeSync(fd);
  }
}

/**
 * Synchronous counterpart of atomicWriteFile, with the same flushing rules.
 * It does not create the parent directory: callers keep their own mkdir.
 * `mode` applies to the new file, so a secret is never readable by others,
 * not even between the write and the rename.
 */
export function atomicWriteFileSync(
  targetPath: string,
  data: string | Uint8Array,
  options: { mode?: number } = {},
): void {
  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let fd: number | undefined;
  try {
    fd = fsSync.openSync(temporaryPath, 'wx', options.mode);
    fsSync.writeFileSync(fd, data);
    fsyncUnlessDisabled(fd);
    fsSync.closeSync(fd);
    fd = undefined;
    fsSync.renameSync(temporaryPath, targetPath);
  } catch (error) {
    try {
      if (fd !== undefined) fsSync.closeSync(fd);
      fsSync.rmSync(temporaryPath, { force: true });
    } catch {
      // the write already failed; that error is the one reported
    }
    throw error;
  }
  syncDirectoryBestEffort(directory);
}
