import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'app-bar-fit.js'), 'utf8');
const scope = {};
vm.runInNewContext(source, { globalThis: scope });
const appBarFit = scope.RcAppBarFit;

test('the bar keeps its own size when everything fits at once', () => {
  const scale = appBarFit.chooseScale(() => true);
  assert.equal(scale, 1);
});

test('the bar shrinks to the first scale that fits', () => {
  const tried = [];
  const fits = (candidate) => {
    tried.push(candidate);
    return candidate <= 0.9;
  };
  const scale = appBarFit.chooseScale(fits);
  assert.equal(scale, 0.9);
  assert.deepEqual(tried, [1, 0.98, 0.96, 0.94, 0.92, 0.9]);
});

test('the text never shrinks below the floor, and the floor is the last one tried', () => {
  const tried = [];
  const fits = (candidate) => {
    tried.push(candidate);
    return false;
  };
  const scale = appBarFit.chooseScale(fits);
  assert.equal(scale, 0.8);
  assert.equal(tried.at(-1), 0.8);
  for (const candidate of tried) {
    assert.ok(candidate >= 0.8, `${candidate} must not go below the floor`);
  }
  const high = appBarFit.chooseScale(() => false, { min: 0.9 });
  assert.equal(high, 0.9);
  const low = appBarFit.chooseScale(() => false, { step: 0.1, min: 0.5 });
  assert.equal(low, 0.5);
  const fitsBelow = (candidate) => candidate <= 0.7;
  const stepped = appBarFit.chooseScale(fitsBelow, { step: 0.1, min: 0.5 });
  assert.equal(stepped, 0.7);
});

test('every tried scale is rounded to two decimals', () => {
  const tried = [];
  const fits = (candidate) => {
    tried.push(candidate);
    return false;
  };
  appBarFit.chooseScale(fits, { step: 0.03 });
  assert.ok(tried.includes(0.97));
  for (const candidate of tried) {
    assert.equal(candidate, Math.round(candidate * 100) / 100);
  }
});

test('the API is also handed over to a Node module object', () => {
  const moduleScope = { module: { exports: {} } };
  vm.runInNewContext(source, { globalThis: moduleScope });
  const handedOver = moduleScope.module.exports;
  assert.equal(typeof handedOver.chooseScale, 'function');
  assert.equal(typeof handedOver.install, 'function');
});
