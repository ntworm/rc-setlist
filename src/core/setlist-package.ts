/**
 * Packages of setlists: every setlist of a project in one file.
 *
 * A package carries what makes a setlist: its name, the custom order of its
 * songs, the colours and notes of its song book, and its lyrics. It leaves
 * the generated files behind (exports and click previews): they are made
 * again from the setlist.
 *
 * Live runs the extension under the permission model of Node: the extension
 * may only touch its own folder. The packages therefore live in a fixed
 * folder inside it, and the operator moves files in and out of that folder.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { parseSongBook } from './song-book.js';
import { atomicWriteFile } from '../util/atomic-write.js';

/** The extension of a package file. */
export const PACKAGE_EXTENSION = '.rcsetlist';

/** The name the format is known by inside the file. */
const PACKAGE_FORMAT = 'rc-setlist-package';

/** The largest package the extension reads. */
const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;

/** The most setlists one package may carry. */
const MAX_SETLISTS = 200;

/** The most lyric files one setlist may carry. */
const MAX_LYRICS = 1000;

/** The largest lyric file a package may carry. */
const MAX_LYRIC_BYTES = 256 * 1024;

/** The longest custom order a package may carry. */
const MAX_ORDER = 2000;

/** The most packages the panel lists. */
const MAX_LISTED = 200;

/** A lyric file, as the folder of a setlist names it. */
// eslint-disable-next-line no-control-regex -- a file name holds no control character.
const LYRIC_FILE = /^[^\\/:*?"<>|\u0000-\u001f]{1,200}\.(lrc|txt)$/i;

/** A package file, as the folder of the packages names it. */
// eslint-disable-next-line no-control-regex -- a file name holds no control character.
const PACKAGE_FILE = /^[^\\/:*?"<>|\u0000-\u001f]{1,200}\.rcsetlist$/i;

/** The folders of a setlist the package reads and writes. */
export interface PackageProfilePaths {
  lyrics: string;
  customOrder: string;
  songBook: string;
}

/** What the package needs of the manager of the setlists. */
export interface PackageProfileManager {
  list(): { id: string; name: string }[];
  getPaths(id: string): PackageProfilePaths;
  hasName(name: string): boolean;
  create(name: string): Promise<{ id: string; name: string }>;
  remove?(id: string, confirmationName: string): Promise<unknown>;
}

/** One package of the folder. */
export interface PackageFileEntry {
  file: string;
  modifiedAt: number;
}

/** One setlist, as it travels in a package. */
interface PackagedSetlist {
  name: string;
  customOrder: string[] | null;
  songBook: unknown;
  lyrics: { file: string; text: string }[];
}

/** The whole package. */
interface SetlistPackage {
  format: typeof PACKAGE_FORMAT;
  version: 1;
  exportedAt: string;
  projectName: string;
  setlists: PackagedSetlist[];
}

/** A package that cannot be read. */
export class PackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageError';
  }
}

/**
 * The folder of the packages, inside the folder of the extension.
 */
export function packagesDirectory(storageRoot: string): string {
  return path.join(storageRoot, 'packages');
}

/**
 * Whether a name is the name of a package file.
 */
export function isPackageFileName(file: string): boolean {
  return PACKAGE_FILE.test(file) && path.basename(file) === file;
}

/**
 * The packages of the folder, the newest first.
 */
export async function listPackages(dir: string): Promise<PackageFileEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const entries: PackageFileEntry[] = [];
  for (const file of names) {
    if (!isPackageFileName(file)) continue;
    try {
      const stat = await fs.stat(path.join(dir, file));
      if (stat.isFile()) entries.push({ file, modifiedAt: stat.mtimeMs });
    } catch {
      // A file that went away while the folder was read is not listed.
    }
  }
  entries.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return entries.slice(0, MAX_LISTED);
}

/**
 * Reads a file, or nothing when it is not there.
 */
async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Reads a list of strings, or nothing when the text is not one.
 */
function readOrder(text: string | null): string[] | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isOrder(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Whether a value is a custom order the setlist can load.
 */
function isOrder(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_ORDER &&
    value.every((title) => typeof title === 'string' && title.length <= 500)
  );
}

/**
 * The lyrics of a setlist, as the package carries them.
 */
async function readLyrics(dir: string): Promise<{ file: string; text: string }[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const lyrics: { file: string; text: string }[] = [];
  for (const file of names.sort()) {
    if (lyrics.length >= MAX_LYRICS) break;
    if (!LYRIC_FILE.test(file)) continue;
    const full = path.join(dir, file);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile() || stat.size > MAX_LYRIC_BYTES) continue;
      lyrics.push({ file, text: await fs.readFile(full, 'utf8') });
    } catch {
      // A lyric that cannot be read stays out of the package.
    }
  }
  return lyrics;
}

/**
 * One setlist, read out of its folder.
 */
async function readSetlist(
  manager: PackageProfileManager,
  profile: { id: string; name: string },
): Promise<PackagedSetlist> {
  const paths = manager.getPaths(profile.id);
  const bookText = await readOptional(paths.songBook);
  let songBook: unknown = null;
  if (bookText !== null) {
    try {
      songBook = parseSongBook(JSON.parse(bookText));
    } catch {
      songBook = null;
    }
  }
  return {
    name: profile.name,
    customOrder: readOrder(await readOptional(paths.customOrder)),
    songBook,
    lyrics: await readLyrics(paths.lyrics),
  };
}

/**
 * A name a file may carry on every system.
 */
function fileSafe(name: string): string {
  // eslint-disable-next-line no-control-regex -- a file name holds no control character.
  const unsafe = /[\\/:*?"<>|\u0000-\u001f]/g;
  const clean = name.replace(unsafe, ' ').replace(/\s+/g, ' ').trim();
  return clean.slice(0, 80) || 'RC Setlist';
}

/**
 * The moment of the export, as a file name can carry it.
 */
function stamp(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(
    date.getHours(),
  )}h${two(date.getMinutes())}`;
}

/**
 * Writes every setlist of the project into one package of the folder.
 *
 * Returns the name of the file it wrote.
 */
export async function exportPackage(
  manager: PackageProfileManager,
  options: { dir: string; projectName: string; now?: Date },
): Promise<string> {
  const now = options.now ?? new Date();
  const setlists: PackagedSetlist[] = [];
  for (const profile of manager.list()) setlists.push(await readSetlist(manager, profile));
  const pack: SetlistPackage = {
    format: PACKAGE_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    projectName: options.projectName,
    setlists,
  };
  await fs.mkdir(options.dir, { recursive: true });
  const base = `${fileSafe(options.projectName)} ${stamp(now)}`;
  const text = JSON.stringify(pack, null, 2);
  // A package the import would refuse is never written.
  if (Buffer.byteLength(text, 'utf8') > MAX_PACKAGE_BYTES) {
    throw new PackageError('The setlists are too large for one package.');
  }
  for (let attempt = 1; attempt < 100; attempt++) {
    const file = `${base}${attempt === 1 ? '' : ` (${attempt})`}${PACKAGE_EXTENSION}`;
    const target = path.join(options.dir, file);
    if (await exists(target)) continue;
    // Written whole or not at all: a broken package never shows up in the list.
    await atomicWriteFile(target, text);
    return file;
  }
  throw new PackageError('Too many packages with the same name in the folder.');
}

/**
 * The name of a setlist, read out of a package.
 */
function parseSetlistName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new PackageError('A setlist has no valid name.');
  }
  return value.trim();
}

/**
 * The custom order of a setlist, read out of a package.
 */
function parseSetlistOrder(value: unknown, name: string): string[] | null {
  if (value === null || value === undefined) return null;
  if (!isOrder(value)) throw new PackageError(`The order of "${name}" is malformed.`);
  return value;
}

/**
 * One lyric of a setlist, read out of a package.
 */
function parseLyric(value: unknown, name: string): { file: string; text: string } {
  const lyric = (value ?? {}) as Record<string, unknown>;
  if (typeof lyric.file !== 'string' || !LYRIC_FILE.test(lyric.file)) {
    throw new PackageError(`A lyric of "${name}" has an invalid file name.`);
  }
  if (typeof lyric.text !== 'string' || lyric.text.length > MAX_LYRIC_BYTES) {
    throw new PackageError(`A lyric of "${name}" is malformed.`);
  }
  return { file: path.basename(lyric.file), text: lyric.text };
}

/**
 * The lyrics of a setlist, read out of a package.
 */
function parseSetlistLyrics(value: unknown, name: string): { file: string; text: string }[] {
  const lyrics = value ?? [];
  if (!Array.isArray(lyrics) || lyrics.length > MAX_LYRICS) {
    throw new PackageError(`The lyrics of "${name}" are malformed.`);
  }
  return lyrics.map((entry: unknown) => parseLyric(entry, name));
}

/**
 * Reads one setlist of a package, refusing what the extension cannot load.
 */
function parseSetlist(value: unknown): PackagedSetlist {
  if (!value || typeof value !== 'object') throw new PackageError('A setlist is malformed.');
  const record = value as Record<string, unknown>;
  const name = parseSetlistName(record.name);
  return {
    name,
    customOrder: parseSetlistOrder(record.customOrder, name),
    songBook: record.songBook ?? null,
    lyrics: parseSetlistLyrics(record.lyrics, name),
  };
}

/**
 * Reads a package, refusing anything that is not one.
 */
export function parsePackage(text: string): PackagedSetlist[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PackageError('The file is not a package of RC Setlist.');
  }
  const record = (value ?? {}) as Record<string, unknown>;
  if (record.format !== PACKAGE_FORMAT || record.version !== 1) {
    throw new PackageError('The file is not a package of RC Setlist.');
  }
  const setlists = record.setlists;
  if (!Array.isArray(setlists) || setlists.length === 0 || setlists.length > MAX_SETLISTS) {
    throw new PackageError('The package holds no setlist.');
  }
  return setlists.map(parseSetlist);
}

/**
 * Whether a file is there.
 */
async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * The name of a setlist of a package, as the manager accepts it.
 */
function cleanName(name: string): string {
  // eslint-disable-next-line no-control-regex -- a name of a setlist holds no control character.
  const control = /[\u0000-\u001f\u007f-\u009f]/g;
  const clean = name.normalize('NFKC').replace(control, ' ').replace(/\s+/g, ' ').trim();
  return clean.slice(0, 70).trim() || 'Setlist';
}

/**
 * A name no setlist of the project has yet.
 */
function freeName(manager: PackageProfileManager, name: string): string {
  const base = cleanName(name);
  if (!manager.hasName(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base} (${suffix})`;
    if (!manager.hasName(candidate)) return candidate;
  }
  throw new PackageError(`No free name for "${name}".`);
}

/**
 * Brings the setlists of a package of the folder into the project.
 *
 * The setlists join the ones the project has: none is replaced, and a name
 * that is taken gets a number. The active setlist does not change. Returns
 * how many setlists came in.
 */
export async function importPackage(
  manager: PackageProfileManager,
  options: { dir: string; file: string },
): Promise<number> {
  if (!isPackageFileName(options.file)) throw new PackageError('Invalid package name.');
  const full = path.join(options.dir, options.file);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat || !stat.isFile()) throw new PackageError('The package is not in the folder.');
  if (stat.size > MAX_PACKAGE_BYTES) throw new PackageError('The package is too large.');
  const setlists = parsePackage(await fs.readFile(full, 'utf8'));
  // Everything is read and checked before the first setlist is created.
  const books = setlists.map((setlist) =>
    setlist.songBook === null ? null : parseSongBook(setlist.songBook),
  );
  const created: { id: string; name: string }[] = [];
  try {
    for (const [index, setlist] of setlists.entries()) {
      const profile = await manager.create(freeName(manager, setlist.name));
      created.push(profile);
      await writeSetlist(manager.getPaths(profile.id), setlist, books[index] ?? null);
    }
  } catch (err) {
    const left = await undoImport(manager, created);
    if (left.length) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new PackageError(
        `${detail} These setlists could not be taken back: ${left.join(', ')}.`,
      );
    }
    throw err;
  }
  return setlists.length;
}

/**
 * Writes the files of one imported setlist into its folder.
 */
async function writeSetlist(
  paths: PackageProfilePaths,
  setlist: PackagedSetlist,
  book: unknown,
): Promise<void> {
  if (setlist.customOrder) {
    await atomicWriteFile(paths.customOrder, JSON.stringify(setlist.customOrder));
  }
  if (book !== null) await atomicWriteFile(paths.songBook, JSON.stringify(book));
  await fs.mkdir(paths.lyrics, { recursive: true });
  for (const lyric of setlist.lyrics) {
    await atomicWriteFile(path.join(paths.lyrics, lyric.file), lyric.text);
  }
}

/**
 * Takes back the setlists an import created before it failed, so no setlist
 * is left half written. They go to the deleted ones, where they can still be
 * restored by hand.
 */
async function undoImport(
  manager: PackageProfileManager,
  created: { id: string; name: string }[],
): Promise<string[]> {
  const left: string[] = [];
  for (const profile of created) {
    try {
      if (!manager.remove) throw new PackageError('No way to take a setlist back.');
      await manager.remove(profile.id, profile.name);
    } catch {
      // Said to the operator: the setlist stayed in the project.
      left.push(profile.name);
    }
  }
  return left;
}
