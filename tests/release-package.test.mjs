import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const rootUrl = new URL('../', import.meta.url);
const rootPath = fileURLToPath(rootUrl);
const read = (file) => readFileSync(new URL(file, rootUrl), 'utf8');

test('0.5.1 metadata and installation kit identify the same final release', () => {
  assert.equal(JSON.parse(read('package.json')).version, '0.5.1');
  assert.match(read('release-template/README.txt'), /Ableton-RC-Setlist-0\.5\.1\.ablx/);
  assert.match(read('scripts/package-release-candidate.ps1'), /\[string\]\$Version = "0\.5\.1"/);
  assert.match(read('scripts/package-release-candidate.ps1'), /RELEASE-NOTES-0\.5\.1\.md/);
  assert.match(read('scripts/package-release-candidate.ps1'), /NOTAS-DA-VERSAO-0\.5\.1\.md/);
});

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
    'en/RELEASE-NOTES.md',
    'pt-BR/NOTAS-DA-VERSAO.md',
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
  assert.match(combined, /Ableton-RC-Setlist-0\.5\.1\.ablx/);
  assert.doesNotMatch(combined, /Ableton Setlist Bridge|commercial-song|real setlist/i);
});

test('release templates prevent the AbletonOSC folder mix-up in both languages', () => {
  for (const path of [
    'release-template/README.txt',
    'release-template/en/TEST-CHECKLIST.md',
    'release-template/pt-BR/TEST-CHECKLIST.md',
  ]) {
    const content = read(path);
    assert.match(content, /User Library[\\/]Remote Scripts[\\/]AbletonOSC/i, `${path} must show the exact install target`);
    assert.match(content, /User Remote Scripts/i, `${path} must distinguish Live's hidden preferences folder`);
    assert.match(content, /AbletonOSC[\\/]__init__\.py/i, `${path} must show how to detect an extra nested folder`);
  }
});

test('current 0.5.1 install and release surfaces do not retain 0.5.0 references', () => {
  const currentSurfaces = [
    'docs/README.md',
    'docs/pt-BR/README.md',
    'docs/INSTALL.md',
    'docs/pt-BR/INSTALL.md',
    'docs/TESTER-GUIDE.md',
    'release-template/START-HERE.html',
    'release-template/README.txt',
    'release-template/en/TEST-CHECKLIST.md',
    'release-template/pt-BR/TEST-CHECKLIST.md',
  ];

  for (const file of currentSurfaces) {
    const content = read(file);
    assert.match(content, /0\.5\.1/, `${file} must identify the current 0.5.1 release`);
    if (file === 'docs/pt-BR/README.md') {
      assert.match(content, /\[O que há de novo na versão 0\.5\.1\]\(NOTAS-DA-VERSAO-0\.5\.1\.md\)/);
    }
    assert.doesNotMatch(
      content,
      /Ableton-RC-Setlist-0\.5\.0\.ablx|RELEASE-NOTES-0\.5\.0|NOTAS-DA-VERSAO-0\.5\.0/i,
      `${file} must not point at 0.5.0 installer or release notes`,
    );
    assert.doesNotMatch(
      content,
      /(?:Ableton RC Setlist|Ableton-RC-Setlist|Release checklist|Checklist de lan[cç]amento|INSTALLATION KIT|KIT DE INSTALA[CÇ][AÃ]O)[^\r\n]*0\.5\.0/i,
      `${file} must not label the current kit as 0.5.0`,
    );
  }
});

test('certificate onboarding is explicit in both languages and canonical English stays English', () => {
  const englishCombined = [
    read('release-template/START-HERE.html'),
    read('release-template/README.txt'),
    read('release-template/en/TEST-CHECKLIST.md'),
    read('docs/INSTALL.md'),
    read('docs/FAQ.md'),
    read('docs/TROUBLESHOOTING.md'),
  ].join('\n');
  const portugueseCombined = [
    read('release-template/START-HERE.html'),
    read('release-template/README.txt'),
    read('release-template/pt-BR/TEST-CHECKLIST.md'),
    read('docs/pt-BR/INSTALL.md'),
    read('docs/pt-BR/FAQ.md'),
    read('docs/pt-BR/TROUBLESHOOTING.md'),
  ].join('\n');

  assert.match(englishCombined, /ERR_CERT_AUTHORITY_INVALID|certificate warning/i);
  assert.match(englishCombined, /exactly matches the IP shown in the Live panel/i);
  assert.match(portugueseCombined, /ERR_CERT_AUTHORITY_INVALID|aviso de certificado/i);
  assert.match(portugueseCombined, /for exatamente o IP mostrado no painel do Live/i);
  assert.doesNotMatch(read('docs/INSTALL.md'), /[ãõçáéíóú]/i);
});

test('generated installation kit keeps English and Portuguese guides in their language folders', (t) => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'rc-setlist-kit-contract-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const ablxPath = path.join(tempRoot, 'Ableton-RC-Setlist-0.5.1.ablx');
  const outputRoot = path.join(tempRoot, 'output');
  writeFileSync(ablxPath, '');

  const powershellExecutable = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(powershellExecutable, [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(rootPath, 'scripts', 'package-release-candidate.ps1'),
    '-Version', '0.5.1',
    '-AblxPath', ablxPath,
    '-OutputRoot', outputRoot,
  ], { cwd: rootPath, encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);

  const kitRoot = path.join(outputRoot, 'Ableton-RC-Setlist-0.5.1-Installation-Kit');
  const expectedGuides = ['INSTALL.md', 'USER-GUIDE.md', 'TROUBLESHOOTING.md', 'FAQ.md', 'TEST-CHECKLIST.md'];
  for (const locale of ['en', 'pt-BR']) {
    for (const guide of expectedGuides) {
      assert.ok(existsSync(path.join(kitRoot, locale, guide)), `${locale}/${guide} must exist`);
    }
  }
  assert.ok(existsSync(path.join(kitRoot, 'en', 'RELEASE-NOTES.md')), 'en/RELEASE-NOTES.md must exist');
  assert.ok(existsSync(path.join(kitRoot, 'pt-BR', 'NOTAS-DA-VERSAO.md')), 'pt-BR/NOTAS-DA-VERSAO.md must exist');

  const rootMarkdownOrHtml = readdirSync(kitRoot)
    .filter((name) => /\.(?:md|html)$/i.test(name))
    .sort();
  assert.deepEqual(rootMarkdownOrHtml, ['CHANGELOG.md', 'START-HERE.html']);

  const allRelativeFiles = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else allRelativeFiles.push(path.relative(kitRoot, absolute).replaceAll('\\', '/'));
    }
  };
  walk(kitRoot);
  assert.equal(allRelativeFiles.some((file) => /LEIA-ME-INSTALACAO/i.test(file)), false);
});

test('verify-production-bundle.mjs rejects bundles missing relative locator semantics', () => {
  const verifierScript = readFileSync(new URL('../scripts/verify-production-bundle.mjs', import.meta.url), 'utf8');
  assert.match(verifierScript, /relative-section/);
  assert.match(verifierScript, /relative-automation/);
});
