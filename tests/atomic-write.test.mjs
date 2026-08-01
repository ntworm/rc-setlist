import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { atomicWriteFile } from '../src/util/atomic-write.ts';

test('atomicWriteFile creates parents and replaces an existing file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-setlist-atomic-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'nested', 'lyrics.lrc');

  await atomicWriteFile(target, 'first', 'utf8');
  await atomicWriteFile(target, 'second', 'utf8');

  assert.equal(await fs.readFile(target, 'utf8'), 'second');
  assert.deepEqual(await fs.readdir(path.dirname(target)), ['lyrics.lrc']);
});

test('atomicWriteFile removes its temporary file and preserves the target when rename fails', async () => {
  const calls = [];
  const fakeFs = {
    mkdir: async (directory) => { calls.push(['mkdir', directory]); },
    writeFile: async (file, data) => { calls.push(['writeFile', file, data]); },
    rename: async (from, to) => {
      calls.push(['rename', from, to]);
      throw new Error('simulated rename failure');
    },
    unlink: async (file) => { calls.push(['unlink', file]); },
  };

  await assert.rejects(
    atomicWriteFile('/show/lyrics.lrc', 'new content', 'utf8', fakeFs),
    /simulated rename failure/,
  );

  const tempPath = calls.find(([operation]) => operation === 'writeFile')[1];
  assert.notEqual(tempPath, '/show/lyrics.lrc');
  assert.deepEqual(calls.at(-1), ['unlink', tempPath]);
});
