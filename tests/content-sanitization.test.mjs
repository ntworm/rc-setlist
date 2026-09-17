import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.svg',
  '.ts',
  '.txt',
]);
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

test('runtime and static surfaces use the "RC Setlist" product name', () => {
  // Per Ableton trademark guidelines the product must not include "Ableton"
  // in its name. Two tiers:
  //   1. Strict (product identity): must mention "RC Setlist" and must NOT
  //      contain "Ableton RC Setlist".
  //   2. Migration context (INSTALL/TROUBLESHOOTING/FAQ/START-HERE): may
  //      mention "Ableton RC Setlist" when documenting the rename, but must
  //      also mention "RC Setlist" so the new name is the visible identity.
  const strict = [
    'README.md',
    'docs/README.md',
    'docs/USER-GUIDE.md',
    'docs/TESTER-GUIDE.md',
    'docs/DEVELOPMENT.md',
    'docs/index.html',
    'docs/media-kit.html',
    'docs/site-i18n.js',
    'docs/pt-BR/README.md',
    'docs/pt-BR/USER-GUIDE.md',
    'manifest.json',
    'package.json',
    'src/server/http.ts',
    'src/ui/panel.ts',
    'static/panel/index.html',
    'static/performance/index.html',
    'static/setlist/index.html',
    'static/shared/i18n.js',
    'release-template/RC-Bridge/Install-RC-Bridge.ps1',
    'release-template/RC-Bridge/Install RC Bridge.command',
    'release-template/RC-Bridge/README.txt',
  ];
  const migrationDocs = [
    'docs/INSTALL.md',
    'docs/TROUBLESHOOTING.md',
    'docs/FAQ.md',
    'docs/pt-BR/INSTALL.md',
    'docs/pt-BR/TROUBLESHOOTING.md',
    'docs/pt-BR/FAQ.md',
    'release-template/START-HERE.html',
    'release-template/README.txt',
  ];
  const findings = [];
  for (const relative of strict) {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) continue;
    const content = readFileSync(absolute, 'utf8');
    if (/\bAbleton RC Setlist\b/.test(content))
      findings.push(`${relative}: contains "Ableton RC Setlist"`);
    if (!/\bRC Setlist\b/.test(content))
      findings.push(`${relative}: does not mention "RC Setlist"`);
  }
  for (const relative of migrationDocs) {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) continue;
    const content = readFileSync(absolute, 'utf8');
    if (!/\bRC Setlist\b/.test(content))
      findings.push(`${relative}: does not mention "RC Setlist"`);
  }
  assert.deepEqual(findings, []);
});

test('marketing surfaces do not promote fictional fixtures or hidden diagnostics', () => {
  const files = [
    'docs/index.html',
    'docs/media-kit.html',
    'scripts/media-kit-template.html',
  ].filter((entry) => existsSync(path.join(root, entry)));
  const blockedMarketing = [/Neon Signal/i, /Synchronized demo text/i, />\s*Drift\s*</i];
  const findings = [];

  for (const relative of files) {
    const content = readFileSync(path.join(root, relative), 'utf8');
    for (const pattern of blockedMarketing) {
      if (pattern.test(content)) findings.push(`${relative}: ${pattern}`);
    }
  }

  assert.deepEqual(findings, []);
});
