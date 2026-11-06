import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  exportPackage,
  importPackage,
  isPackageFileName,
  listPackages,
  parsePackage,
  PackageError,
} from '../src/core/setlist-package.ts';
import { parseSongBook } from '../src/core/song-book.ts';

// A folder of its own, so that the test never touches the machine.
async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rc-setlist-package-'));
}

// The manager of the setlists, as the package needs it: the list of the
// setlists, the folder of each one and the names that are taken.
function fakeManager(root) {
  const profiles = [];
  const pathsOf = (id) => ({
    customOrder: path.join(root, 'profiles', id, 'custom-order.json'),
    lyrics: path.join(root, 'profiles', id, 'lyrics'),
    songBook: path.join(root, 'profiles', id, 'song-book.json'),
  });
  return {
    create: async (name) => {
      const profile = { id: `p${profiles.length + 1}`, name };
      profiles.push(profile);
      await fs.mkdir(pathsOf(profile.id).lyrics, { recursive: true });
      return profile;
    },
    getPaths: (id) => pathsOf(id),
    hasName: (name) => profiles.some((profile) => profile.name === name),
    list: () => profiles.map((profile) => ({ id: profile.id, name: profile.name })),
  };
}

// The song book of a setlist: the colour and the notes of its songs.
const SONG_BOOK = {
  version: 1,
  reloadCount: 0,
  present: [],
  tombstoned: [],
  data: {
    Alpha: { color: '#ff8800', notes: 'Slow start' },
    Beta: { color: '#22aa66', notes: 'Talk to the crowd' },
  },
};

test('a package carries the setlists of the project and gives them back', async () => {
  const root = await tempRoot();
  try {
    const dir = path.join(root, 'packages');
    const manager = fakeManager(root);
    const created = await manager.create('Main Setlist');
    const paths = manager.getPaths(created.id);
    await fs.writeFile(paths.customOrder, JSON.stringify(['Beta', 'Alpha']), 'utf8');
    await fs.writeFile(paths.songBook, JSON.stringify(SONG_BOOK), 'utf8');
    await fs.mkdir(paths.lyrics, { recursive: true });
    await fs.writeFile(path.join(paths.lyrics, 'Beta.lrc'), '[00:01.00] Beta line', 'utf8');

    const file = await exportPackage(manager, { dir, projectName: 'Summer Tour' });
    assert.ok(file.endsWith('.rcsetlist'), 'the package must be a package file');

    // What the package carries.
    const parsed = parsePackage(await fs.readFile(path.join(dir, file), 'utf8'));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, 'Main Setlist');
    assert.deepEqual(parsed[0].customOrder, ['Beta', 'Alpha']);
    assert.deepEqual(parsed[0].songBook, parseSongBook(SONG_BOOK));
    assert.deepEqual(parsed[0].lyrics, [{ file: 'Beta.lrc', text: '[00:01.00] Beta line' }]);

    // And back into another project.
    const other = fakeManager(path.join(root, 'other'));
    const count = await importPackage(other, { dir, file });
    assert.equal(count, 1);
    assert.deepEqual(
      other.list().map((profile) => profile.name),
      ['Main Setlist'],
    );
    const imported = other.getPaths(other.list()[0].id);
    assert.deepEqual(JSON.parse(await fs.readFile(imported.customOrder, 'utf8')), [
      'Beta',
      'Alpha',
    ]);
    assert.deepEqual(
      JSON.parse(await fs.readFile(imported.songBook, 'utf8')),
      parseSongBook(SONG_BOOK),
    );
    assert.equal(
      await fs.readFile(path.join(imported.lyrics, 'Beta.lrc'), 'utf8'),
      '[00:01.00] Beta line',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a name that is taken gets a number', async () => {
  const root = await tempRoot();
  try {
    const dir = path.join(root, 'packages');
    const manager = fakeManager(root);
    await manager.create('Main Setlist');
    const file = await exportPackage(manager, { dir, projectName: 'Summer Tour' });

    const target = fakeManager(path.join(root, 'target'));
    await target.create('Main Setlist');
    const count = await importPackage(target, { dir, file });

    assert.equal(count, 1);
    assert.deepEqual(
      target.list().map((profile) => profile.name),
      ['Main Setlist', 'Main Setlist (2)'],
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an import that fails half way takes back what it created', async () => {
  const root = await tempRoot();
  try {
    const dir = path.join(root, 'packages');
    const source = fakeManager(root);
    await source.create('One');
    await source.create('Two');
    const file = await exportPackage(source, { dir, projectName: 'Summer Tour' });

    const target = fakeManager(path.join(root, 'target'));
    const removed = [];
    const create = target.create;
    let calls = 0;
    target.create = async (name) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full');
      return create(name);
    };
    target.remove = async (id, confirmationName) => {
      removed.push({ id, confirmationName });
    };

    await assert.rejects(importPackage(target, { dir, file }), /disk full/);
    assert.deepEqual(removed, [{ id: 'p1', confirmationName: 'One' }]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a setlist the undo cannot take back is named in the error', async () => {
  const root = await tempRoot();
  try {
    const dir = path.join(root, 'packages');
    const source = fakeManager(root);
    await source.create('One');
    await source.create('Two');
    const file = await exportPackage(source, { dir, projectName: 'Summer Tour' });

    const target = fakeManager(path.join(root, 'target'));
    const create = target.create;
    let calls = 0;
    target.create = async (name) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full');
      return create(name);
    };
    target.remove = async () => {
      throw new Error('disk full again');
    };

    await assert.rejects(importPackage(target, { dir, file }), /could not be taken back: One/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a name with control characters is cleaned before it is created', async () => {
  const root = await tempRoot();
  try {
    const dir = path.join(root, 'packages');
    await fs.mkdir(dir, { recursive: true });
    const pack = {
      format: 'rc-setlist-package',
      version: 1,
      exportedAt: '',
      projectName: 'X',
      setlists: [{ name: 'Tour  Night', customOrder: null, songBook: null, lyrics: [] }],
    };
    await fs.writeFile(path.join(dir, 'odd.rcsetlist'), JSON.stringify(pack), 'utf8');
    const target = fakeManager(root);
    await importPackage(target, { dir, file: 'odd.rcsetlist' });
    assert.deepEqual(
      target.list().map((profile) => profile.name),
      ['Tour Night'],
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a file that is not a package is refused', () => {
  assert.throws(() => parsePackage('not a package'), PackageError);
  assert.throws(
    () => parsePackage(JSON.stringify({ format: 'other', version: 1, setlists: [{ name: 'A' }] })),
    PackageError,
  );
  assert.throws(
    () => parsePackage(JSON.stringify({ format: 'rc-setlist-package', version: 2, setlists: [] })),
    PackageError,
  );
  assert.throws(
    () => parsePackage(JSON.stringify({ format: 'rc-setlist-package', version: 1, setlists: [] })),
    /no setlist/i,
  );
});

test('a lyric file name that walks out of the folder is refused', () => {
  const pack = (lyric) =>
    JSON.stringify({
      format: 'rc-setlist-package',
      version: 1,
      setlists: [{ name: 'A', lyrics: [lyric] }],
    });
  assert.throws(() => parsePackage(pack({ file: '..', text: 'x' })), PackageError);
  assert.throws(() => parsePackage(pack({ file: '../escape.lrc', text: 'x' })), PackageError);
  assert.throws(() => parsePackage(pack({ file: 'folder/escape.lrc', text: 'x' })), PackageError);
  assert.throws(() => parsePackage(pack({ file: 'escape.lrc', text: 42 })), PackageError);
});

test('the packages of the folder are the package files, the newest first', async () => {
  const root = await tempRoot();
  try {
    const dir = path.join(root, 'packages');
    await fs.mkdir(dir, { recursive: true });
    const old = path.join(dir, 'Old.rcsetlist');
    const fresh = path.join(dir, 'Fresh.rcsetlist');
    await fs.writeFile(old, '{}', 'utf8');
    await fs.writeFile(fresh, '{}', 'utf8');
    await fs.writeFile(path.join(dir, 'notes.txt'), 'x', 'utf8');
    await fs.writeFile(path.join(dir, 'song.lrc'), 'x', 'utf8');
    await fs.mkdir(path.join(dir, 'Folder.rcsetlist'));
    const past = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-06-01T00:00:00Z');
    await fs.utimes(old, past, past);
    await fs.utimes(fresh, now, now);

    const listed = await listPackages(dir);
    assert.deepEqual(
      listed.map((entry) => entry.file),
      ['Fresh.rcsetlist', 'Old.rcsetlist'],
    );
    assert.equal(listed[0].modifiedAt, now.getTime());
    assert.deepEqual(await listPackages(path.join(root, 'nowhere')), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('only the name of a package file is the name of a package file', () => {
  assert.equal(isPackageFileName('Winter Set.rcsetlist'), true);
  assert.equal(isPackageFileName('notes.txt'), false);
  assert.equal(isPackageFileName('folder/Winter Set.rcsetlist'), false);
  assert.equal(isPackageFileName('Winter Set'), false);
});

test('a package that is not in the folder is refused', async () => {
  const root = await tempRoot();
  try {
    const dir = path.join(root, 'packages');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'notes.txt'), 'x', 'utf8');
    const manager = fakeManager(root);

    await assert.rejects(
      () => importPackage(manager, { dir, file: 'notes.txt' }),
      /Invalid package name/,
    );
    await assert.rejects(
      () => importPackage(manager, { dir, file: 'folder/Winter Set.rcsetlist' }),
      /Invalid package name/,
    );
    await assert.rejects(
      () => importPackage(manager, { dir, file: 'Missing.rcsetlist' }),
      /not in the folder/,
    );
    assert.deepEqual(manager.list(), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
