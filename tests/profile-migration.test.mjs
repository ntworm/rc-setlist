import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { ProfileManager, ProfileError } from '../src/core/profile-manager.ts';
import { migrateLegacyData } from '../src/core/profile-migration.ts';

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'rc-setlist-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function deterministicOptions() {
  let id = 0;
  let tick = 0;
  return {
    randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => new Date(Date.UTC(2026, 6, 10, 0, 0, tick++)).toISOString(),
  };
}

test('global lyrics and custom order migrate to Setlist Principal without deleting source', async (t) => {
  const root = makeRoot(t);
  // Create global legacy files
  fs.mkdirSync(path.join(root, 'lyrics'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lyrics', 'Song A.lrc'), '[00:00.00] Line 1');
  fs.writeFileSync(path.join(root, 'custom-order.json'), JSON.stringify(['Song A']));

  const manager = new ProfileManager(root, deterministicOptions());
  await manager.initialize(); // Calls migrateLegacyData internally

  const primary = manager.getActive();
  assert.equal(primary.name, 'Setlist Principal');

  const paths = manager.getActivePaths();
  assert.equal(fs.existsSync(path.join(paths.lyrics, 'Song A.lrc')), true);
  assert.equal(fs.existsSync(paths.customOrder), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.customOrder, 'utf8')), ['Song A']);

  // Source files are preserved
  assert.equal(fs.existsSync(path.join(root, 'lyrics', 'Song A.lrc')), true);
  assert.equal(fs.existsSync(path.join(root, 'custom-order.json')), true);
});

test('renamed extension imports profile lyrics from the known previous storage identity', async (t) => {
  const parent = makeRoot(t);
  const previousRoot = path.join(parent, 'worm.ableton-setlist-bridge');
  const currentRoot = path.join(parent, 'ntworm.ableton-rc-setlist');

  const previous = new ProfileManager(previousRoot, deterministicOptions());
  await previous.initialize();
  const previousPaths = previous.getActivePaths();
  fs.writeFileSync(path.join(previousPaths.lyrics, 'Legacy Song.lrc'), '[00:00.00]Preserved legacy lyric');
  fs.writeFileSync(previousPaths.customOrder, JSON.stringify(['Legacy Song']));

  const previousProject = path.join(previousRoot, 'projects', 'legacy-project');
  fs.mkdirSync(path.join(previousProject, 'lyrics'), { recursive: true });
  fs.writeFileSync(path.join(previousProject, 'project-info.json'), JSON.stringify({ projectName: 'Legacy Show' }));
  fs.writeFileSync(path.join(previousProject, 'lyrics', 'Project Song.txt'), 'Preserved project lyric');

  const current = new ProfileManager(currentRoot, deterministicOptions());
  await current.initialize();

  const currentPaths = current.getActivePaths();
  assert.equal(
    fs.readFileSync(path.join(currentPaths.lyrics, 'Legacy Song.lrc'), 'utf8'),
    '[00:00.00]Preserved legacy lyric',
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(currentPaths.customOrder, 'utf8')), ['Legacy Song']);
  assert.equal(fs.existsSync(path.join(previousPaths.lyrics, 'Legacy Song.lrc')), true);

  const importedProject = current.list().find((profile) => profile.name === 'Legacy Show');
  assert.ok(importedProject);
  assert.equal(
    fs.readFileSync(path.join(current.getPaths(importedProject.id).lyrics, 'Project Song.txt'), 'utf8'),
    'Preserved project lyric',
  );
  assert.equal(fs.existsSync(path.join(previousProject, 'lyrics', 'Project Song.txt')), true);

  const restarted = new ProfileManager(currentRoot, deterministicOptions());
  await restarted.initialize();
  assert.equal(restarted.list().length, 2);
});

test('project-info directories migrate into explicit profiles in sorted hash order', async (t) => {
  const root = makeRoot(t);

  // Set up project legacy sources
  const project1 = path.join(root, 'projects', 'hash1');
  fs.mkdirSync(path.join(project1, 'lyrics'), { recursive: true });
  fs.writeFileSync(path.join(project1, 'project-info.json'), JSON.stringify({ projectName: 'Show A' }));
  fs.writeFileSync(path.join(project1, 'lyrics', 'Song B.txt'), 'Lyrics B');

  // Same name but different hash (creates unique name)
  const project2 = path.join(root, 'projects', 'hash2');
  fs.mkdirSync(path.join(project2, 'lyrics'), { recursive: true });
  fs.writeFileSync(path.join(project2, 'project-info.json'), JSON.stringify({ projectName: 'Show A' }));
  fs.writeFileSync(path.join(project2, 'lyrics', 'Song C.txt'), 'Lyrics C');

  const manager = new ProfileManager(root, deterministicOptions());
  await manager.initialize();

  const list = manager.list();
  // Setlist Principal, Show A, Show A (2)
  assert.equal(list.length, 3);
  assert.equal(list[1].name, 'Show A');
  assert.equal(list[2].name, 'Show A (2)');

  const showAPaths = manager.getPaths(list[1].id);
  assert.equal(fs.existsSync(path.join(showAPaths.lyrics, 'Song B.txt')), true);

  const showA2Paths = manager.getPaths(list[2].id);
  assert.equal(fs.existsSync(path.join(showA2Paths.lyrics, 'Song C.txt')), true);

  // Idempotency: reinitializing does not create duplicate profiles
  const restarted = new ProfileManager(root, deterministicOptions());
  await restarted.initialize();
  assert.equal(restarted.list().length, 3);
});

test('detailed migration: existing target files are not overwritten, custom-order is copied, exports/audio are ignored, transactional cleanup on failure, log sanitization', async (t) => {
  const root = makeRoot(t);

  // 1. Set up global legacy files
  fs.mkdirSync(path.join(root, 'lyrics'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lyrics', 'Song A.lrc'), 'Global Lyrics');
  fs.writeFileSync(path.join(root, 'custom-order.json'), JSON.stringify(['Song A']));
  // Create unrelated folder in legacy to ensure exports/audio are NOT migrated
  fs.mkdirSync(path.join(root, 'exports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'exports', 'unmigrated.csv'), 'csv');
  fs.mkdirSync(path.join(root, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(root, 'audio', 'unmigrated.wav'), 'wav');

  // Set up project legacy files
  const project1 = path.join(root, 'projects', 'hash1');
  fs.mkdirSync(path.join(project1, 'lyrics'), { recursive: true });
  fs.writeFileSync(path.join(project1, 'project-info.json'), JSON.stringify({ projectName: 'Show A' }));
  fs.writeFileSync(path.join(project1, 'custom-order.json'), JSON.stringify(['Song B']));
  fs.writeFileSync(path.join(project1, 'lyrics', 'Song B.txt'), 'Project Lyrics');

  // Let's create a manager and initialize it
  const manager = new ProfileManager(root, deterministicOptions());
  await manager.initialize();

  const primaryPaths = manager.getActivePaths();
  // Verify global lyrics and custom-order are migrated
  assert.equal(fs.readFileSync(path.join(primaryPaths.lyrics, 'Song A.lrc'), 'utf8'), 'Global Lyrics');
  assert.deepEqual(JSON.parse(fs.readFileSync(primaryPaths.customOrder, 'utf8')), ['Song A']);

  // Verify exports/audio were not created/migrated inside the profile
  assert.equal(fs.existsSync(path.join(primaryPaths.exports, 'unmigrated.csv')), false);
  assert.equal(fs.existsSync(path.join(primaryPaths.audio, 'unmigrated.wav')), false);

  const list = manager.list();
  const showAPaths = manager.getPaths(list[1].id);
  // Verify project custom-order is migrated
  assert.deepEqual(JSON.parse(fs.readFileSync(showAPaths.customOrder, 'utf8')), ['Song B']);

  // Verify sources remain intact
  assert.equal(fs.existsSync(path.join(root, 'lyrics', 'Song A.lrc')), true);
  assert.equal(fs.existsSync(path.join(project1, 'lyrics', 'Song B.txt')), true);

  // 2. Transactional cleanup: fail inside populate during import
  const failProject = path.join(root, 'projects', 'hash2');
  fs.mkdirSync(path.join(failProject, 'lyrics'), { recursive: true });
  fs.writeFileSync(path.join(failProject, 'project-info.json'), JSON.stringify({ projectName: 'Show Fail' }));

  const manager2 = new ProfileManager(root, deterministicOptions());
  await manager2.initialize();

  await assert.rejects(manager2.importLegacyProfile('project:hash2', 'Show Fail', async () => {
    throw new Error('Injected populate failure');
  }));

  // Verify that NO partial/migrating directory remains and no ledger entry is created
  const profilesDir = path.join(root, 'profiles');
  const files = fs.readdirSync(profilesDir);
  assert.equal(files.some(f => f.startsWith('.migrating-')), false);
  assert.equal(manager2.hasLegacySource('project:hash2'), false);

  // 3. Verify logs do not contain absolute paths (projectPath)
  const logs = [];
  const originalWarn = console.warn;
  console.warn = (msg) => logs.push(msg);
  try {
    // trigger a warning by writing an invalid project-info.json
    const invalidProject = path.join(root, 'projects', 'hash3');
    fs.mkdirSync(invalidProject, { recursive: true });
    fs.writeFileSync(path.join(invalidProject, 'project-info.json'), 'invalid json');

    const manager3 = new ProfileManager(root, deterministicOptions());
    await manager3.initialize();
  } finally {
    console.warn = originalWarn;
  }

  // Ensure warnings logged do not contain path traversal or absolute project paths
  for (const logMsg of logs) {
    assert.equal(logMsg.includes(root), false);
  }
});

// Issue 4: importLegacyProfile metadata write failure cleanup
test('importLegacyProfile cleans up staging dir when metadata write fails and does not record source', async (t) => {
  const root = makeRoot(t);
  const manager = new ProfileManager(root, {
    ...deterministicOptions(),
    writeJsonAtomic: async (filePath, val) => {
      // Fail on staging profile.json (inside .migrating-* dir) but not on index.json or default profile.json
      if (filePath.includes('.migrating-') && filePath.endsWith('profile.json')) {
        throw new Error('Injected metadata write failure in staging');
      }
      await fs.promises.writeFile(filePath, JSON.stringify(val, null, 2), 'utf8');
    }
  });
  await manager.initialize();

  await assert.rejects(
    manager.importLegacyProfile('project:hash_fail', 'Failed Import', async (paths) => {
      // Write a sentinel file to prove we got this far
      fs.mkdirSync(paths.lyrics, { recursive: true });
      fs.writeFileSync(path.join(paths.lyrics, 'sentinel.lrc'), 'should be cleaned up');
    }),
    (err) => err instanceof ProfileError && err.code === 'profile_io_error'
  );

  // No .migrating-* or final UUID directory should remain
  const profilesDir = path.join(root, 'profiles');
  const entries = fs.readdirSync(profilesDir);
  assert.equal(entries.some(f => f.startsWith('.migrating-')), false, 'No .migrating-* should remain');

  // source should not be in legacySources
  assert.equal(manager.hasLegacySource('project:hash_fail'), false);
});

// Issue 5: True non-overwrite sentinel test
test('migration does not overwrite pre-existing file in profile destination', async (t) => {
  const root = makeRoot(t);

  // 1. Initialize without global source
  const options = deterministicOptions();
  const manager = new ProfileManager(root, options);
  await manager.initialize();

  // 2. Write a sentinel lyric directly into the profile's lyrics dir
  const primaryPaths = manager.getActivePaths();
  fs.mkdirSync(primaryPaths.lyrics, { recursive: true });
  fs.writeFileSync(path.join(primaryPaths.lyrics, 'Song A.lrc'), 'SENTINEL ORIGINAL');

  // 3. Create a global legacy source with the same filename but different content
  fs.mkdirSync(path.join(root, 'lyrics'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lyrics', 'Song A.lrc'), 'GLOBAL OVERWRITE ATTEMPT');

  // 4. Reinitialize (triggers migration)
  const restarted = new ProfileManager(root, options);
  await restarted.initialize();

  // 5. The sentinel content must survive
  const content = fs.readFileSync(path.join(primaryPaths.lyrics, 'Song A.lrc'), 'utf8');
  assert.equal(content, 'SENTINEL ORIGINAL', 'Pre-existing file must not be overwritten by migration');

  // 6. Source must remain
  assert.equal(fs.existsSync(path.join(root, 'lyrics', 'Song A.lrc')), true);
});
