import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const entry = path.resolve(manifest.entry);

if (!fs.existsSync(entry)) {
  process.stderr.write(`Production bundle missing at ${entry}\n`);
  process.exit(1);
}

const bundleContent = fs.readFileSync(entry, 'utf8');

// Verify mandatory feature markers in production bundle
const requiredSemantics = [
  'relative-section',
  'relative-automation',
];

for (const semantic of requiredSemantics) {
  if (!bundleContent.includes(semantic)) {
    process.stderr.write(
      `Production bundle at ${entry} is missing required semantic marker: "${semantic}". Build may be stale.\n`,
    );
    process.exit(1);
  }
}

const result = spawnSync(
  process.execPath,
  ['--input-type=commonjs', '-e', `require(${JSON.stringify(entry)});`],
  { encoding: 'utf8' },
);

if (result.status !== 0) {
  process.stderr.write(
    result.stderr || result.stdout || 'Bundle load failed without output.\n',
  );
  process.exit(result.status ?? 1);
}

console.log(`production bundle verified: ${manifest.entry} (contains relative locator semantics)`);
