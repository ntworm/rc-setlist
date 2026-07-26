import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function listSourceFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    const res = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(listSourceFiles(res));
    } else if (entry.isFile() && /\.(ts|js|mjs)$/.test(entry.name)) {
      results.push(res);
    }
  }
  return results;
}

test('production source has no project WAV probe or importIntoProject call', () => {
  const sourceFiles = listSourceFiles(path.join(repoRoot, 'src'));
  const source = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(source, /importIntoProject\s*\(/);
  assert.doesNotMatch(source, /project-detector/);
  assert.doesNotMatch(source, /setlist_bridge_probe_/);
});
