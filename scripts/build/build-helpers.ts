import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CopyTreeOptions {
  /** Directory or file names to leave out of the copy, at any depth. */
  skip?: (name: string) => boolean;
}

function copyDirectory(source: string, destination: string, options: CopyTreeOptions): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (options.skip?.(entry.name)) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath, options);
    } else if (!entry.name.endsWith('.test.mjs')) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

export function copyStaticTree(source: string, destination: string, options: CopyTreeOptions = {}): void {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`Static source directory does not exist: ${source}`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
  copyDirectory(source, destination, options);
}

export function nodeEnvDefine(production: boolean): Record<string, string> {
  return {
    'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
  };
}
