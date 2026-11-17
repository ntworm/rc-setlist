import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { writeJsonAtomic } from '../src/core/profile/storage.ts';
import { ProfileError } from '../src/core/profile/types.ts';

test('a failing writer leaves the previous file readable and hides the path', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'rc-setlist-profile-storage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'profile.json');
  await writeJsonAtomic(file, { n: 1 });
  const failure = new Error('disk full');

  await assert.rejects(
    writeJsonAtomic(file, { n: 2 }, async () => {
      throw failure;
    }),
    (error) => {
      assert.ok(error instanceof ProfileError);
      assert.equal(error.code, 'profile_io_error');
      assert.equal(error.cause, failure);
      assert.ok(!error.message.includes(root), 'the message carries no path');
      assert.ok(!error.message.includes('profile.json'), 'the message carries no file name');
      return true;
    },
  );
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { n: 1 });
  assert.deepEqual(JSON.parse(await fs.readFile(`${file}.bak`, 'utf8')), { n: 1 });
});
