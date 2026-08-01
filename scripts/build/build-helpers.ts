import * as fs from 'node:fs';
import * as path from 'node:path';

function copyDirectory(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (!entry.name.endsWith('.test.mjs')) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

export function copyStaticTree(source: string, destination: string): void {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`Static source directory does not exist: ${source}`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
  copyDirectory(source, destination);
}

export function nodeEnvDefine(production: boolean): Record<string, string> {
  return {
    'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
  };
}
