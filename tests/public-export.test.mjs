import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootUrl = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, rootUrl), 'utf8');

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
    'scripts/build.ts',
    'docs/media/en/performance.png',
    'docs/media/en/performance-phone.png',
    'docs/media/en/product-truth-discord.png',
    'docs/media/en/stage-control.png',
    'docs/media/en/stage-editorial.png',
    'docs/media/en/workflow.png',
    'docs/media/pt-BR/performance.png',
    'docs/media/pt-BR/performance-phone.png',
    'docs/media/pt-BR/product-truth-discord.png',
    'docs/media/pt-BR/stage-control.png',
    'docs/media/pt-BR/stage-editorial.png',
    'docs/media/pt-BR/workflow.png',
    'CODE_OF_CONDUCT.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'vendor/README.md',
  ]) {
    assert.match(
      allowlist,
      new RegExp(`^${required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
    );
  }

  for (const privatePath of [
    'docs/media/',
    'docs/media-kit.html',
    'docs/media/product-truth-linkedin.png',
    'docs/media/product-truth-square.png',
  ]) {
    assert.doesNotMatch(
      allowlist,
      new RegExp(`^${privatePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
    );
  }

  assert.doesNotMatch(
    allowlist,
    /AGENTS\.md|AGENT_GUIDE|\.agent-context|\.tgz|docs\/superpowers|docs\/agent|docs\/release\/BASELINE|release-kit|competitive_analysis|investigation_report/i,
  );
  assert.match(
    exporter,
    /tests\/scratch/,
    'internal scratch probes must be excluded from the public snapshot',
  );
});

test('snapshot verifier rejects private archives, internal context and stale branding', () => {
  const verifier = read('scripts/verify-public-snapshot.mjs');
  for (const rule of [
    'tgz',
    '.agent-context',
    'internal-scratch',
    'stale-product-name',
    'commercial-song',
  ]) {
    assert.ok(verifier.includes(rule), `verifier must cover ${rule}`);
  }
  assert.match(verifier, /src\/core\/profile-migration\.ts/);
  assert.match(verifier, /allowedContentRulePaths/);
});

test('snapshot verifier scopes scanner self-references to exact files', () => {
  const verifier = read('scripts/verify-public-snapshot.mjs');
  for (const exactPath of [
    'tests/content-sanitization.test.mjs',
    'tests/log.test.mjs',
    'docs/TROUBLESHOOTING.md',
    'docs/pt-BR/TROUBLESHOOTING.md',
    'tests/profile-migration.test.mjs',
    'tests/project-profile-scope.test.mjs',
    'tests/release-package.test.mjs',
    'tests/release-surface.test.mjs',
  ]) {
    assert.ok(verifier.includes(exactPath), `verifier must scope the exception to ${exactPath}`);
  }
  assert.doesNotMatch(
    verifier,
    /relative\.startsWith\(['"]tests\//,
    'verifier must not skip the tests tree',
  );
  assert.match(
    verifier,
    /relative === ['"]node_modules['"]/,
    'verifier may skip only the generated root dependency tree',
  );
});

test('every local link in a public document resolves inside the public snapshot', () => {
  // The export ships only what public-files.txt names, so a link to a file the
  // allowlist omits is dead in the published repository while working perfectly
  // in this one. Both USER-GUIDEs pointed at docs/architecture/, and four pages
  // pointed at docs/RELEASE-NOTES-0.5.1.md, before either was allowlisted.
  const root = fileURLToPath(rootUrl);
  const entries = read('public-files.txt')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const isPublic = (relative) =>
    entries.some((entry) =>
      entry.endsWith('/') ? relative.startsWith(entry) : relative === entry,
    );

  const documents = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry);
    if (entry.endsWith('/')) {
      if (!existsSync(absolute)) continue;
      const walk = (dir) => {
        for (const item of readdirSync(dir, { withFileTypes: true })) {
          const child = path.join(dir, item.name);
          if (item.isDirectory()) walk(child);
          else if (/\.(?:md|html)$/.test(item.name)) documents.push(child);
        }
      };
      walk(absolute);
    } else if (/\.(?:md|html)$/.test(entry) && existsSync(absolute)) {
      documents.push(absolute);
    }
  }

  const broken = [];
  for (const document of documents) {
    const text = readFileSync(document, 'utf8');
    const links = [
      ...text.matchAll(/\]\(([^)#?\s]+)\)/g),
      ...text.matchAll(/href="([^"#?\s]+)"/g),
    ].map((match) => match[1]);

    for (const link of links) {
      if (/^(?:https?:|mailto:|data:|#|\/\/)/.test(link)) continue;
      const target = path.resolve(path.dirname(document), link);
      if (!existsSync(target) || statSync(target).isDirectory()) continue;
      const relative = path.relative(root, target).split(path.sep).join('/');
      if (!isPublic(relative)) {
        broken.push(`${path.relative(root, document).split(path.sep).join('/')} -> ${link}`);
      }
    }
  }

  assert.deepEqual(broken, [], 'these links leave the public snapshot');
});

test('every allowlisted path exists', () => {
  // scripts/export-public-repo.ps1 throws on the first entry it cannot find, so
  // a stale line does not degrade the snapshot — it stops the publish outright.
  // Both of these had been dead for a release: build.ts moved to scripts/ and
  // the 0.5.0 notes were deleted, and the allowlist kept naming them.
  const root = fileURLToPath(rootUrl);
  const missing = read('public-files.txt')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .filter((entry) => !existsSync(path.join(root, entry)));

  assert.deepEqual(missing, [], 'these allowlist entries would abort the export');
});
