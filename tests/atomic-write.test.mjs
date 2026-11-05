import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { atomicWriteFile } from '../src/util/atomic-write.ts';
import { atomicWriteFileWithDependencies } from '../src/util/atomic-write-internal.ts';

async function makeTestDirectory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-setlist-atomic-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('atomicWriteFile creates parents and atomically replaces an existing file', async (t) => {
  const root = await makeTestDirectory(t);
  const target = path.join(root, 'nested', 'lyrics.lrc');

  await atomicWriteFile(target, 'first');
  await atomicWriteFile(target, 'second');

  assert.equal(await fs.readFile(target, 'utf8'), 'second');
  assert.deepEqual(await fs.readdir(path.dirname(target)), ['lyrics.lrc']);
});

function fakeAtomicDependencies({
  tokens = [],
  platform = 'linux',
  directorySyncError,
  fileSyncError,
} = {}) {
  const calls = [];
  return {
    calls,
    dependencies: {
      platform,
      createToken: () => tokens.shift() ?? 'fallback-token',
      fileSystem: {
        mkdir: async (directory) => {
          calls.push(['mkdir', directory]);
        },
        open: async (file, flags) => {
          calls.push(['open', file, flags]);
          const isDirectory = flags === 'r';
          return {
            writeFile: async (data) => {
              calls.push(['writeFile', file, data]);
            },
            sync: async () => {
              calls.push(['sync', file]);
              if (isDirectory && directorySyncError) throw directorySyncError;
              if (!isDirectory && fileSyncError) throw fileSyncError;
            },
            close: async () => {
              calls.push(['close', file]);
            },
          };
        },
        rename: async (from, to) => {
          calls.push(['rename', from, to]);
        },
        rm: async (file) => {
          calls.push(['rm', file]);
        },
      },
    },
  };
}

test('concurrent writes derive unique temporary files beside the same target deterministically', async () => {
  const { calls, dependencies } = fakeAtomicDependencies({ tokens: ['one', 'two'] });
  const target = path.resolve('show', 'custom-order.json');

  await Promise.all([
    atomicWriteFileWithDependencies(target, 'first', dependencies),
    atomicWriteFileWithDependencies(target, 'second', dependencies),
  ]);

  const tempPaths = calls
    .filter(([operation, _file, flags]) => operation === 'open' && flags === 'wx')
    .map(([, file]) => file);
  assert.equal(new Set(tempPaths).size, 2);
  assert.ok(tempPaths.every((file) => path.dirname(file) === path.dirname(target)));
});

test('atomic replacement syncs the containing directory after rename', async () => {
  const { calls, dependencies } = fakeAtomicDependencies({ tokens: ['durable'] });
  const target = path.resolve('show', 'lyrics.lrc');

  await atomicWriteFileWithDependencies(target, 'lyrics', dependencies);

  const renameIndex = calls.findIndex(([operation]) => operation === 'rename');
  const directoryOpenIndex = calls.findIndex(
    ([operation, file, flags]) =>
      operation === 'open' && file === path.dirname(target) && flags === 'r',
  );
  const directorySyncIndex = calls.findIndex(
    ([operation, file]) => operation === 'sync' && file === path.dirname(target),
  );
  assert.ok(renameIndex >= 0);
  assert.ok(directoryOpenIndex > renameIndex);
  assert.ok(directorySyncIndex > directoryOpenIndex);
});

test('Windows permits only documented unsupported directory-sync failures', async () => {
  for (const code of ['EPERM', 'EACCES', 'EISDIR', 'ENOTSUP', 'EINVAL']) {
    const error = Object.assign(new Error(`directory sync ${code}`), { code });
    const { dependencies } = fakeAtomicDependencies({
      tokens: [code],
      platform: 'win32',
      directorySyncError: error,
    });
    await atomicWriteFileWithDependencies(
      path.resolve('show', `${code}.lrc`),
      'lyrics',
      dependencies,
    );
  }

  for (const [platform, code] of [
    ['win32', 'EIO'],
    ['linux', 'EPERM'],
  ]) {
    const error = Object.assign(new Error(`directory sync ${code}`), { code });
    const { dependencies } = fakeAtomicDependencies({
      tokens: [`${platform}-${code}`],
      platform,
      directorySyncError: error,
    });
    await assert.rejects(
      atomicWriteFileWithDependencies(
        path.resolve('show', `${platform}-${code}.lrc`),
        'lyrics',
        dependencies,
      ),
      error,
    );
  }
});

test('fsync disabled by the Permission Model still replaces the file on every platform', async () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const denied = () =>
      Object.assign(new Error('fsync API is disabled when Permission Model is enabled.'), {
        code: 'ERR_ACCESS_DENIED',
      });
    const { calls, dependencies } = fakeAtomicDependencies({
      tokens: [platform],
      platform,
      fileSyncError: denied(),
      directorySyncError: denied(),
    });
    const target = path.resolve('show', `${platform}-custom-order.json`);

    await atomicWriteFileWithDependencies(target, 'order', dependencies);

    const renames = calls.filter(([operation]) => operation === 'rename');
    assert.equal(renames.length, 1);
    assert.equal(renames[0][2], target);
    assert.ok(!calls.some(([operation]) => operation === 'rm'));
  }
});

test('other file-sync failures still fail the write and remove the temporary file', async () => {
  const error = Object.assign(new Error('file sync EIO'), { code: 'EIO' });
  const { calls, dependencies } = fakeAtomicDependencies({
    tokens: ['eio'],
    platform: 'win32',
    fileSyncError: error,
  });

  await assert.rejects(
    atomicWriteFileWithDependencies(path.resolve('show', 'eio.lrc'), 'lyrics', dependencies),
    error,
  );
  assert.ok(!calls.some(([operation]) => operation === 'rename'));
  assert.ok(calls.some(([operation]) => operation === 'rm'));
});

test('a write failure removes only its exact temporary file', async (t) => {
  const root = await makeTestDirectory(t);
  const sentinel = path.join(root, 'keep.txt');
  await fs.writeFile(sentinel, 'keep');
  const buffer = new ArrayBuffer(8);
  const detachedBytes = new Uint8Array(buffer);
  structuredClone(buffer, { transfer: [buffer] });

  await assert.rejects(
    atomicWriteFile(path.join(root, 'failed-write.bin'), detachedBytes),
    /detached ArrayBuffer/i,
  );

  assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep');
  assert.deepEqual(await fs.readdir(root), ['keep.txt']);
});

test('a rename failure removes its temp file and preserves existing target content', async (t) => {
  const root = await makeTestDirectory(t);
  const target = path.join(root, 'lyrics.lrc');
  let heldTarget;
  if (process.platform === 'win32') {
    await fs.writeFile(target, 'previous content');
    heldTarget = await fs.open(target, 'r+');
  } else {
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'previous.txt'), 'previous content');
  }

  try {
    await assert.rejects(atomicWriteFile(target, 'replacement'));
  } finally {
    await heldTarget?.close();
  }

  const previousPath = process.platform === 'win32' ? target : path.join(target, 'previous.txt');
  assert.equal(await fs.readFile(previousPath, 'utf8'), 'previous content');
  assert.deepEqual(await fs.readdir(root), ['lyrics.lrc']);
});
