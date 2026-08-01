import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

type AtomicWriteData = string | Uint8Array;
type AtomicWriteOptions = BufferEncoding | { encoding?: BufferEncoding; mode?: number } | undefined;

export interface AtomicFileSystem {
  mkdir(directory: string, options: { recursive: true }): Promise<unknown>;
  writeFile(file: string, data: AtomicWriteData, options?: AtomicWriteOptions): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  unlink(file: string): Promise<unknown>;
}

const defaultFileSystem: AtomicFileSystem = {
  mkdir: (directory, options) => fs.mkdir(directory, options),
  writeFile: (file, data, options) => fs.writeFile(file, data, options),
  rename: (from, to) => fs.rename(from, to),
  unlink: (file) => fs.unlink(file),
};

export async function atomicWriteFile(
  targetPath: string,
  data: AtomicWriteData,
  options?: AtomicWriteOptions,
  fileSystem: AtomicFileSystem = defaultFileSystem,
): Promise<void> {
  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );

  await fileSystem.mkdir(directory, { recursive: true });
  try {
    await fileSystem.writeFile(temporaryPath, data, options);
    await fileSystem.rename(temporaryPath, targetPath);
  } catch (error) {
    await fileSystem.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
