import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const entry = path.resolve(manifest.entry);
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

console.log(`production bundle loaded: ${manifest.entry}`);
