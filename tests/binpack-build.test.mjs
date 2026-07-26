import assert from 'node:assert/strict';
import test from 'node:test';

import { patchBinpackSource } from '../scripts/build/binpack-strict.ts';

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

