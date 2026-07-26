import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.ts', '.txt']);
const blocked = [
  /Wonderwall/i,
  /\bOasis\b/i,
  /Pearl Jam/i,
  /\bColdplay\b/i,
  /\bRadiohead\b/i,
  /Led Zeppelin/i,
  /Stairway to Heaven/i,
  /Today is gonna be the day/i,
  /Look at the stars[\s\S]{0,80}shine for you/i,
  /When you were here before/i,
  /C:\\Users\\ExampleUser/i,
  /C:\/Users\/ExampleUser/i,
  /file:\/\/\/[a-z]:\/Users\//i,
];

function collect(entry, files = []) {
  const absolute = path.join(root, entry);
  if (!existsSync(absolute)) return files;
  const statEntries = readdirSync(absolute, { withFileTypes: true });
  for (const item of statEntries) {
    const relative = path.join(entry, item.name);
    if (item.isDirectory()) collect(relative, files);
    else if (textExtensions.has(path.extname(item.name).toLowerCase())) files.push(relative);
  }
  return files;
}

function assertClean(files) {
  const findings = [];
  for (const relative of files) {
    if (relative.endsWith('content-sanitization.test.mjs')) continue;
    const content = readFileSync(path.join(root, relative), 'utf8');
    for (const pattern of blocked) {
      if (pattern.test(content) || pattern.test(relative)) findings.push(`${relative}: ${pattern}`);
    }
  }
  assert.deepEqual(findings, []);
}

test('source, tests, static clients and examples contain only fictional material', () => {
  const files = ['examples', 'src', 'static', 'tests'].flatMap((entry) => collect(entry));
  assertClean(files);
});

test('public-facing prose contains no commercial-song or personal-path fixture', () => {
  const files = [
    'README.md',
    'CHANGELOG.md',
    'INSTALL.md',
    'USER-GUIDE.md',
    'FAQ.md',
    'PRIVACY.md',
    'SECURITY.md',
    'docs/index.html',
    'docs/README.md',
    'docs/INSTALL.md',
    'docs/USER-GUIDE.md',
    'docs/TESTER-GUIDE.md',
    'docs/DEVELOPMENT.md',
    'docs/FAQ.md',
    'docs/TROUBLESHOOTING.md',
  ].filter((entry) => existsSync(path.join(root, entry)));
  assertClean(files);
});
