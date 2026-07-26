import * as fs from 'node:fs';
import * as path from 'node:path';
import { getExtensionContext } from './context.js';

const SETLIST_DIR = '.setlist';
const AUTO_START_FILE = 'auto-start';

function autoStartPath(): string | null {
  // 1. Try SDK storageDirectory first if context is available
  const context = getExtensionContext();
  if (context && context.environment.storageDirectory) {
    return path.join(context.environment.storageDirectory, AUTO_START_FILE);
  }

  // 2. Fallback candidates (fixing the double-append bug by direct lookup)
  const candidates = [
    process.cwd(),
    process.env.HOME || null,
    process.env.USERPROFILE || null,
  ].filter((p): p is string => typeof p === 'string');

  for (const dir of candidates) {
    try {
      const probe = path.join(dir, SETLIST_DIR);
      if (fs.existsSync(probe)) {
        return path.join(probe, AUTO_START_FILE);
      }
    } catch {
      // ignore — try next candidate
    }
  }
  return null;
}

export function getAutoStart(): boolean {
  const p = autoStartPath();
  if (!p) return false;
  try {
    const raw = fs.readFileSync(p, 'utf8').trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes';
  } catch {
    return false;
  }
}

export function setAutoStart(on: boolean): boolean {
  // 1. Try SDK storageDirectory first if context is available
  const context = getExtensionContext();
  if (context && context.environment.storageDirectory) {
    const dir = context.environment.storageDirectory;
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, AUTO_START_FILE), on ? 'true' : 'false', 'utf8');
      return true;
    } catch (err) {
      console.error(`[rc-setlist] setAutoStart write failed at ${dir}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  // 2. Fallback candidates (fixing the double-append bug)
  const candidates = [
    process.cwd(),
    process.env.HOME || null,
    process.env.USERPROFILE || null,
  ].filter((p): p is string => typeof p === 'string');

  for (const dir of candidates) {
    const setlistDir = path.join(dir, SETLIST_DIR);
    try {
      if (!fs.existsSync(setlistDir)) continue;
      fs.writeFileSync(path.join(setlistDir, AUTO_START_FILE), on ? 'true' : 'false', 'utf8');
      return true;
    } catch (err) {
      console.error(`[rc-setlist] setAutoStart write failed at ${setlistDir}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
  console.error('[rc-setlist] setAutoStart: no writable .setlist/ directory found');
  return false;
}
