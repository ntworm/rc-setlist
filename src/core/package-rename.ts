// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Renaming a package file of the packages folder.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PACKAGE_EXTENSION, PackageError, isPackageFileName } from './setlist-package.js';

/**
 * Renames a package file of the folder: the name is the one without the
 * extension, 1 to 120 characters, written as a file name may be written.
 */
export async function renamePackage(dir: string, file: string, newName: string): Promise<string> {
  const name = typeof newName === 'string' ? newName.normalize('NFKC').trim() : '';
  // eslint-disable-next-line no-control-regex -- a file name holds no control character.
  const unsafe = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/;
  if (!isPackageFileName(file) || !name || name.length > 120 || unsafe.test(name)) {
    throw new PackageError('Invalid package name.');
  }
  const target = `${name}${PACKAGE_EXTENSION}`;
  if (target === file) return file;
  if (
    await fs.stat(path.join(dir, target)).then(
      () => true,
      () => false,
    )
  ) {
    throw new PackageError('A package with that name is already in the folder.');
  }
  const source = path.join(dir, file);
  const stat = await fs.stat(source).catch(() => null);
  if (!stat || !stat.isFile()) throw new PackageError('The package is not in the folder.');
  await fs.rename(source, path.join(dir, target));
  return target;
}
