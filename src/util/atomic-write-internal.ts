import * as path from 'node:path';

export interface AtomicFileHandle {
  writeFile(data: string | Uint8Array): Promise<unknown>;
  sync(): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface AtomicFileSystem {
  mkdir(directory: string, options: { recursive: true }): Promise<unknown>;
  open(file: string, flags: 'r' | 'wx'): Promise<AtomicFileHandle>;
  rename(from: string, to: string): Promise<unknown>;
  rm(file: string, options: { force: true }): Promise<unknown>;
}

export interface AtomicWriteDependencies {
  fileSystem: AtomicFileSystem;
  createToken(): string;
  platform: NodeJS.Platform;
}

const WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  'EPERM',
  'EACCES',
  'EISDIR',
  'ENOTSUP',
  'EINVAL',
]);

function isUnsupportedWindowsDirectorySync(error: unknown, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32' || typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_CODES.has(code);
}

async function syncContainingDirectory(
  directory: string,
  dependencies: AtomicWriteDependencies,
): Promise<void> {
  let directoryHandle: AtomicFileHandle | undefined;
  try {
    directoryHandle = await dependencies.fileSystem.open(directory, 'r');
    await directoryHandle.sync();
  } catch (error) {
    // Windows can atomically publish the rename and flush the file while its
    // Node/filesystem combination still rejects opening or fsyncing a directory.
    // Only those documented unsupported-operation errors are tolerated.
    if (!isUnsupportedWindowsDirectorySync(error, dependencies.platform)) throw error;
  } finally {
    await directoryHandle?.close();
  }
}

export async function atomicWriteFileWithDependencies(
  targetPath: string,
  data: string | Uint8Array,
  dependencies: AtomicWriteDependencies,
): Promise<void> {
  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${dependencies.createToken()}.tmp`,
  );
  let handle: AtomicFileHandle | undefined;

  try {
    await dependencies.fileSystem.mkdir(directory, { recursive: true });
    handle = await dependencies.fileSystem.open(temporaryPath, 'wx');
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await dependencies.fileSystem.rename(temporaryPath, targetPath);
    await syncContainingDirectory(directory, dependencies);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await dependencies.fileSystem.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
