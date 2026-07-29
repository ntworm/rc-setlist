import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const snapshotRoot = path.resolve(process.argv[2] || process.cwd());
const required = [
  'README.md',
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  'manifest.json',
  'docs/index.html',
  'src',
  'static',
  'tests',
];
const forbiddenPathRules = [
  { label: 'private-archive', pattern: /\.(?:tgz|ablx|zip)$/i },
  { label: 'internal-context', pattern: /(?:^|[\\/])(?:\.agent-context|\.worktrees|releases?|release-kit)(?:[\\/]|$)/i },
  { label: 'internal-docs', pattern: /(?:^|[\\/])docs[\\/](?:agent|superpowers)(?:[\\/]|$)/i },
  { label: 'internal-scratch', pattern: /^tests[\\/]scratch(?:[\\/]|$)/i },
  { label: 'vendored-remote-script', pattern: /(?:^|[\\/])vendor[\\/]AbletonOSC(?:[\\/]|$)/i },
];
const textExtensions = new Set(['', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.svg', '.ts', '.txt', '.yml', '.yaml']);
const contentRules = [
  { label: 'personal-windows-path', pattern: /[A-Z]:[\\/]+Users[\\/]+/i },
  { label: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'github-token', pattern: /gh(?:p|o|u|s|r)_[A-Za-z0-9]{30,}/ },
  { label: 'stale-product-name', pattern: /Ableton\s+Setlist\s+Bridge/i },
  { label: 'stale-product-slug', pattern: new RegExp(['ableton', 'setlist', 'bridge'].join('-'), 'i') },
];
const allowedContentRulePaths = new Map([
  ['personal-windows-path', new Set([
    'tests/content-sanitization.test.mjs',
  ])],
  ['stale-product-name', new Set([
    'docs/TROUBLESHOOTING.md',
    'docs/pt-BR/TROUBLESHOOTING.md',
    'tests/release-package.test.mjs',
    'tests/release-surface.test.mjs',
  ])],
  ['stale-product-slug', new Set([
    'src/core/profile-migration.ts',
    'tests/profile-migration.test.mjs',
    'tests/project-profile-scope.test.mjs',
    'tests/release-surface.test.mjs',
  ])],
]);

const failures = [];
for (const relative of required) {
  try {
    lstatSync(path.join(snapshotRoot, relative));
  } catch {
    failures.push(`missing-required: ${relative}`);
  }
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const fullPath = path.join(directory, entry.name);
    const relative = path.relative(snapshotRoot, fullPath).replaceAll('\\', '/');
    if (relative === 'node_modules') continue;
    const stats = lstatSync(fullPath);
    if (stats.isSymbolicLink()) {
      failures.push(`symbolic-link: ${relative}`);
      continue;
    }
    for (const rule of forbiddenPathRules) {
      if (rule.pattern.test(relative)) failures.push(`${rule.label}: ${relative}`);
    }
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const content = readFileSync(fullPath, 'utf8');
    for (const rule of contentRules) {
      if (allowedContentRulePaths.get(rule.label)?.has(relative)) continue;
      if (rule.pattern.test(content)) failures.push(`${rule.label}: ${relative}`);
    }
  }
}

walk(snapshotRoot);

const sanitization = spawnSync(process.execPath, ['--test', 'tests/content-sanitization.test.mjs'], {
  cwd: snapshotRoot,
  encoding: 'utf8',
});
if (sanitization.status !== 0) {
  failures.push(`commercial-song/content sanitization gate failed:\n${sanitization.stdout}${sanitization.stderr}`);
}

if (failures.length) {
  console.error('[public-snapshot] Verification failed:');
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`);
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(path.join(snapshotRoot, 'package.json'), 'utf8'));
console.log(`[public-snapshot] Ableton RC Setlist ${packageJson.version}: sanitized snapshot verified.`);
