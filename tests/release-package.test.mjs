import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const rootUrl = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, rootUrl), 'utf8');

test('release installation kit has a deterministic packager and owner-facing templates', () => {
  for (const file of [
    'scripts/package-release-candidate.ps1',
    'release-template/START-HERE.html',
    'release-template/README.txt',
    'release-template/en/TEST-CHECKLIST.md',
    'release-template/pt-BR/TEST-CHECKLIST.md',
  ]) {
    assert.ok(existsSync(new URL(file, rootUrl)), `${file} must exist`);
  }

  const packager = read('scripts/package-release-candidate.ps1');
  for (const required of [
    'Ableton-RC-Setlist-$Version.ablx',
    'Ableton-RC-Setlist-$Version-Installation-Kit',
    'SHA256SUMS.txt',
    'THIRD_PARTY_NOTICES.md',
    'en/TEST-CHECKLIST.md',
    'pt-BR/TEST-CHECKLIST.md',
    'en/INSTALL.md',
    'pt-BR/INSTALL.md',
    'START-HERE.html',
    'Get-ChildItem -LiteralPath $exampleSource',
  ]) {
    assert.ok(packager.includes(required), `packager must include ${required}`);
  }

  assert.doesNotMatch(packager, /Copy-Item[^\n]+AbletonOSC/i, 'AbletonOSC must remain an external upstream install');
  assert.match(packager, /Release verification: automated gates passed; rehearse in Ableton Live before stage use/);
});

test('release templates describe the real prerequisites and safe local-network setup', () => {
  const combined = [
    read('release-template/START-HERE.html'),
    read('release-template/README.txt'),
    read('release-template/en/TEST-CHECKLIST.md'),
    read('release-template/pt-BR/TEST-CHECKLIST.md'),
  ].join('\n');

  assert.match(combined, /Ableton Live 12\.4\.5\+/);
  assert.match(combined, /AbletonOSC/);
  assert.match(combined, /trusted (?:local network|LAN)/i);
  assert.match(combined, /Ableton-RC-Setlist-0\.4\.0\.ablx/);
  assert.doesNotMatch(combined, /Ableton Setlist Bridge|commercial-song|real setlist/i);
});
