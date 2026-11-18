import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import * as preferences from '../src/preferences.ts';

const { getAutoStart, setAutoStart } = preferences;

test('Preferences: auto-start read/write with SDK context', () => {
  const testStorageDir = path.join(
    tmpdir(),
    'setlist-pref-test-' + Math.random().toString(36).substring(7),
  );
  fs.mkdirSync(testStorageDir, { recursive: true });

  setExtensionContext({
    environment: {
      storageDirectory: testStorageDir,
    },
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
    } catch {
      // swallow: nothing to do here on purpose
    }
  }
});

test('Preferences: auto-start resolves fallback dirs without double-append', () => {
  // Clear context to force fallback resolution
  clearExtensionContext();

  const originalCwd = process.cwd;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  // We mock process.cwd and HOME/USERPROFILE to test fallback resolution
  const tempFallbackDir = path.join(
    tmpdir(),
    'setlist-fallback-' + Math.random().toString(36).substring(7),
  );
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
    } catch {
      // swallow: nothing to do here on purpose
    }
  }
});

test('Preferences: UI locale persists only supported languages in SDK storage', () => {
  assert.strictEqual(typeof preferences.getUiLocale, 'function', 'getUiLocale must be exported');
  assert.strictEqual(typeof preferences.setUiLocale, 'function', 'setUiLocale must be exported');
  const { getUiLocale, setUiLocale } = preferences;
  const testStorageDir = path.join(
    tmpdir(),
    'setlist-locale-test-' + Math.random().toString(36).substring(7),
  );
  fs.mkdirSync(testStorageDir, { recursive: true });
  setExtensionContext({
    environment: {
      storageDirectory: testStorageDir,
    },
  });

  try {
    assert.strictEqual(getUiLocale(), 'en');
    assert.strictEqual(setUiLocale('pt-BR'), true);
    assert.strictEqual(getUiLocale(), 'pt-BR');
    assert.strictEqual(
      fs.readFileSync(path.join(testStorageDir, 'ui-locale'), 'utf8').trim(),
      'pt-BR',
    );

    assert.strictEqual(setUiLocale('fr'), false);
    assert.strictEqual(getUiLocale(), 'pt-BR');
    assert.strictEqual(setUiLocale('en'), true);
    assert.strictEqual(getUiLocale(), 'en');
  } finally {
    clearExtensionContext();
    try {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    } catch {
      // swallow: nothing to do here on purpose
    }
  }
});

const PEER = { host: '192.168.0.10', port: 4444, peerToken: 'secret-token', fingerprint: 'ab:cd' };
const PEER_TWO = {
  host: '192.168.0.11',
  port: 4444,
  peerToken: 'other-token',
  fingerprint: 'ef:01',
};

// The pairings live in the storage of the extension, so every test gets one
// of its own and hands it over while the test runs.
function withPeerStorage(run) {
  const storageDir = fs.mkdtempSync(path.join(tmpdir(), 'setlist-peers-'));
  setExtensionContext({ environment: { storageDirectory: storageDir } });
  try {
    run(storageDir);
  } finally {
    clearExtensionContext();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
}

test('Preferences: a pairing file from before the list loads as one entry', () => {
  withPeerStorage((storageDir) => {
    fs.writeFileSync(path.join(storageDir, 'peer.json'), JSON.stringify(PEER), 'utf8');
    assert.deepStrictEqual(preferences.readPeerConfigs(), [PEER]);
    assert.deepStrictEqual(preferences.readPeerConfig(), PEER);
  });
});

test('Preferences: two computers can be paired at the same time', () => {
  withPeerStorage((storageDir) => {
    assert.strictEqual(preferences.writePeerConfig(PEER), true);
    assert.strictEqual(preferences.writePeerConfig(PEER_TWO), true);
    assert.deepStrictEqual(preferences.readPeerConfigs(), [PEER, PEER_TWO]);
    const stored = JSON.parse(fs.readFileSync(path.join(storageDir, 'peer.json'), 'utf8'));
    assert.deepStrictEqual(stored, { peers: [PEER, PEER_TWO] });
  });
});

test('Preferences: pairing the same computer again replaces the old pairing', () => {
  withPeerStorage(() => {
    assert.strictEqual(preferences.writePeerConfig(PEER), true);
    assert.strictEqual(preferences.writePeerConfig(PEER_TWO), true);
    const again = { ...PEER, peerToken: 'fresh-token' };
    assert.strictEqual(preferences.writePeerConfig(again), true);
    assert.deepStrictEqual(preferences.readPeerConfigs(), [again, PEER_TWO]);
  });
});

test('Preferences: the key of a pairing ignores the case of the host', () => {
  assert.strictEqual(preferences.peerKey({ host: 'LOCALHOST', port: 4444 }), 'localhost:4444');
});

test('Preferences: removing one computer keeps the other', () => {
  withPeerStorage((storageDir) => {
    preferences.writePeerConfig(PEER);
    preferences.writePeerConfig(PEER_TWO);
    assert.strictEqual(preferences.removePeerConfig(PEER.host, PEER.port), true);
    assert.deepStrictEqual(preferences.readPeerConfigs(), [PEER_TWO]);
    assert.ok(
      fs.existsSync(path.join(storageDir, 'peer.json')),
      'the file stays for the computer that is still paired',
    );
  });
});

test('Preferences: removing the last computer removes the file', () => {
  withPeerStorage((storageDir) => {
    preferences.writePeerConfig(PEER);
    assert.strictEqual(preferences.removePeerConfig(PEER.host, PEER.port), true);
    assert.deepStrictEqual(preferences.readPeerConfigs(), []);
    assert.strictEqual(fs.existsSync(path.join(storageDir, 'peer.json')), false);
  });
});

test('Preferences: a broken entry is skipped and the other computers stay', () => {
  withPeerStorage((storageDir) => {
    const broken = { host: '192.168.0.12', port: 'not-a-port' };
    fs.writeFileSync(
      path.join(storageDir, 'peer.json'),
      JSON.stringify({ peers: [PEER, broken, PEER_TWO] }),
      'utf8',
    );
    assert.deepStrictEqual(preferences.readPeerConfigs(), [PEER, PEER_TWO]);
    assert.deepStrictEqual(preferences.readPeerConfig(), PEER);
  });
});

test(
  'Preferences: the peer config is owner-only, also when an older file was not',
  { skip: process.platform === 'win32' ? 'Windows has no POSIX file modes' : false },
  () => {
    const testStorageDir = fs.mkdtempSync(path.join(tmpdir(), 'setlist-peer-mode-'));
    const peerFile = path.join(testStorageDir, 'peer.json');
    setExtensionContext({ environment: { storageDirectory: testStorageDir } });
    try {
      assert.strictEqual(preferences.writePeerConfig(PEER), true);
      assert.strictEqual(fs.statSync(peerFile).mode & 0o777, 0o600);

      fs.chmodSync(peerFile, 0o644);
      assert.deepStrictEqual(preferences.readPeerConfig(), PEER);
      assert.strictEqual(fs.statSync(peerFile).mode & 0o777, 0o600);
    } finally {
      clearExtensionContext();
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  },
);

test('Preferences: the computer that handed out its code remembers it is the second one', () => {
  withPeerStorage((storageDir) => {
    assert.strictEqual(preferences.readSlaveRole(), null);

    const role = { masterAddress: '192.168.0.2', pairedAt: '2026-11-18T10:00:00.000Z' };
    assert.strictEqual(preferences.writeSlaveRole(role), true);
    assert.deepStrictEqual(preferences.readSlaveRole(), role);
    assert.ok(fs.existsSync(path.join(storageDir, 'peer-role.json')));
  });
});

test('Preferences: a role file that cannot be read is no role at all', () => {
  withPeerStorage((storageDir) => {
    const roleFile = path.join(storageDir, 'peer-role.json');
    const broken = ['not json at all', JSON.stringify({ masterAddress: '' })];
    for (const content of broken) {
      fs.writeFileSync(roleFile, content, 'utf8');
      assert.strictEqual(preferences.readSlaveRole(), null);
    }
  });
});

test(
  'Preferences: the role file is owner-only',
  { skip: process.platform === 'win32' ? 'Windows has no POSIX file modes' : false },
  () => {
    const testStorageDir = fs.mkdtempSync(path.join(tmpdir(), 'setlist-role-mode-'));
    setExtensionContext({ environment: { storageDirectory: testStorageDir } });
    try {
      assert.strictEqual(
        preferences.writeSlaveRole({ masterAddress: '10.0.0.2', pairedAt: 'now' }),
        true,
      );
      assert.strictEqual(
        fs.statSync(path.join(testStorageDir, 'peer-role.json')).mode & 0o777,
        0o600,
      );
    } finally {
      clearExtensionContext();
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  },
);
