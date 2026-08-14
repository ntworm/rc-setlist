import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootUrl = new URL('../', import.meta.url);
const rootPath = fileURLToPath(rootUrl);

function read(path) {
  return readFileSync(new URL(path, rootUrl), 'utf8');
}

test('machine-readable metadata identifies the Ableton RC Setlist 0.5.1 release', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  const manifest = JSON.parse(read('manifest.json'));

  assert.equal(packageJson.name, 'rc-setlist');
  assert.equal(packageJson.version, '0.5.1');
  assert.equal(packageLock.version, '0.5.1');
  assert.equal(packageLock.packages?.['']?.version, '0.5.1');
  assert.equal(packageJson.author, 'ntworm');
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, 'PolyForm-Noncommercial-1.0.0');
  assert.equal(packageJson.repository?.url, 'git+https://github.com/ntworm/rc-setlist.git');
  assert.equal(packageJson.homepage, 'https://ntworm.github.io/rc-setlist/');
  assert.equal(packageJson.engines?.node, '>=24.16.0 <25');
  assert.equal(packageJson.packageManager, 'npm@11.8.0');

  assert.equal(manifest.name, 'Ableton RC Setlist');
  assert.equal(manifest.author, 'ntworm');
  assert.equal(manifest.version, '0.5.1');
});

test('project license is PolyForm Noncommercial with the required notice', () => {
  const license = read('LICENSE');
  assert.match(license, /^PolyForm Noncommercial License 1\.0\.0/m);
  assert.match(license, /Required Notice:/);
  assert.match(license, /Copyright © 2026 Gabriel Worm/);
  assert.match(license, /https:\/\/github\.com\/ntworm\/rc-setlist/);
  assert.doesNotMatch(license, /Business Source License|Change Date|MIT License/);
});

test('public project metadata and repository hygiene files exist', () => {
  for (const path of [
    '.gitattributes',
    '.nvmrc',
    '.node-version',
    '.github/CODEOWNERS',
    '.github/dependabot.yml',
    '.github/pull_request_template.md',
    'NOTICE',
    'THIRD_PARTY_NOTICES.md',
    'public-files.txt',
    'vendor/README.md',
  ]) {
    assert.ok(existsSync(new URL(path, rootUrl)), `${path} must exist`);
  }
});

test('package manifest has no repository-local Ableton SDK or CLI archive', () => {
  const packageJson = JSON.parse(read('package.json'));
  const serialized = JSON.stringify(packageJson);

  assert.doesNotMatch(serialized, /ableton-extensions-(?:sdk|cli)-[^"']+\.tgz/i);
  assert.doesNotMatch(serialized, /file:\.\/vendor/i);
});

test('runtime and static surfaces use only the Ableton RC Setlist product name', () => {
  const files = ['src', 'static'].flatMap((directory) =>
    readdirSync(path.join(rootPath, directory), { recursive: true })
      .map((entry) => path.join(directory, entry))
      .filter((entry) => /\.(?:css|html|js|ts)$/i.test(entry)),
  );
  files.push('scripts/build.ts', 'manifest.json');

  const stale = files.filter((file) => {
    let content = read(file);
    if (file.replaceAll('\\', '/') === 'src/core/profile-migration.ts') {
      content = content.replaceAll('worm.ableton-setlist-bridge', '');
    }
    return /Ableton Setlist Bridge|ableton-setlist-bridge|worm\.ableton/i.test(content);
  });
  assert.deepEqual(stale, []);
  assert.match(read('static/panel/index.html'), />Ableton RC Setlist</);
  assert.match(read('static/setlist/index.html'), /<title>Ableton RC Setlist\b/);
  assert.match(read('static/performance/index.html'), /<title>Ableton RC Setlist\b/);
});
