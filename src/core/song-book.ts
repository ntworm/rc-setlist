// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist

import { reconcileSongIdentities, type IdentifiedSong, type IncomingSong } from './song-identity.js';

/**
 * Everything RC Setlist remembers about a song that Ableton does not store.
 *
 * Today that is a colour. The shape exists so that notes, ratings or anything
 * else can join without another reconciliation layer being invented — the point
 * of song-identity.ts is that this file is the only place that has to know how
 * side data is keyed.
 *
 * Persisted per profile, beside custom-order.json, and never written into the
 * Live project. See docs/architecture/song-identity.md for the contract.
 */

export interface SongSideData {
  /** One of the eight palette values, or absent for the default neutral chip. */
  color?: string;
}

export interface SongBook {
  version: 1;
  /** Monotonic count of cue reloads, used only to age tombstones. */
  reloadCount: number;
  /** Identities currently present in Live, in Live's order. */
  present: IdentifiedSong[];
  /** Identities not present now but still remembered. */
  tombstoned: IdentifiedSong[];
  /** Side data by song id. Entries survive while the identity does. */
  data: Record<string, SongSideData>;
}

export function emptySongBook(): SongBook {
  return { version: 1, reloadCount: 0, present: [], tombstoned: [], data: {} };
}

function isIdentity(value: unknown): value is IdentifiedSong {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string'
    && typeof entry.name === 'string'
    && typeof entry.time === 'number'
    && Number.isFinite(entry.time)
    && (entry.missingSince === undefined || typeof entry.missingSince === 'number');
}

/**
 * Parse a stored book, tolerating anything. A corrupt or hand-edited file costs
 * the user their colours; it must never cost them a working setlist, so this
 * degrades to an empty book instead of throwing.
 */
export function parseSongBook(raw: unknown): SongBook {
  if (typeof raw !== 'object' || raw === null) return emptySongBook();
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== 1) return emptySongBook();

  const present = Array.isArray(candidate.present) ? candidate.present.filter(isIdentity) : [];
  const tombstoned = Array.isArray(candidate.tombstoned) ? candidate.tombstoned.filter(isIdentity) : [];
  const reloadCount = typeof candidate.reloadCount === 'number' && Number.isFinite(candidate.reloadCount)
    ? candidate.reloadCount
    : 0;

  const data: Record<string, SongSideData> = {};
  if (typeof candidate.data === 'object' && candidate.data !== null) {
    for (const [id, value] of Object.entries(candidate.data as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue;
      const color = (value as Record<string, unknown>).color;
      if (typeof color === 'string') data[id] = { color };
    }
  }

  return { version: 1, reloadCount, present, tombstoned, data };
}

/**
 * Fold a fresh cue list into the book: reconcile identities, age tombstones,
 * and drop side data whose identity was forgotten for good.
 */
export function applyCues(
  book: SongBook,
  cues: readonly IncomingSong[],
  makeId: () => string,
): SongBook {
  const reloadCount = book.reloadCount + 1;
  const result = reconcileSongIdentities(
    [...book.present, ...book.tombstoned],
    cues,
    { reloadCount, makeId },
  );

  const data = { ...book.data };
  for (const id of result.pruned) delete data[id];

  return {
    version: 1,
    reloadCount,
    present: result.present,
    tombstoned: result.tombstoned,
    data,
  };
}

export function getSongColor(book: SongBook, songId: string): string | undefined {
  return book.data[songId]?.color;
}

/** Passing undefined clears the colour and removes the entry entirely. */
export function setSongColor(book: SongBook, songId: string, color: string | undefined): SongBook {
  const data = { ...book.data };
  const rest: SongSideData = { ...data[songId] };
  if (color === undefined) delete rest.color;
  else rest.color = color;

  if (Object.keys(rest).length === 0) delete data[songId];
  else data[songId] = rest;

  return { ...book, data };
}

/** Colour lookup for the UI, keyed by beat position — what the client knows. */
export function colorsByTime(book: SongBook): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of book.present) {
    const color = book.data[entry.id]?.color;
    if (color) out[String(entry.time)] = color;
  }
  return out;
}
