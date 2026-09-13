import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const rootUrl = new URL('../', import.meta.url);

function readRequired(path) {
  const url = new URL(path, rootUrl);
  assert.ok(existsSync(url), `${path} must exist`);
  return readFileSync(url, 'utf8');
}

test('PolyForm license keeps its canonical sections and Ableton RC Setlist notice', () => {
  const license = readRequired('LICENSE');
  const headings = [
    'Acceptance',
    'Copyright License',
    'Distribution License',
    'Notices',
    'Changes and New Works License',
    'Patent License',
    'Noncommercial Purposes',
    'Personal Uses',
    'Noncommercial Organizations',
    'Fair Use',
    'No Other Rights',
    'Patent Defense',
    'Violations',
    'No Liability',
    'Definitions',
  ];

  assert.match(license, /^PolyForm Noncommercial License 1\.0\.0/);
  for (const heading of headings) assert.match(license, new RegExp(`^## ${heading}$`, 'm'));
  assert.match(license, /Required Notice: Copyright © 2026 Gabriel Worm/);
  assert.match(license, /https:\/\/github\.com\/ntworm\/rc-setlist/);
  assert.doesNotMatch(license, /Business Source License|Change Date|Change License/);
});

test('project notice states copyright, source-available license and trademark independence', () => {
  const notice = readRequired('NOTICE');
  // The notice carries no version on purpose: a version written by hand goes stale.
  assert.match(notice, /^Ableton RC Setlist\n/);
  assert.doesNotMatch(notice, /Setlist \d+\.\d+\.\d+/);
  assert.match(notice, /Copyright © 2026 Gabriel Worm/);
  assert.match(notice, /PolyForm Noncommercial 1\.0\.0/);
  assert.match(notice, /Ableton and Ableton Live are trademarks of Ableton AG/);
  assert.match(notice, /independent project and is not affiliated with or endorsed by Ableton AG/);
});

test('third-party notices cover direct runtime dependencies and bundled QR code', () => {
  const notices = readRequired('THIRD_PARTY_NOTICES.md');
  for (const dependency of ['osc-min', 'selfsigned', 'ws']) {
    assert.match(notices, new RegExp(`\\b${dependency}\\b`, 'i'));
  }
  assert.match(notices, /Kazuhiko Arase/);
  assert.match(notices, /Ableton Extensions SDK/i);
  assert.match(notices, /not redistributed in this source repository/i);
  // RC Bridge is a bundled fork of AbletonOSC (MIT): the attribution, the
  // licence text and the upstream commit it was taken from must travel with it.
  assert.match(notices, /## RC Bridge \(a fork of AbletonOSC\)/);
  assert.match(notices, /Daniel John Jones and contributors/);
  assert.match(notices, /0ca68214bd62c9b5cb641ca34006cfd70ba94430/);
  assert.match(notices, /RC Bridge[\s\S]*Permission is hereby granted, free of charge/);
});

test('third-party notice generation normalizes dependency license line endings', () => {
  const generator = readRequired('scripts/generate-third-party-notices.mjs');
  assert.ok(generator.includes(".replace(/\\r\\n?/g, '\\n')"));
  assert.ok(generator.includes("'--package-lock-only'"));
});

test('checked-in third-party notices match the generator output', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-third-party-notices.mjs', '--check'], {
    cwd: rootUrl,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
