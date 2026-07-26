import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function readRequired(path) {
  const url = new URL(`../${path}`, import.meta.url);
  assert.ok(existsSync(url), `${path} must exist`);
  return readFileSync(url, 'utf8');
}

test('public landing presents Ableton RC Setlist as source-available and noncommercial', () => {
  const landing = read('docs/index.html');

  assert.match(landing, /<title>Ableton RC Setlist\b/);
  assert.match(landing, /source-available/i);
  assert.match(landing, /PolyForm Noncommercial 1\.0\.0/i);
  assert.match(landing, /independent project.+not affiliated with or endorsed by Ableton AG/is);
  assert.match(landing, /https:\/\/ntworm\.github\.io\/rc-setlist\//i);
  assert.match(landing, /Release 0\.3\.0/);
  assert.doesNotMatch(landing, /Release candidate/i);
  assert.doesNotMatch(landing, /commercial distribution is in preparation|private beta|sales open/i);
  assert.doesNotMatch(landing, /fonts\.googleapis\.com|fonts\.gstatic\.com|google-analytics|googletagmanager/i);
});

test('public documentation uses the official compatibility floor', () => {
  for (const path of ['README.md', 'docs/INSTALL.md', 'docs/DEVELOPMENT.md']) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} must exist`);
    const content = read(path);
    assert.match(content, /Ableton Live 12\.4\.5\+ Suite \(Beta\)/i, `${path} must state the Live floor`);
    assert.match(content, /Node(?:\.js)? 24\.16\.0/i, `${path} must state the development Node floor`);
  }
});

test('public documentation describes external AbletonOSC without bundling it', () => {
  const readme = readRequired('README.md');
  const install = readRequired('docs/INSTALL.md');

  for (const [label, content] of [['README', readme], ['install guide', install]]) {
    assert.match(content, /github\.com\/ideoforms\/AbletonOSC/i, `${label} must link upstream AbletonOSC`);
    assert.doesNotMatch(content, /bundled.+AbletonOSC|vendor\/AbletonOSC/i, `${label} must not claim AbletonOSC is bundled`);
  }
});

test('public docs contain the required user, contributor, privacy and security pages', () => {
  const required = [
    'docs/README.md',
    'docs/INSTALL.md',
    'docs/USER-GUIDE.md',
    'docs/TESTER-GUIDE.md',
    'docs/DEVELOPMENT.md',
    'docs/FAQ.md',
    'docs/TROUBLESHOOTING.md',
    'PRIVACY.md',
    'SECURITY.md',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
    'SUPPORT.md',
    'CHANGELOG.md',
    'LICENSE',
    'NOTICE',
    'THIRD_PARTY_NOTICES.md',
  ];

  for (const path of required) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} must exist`);
  }
});

test('public landing contains truthful site media and keeps the owner media kit private', () => {
  const required = [
    'docs/media/product-truth-discord.png',
    'docs/media/performance.png',
    'docs/media/stage-control.png',
    'docs/media/workflow.png',
    'docs/media/stage-editorial.png',
  ];

  for (const path of required) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} must exist`);
  }

  const landing = read('docs/index.html');
  const allowlist = read('public-files.txt');
  assert.doesNotMatch(landing, /href=["']\.\/media-kit\.html["']/i);
  assert.doesNotMatch(landing, /Need artwork for a post or community listing\?/i);
  for (const privatePath of [
    'docs/media/',
    'docs/media-kit.html',
    'docs/media/product-truth-linkedin.png',
    'docs/media/product-truth-square.png',
  ]) {
    assert.doesNotMatch(allowlist, new RegExp(`^${privatePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
});

test('Dependabot keeps TypeScript and Node types on the supported major release line', () => {
  const dependabot = read('.github/dependabot.yml');
  for (const dependency of ['typescript', '@types/node']) {
    const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      dependabot,
      new RegExp(`dependency-name:\\s*["']?${escaped}["']?[\\s\\S]*?update-types:[\\s\\S]*?version-update:semver-major`),
      `${dependency} must ignore semver-major Dependabot updates`,
    );
  }
});

test('public media verification excludes owner-only social cards', () => {
  const packageJson = JSON.parse(read('package.json'));
  const publicCheck = packageJson.scripts['media:check'];
  const ownerCheck = packageJson.scripts['media:check:owner'];
  const publicGate = packageJson.scripts['ci:public'];
  const renderer = read('scripts/render-media-kit.mjs');

  assert.match(publicCheck, /--check\s+--public/);
  assert.match(ownerCheck, /--check/);
  assert.doesNotMatch(ownerCheck, /--public/);
  assert.match(publicGate, /media:check/);
  assert.match(renderer, /publicOutputIds/);
  assert.match(renderer, /process\.argv\.includes\(['"]--public['"]\)/);
});

test('the public CI gate includes browser and release-surface regressions', () => {
  const packageJson = JSON.parse(read('package.json'));
  const publicGate = packageJson.scripts['ci:public'];
  const workflow = read('.github/workflows/ci.yml');
  assert.equal(typeof publicGate, 'string', 'package.json must define ci:public');
  assert.match(publicGate, /test:ui/);
  assert.match(publicGate, /test:release-surface/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
});

test('production build cleans generated output and enables minification', () => {
  const build = read('build.ts');
  assert.match(build, /rmSync\([^\n]+recursive:\s*true[^\n]+force:\s*true/);
  assert.match(build, /minify:\s*production/);
});

test('public Markdown and HTML have no broken local links', () => {
  const result = spawnSync(process.execPath, ['scripts/check-doc-links.mjs'], {
    cwd: new URL('../', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
