import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { atomicWriteFileWithDependencies } from './atomic-write-internal.js';

/**
 * Atomically replaces a file from a unique temporary sibling. The new file and,
 * where the platform supports it, the containing directory are flushed before
 * the promise resolves. Some Windows filesystems reject directory fsync; there
 * the guarantee is atomic visibility plus a flushed file, not crash-durable
 * persistence of the renamed directory entry.
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
