import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const documents = [
  'README.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'PRIVACY.md',
  'SECURITY.md',
  'SUPPORT.md',
  'examples/README.md',
  'vendor/README.md',
  'docs/README.md',
  'docs/INSTALL.md',
  'docs/USER-GUIDE.md',
  'docs/TESTER-GUIDE.md',
  'docs/DEVELOPMENT.md',
  'docs/FAQ.md',
  'docs/TROUBLESHOOTING.md',
  'docs/index.html',
  '.github/ISSUE_TEMPLATE/bug_report.md',
  '.github/ISSUE_TEMPLATE/feature_request.md',
  '.github/pull_request_template.md',
];

function localTargets(file, content) {
  const targets = [];
  if (file.endsWith('.html')) {
    for (const match of content.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) targets.push(match[1]);
  } else {
    for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) targets.push(match[1]);
  }
  return targets.filter((target) => {
    const value = target.trim().replace(/^<|>$/g, '');
    return value && !/^(?:https?:|mailto:|tel:|data:|javascript:|#)/i.test(value) && !value.startsWith('/');
  });
}

const broken = [];
for (const file of documents) {
  const absolute = path.join(root, file);
  if (!existsSync(absolute)) {
    broken.push(`${file}: document is missing`);
    continue;
  }
  const content = readFileSync(absolute, 'utf8');
  for (const rawTarget of localTargets(file, content)) {
    const target = rawTarget.trim().replace(/^<|>$/g, '').split(/[?#]/, 1)[0];
    if (!target) continue;
    const resolved = path.resolve(path.dirname(absolute), decodeURIComponent(target));
    if (!existsSync(resolved)) broken.push(`${file}: ${rawTarget}`);
  }
}

if (broken.length) {
  console.error(`Broken local documentation links (${broken.length}):`);
  for (const finding of broken) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Checked ${documents.length} public documents: no broken local links.`);
