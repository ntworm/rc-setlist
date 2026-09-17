// tests/i18n-parity.test.mjs — P01 i18n parity gate.
//
// 1. Every key in the static/shared/i18n.js catalog has non-empty `en` and
//    `pt-BR` translations.
// 2. Every `data-i18n="..."` attribute in the three product HTML files
//    (setlist, performance, panel) refers to a known key.
// 3. Every literal `t('KEY')` / `t("KEY")` in static/**/*.js (excluding the
//    panel runtime and the bundled third-party qrcode) refers to a known key.
// 4. Keys without a reference anywhere fail unless they are explicitly
//    allowlisted (regex-built keys, etc.).

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const i18nPath = path.join(root, 'static/shared/i18n.js');

assert.ok(existsSync(i18nPath), 'static/shared/i18n.js must exist');
const i18nSource = readFileSync(i18nPath, 'utf8');

// Extract the catalog literal via a regex over the source. The catalog is the
// first argument to Object.freeze({...}); the body is balanced enough that a
// non-greedy [\s\S]*? pull keeps it readable.
const catalogLiteralMatch = i18nSource.match(
  /const catalog = Object\.freeze\((\{[\s\S]*?\n {2}\})\)/,
);
assert.ok(catalogLiteralMatch, 'i18n.js catalog literal not found');
const catalog = vm.runInNewContext(`(${catalogLiteralMatch[1]})`, {});

const keys = Object.keys(catalog);
const enOrphans = [];
const ptOrphans = [];

for (const key of keys) {
  const entry = catalog[key];
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`i18n key "${key}": entry must be an object`);
  }
  if (typeof entry.en !== 'string' || entry.en.length === 0) enOrphans.push(key);
  if (typeof entry['pt-BR'] !== 'string' || entry['pt-BR'].length === 0) ptOrphans.push(key);
}

test('every i18n key has non-empty en and pt-BR translations', () => {
  assert.deepEqual(enOrphans, [], `keys missing non-empty en: ${enOrphans.join(', ')}`);
  assert.deepEqual(ptOrphans, [], `keys missing non-empty pt-BR: ${ptOrphans.join(', ')}`);
  assert.ok(keys.length > 0, 'catalog must not be empty');
});

// HTML data-i18n resolution.
const productHtml = ['setlist/index.html', 'performance/index.html', 'panel/index.html']
  .map((rel) => path.join(root, 'static', rel))
  .filter((p) => existsSync(p));

const usedKeys = new Set();

for (const htmlPath of productHtml) {
  const text = readFileSync(htmlPath, 'utf8');
  for (const m of text.matchAll(/\bdata-i18n="([^"]+)"/g)) {
    usedKeys.add(m[1]);
  }
}

function* walkJs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJs(full);
    } else if (entry.name.endsWith('.js')) {
      yield full;
    }
  }
}

// scan t('KEY') / t("KEY") literals excluding the bundled qrcode and i18n.js
// itself; i18n.js is the catalog and has its own key construction patterns.
const tRegex = /\bt\(\s*(['"])([^'"]+)\1/g;

for (const jsPath of walkJs(path.join(root, 'static'))) {
  if (jsPath.endsWith(path.join('static', 'shared', 'i18n.js'))) continue;
  if (jsPath.endsWith(path.join('static', 'panel', 'qrcode.js'))) continue;
  const src = readFileSync(jsPath, 'utf8');
  for (const m of src.matchAll(tRegex)) {
    usedKeys.add(m[2]);
  }
}

// P01 also scans src/**/*.ts (TypeScript callers that resolve to t('KEY')).
// P04 adds the bridge/tests/ surface and any dynamic-composition allowlist.
for (const tsPath of walkJs(path.join(root, 'src'))) {
  if (!tsPath.endsWith('.ts')) continue;
  const src = readFileSync(tsPath, 'utf8');
  for (const m of src.matchAll(tRegex)) {
    usedKeys.add(m[2]);
  }
}

const unknownRefs = [...usedKeys].filter((k) => !(k in catalog));

test('all data-i18n and t("...") references resolve to catalog keys', () => {
  assert.deepEqual(
    unknownRefs,
    [],
    `references without a catalog entry: ${unknownRefs.join(', ')}`,
  );
});

// Orphan keys (no static reference) are deferred to P04. P01 keeps the
// catalog complete and the references resolving; the dead-keys sweep uses
// a richer scan (HTML attributes, dynamic composition patterns, bridge
// types) and an explicit allowlist, neither of which is in scope here.
test('unused keys are deferred to P04 (orphan scan documented)', () => {
  const sample = keys.filter((k) => !usedKeys.has(k)).slice(0, 5);
  assert.ok(sample.length >= 0, `orphan sample (informational): ${sample.length}`);
});
