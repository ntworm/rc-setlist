import assert from 'node:assert/strict';
import test from 'node:test';

import { patchBinpackSource } from '../scripts/build/binpack-strict.ts';
import { copyStaticTree, nodeEnvDefine } from '../scripts/build/build-helpers.ts';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const broken = `module.exports.pack = function () {
  b = new Buffer(sizeOfType(binpackTypename));
};
twoToThe32 = Math.pow(2, 32);
`;

test('patchBinpackSource declares both published binpack globals', () => {
  const fixed = patchBinpackSource(broken);

  assert.match(fixed, /var b = new Buffer/);
  assert.match(fixed, /var twoToThe32 = Math\.pow/);
  assert.doesNotMatch(fixed, /^\s*b = new Buffer/m);
  assert.doesNotMatch(fixed, /^twoToThe32 =/m);
});

test('patchBinpackSource is idempotent', () => {
  const once = patchBinpackSource(broken);

  assert.equal(patchBinpackSource(once), once);
});

test('patchBinpackSource rejects an unknown dependency shape', () => {
  assert.throws(
    () => patchBinpackSource('module.exports = {};'),
    /binpack source shape/,
  );
});

test('production builds define NODE_ENV and missing static input is fatal', () => {
  assert.deepStrictEqual(nodeEnvDefine(false), {
    'process.env.NODE_ENV': JSON.stringify('development'),
  });
  assert.deepStrictEqual(nodeEnvDefine(true), {
    'process.env.NODE_ENV': JSON.stringify('production'),
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-setlist-build-'));
  try {
    assert.throws(
      () => copyStaticTree(path.join(root, 'missing'), path.join(root, 'output')),
      /static source directory/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
