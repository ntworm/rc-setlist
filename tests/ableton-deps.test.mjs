import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const projectRoot = new URL('../', import.meta.url);

function runScript(script, env = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ABLETON_SDK_TGZ: '',
      ABLETON_CLI_TGZ: '',
      ...env,
    },
    encoding: 'utf8',
  });
}

test('Ableton dependency verification explains the two required local archives', () => {
  const result = runScript('scripts/verify-ableton-deps.mjs');
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 2);
  assert.match(output, /ABLETON_SDK_TGZ/);
  assert.match(output, /ABLETON_CLI_TGZ/);
  assert.match(output, /npm run setup:ableton/);
  assert.doesNotMatch(output, /https?:\/\/.+\.tgz/i, 'verification must not suggest an archive download URL');
});

test('Ableton dependency setup rejects repository-relative archive paths', () => {
  const result = runScript('scripts/install-ableton-deps.mjs', {
    ABLETON_SDK_TGZ: './vendor/sdk.tgz',
    ABLETON_CLI_TGZ: './vendor/cli.tgz',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 2);
  assert.match(output, /absolute local paths/i);
  assert.doesNotMatch(output, /npm install/i, 'invalid paths must fail before npm is executed');
});

test('public TypeScript build resolves the SDK only through a checked-in type boundary', () => {
  const config = JSON.parse(readFileSync(new URL('../tsconfig.public.json', import.meta.url), 'utf8'));
  const shimPath = 'src/ableton-sdk-public.d.ts';

  assert.deepEqual(config.compilerOptions.paths?.['@ableton-extensions/sdk'], [`./${shimPath}`]);
  assert.ok(existsSync(new URL(`../${shimPath}`, import.meta.url)), `${shimPath} must exist`);
});
