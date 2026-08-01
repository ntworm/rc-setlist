// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Atomic persistence helpers for Setlist (Task 4.3 / ADR-004)

import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
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
  const tmpPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
  } catch (err) {
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch {}
    }
    throw err;
  }
}

export function loadSetlist(dir: string, name: string): Setlist {
  const filePath = join(dir, `${name}${EXT}`);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Setlist;
}

export function listSetlists(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(EXT) && !f.includes('.tmp.'))
    .map((f) => f.slice(0, -EXT.length));
}

export function deleteSetlist(dir: string, name: string): void {
  const filePath = join(dir, `${name}${EXT}`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
