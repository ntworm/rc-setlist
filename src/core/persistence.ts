import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Setlist } from '../types.js';

const EXT = '.json';

function ensureFolder(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function saveSetlist(dir: string, name: string, data: Setlist): void {
  ensureFolder(dir);
  const filePath = join(dir, `${name}${EXT}`);
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function loadSetlist(dir: string, name: string): Setlist {
  const filePath = join(dir, `${name}${EXT}`);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Setlist;
}

export function listSetlists(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(EXT))
    .map((f) => f.slice(0, -EXT.length));
}

export function deleteSetlist(dir: string, name: string): void {
  const filePath = join(dir, `${name}${EXT}`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
