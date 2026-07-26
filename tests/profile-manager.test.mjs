import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { ProfileError, ProfileManager, normalizeProfileName, isValidUUID } from '../src/core/profile-manager.ts';

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'rc-setlist-profiles-'));
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

test('profile names normalize with NFKC and enforce the contract', () => {
  assert.equal(normalizeProfileName('  Ｆｅｓｔｉｖａｌ  '), 'Festival');
  assert.throws(() => normalizeProfileName('   '), (err) => err instanceof ProfileError && err.code === 'invalid_profile');
  assert.throws(() => normalizeProfileName('a'.repeat(81)), (err) => err instanceof ProfileError && err.code === 'invalid_profile');
  assert.throws(() => normalizeProfileName('Show\u0000'), (err) => err instanceof ProfileError && err.code === 'invalid_profile');
});

test('empty storage creates and remembers Setlist Principal with profile-local paths', async (t) => {
  const root = makeRoot(t);
  const manager = new ProfileManager(root, deterministicOptions());
  await manager.initialize();

  assert.equal(manager.list().length, 1);
  assert.equal(manager.getActive().name, 'Setlist Principal');
  assert.equal(typeof manager.delete, 'undefined');
  const paths = manager.getActivePaths();
  assert.equal(paths.root, path.join(root, 'profiles', manager.getActive().id));
  assert.equal(paths.lyrics, path.join(paths.root, 'lyrics'));
  assert.equal(paths.customOrder, path.join(paths.root, 'custom-order.json'));
  assert.equal(paths.exports, path.join(paths.root, 'exports'));
  assert.equal(paths.audio, path.join(paths.root, 'audio'));

  const restarted = new ProfileManager(root, deterministicOptions());
  await restarted.initialize();
  assert.equal(restarted.getActive().id, manager.getActive().id);
});

test('first initialization persists the registry without global structuredClone', async (t) => {
  const originalStructuredClone = globalThis.structuredClone;
  const root = makeRoot(t);

  try {
    globalThis.structuredClone = undefined;
    const manager = new ProfileManager(root, deterministicOptions());
    await assert.doesNotReject(manager.initialize());

    const registry = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'index.json'), 'utf8'));
    assert.equal(registry.migrationVersion, 1);
    assert.equal(manager.getActive().name, 'Setlist Principal');
  } finally {
    globalThis.structuredClone = originalStructuredClone;
  }
});

test('create, select, restart, and rename preserve UUID identity', async (t) => {
  const root = makeRoot(t);
  const options = deterministicOptions();
  const manager = new ProfileManager(root, options);
  await manager.initialize();
  const festival = await manager.create('Festival Julho');
  await manager.select(festival.id);
  await manager.rename(festival.id, 'Festival Agosto');

  const restarted = new ProfileManager(root, options);
  await restarted.initialize();
  assert.equal(restarted.getActive().id, festival.id);
  assert.equal(restarted.getActive().name, 'Festival Agosto');
});

test('profile names are unique after normalization and case folding', async (t) => {
  const manager = new ProfileManager(makeRoot(t), deterministicOptions());
  await manager.initialize();
  await manager.create('Festival');
  await assert.rejects(manager.create('  festival  '), (err) => err.code === 'duplicate_profile_name');
});

test('create, rename and select validate input and reject invalid profiles', async (t) => {
  const manager = new ProfileManager(makeRoot(t), deterministicOptions());
  await manager.initialize();
  await assert.rejects(manager.create(''), (err) => err.code === 'invalid_profile');
  await assert.rejects(manager.select('non-existent-uuid'), (err) => err.code === 'invalid_profile');
});

test('corrupt index.json recovers from index.json.bak', async (t) => {
  const root = makeRoot(t);
  const manager = new ProfileManager(root, deterministicOptions());
  await manager.initialize();
  const festival = await manager.create('Festival');
  await manager.select(festival.id);
  await manager.create('Another'); // Pushes active profile selection into backup index

  // corrupt index.json
  const indexPath = path.join(root, 'profiles', 'index.json');
  fs.writeFileSync(indexPath, 'corrupted data {');

  const restarted = new ProfileManager(root, deterministicOptions());
  await restarted.initialize();
  assert.equal(restarted.getActive().id, festival.id);
});

test('absent index and bak rebuilds index from directory profile.json scanning', async (t) => {
  const root = makeRoot(t);
  const manager = new ProfileManager(root, deterministicOptions());
  await manager.initialize();
  const fest = await manager.create('Fest');
  await manager.select(fest.id);

  // remove index.json and index.json.bak
  const indexPath = path.join(root, 'profiles', 'index.json');
  fs.unlinkSync(indexPath);
  try { fs.unlinkSync(indexPath + '.bak'); } catch {}

  const restarted = new ProfileManager(root, deterministicOptions());
  await restarted.initialize();
  // It should find "Fest" and "Setlist Principal" profiles by scanning subdirs
  assert.equal(restarted.list().length, 2);
  assert.equal(restarted.getActive().name, 'Setlist Principal'); // Setlist Principal is the oldest profile
});

test('schemaVersion 2 throws future_schema without rewriting index.json or index.json.bak', async (t) => {
  const root = makeRoot(t);
  const manager = new ProfileManager(root, deterministicOptions());
  await manager.initialize();
  const indexPath = path.join(root, 'profiles', 'index.json');
  const indexBakPath = indexPath + '.bak';

  // Set up schema 2 registry on disk
  const schema2Data = JSON.stringify({ schemaVersion: 2, activeProfileId: '123', profiles: [] });
  fs.writeFileSync(indexPath, schema2Data);
  fs.writeFileSync(indexBakPath, schema2Data);

  const restarted = new ProfileManager(root, deterministicOptions());
  await assert.rejects(restarted.initialize(), (err) => err instanceof ProfileError && err.code === 'future_schema');

  // Verify files were not rewritten
  assert.equal(fs.readFileSync(indexPath, 'utf8'), schema2Data);
  assert.equal(fs.readFileSync(indexBakPath, 'utf8'), schema2Data);
});

test('invalid IDs, path traversal, and timestamps validation', async (t) => {
  const root = makeRoot(t);
  const manager = new ProfileManager(root, deterministicOptions());
  await manager.initialize();

  // Try path traversal or invalid UUID format
  assert.throws(() => manager.getPaths('..'), (err) => err instanceof ProfileError && err.code === 'invalid_profile');
  assert.throws(() => manager.getPaths('00000000-0000-0000-0000-00000000000g'), (err) => err instanceof ProfileError && err.code === 'invalid_profile');

  // Try corrupting index.json with invalid activeProfileId (e.g. non-UUID format)
  const indexPath = path.join(root, 'profiles', 'index.json');
  const registry = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  registry.profiles.push({
    id: '../evil',
    name: 'Evil',
    createdAt: 'invalid-date',
    updatedAt: '2026-07-10T00:00:00Z'
  });
  try { fs.unlinkSync(indexPath + '.bak'); } catch {}
  fs.writeFileSync(indexPath, JSON.stringify(registry));

  const restarted = new ProfileManager(root, deterministicOptions());
  await restarted.initialize();
  // Verify the invalid profile was discarded
  assert.equal(restarted.list().some(p => p.id === '../evil'), false);

  // Create a profile directory with invalid UUID name
  const evilDir = path.join(root, 'profiles', 'invalid-uuid-folder');
  fs.mkdirSync(evilDir, { recursive: true });
  fs.writeFileSync(path.join(evilDir, 'profile.json'), JSON.stringify({
    id: 'invalid-uuid-folder',
    name: 'Evil Dir',
    createdAt: 'invalid-date',
    updatedAt: '2026-07-10T00:00:00Z'
  }));

  const manager4 = new ProfileManager(root, deterministicOptions());
  await manager4.initialize();
  // Verify it was discarded
  assert.equal(manager4.list().some(p => p.name === 'Evil Dir'), false);
});

test('missing or invalid activeProfileId chooses oldest profile and repairs index', async (t) => {
  const root = makeRoot(t);
  const manager = new ProfileManager(root, deterministicOptions());
  await manager.initialize();
  const fest = await manager.create('Fest');

  const indexPath = path.join(root, 'profiles', 'index.json');
  const registry = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  // Set activeProfileId to non-existent but valid UUID
  registry.activeProfileId = '00000000-0000-4000-8000-999999999999';
  fs.writeFileSync(indexPath, JSON.stringify(registry));

  const restarted = new ProfileManager(root, deterministicOptions());
  await restarted.initialize();

  // Setlist Principal is older than Fest, so it should be chosen as active
  assert.equal(restarted.getActive().name, 'Setlist Principal');

  // Verify index.json was repaired on disk
  const repairedRegistry = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(repairedRegistry.activeProfileId, restarted.getActive().id);
});

test('select(id) validates metadata and ID mismatch, and reverts active profile on failure', async (t) => {
  const root = makeRoot(t);
  const manager = new ProfileManager(root, deterministicOptions());
  await manager.initialize();
  const fest = await manager.create('Fest');
  const festPaths = manager.getPaths(fest.id);

  // Mismatch ID in profile.json
  const meta = JSON.parse(fs.readFileSync(festPaths.metadata, 'utf8'));
  meta.id = '00000000-0000-4000-8000-888888888888';
  fs.writeFileSync(festPaths.metadata, JSON.stringify(meta));

  // Trying to select should fail and preserve previous active profile
  await assert.rejects(manager.select(fest.id), (err) => err instanceof ProfileError && err.code === 'profile_io_error');
  assert.equal(manager.getActive().name, 'Setlist Principal');
});

test('transactional metadata cleanup on create failure', async (t) => {
  const root = makeRoot(t);
  // Inject mock writeJsonAtomic that fails for profile.json on the SECOND call
  // (the first call is during initialize() for Setlist Principal)
  let profileJsonWriteCount = 0;
  const manager = new ProfileManager(root, {
    ...deterministicOptions(),
    writeJsonAtomic: async (filePath, val) => {
      if (filePath.endsWith('profile.json')) {
        profileJsonWriteCount++;
        if (profileJsonWriteCount > 1) {
          throw new Error('Injected profile.json write failure');
        }
      }
      // Default logic for all writes that don't fail
      const tempPath = `${filePath}.tmp`;
      await fs.promises.writeFile(tempPath, JSON.stringify(val), 'utf8');
      await fs.promises.rename(tempPath, filePath);
    }
  });
  await manager.initialize();

  await assert.rejects(manager.create('FailProfile'));

  // Verify no orphaned directory remains in profiles/
  const profilesDir = path.join(root, 'profiles');
  const files = fs.readdirSync(profilesDir);
  // Only index.json and the Setlist Principal folder should exist
  assert.equal(files.filter(f => f !== 'index.json').length, 1);
});

// ===== NEW RED TESTS =====

// Issue 1: Default profile with atomic persistence
test('first initialization rejects with profile_io_error when profile.json write fails, leaving no partial state', async (t) => {
  const root = makeRoot(t);
  let callCount = 0;
  const manager = new ProfileManager(root, {
    ...deterministicOptions(),
    writeJsonAtomic: async (filePath, val) => {
      callCount++;
      if (filePath.endsWith('profile.json')) {
        throw new Error('Injected profile.json failure during first init');
      }
      // For index.json, use real write
      await fs.promises.writeFile(filePath, JSON.stringify(val, null, 2), 'utf8');
    }
  });

  await assert.rejects(manager.initialize(), (err) => {
    return err instanceof ProfileError && err.code === 'profile_io_error';
  });

  // No partial profile directory should remain
  const profilesDir = path.join(root, 'profiles');
  const entries = fs.existsSync(profilesDir) ? fs.readdirSync(profilesDir) : [];
  const profileDirs = entries.filter(f => !f.startsWith('index'));
  assert.equal(profileDirs.length, 0, `Expected no profile dirs, found: ${profileDirs}`);

  // No index.json should exist
  assert.equal(fs.existsSync(path.join(profilesDir, 'index.json')), false);
});

// Issue 2: Real profile.json.bak recovery during scan
test('corrupt profile.json recovers from profile.json.bak during directory scan', async (t) => {
  const root = makeRoot(t);
  const options = deterministicOptions();
  const manager = new ProfileManager(root, options);
  await manager.initialize();
  const fest = await manager.create('Fest');

  const indexPath = path.join(root, 'profiles', 'index.json');
  const festMetaPath = path.join(root, 'profiles', fest.id, 'profile.json');
  const festMetaBak = festMetaPath + '.bak';

  // Create a valid backup of profile.json
  fs.copyFileSync(festMetaPath, festMetaBak);

  // Corrupt profile.json with invalid JSON
  fs.writeFileSync(festMetaPath, '{{invalid json');

  // Remove index.json and index.json.bak to force directory scan
  fs.unlinkSync(indexPath);
  try { fs.unlinkSync(indexPath + '.bak'); } catch {}

  const restarted = new ProfileManager(root, options);
  await restarted.initialize();

  // Fest should be recovered from .bak
  assert.equal(restarted.list().some(p => p.id === fest.id), true, 'Fest should be recovered from .bak');
});

// Issue 3a: Rename metadata write failure
test('rename returns ProfileError on metadata write failure and preserves previous state', async (t) => {
  const root = makeRoot(t);
  let failNext = false;
  const manager = new ProfileManager(root, {
    ...deterministicOptions(),
    writeJsonAtomic: async (filePath, val) => {
      if (failNext && filePath.endsWith('profile.json')) {
        throw new Error('Injected rename metadata failure');
      }
      await fs.promises.writeFile(filePath, JSON.stringify(val, null, 2), 'utf8');
    }
  });
  await manager.initialize();
  const fest = await manager.create('Fest');

  failNext = true;
  await assert.rejects(manager.rename(fest.id, 'New Name'), (err) => {
    return err instanceof ProfileError && err.code === 'profile_io_error';
  });

  // Name should remain 'Fest' in memory
  assert.equal(manager.list().find(p => p.id === fest.id)?.name, 'Fest');

  // Name should remain 'Fest' on disk (index.json)
  const indexPath = path.join(root, 'profiles', 'index.json');
  const registry = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(registry.profiles.find(p => p.id === fest.id)?.name, 'Fest');

  // profile.json should still have original name
  const metaPath = path.join(root, 'profiles', fest.id, 'profile.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  assert.equal(meta.name, 'Fest');
});

// Issue 3b: Rename index commit failure after metadata write
test('rename restores previous metadata when index commit fails', async (t) => {
  const root = makeRoot(t);
  let failIndexNext = false;
  const manager = new ProfileManager(root, {
    ...deterministicOptions(),
    writeJsonAtomic: async (filePath, val) => {
      if (failIndexNext && filePath.endsWith('index.json')) {
        throw new Error('Injected index commit failure');
      }
      await fs.promises.writeFile(filePath, JSON.stringify(val, null, 2), 'utf8');
    }
  });
  await manager.initialize();
  const fest = await manager.create('Fest');

  failIndexNext = true;
  await assert.rejects(manager.rename(fest.id, 'New Name'), (err) => {
    return err instanceof ProfileError && err.code === 'profile_io_error';
  });

  // In-memory name should remain 'Fest'
  assert.equal(manager.list().find(p => p.id === fest.id)?.name, 'Fest');

  // profile.json on disk should be restored to 'Fest'
  const metaPath = path.join(root, 'profiles', fest.id, 'profile.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  assert.equal(meta.name, 'Fest');
});

// Issue 3c: recordLegacySource metadata write failure
test('recordLegacySource returns ProfileError on metadata write failure and preserves previous state', async (t) => {
  const root = makeRoot(t);
  let failNext = false;
  const manager = new ProfileManager(root, {
    ...deterministicOptions(),
    writeJsonAtomic: async (filePath, val) => {
      if (failNext && filePath.endsWith('profile.json')) {
        throw new Error('Injected recordLegacy metadata failure');
      }
      await fs.promises.writeFile(filePath, JSON.stringify(val, null, 2), 'utf8');
    }
  });
  await manager.initialize();
  const principal = manager.getActive();

  failNext = true;
  await assert.rejects(manager.recordLegacySource('global', principal.id), (err) => {
    return err instanceof ProfileError && err.code === 'profile_io_error';
  });

  // Legacy source should not be recorded
  assert.equal(manager.hasLegacySource('global'), false);
});

// Issue 6: Scan recovery must not swallow persistence failure
test('scan recovery rejects when index write fails, does not create spurious Setlist Principal', async (t) => {
  const root = makeRoot(t);
  const options = deterministicOptions();
  const manager = new ProfileManager(root, options);
  await manager.initialize();
  const fest = await manager.create('Fest');

  // Remove index.json and .bak to force scan
  const indexPath = path.join(root, 'profiles', 'index.json');
  fs.unlinkSync(indexPath);
  try { fs.unlinkSync(indexPath + '.bak'); } catch {}

  // New manager with writer that fails on index.json
  const restarted = new ProfileManager(root, {
    ...deterministicOptions(),
    writeJsonAtomic: async (filePath, val) => {
      if (filePath.endsWith('index.json')) {
        throw new Error('Injected index write failure during scan rebuild');
      }
      await fs.promises.writeFile(filePath, JSON.stringify(val, null, 2), 'utf8');
    }
  });

  await assert.rejects(restarted.initialize(), (err) => {
    return err instanceof ProfileError && err.code === 'profile_io_error';
  });

  // No extra Setlist Principal should have been created
  const profilesDir = path.join(root, 'profiles');
  const dirs = fs.readdirSync(profilesDir).filter(f => {
    const stat = fs.statSync(path.join(profilesDir, f));
    return stat.isDirectory();
  });
  // Only the existing Setlist Principal and Fest should exist
  assert.equal(dirs.length, 2);
});

// Issue 7: UUID v4 validation
test('isValidUUID rejects non-v4 UUIDs (wrong version or variant bits)', () => {
  // Valid v4 UUID: version nibble is 4, variant bits are 8/9/a/b
  assert.equal(isValidUUID('00000000-0000-4000-8000-000000000001'), true);
  assert.equal(isValidUUID('a1b2c3d4-e5f6-4a7b-9c8d-e0f1a2b3c4d5'), true);

  // Wrong version (1 instead of 4)
  assert.equal(isValidUUID('00000000-0000-1000-8000-000000000001'), false);

  // Wrong variant (0 instead of 8-b)
  assert.equal(isValidUUID('00000000-0000-4000-0000-000000000001'), false);

  // Wrong variant (c instead of 8-b)
  assert.equal(isValidUUID('00000000-0000-4000-c000-000000000001'), false);

  // Valid v4 with variant a
  assert.equal(isValidUUID('00000000-0000-4000-a000-000000000001'), true);
});

test('rename with corrupted metadata and index commit failure does not escape SyntaxError and preserves state', async (t) => {
  const root = makeRoot(t);
  let failIndex = false;
  const manager = new ProfileManager(root, {
    ...deterministicOptions(),
    writeJsonAtomic: async (filePath, val) => {
      if (failIndex && filePath.endsWith('index.json')) {
        throw new Error('Injected index commit failure during rename');
      }
      await fs.promises.writeFile(filePath, JSON.stringify(val, null, 2), 'utf8');
    }
  });
  await manager.initialize();
  const fest = await manager.create('Fest');
  const festPaths = manager.getPaths(fest.id);

  // Corrupt profile.json beforehand
  fs.writeFileSync(festPaths.metadata, '{{invalid json');

  // Trigger rename with index failure
  failIndex = true;
  await assert.rejects(
    manager.rename(fest.id, 'New Name'),
    (err) => {
      // Must be a ProfileError with profile_io_error, NOT a SyntaxError from JSON.parse()
      return err instanceof ProfileError && err.code === 'profile_io_error';
    }
  );

  // Verify memory and index preserved
  assert.equal(manager.list().find(p => p.id === fest.id)?.name, 'Fest');
  const index = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'index.json'), 'utf8'));
  assert.equal(index.profiles.find(p => p.id === fest.id)?.name, 'Fest');
});

test('recordLegacySource metadata write / index rollback failure handles state correctly', async (t) => {
  const root = makeRoot(t);
  let failIndex = false;
  const manager = new ProfileManager(root, {
    ...deterministicOptions(),
    writeJsonAtomic: async (filePath, val) => {
      if (failIndex && filePath.endsWith('index.json')) {
        throw new Error('Injected index commit failure');
      }
      await fs.promises.writeFile(filePath, JSON.stringify(val, null, 2), 'utf8');
    }
  });
  await manager.initialize();
  const principal = manager.getActive();

  // Trigger recordLegacySource with index failure
  failIndex = true;
  await assert.rejects(
    manager.recordLegacySource('global', principal.id),
    (err) => err instanceof ProfileError && err.code === 'profile_io_error'
  );

  // Verify legacySources not changed
  assert.equal(manager.hasLegacySource('global'), false);
});

test('recordLegacySource with corrupted metadata throws ProfileError before mutation', async (t) => {
  const root = makeRoot(t);
  const manager = new ProfileManager(root, deterministicOptions());
  await manager.initialize();
  const principal = manager.getActive();
  const paths = manager.getActivePaths();

  // Corrupt profile.json beforehand
  fs.writeFileSync(paths.metadata, '{{invalid json');

  // Should throw ProfileError and not run any metadata writes/updates
  await assert.rejects(
    manager.recordLegacySource('global', principal.id),
    (err) => err instanceof ProfileError && err.code === 'profile_io_error'
  );
});
