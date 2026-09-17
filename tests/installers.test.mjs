// Validates the kit-side installer and data-migration wrappers, and proves
// the Node migration helper performs an idempotent, never-overwriting copy
// from the 0.x data layout to the 1.0 layout.
//
// Coverage:
//   - bash syntax check on release-template/Migrate RC Setlist Data.command
//   - PowerShell parse check on release-template/Migrate-RC-Setlist-Data.ps1
//   - PowerShell parse check on release-template/Migrate-RC-Setlist-Data.cmd
//   - PowerShell parse check on release-template/RC-Bridge/Install-RC-Bridge.ps1
//   - bash syntax check on release-template/RC-Bridge/Install RC Bridge.command
//   - functional test of scripts/migrate-data.mjs against a temp directory

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const bashPath =
  process.platform === 'win32'
    ? existsSync('C:/Program Files/Git/bin/bash.exe')
      ? 'C:/Program Files/Git/bin/bash.exe'
      : 'bash'
    : 'bash';

function hasExec(bin) {
  try {
    const probe = spawnSync(bin, ['--version'], { stdio: 'ignore' });
    return probe.status === 0 || probe.status === 1;
  } catch {
    return false;
  }
}

const powershellBin = hasExec('powershell')
  ? 'powershell'
  : hasExec('pwsh')
    ? 'pwsh'
    : null;

const hasBash = hasExec(bashPath);

function bashSyntax(file) {
  if (!hasBash) {
    return { ok: false, stderr: 'bash not found' };
  }
  const probe = spawnSync(bashPath, ['-n', file], { encoding: 'utf8' });
  return {
    ok: probe.status === 0,
    stdout: probe.stdout ?? '',
    stderr: probe.stderr ?? '',
    status: probe.status,
  };
}

function powershellSyntax(file) {
  if (!powershellBin) {
    return { ok: false, stderr: 'PowerShell not found' };
  }
  const probe = spawnSync(
    powershellBin,
    [
      '-NoProfile',
      '-Command',
      `[System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$null, [ref]$null)`,
    ],
    { encoding: 'utf8' },
  );
  return {
    ok: probe.status === 0,
    stdout: probe.stdout ?? '',
    stderr: probe.stderr ?? '',
    status: probe.status,
  };
}

function nodeSyntax(file) {
  const probe = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  return {
    ok: probe.status === 0,
    stdout: probe.stdout ?? '',
    stderr: probe.stderr ?? '',
    status: probe.status,
  };
}

const skip = (label) => ({ skipped: true, label });

test('bash syntax: macOS migration command', { skip: !hasBash }, () => {
  const file = path.join(root, 'release-template', 'Migrate RC Setlist Data.command');
  const result = bashSyntax(file);
  assert.equal(result.ok, true, `${file} did not parse: ${result.stderr}`);
});

test('bash syntax: macOS bridge installer command', { skip: !hasBash }, () => {
  const file = path.join(root, 'release-template', 'RC-Bridge', 'Install RC Bridge.command');
  const result = bashSyntax(file);
  assert.equal(result.ok, true, `${file} did not parse: ${result.stderr}`);
});

test('PowerShell syntax: Windows migration script', { skip: !powershellBin }, () => {
  const file = path.join(root, 'release-template', 'Migrate-RC-Setlist-Data.ps1');
  const result = powershellSyntax(file);
  assert.equal(result.ok, true, `${file} did not parse: ${result.stderr}`);
});

test('PowerShell syntax: Windows migration launcher', { skip: !powershellBin }, () => {
  const file = path.join(root, 'release-template', 'Migrate-RC-Setlist-Data.cmd');
  const result = powershellSyntax(file);
  assert.equal(result.ok, true, `${file} did not parse: ${result.stderr}`);
});

test('PowerShell syntax: Windows bridge installer', { skip: !powershellBin }, () => {
  const file = path.join(root, 'release-template', 'RC-Bridge', 'Install-RC-Bridge.ps1');
  const result = powershellSyntax(file);
  assert.equal(result.ok, true, `${file} did not parse: ${result.stderr}`);
});

test('Node syntax: migrate-data.mjs', () => {
  const file = path.join(root, 'scripts', 'migrate-data.mjs');
  const result = nodeSyntax(file);
  assert.equal(result.ok, true, `${file} did not parse: ${result.stderr}`);
});

test('migrate-data.mjs: copies 0.x data into the 1.0 layout without overwriting', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'rc-migrate-'));
  const source = path.join(work, 'ntworm.ableton-rc-setlist');
  const dest = path.join(work, 'ntworm.rc-setlist');

  mkdirSync(path.join(source, 'profiles', 'main'), { recursive: true });
  mkdirSync(path.join(source, 'project-setlists'), { recursive: true });
  writeFileSync(path.join(source, 'profiles', 'index.json'), '[]');
  writeFileSync(
    path.join(source, 'profiles', 'main', 'setlist.json'),
    '{"order":[],"color":"red"}',
  );
  writeFileSync(path.join(source, 'project-setlists', 'session.json'), '{"k":"v"}');
  writeFileSync(path.join(source, 'token'), 'tokenvalue');
  writeFileSync(path.join(source, 'ui-locale'), 'pt-BR');
  writeFileSync(path.join(source, 'auto-start'), 'true');

  const helper = path.join(root, 'scripts', 'migrate-data.mjs');
  const first = spawnSync(
    process.execPath,
    [helper, '--source', source, '--dest', dest, '--json'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(first.status, 0, `migrate failed: ${first.stderr}`);
  const summary = JSON.parse(first.stdout);
  assert.equal(summary.action, 'migrated');
  assert.equal(summary.ok, true);
  assert.ok(
    existsSync(path.join(dest, 'profiles', 'main', 'setlist.json')),
    'setlist.json not copied',
  );
  assert.equal(
    readFileSync(path.join(dest, 'profiles', 'main', 'setlist.json'), 'utf8'),
    '{"order":[],"color":"red"}',
  );
  assert.equal(readFileSync(path.join(dest, 'token'), 'utf8'), 'tokenvalue');
  assert.equal(
    readFileSync(path.join(source, 'token'), 'utf8'),
    'tokenvalue',
    'source must be untouched',
  );

  // Mutate the destination to prove a second run does not overwrite.
  writeFileSync(path.join(dest, 'token'), 'edited-by-user');
  const second = spawnSync(
    process.execPath,
    [helper, '--source', source, '--dest', dest, '--json'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(second.status, 0, `second migrate failed: ${second.stderr}`);
  assert.equal(
    readFileSync(path.join(dest, 'token'), 'utf8'),
    'edited-by-user',
    'second run must not overwrite',
  );

  // A destination that already has profiles/ is a no-op.
  mkdirSync(path.join(dest, 'profiles'), { recursive: true });
  writeFileSync(path.join(dest, 'profiles', 'index.json'), '[]');
  const third = spawnSync(
    process.execPath,
    [helper, '--source', source, '--dest', dest, '--json'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(third.status, 0);
  const thirdSummary = JSON.parse(third.stdout);
  assert.equal(thirdSummary.action, 'no-op');
});

test('migrate-data.mjs: exits 1 with a clear message when the source is missing', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'rc-migrate-missing-'));
  const source = path.join(work, 'ntworm.ableton-rc-setlist');
  const dest = path.join(work, 'ntworm.rc-setlist');
  const helper = path.join(root, 'scripts', 'migrate-data.mjs');
  const probe = spawnSync(process.execPath, [helper, '--source', source, '--dest', dest], {
    encoding: 'utf8',
  });
  assert.equal(probe.status, 1, 'expected exit 1');
  assert.match(probe.stderr, /Source directory not found/);
});

test('public-files.txt: kit scripts are not in the public snapshot allowlist', () => {
  // The kit scripts and the Node helper must NOT appear in the public snapshot
  // (release-template is, but its contents are shipped only inside the kit).
  const allow = readFileSync(path.join(root, 'public-files.txt'), 'utf8');
  assert.equal(
    allow.includes('Migrate-RC-Setlist-Data.ps1'),
    false,
    'public-files.txt must not list kit migration scripts',
  );
  assert.equal(allow.includes('Migrate RC Setlist Data.command'), false);
  assert.equal(allow.includes('scripts/migrate-data.mjs'), false);
});
