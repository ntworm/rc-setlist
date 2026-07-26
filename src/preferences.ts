import * as fs from 'node:fs';
import * as path from 'node:path';
import { getExtensionContext } from './context.js';

const SETLIST_DIR = '.setlist';
const AUTO_START_FILE = 'auto-start';
const UI_LOCALE_FILE = 'ui-locale';

function preferencePath(fileName: string): string | null {
  // 1. Try SDK storageDirectory first if context is available
  const context = getExtensionContext();
  if (context && context.environment.storageDirectory) {
    return path.join(context.environment.storageDirectory, fileName);
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
        return path.join(probe, fileName);
      }
    } catch {
      // ignore — try next candidate
    }
  }
  return null;
}

function readPreference(fileName: string): string | null {
  const preferenceFile = preferencePath(fileName);
  if (!preferenceFile) return null;
  try {
    return fs.readFileSync(preferenceFile, 'utf8').trim();
  } catch {
    return null;
  }
}

function writePreference(fileName: string, value: string): boolean {
  // 1. Try SDK storageDirectory first if context is available
  const context = getExtensionContext();
  if (context && context.environment.storageDirectory) {
    const dir = context.environment.storageDirectory;
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, fileName), value, 'utf8');
      return true;
    } catch (err) {
      console.error(`[rc-setlist] preference write failed at ${dir}: ${err instanceof Error ? err.message : String(err)}`);
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
      fs.writeFileSync(path.join(setlistDir, fileName), value, 'utf8');
      return true;
    } catch (err) {
      console.error(`[rc-setlist] preference write failed at ${setlistDir}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
  console.error(`[rc-setlist] ${fileName}: no writable .setlist/ directory found`);
  return false;
}

export function getAutoStart(): boolean {
  const raw = readPreference(AUTO_START_FILE)?.toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes';
}

export function setAutoStart(on: boolean): boolean {
  return writePreference(AUTO_START_FILE, on ? 'true' : 'false');
}

export type UiLocale = 'en' | 'pt-BR';

export function getUiLocale(): UiLocale {
  return readPreference(UI_LOCALE_FILE) === 'pt-BR' ? 'pt-BR' : 'en';
}

export function setUiLocale(locale: string): boolean {
  if (locale !== 'en' && locale !== 'pt-BR') return false;
  return writePreference(UI_LOCALE_FILE, locale);
}
