// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Every `tests/*.test.mjs` file must be named by at least one package.json
// script, so no test file silently stops running.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const repoRoot = process.cwd();

/**
 * Returns the test files that no script names as a whitespace-separated token.
 * @param {string[]} testFiles repository-relative paths such as `tests/a.test.mjs`
 * @param {Record<string, string>} scripts the `scripts` block of package.json
 * @returns {string[]} the files missing from every script, in input order
 */
export function missingTestFiles(testFiles, scripts) {
  const tokens = new Set(
    Object.values(scripts).flatMap((command) => String(command).split(/\s+/).filter(Boolean)),
  );
  return testFiles.filter((file) => !tokens.has(file));
}

test('every tests/*.test.mjs file is listed by a package.json script', () => {
  const testFiles = readdirSync(join(repoRoot, 'tests'))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => `tests/${name}`);
  assert.ok(testFiles.length > 0, 'tests/ must contain test files');
  const { scripts } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const missing = missingTestFiles(testFiles, scripts);
  assert.deepEqual(missing, [], `test files not run by any script: ${missing.join(', ')}`);
});

test('missingTestFiles reports files no script names', () => {
  const scripts = {
    'test:src': 'node --test tests/a.test.mjs tests/b.test.mjs',
    lint: 'eslint . --max-warnings 0',
  };
  assert.deepEqual(
    missingTestFiles(['tests/a.test.mjs', 'tests/c.test.mjs', 'tests/b.test.mjs'], scripts),
    ['tests/c.test.mjs'],
  );
});

test('missingTestFiles needs an exact token, not a substring', () => {
  const scripts = { test: 'node --test tests/ab.test.mjs' };
  assert.deepEqual(missingTestFiles(['tests/b.test.mjs'], scripts), ['tests/b.test.mjs']);
  assert.deepEqual(missingTestFiles([], scripts), []);
});
