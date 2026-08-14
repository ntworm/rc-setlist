import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const rootUrl = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, rootUrl), 'utf8');

function publicEntries() {
  return read('public-files.txt')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function isPubliclyCovered(path, entries) {
  return entries.includes(path)
    || entries.some((entry) => entry.endsWith('/') && path.startsWith(entry));
}

test('public export uses an explicit allowlist and reproducible verifier', () => {
  for (const file of [
    'public-files.txt',
    'scripts/export-public-repo.ps1',
    'scripts/verify-public-snapshot.mjs',
  ]) {
    assert.ok(existsSync(new URL(file, rootUrl)), `${file} must exist`);
  }

  const allowlist = read('public-files.txt');
  const exporter = read('scripts/export-public-repo.ps1');
  for (const required of [
    'src/',
    'static/',
    'tests/',
    'docs/index.html',
    'docs/site-i18n.js',
    'docs/RELEASE-NOTES-0.4.1.md',
    'docs/RELEASE-NOTES-0.4.2.md',
    'docs/RELEASE-NOTES-0.5.1.md',
    'docs/media/en/performance.png',
    'docs/media/en/product-truth-discord.png',
    'docs/media/en/stage-control.png',
    'docs/media/en/stage-editorial.png',
    'docs/media/en/workflow.png',
    'docs/media/pt-BR/performance.png',
    'docs/media/pt-BR/product-truth-discord.png',
    'docs/media/pt-BR/stage-control.png',
    'docs/media/pt-BR/stage-editorial.png',
    'docs/media/pt-BR/workflow.png',
    'CODE_OF_CONDUCT.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'vendor/README.md',
  ]) {
    assert.match(allowlist, new RegExp(`^${required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }

  for (const privatePath of [
    'docs/media/',
    'docs/media-kit.html',
    'docs/media/product-truth-linkedin.png',
    'docs/media/product-truth-square.png',
  ]) {
    assert.doesNotMatch(allowlist, new RegExp(`^${privatePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }

  assert.doesNotMatch(allowlist, /AGENTS\.md|AGENT_GUIDE|\.agent-context|\.tgz|docs\/superpowers|docs\/agent|docs\/release\/BASELINE|release-kit|competitive_analysis|investigation_report/i);
  assert.match(exporter, /tests\/scratch/, 'internal scratch probes must be excluded from the public snapshot');
});

test('public export entries exist and cover the complete 0.5.1 publication surface', () => {
  const entries = publicEntries();

  for (const entry of entries) {
    assert.ok(existsSync(new URL(entry, rootUrl)), `${entry} must exist before export`);
  }

  for (const requiredPath of [
    'scripts/build.ts',
    'docs/.nojekyll',
    'docs/RELEASE-NOTES-0.5.1.md',
    'docs/pt-BR/NOTAS-DA-VERSAO-0.5.1.md',
  ]) {
    assert.ok(isPubliclyCovered(requiredPath, entries), `${requiredPath} must be covered by the public allowlist`);
  }

  assert.ok(!entries.includes('build.ts'), 'the removed root build.ts path must not be exported');
  assert.ok(!entries.includes('vendor/AbletonOSC'), 'the external AbletonOSC gitlink must not be exported');
  assert.ok(!existsSync(new URL('vendor/AbletonOSC', rootUrl)), 'the public source tree must not track the external AbletonOSC checkout');
  assert.ok(!existsSync(new URL('.mailmap', rootUrl)), 'the source tree must not rewrite automated-agent identities as contributors');
});

test('snapshot verifier rejects private archives, internal context and stale branding', () => {
  const verifier = read('scripts/verify-public-snapshot.mjs');
  for (const rule of ['tgz', '.agent-context', 'internal-scratch', 'stale-product-name', 'commercial-song']) {
    assert.ok(verifier.includes(rule), `verifier must cover ${rule}`);
  }
  assert.match(verifier, /src\/core\/profile-migration\.ts/);
  assert.match(verifier, /allowedContentRulePaths/);
});

test('snapshot verifier scopes scanner self-references to exact files', () => {
  const verifier = read('scripts/verify-public-snapshot.mjs');
  for (const exactPath of [
    'tests/content-sanitization.test.mjs',
    'docs/TROUBLESHOOTING.md',
    'docs/pt-BR/TROUBLESHOOTING.md',
    'tests/profile-migration.test.mjs',
    'tests/project-profile-scope.test.mjs',
    'tests/release-package.test.mjs',
    'tests/release-surface.test.mjs',
  ]) {
    assert.ok(verifier.includes(exactPath), `verifier must scope the exception to ${exactPath}`);
  }
  assert.doesNotMatch(verifier, /relative\.startsWith\(['"]tests\//, 'verifier must not skip the tests tree');
  assert.match(verifier, /relative === ['"]node_modules['"]/, 'verifier may skip only the generated root dependency tree');
});
