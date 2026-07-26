import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import { getAutoStart, setAutoStart } from '../src/preferences.ts';

test('Preferences: auto-start read/write with SDK context', () => {
  const testStorageDir = path.join(tmpdir(), 'setlist-pref-test-' + Math.random().toString(36).substring(7));
  fs.mkdirSync(testStorageDir, { recursive: true });

  setExtensionContext({
    environment: {
      storageDirectory: testStorageDir
    }
  });

  try {
    // 1. Initially should return false (no file exists)
    assert.strictEqual(getAutoStart(), false);

    // 2. Set to true and verify it returns true
    let success = setAutoStart(true);
    assert.strictEqual(success, true);
    assert.strictEqual(getAutoStart(), true);

    // Verify the file was written to the storageDirectory and NOT double-appended
    const expectedFilePath = path.join(testStorageDir, 'auto-start');
    assert.ok(fs.existsSync(expectedFilePath), 'auto-start file should exist in storageDirectory');
    const content = fs.readFileSync(expectedFilePath, 'utf8').trim();
    assert.strictEqual(content, 'true');

    // 3. Set to false and verify
    success = setAutoStart(false);
    assert.strictEqual(success, true);
    assert.strictEqual(getAutoStart(), false);
    assert.strictEqual(fs.readFileSync(expectedFilePath, 'utf8').trim(), 'false');

  } finally {
    clearExtensionContext();
    try {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    } catch {}
  }
});

test('Preferences: auto-start resolves fallback dirs without double-append', () => {
  // Clear context to force fallback resolution
  clearExtensionContext();

  const originalCwd = process.cwd;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  // We mock process.cwd and HOME/USERPROFILE to test fallback resolution
  const tempFallbackDir = path.join(tmpdir(), 'setlist-fallback-' + Math.random().toString(36).substring(7));
  const setlistSubdir = path.join(tempFallbackDir, '.setlist');
  fs.mkdirSync(setlistSubdir, { recursive: true });

  // Stub process.cwd so CWD/.setlist does not exist
  process.cwd = () => path.join(tempFallbackDir, 'cwd-mock');

  // Temporarily stub HOME/USERPROFILE to point to tempFallbackDir
  process.env.HOME = tempFallbackDir;
  process.env.USERPROFILE = tempFallbackDir;

  try {
    // Write fake auto-start file in fallback path (which should be resolved correctly to HOME/.setlist/auto-start)
    const expectedFilePath = path.join(setlistSubdir, 'auto-start');
    fs.writeFileSync(expectedFilePath, 'true', 'utf8');

    // getAutoStart should correctly resolve to HOME/.setlist/auto-start and return true
    assert.strictEqual(getAutoStart(), true, 'Should find the file under HOME/.setlist/auto-start');

    // setAutoStart(false) should write to it
    const success = setAutoStart(false);
    assert.strictEqual(success, true);
    assert.strictEqual(fs.readFileSync(expectedFilePath, 'utf8').trim(), 'false');

  } finally {
    // Restore process.cwd and env vars
    process.cwd = originalCwd;

    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;

    if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
    else delete process.env.USERPROFILE;

    try {
      fs.rmSync(tempFallbackDir, { recursive: true, force: true });
    } catch {}
  }
});
