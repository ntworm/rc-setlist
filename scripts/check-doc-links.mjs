// Checks every Markdown and HTML document that reaches the public repository
// for local links that point at nothing. The document list is the public
// allowlist itself, so a document cannot be published without being checked.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// Templates whose links only resolve once rendered or copied into the kit:
// tests/release-package.test.mjs checks the kit, scripts/render-media-kit.mjs
// fills the media template.
const TEMPLATE_PREFIXES = ['release-template/', 'scripts/'];

function publicDocuments() {
  const allowlist = readFileSync(path.join(root, 'public-files.txt'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const documents = new Set();
  const isDocument = (file) => /\.(?:md|html)$/i.test(file);
  const walk = (relativeDir) => {
    const absolute = path.join(root, relativeDir);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute)) {
      const relative = path.posix.join(relativeDir, entry);
      if (statSync(path.join(root, relative)).isDirectory()) walk(relative);
      else if (isDocument(relative)) documents.add(relative);
    }
  };
  for (const entry of allowlist) {
    if (TEMPLATE_PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;
    if (entry.endsWith('/')) walk(entry.slice(0, -1));
    else if (isDocument(entry)) documents.add(entry);
  }
  return [...documents].sort();
}

function localTargets(file, content) {
  const targets = [];
  if (file.endsWith('.html')) {
    for (const match of content.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi))
      targets.push(match[1]);
  } else {
    for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) targets.push(match[1]);
  }
  return targets.filter((target) => {
    const value = target.trim().replace(/^<|>$/g, '');
    return (
      value &&
      !/^(?:https?:|mailto:|tel:|data:|javascript:|#)/i.test(value) &&
      !value.startsWith('/')
    );
  });
}

const documents = publicDocuments();
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
