import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

import {
  legacyProjectKeyForFile,
  projectSessionIdForSong,
  projectIdentityFromMetadata,
  resolveProjectIdentity,
} from '../src/core/project-identity.ts';
import {
  initializeProjectProfileScope,
  recoverCompatibleLegacyPayload,
} from '../src/core/project-profile-scope.ts';
import { ProfileManager } from '../src/core/profile-manager.ts';
import {
  activateProjectProfileScope,
  bridgeState,
} from '../src/core/bridge-state.ts';
import { SetlistManager } from '../src/core/setlist-manager.ts';

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'rc-setlist-project-scope-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function deterministicOptions() {
  let id = 0;
  let tick = 0;
  return {
    randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => new Date(Date.UTC(2026, 6, 29, 0, 0, tick++)).toISOString(),
  };
}

test('saved Live Set identity is stable across Windows path case and separators', () => {
  const first = projectIdentityFromMetadata({
    song_name: 'Setlist Bridge',
    file_path: 'C:\\Shows\\Setlist Bridge Project\\SETLIST BRIDGE.als',
  }, { platform: 'win32' });
  const second = projectIdentityFromMetadata({
    song_name: 'SETLIST BRIDGE',
    file_path: 'c:/shows/setlist bridge project/setlist bridge.ALS',
  }, { platform: 'win32' });

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.key, second.key);
  assert.equal(first.displayName, 'Setlist Bridge');
  assert.equal(first.persistent, true);
  assert.equal(first.source, 'mcp-path');
  assert.equal(first.filePath, 'C:\\Shows\\Setlist Bridge Project\\SETLIST BRIDGE.als');
});

test('different saved Live Sets receive different project storage roots', async (t) => {
  const storageRoot = makeRoot(t);
  const alpha = projectIdentityFromMetadata({
    song_name: 'Alpha',
    file_path: 'C:\\Shows\\Alpha Project\\Alpha.als',
  }, { platform: 'win32' });
  const beta = projectIdentityFromMetadata({
    song_name: 'Beta',
    file_path: 'C:\\Shows\\Beta Project\\Beta.als',
  }, { platform: 'win32' });
  assert.ok(alpha);
  assert.ok(beta);

  const alphaScope = await initializeProjectProfileScope({
    storageRoot,
    identity: alpha,
    managerOptions: deterministicOptions(),
  });
  const betaScope = await initializeProjectProfileScope({
    storageRoot,
    identity: beta,
    managerOptions: deterministicOptions(),
  });

  assert.notEqual(alpha.key, beta.key);
  assert.notEqual(alphaScope.root, betaScope.root);
  assert.equal(alphaScope.root, path.join(storageRoot, 'project-setlists', alpha.key));
  assert.equal(betaScope.root, path.join(storageRoot, 'project-setlists', beta.key));
  assert.deepEqual(alphaScope.manager.list().map(({ name }) => name), ['Main Setlist']);
  assert.deepEqual(betaScope.manager.list().map(({ name }) => name), ['Main Setlist']);
});

test('identity resolution prefers project metadata and falls back to the Ableton window title', async () => {
  let titleReads = 0;
  const metadataIdentity = await resolveProjectIdentity({
    platform: 'win32',
    sessionId: 'session-a',
    getProjectMetadata: async () => ({
      song_name: 'Metadata Set',
      file_path: 'C:\\Shows\\Metadata Project\\Metadata Set.als',
    }),
    readWindowTitle: async () => {
      titleReads += 1;
      return 'WRONG TITLE - Ableton Live 12 Beta';
    },
  });
  assert.equal(metadataIdentity.displayName, 'Metadata Set');
  assert.equal(metadataIdentity.source, 'mcp-path');
  assert.equal(titleReads, 0);

  const titleIdentity = await resolveProjectIdentity({
    platform: 'win32',
    sessionId: 'session-b',
    getProjectMetadata: async () => {
      throw new Error('MCP unavailable');
    },
    readWindowTitle: async () => 'SETLIST BRIDGE* - Ableton Live 12 Beta',
  });
  assert.equal(titleIdentity.displayName, 'SETLIST BRIDGE');
  assert.equal(titleIdentity.source, 'window-title');
  assert.equal(titleIdentity.persistent, true);
});

test('unidentified Live Set uses an isolated session scope instead of global profiles', async (t) => {
  const storageRoot = makeRoot(t);
  const globalManager = new ProfileManager(storageRoot, deterministicOptions());
  await globalManager.initialize();
  await globalManager.create('Another Project Setlist');

  const identity = await resolveProjectIdentity({
    platform: 'linux',
    sessionId: 'fixed-session',
    getProjectMetadata: async () => null,
    readWindowTitle: async () => '',
  });
  const scope = await initializeProjectProfileScope({
    storageRoot,
    identity,
    managerOptions: deterministicOptions(),
  });

  assert.equal(identity.source, 'session');
  assert.equal(identity.persistent, false);
  assert.notEqual(scope.root, storageRoot);
  assert.deepEqual(scope.manager.list().map(({ name }) => name), ['Main Setlist']);
  assert.deepEqual(globalManager.list().map(({ name }) => name), [
    'Main Setlist',
    'Another Project Setlist',
  ]);
});

test('temporary project session id is stable for one Live process and Song handle', () => {
  assert.equal(
    projectSessionIdForSong(4242, '91', 'fallback-a'),
    projectSessionIdForSong(4242, '91', 'fallback-b'),
  );
  assert.notEqual(
    projectSessionIdForSong(4242, '91', 'fallback-a'),
    projectSessionIdForSong(4242, '92', 'fallback-a'),
  );
  assert.equal(projectSessionIdForSong(4242, '', 'fallback-a'), 'fallback-a');
});

test('delayed saved-project identity promotes all temporary profiles without deleting source', async (t) => {
  const storageRoot = makeRoot(t);
  const sessionIdentity = await resolveProjectIdentity({
    platform: 'linux',
    sessionId: 'live-process-song-handle',
    getProjectMetadata: async () => null,
    readWindowTitle: async () => '',
  });
  const source = await initializeProjectProfileScope({
    storageRoot,
    identity: sessionIdentity,
    managerOptions: deterministicOptions(),
  });
  const main = source.manager.getActive();
  fs.mkdirSync(source.manager.getPaths(main.id).lyrics, { recursive: true });
  fs.writeFileSync(path.join(source.manager.getPaths(main.id).lyrics, 'Song A.lrc'), '[00:00.00]Main lyric');
  const second = await source.manager.create('Second Setlist');
  fs.mkdirSync(source.manager.getPaths(second.id).lyrics, { recursive: true });
  fs.writeFileSync(path.join(source.manager.getPaths(second.id).lyrics, 'Song A.lrc'), '[00:00.00]Second lyric');
  await source.manager.select(second.id);

  const savedIdentity = projectIdentityFromMetadata({
    song_name: 'Show',
    file_path: 'C:\\Shows\\Show Project\\Show.als',
  }, { platform: 'win32' });
  assert.ok(savedIdentity);
  const promoted = await initializeProjectProfileScope({
    storageRoot,
    identity: savedIdentity,
    managerOptions: deterministicOptions(),
    promoteFrom: source,
  });

  assert.deepEqual(promoted.manager.list().map(({ name }) => name), ['Main Setlist', 'Second Setlist']);
  assert.equal(promoted.manager.getActive().name, 'Second Setlist');
  const promotedMain = promoted.manager.list().find(({ name }) => name === 'Main Setlist');
  const promotedSecond = promoted.manager.list().find(({ name }) => name === 'Second Setlist');
  assert.equal(
    fs.readFileSync(path.join(promoted.manager.getPaths(promotedMain.id).lyrics, 'Song A.lrc'), 'utf8'),
    '[00:00.00]Main lyric',
  );
  assert.equal(
    fs.readFileSync(path.join(promoted.manager.getPaths(promotedSecond.id).lyrics, 'Song A.lrc'), 'utf8'),
    '[00:00.00]Second lyric',
  );
  assert.equal(fs.existsSync(path.join(source.manager.getPaths(second.id).lyrics, 'Song A.lrc')), true);

  const repeated = await initializeProjectProfileScope({
    storageRoot,
    identity: savedIdentity,
    managerOptions: deterministicOptions(),
    promoteFrom: source,
  });
  assert.deepEqual(repeated.manager.list().map(({ name }) => name), ['Main Setlist', 'Second Setlist']);
});

test('promotion merges complementary data in a same-named profile without creating a false conflict', async (t) => {
  const storageRoot = makeRoot(t);
  const sessionIdentity = await resolveProjectIdentity({
    platform: 'linux', sessionId: 'complementary-session', getProjectMetadata: async () => null, readWindowTitle: async () => '',
  });
  const source = await initializeProjectProfileScope({
    storageRoot, identity: sessionIdentity, managerOptions: deterministicOptions(), adoptOrphanSession: false,
  });
  fs.writeFileSync(source.manager.getActivePaths().customOrder, JSON.stringify(['Song B', 'Song A']));

  const savedIdentity = projectIdentityFromMetadata({
    song_name: 'Show', file_path: 'C:\\Shows\\Complementary\\Show.als',
  }, { platform: 'win32' });
  assert.ok(savedIdentity);
  const existing = await initializeProjectProfileScope({
    storageRoot, identity: savedIdentity, managerOptions: deterministicOptions(), adoptOrphanSession: false,
  });
  const existingPaths = existing.manager.getActivePaths();
  fs.mkdirSync(existingPaths.lyrics, { recursive: true });
  fs.writeFileSync(path.join(existingPaths.lyrics, 'Song A.lrc'), '[00:00.00]Existing lyric');

  const promoted = await initializeProjectProfileScope({
    storageRoot,
    identity: savedIdentity,
    managerOptions: deterministicOptions(),
    promoteFrom: source,
  });

  assert.deepEqual(promoted.manager.list().map(({ name }) => name), ['Main Setlist']);
  const paths = promoted.manager.getActivePaths();
  assert.equal(fs.readFileSync(path.join(paths.lyrics, 'Song A.lrc'), 'utf8'), '[00:00.00]Existing lyric');
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.customOrder, 'utf8')), ['Song B', 'Song A']);
});

test('repeating a conflicting promotion reuses the recovered profile instead of creating an empty one', async (t) => {
  const storageRoot = makeRoot(t);
  const options = deterministicOptions();
  const sessionIdentity = await resolveProjectIdentity({
    platform: 'linux', sessionId: 'conflicting-session', getProjectMetadata: async () => null, readWindowTitle: async () => '',
  });
  const source = await initializeProjectProfileScope({
    storageRoot, identity: sessionIdentity, managerOptions: options, adoptOrphanSession: false,
  });
  fs.mkdirSync(source.manager.getActivePaths().lyrics, { recursive: true });
  fs.writeFileSync(path.join(source.manager.getActivePaths().lyrics, 'Song A.lrc'), '[00:00.00]Temporary lyric');

  const savedIdentity = projectIdentityFromMetadata({
    song_name: 'Show', file_path: 'C:\\Shows\\Conflict\\Show.als',
  }, { platform: 'win32' });
  assert.ok(savedIdentity);
  const existing = await initializeProjectProfileScope({
    storageRoot, identity: savedIdentity, managerOptions: options, adoptOrphanSession: false,
  });
  fs.mkdirSync(existing.manager.getActivePaths().lyrics, { recursive: true });
  fs.writeFileSync(path.join(existing.manager.getActivePaths().lyrics, 'Song A.lrc'), '[00:00.00]Saved lyric');

  const first = await initializeProjectProfileScope({
    storageRoot, identity: savedIdentity, managerOptions: options, promoteFrom: source,
  });
  const recoveredId = first.manager.getActive().id;
  assert.deepEqual(first.manager.list().map(({ name }) => name), ['Main Setlist', 'Main Setlist (Recovered)']);

  const repeated = await initializeProjectProfileScope({
    storageRoot, identity: savedIdentity, managerOptions: options, promoteFrom: source,
  });
  assert.deepEqual(repeated.manager.list().map(({ name }) => name), ['Main Setlist', 'Main Setlist (Recovered)']);
  assert.equal(repeated.manager.getActive().id, recoveredId);
  assert.equal(
    fs.readFileSync(path.join(repeated.manager.getActivePaths().lyrics, 'Song A.lrc'), 'utf8'),
    '[00:00.00]Temporary lyric',
  );
});

test('one orphan temporary scope is adopted but multiple candidates are never guessed', async (t) => {
  const storageRoot = makeRoot(t);
  const oldIdentity = await resolveProjectIdentity({
    platform: 'linux', sessionId: 'old-session', getProjectMetadata: async () => null, readWindowTitle: async () => '',
  });
  const oldScope = await initializeProjectProfileScope({
    storageRoot, identity: oldIdentity, managerOptions: deterministicOptions(), adoptOrphanSession: false,
  });
  await oldScope.manager.create('Second Setlist');

  const newIdentity = await resolveProjectIdentity({
    platform: 'linux', sessionId: 'new-session', getProjectMetadata: async () => null, readWindowTitle: async () => '',
  });
  const adopted = await initializeProjectProfileScope({
    storageRoot, identity: newIdentity, managerOptions: deterministicOptions(),
  });
  assert.deepEqual(adopted.manager.list().map(({ name }) => name), ['Main Setlist', 'Second Setlist']);

  const ambiguousRoot = makeRoot(t);
  for (const id of ['old-a', 'old-b']) {
    const identity = await resolveProjectIdentity({
      platform: 'linux', sessionId: id, getProjectMetadata: async () => null, readWindowTitle: async () => '',
    });
    const scope = await initializeProjectProfileScope({
      storageRoot: ambiguousRoot, identity, managerOptions: deterministicOptions(), adoptOrphanSession: false,
    });
    await scope.manager.create(`Setlist ${id}`);
  }
  const currentIdentity = await resolveProjectIdentity({
    platform: 'linux', sessionId: 'current', getProjectMetadata: async () => null, readWindowTitle: async () => '',
  });
  const current = await initializeProjectProfileScope({
    storageRoot: ambiguousRoot, identity: currentIdentity, managerOptions: deterministicOptions(),
  });
  assert.deepEqual(current.manager.list().map(({ name }) => name), ['Main Setlist']);
});

test('compatible legacy lyrics recover only from an exact current-song-set match', async (t) => {
  const storageRoot = makeRoot(t);
  const globalManager = new ProfileManager(storageRoot, deterministicOptions());
  await globalManager.initialize();
  const compatible = await globalManager.create('Compatible Project');
  const compatiblePaths = globalManager.getPaths(compatible.id);
  fs.mkdirSync(compatiblePaths.lyrics, { recursive: true });
  fs.writeFileSync(path.join(compatiblePaths.lyrics, 'song a.lrc'), '[00:00.00]Recovered A');
  fs.writeFileSync(path.join(compatiblePaths.lyrics, 'Song B.txt'), 'Recovered B');
  fs.writeFileSync(path.join(compatiblePaths.lyrics, 'Other Song.lrc'), '[00:00.00]Do not copy');
  fs.writeFileSync(compatiblePaths.customOrder, JSON.stringify(['Song B', 'Song A']));
  const unrelated = await globalManager.create('Unrelated Project');
  const unrelatedPaths = globalManager.getPaths(unrelated.id);
  fs.mkdirSync(unrelatedPaths.lyrics, { recursive: true });
  fs.writeFileSync(path.join(unrelatedPaths.lyrics, 'Song A.lrc'), '[00:00.00]Wrong project');
  fs.writeFileSync(unrelatedPaths.customOrder, JSON.stringify(['Song A', 'Other Song']));

  const sessionIdentity = await resolveProjectIdentity({
    platform: 'linux', sessionId: 'lyrics-session', getProjectMetadata: async () => null, readWindowTitle: async () => '',
  });
  const scope = await initializeProjectProfileScope({
    storageRoot, identity: sessionIdentity, managerOptions: deterministicOptions(), adoptOrphanSession: false,
  });
  const result = await recoverCompatibleLegacyPayload({
    storageRoot,
    manager: scope.manager,
    songTitles: ['Song A', 'Song B'],
    candidateRoots: [storageRoot],
  });

  assert.equal(result.recovered, true);
  assert.deepEqual(result.customOrder, ['Song B', 'Song A']);
  const active = scope.manager.getActivePaths();
  assert.equal(fs.readFileSync(path.join(active.lyrics, 'Song A.lrc'), 'utf8'), '[00:00.00]Recovered A');
  assert.equal(fs.readdirSync(active.lyrics).includes('Song A.lrc'), true);
  assert.equal(fs.readFileSync(path.join(active.lyrics, 'Song B.txt'), 'utf8'), 'Recovered B');
  assert.equal(fs.existsSync(path.join(active.lyrics, 'Other Song.lrc')), false);
});

test('compatible legacy recovery refuses conflicting matches and never overwrites lyrics', async (t) => {
  const storageRoot = makeRoot(t);
  const globalManager = new ProfileManager(storageRoot, deterministicOptions());
  await globalManager.initialize();
  for (const [name, lyric] of [['Candidate One', 'One'], ['Candidate Two', 'Two']]) {
    const profile = await globalManager.create(name);
    const paths = globalManager.getPaths(profile.id);
    fs.mkdirSync(paths.lyrics, { recursive: true });
    fs.writeFileSync(path.join(paths.lyrics, 'Song A.lrc'), `[00:00.00]${lyric}`);
    fs.writeFileSync(paths.customOrder, JSON.stringify(['Song A', 'Song B']));
  }
  const sessionIdentity = await resolveProjectIdentity({
    platform: 'linux', sessionId: 'ambiguous-lyrics', getProjectMetadata: async () => null, readWindowTitle: async () => '',
  });
  const scope = await initializeProjectProfileScope({
    storageRoot, identity: sessionIdentity, managerOptions: deterministicOptions(), adoptOrphanSession: false,
  });
  const target = scope.manager.getActivePaths();
  fs.mkdirSync(target.lyrics, { recursive: true });
  fs.writeFileSync(path.join(target.lyrics, 'Song A.lrc'), '[00:00.00]Keep me');

  const result = await recoverCompatibleLegacyPayload({
    storageRoot,
    manager: scope.manager,
    songTitles: ['Song A', 'Song B'],
    candidateRoots: [storageRoot],
  });
  assert.equal(result.recovered, false);
  assert.equal(fs.readFileSync(path.join(target.lyrics, 'Song A.lrc'), 'utf8'), '[00:00.00]Keep me');
  assert.equal(fs.existsSync(target.customOrder), false);
});

test('compatible legacy recovery preserves an existing project order and ignores unsafe profile ids', async (t) => {
  const storageRoot = makeRoot(t);
  const globalManager = new ProfileManager(storageRoot, deterministicOptions());
  await globalManager.initialize();
  const compatible = await globalManager.create('Compatible Project');
  const source = globalManager.getPaths(compatible.id);
  fs.mkdirSync(source.lyrics, { recursive: true });
  fs.writeFileSync(path.join(source.lyrics, 'Song A.lrc'), '[00:00.00]Recovered');
  fs.writeFileSync(source.customOrder, JSON.stringify(['Song B', 'Song A']));

  const registryPath = path.join(storageRoot, 'profiles', 'index.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  registry.profiles.push({ id: '../outside', name: 'Unsafe' });
  fs.writeFileSync(registryPath, JSON.stringify(registry));

  const sessionIdentity = await resolveProjectIdentity({
    platform: 'linux', sessionId: 'preserve-order', getProjectMetadata: async () => null, readWindowTitle: async () => '',
  });
  const scope = await initializeProjectProfileScope({
    storageRoot, identity: sessionIdentity, managerOptions: deterministicOptions(), adoptOrphanSession: false,
  });
  const target = scope.manager.getActivePaths();
  fs.writeFileSync(target.customOrder, JSON.stringify(['Song A', 'Song B']));

  const result = await recoverCompatibleLegacyPayload({
    storageRoot,
    manager: scope.manager,
    songTitles: ['Song A', 'Song B'],
    candidateRoots: [storageRoot],
  });

  assert.equal(result.recovered, true);
  assert.deepEqual(result.customOrder, ['Song A', 'Song B']);
  assert.deepEqual(JSON.parse(fs.readFileSync(target.customOrder, 'utf8')), ['Song A', 'Song B']);
  assert.equal(fs.readFileSync(path.join(target.lyrics, 'Song A.lrc'), 'utf8'), '[00:00.00]Recovered');
});

test('project scope imports only the exact legacy Ableton Project and remains idempotent', async (t) => {
  const storageParent = makeRoot(t);
  const currentRoot = path.join(storageParent, 'ntworm.ableton-rc-setlist');
  const previousRoot = path.join(storageParent, 'worm.ableton-setlist-bridge');
  const filePath = 'C:\\Shows\\Alpha Project\\Alpha.als';
  const exactKey = legacyProjectKeyForFile(filePath);
  assert.match(exactKey, /^[a-f0-9]{32}$/);

  const exactLegacy = path.join(previousRoot, 'projects', exactKey);
  fs.mkdirSync(path.join(exactLegacy, 'lyrics'), { recursive: true });
  fs.writeFileSync(path.join(exactLegacy, 'project-info.json'), JSON.stringify({
    projectName: 'Alpha Project',
    projectPath: 'C:/Shows/Alpha Project',
    key: exactKey,
  }));
  fs.writeFileSync(path.join(exactLegacy, 'lyrics', 'Alpha Song.lrc'), '[00:00.00]Exact project lyric');
  fs.writeFileSync(path.join(exactLegacy, 'custom-order.json'), JSON.stringify(['Alpha Song']));

  const unrelatedLegacy = path.join(previousRoot, 'projects', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  fs.mkdirSync(path.join(unrelatedLegacy, 'lyrics'), { recursive: true });
  fs.writeFileSync(path.join(unrelatedLegacy, 'project-info.json'), JSON.stringify({
    projectName: 'Other Project',
  }));
  fs.writeFileSync(path.join(unrelatedLegacy, 'lyrics', 'Other Song.lrc'), '[00:00.00]Must stay isolated');

  const globalManager = new ProfileManager(currentRoot, deterministicOptions());
  await globalManager.initialize();
  assert.ok(globalManager.list().some(({ name }) => name === 'Other Project'));

  const identity = projectIdentityFromMetadata({
    song_name: 'Alpha',
    file_path: filePath,
  }, { platform: 'win32' });
  assert.ok(identity);

  const first = await initializeProjectProfileScope({
    storageRoot: currentRoot,
    identity,
    managerOptions: deterministicOptions(),
  });
  const activePaths = first.manager.getActivePaths();
  assert.deepEqual(first.manager.list().map(({ name }) => name), ['Main Setlist']);
  assert.equal(
    fs.readFileSync(path.join(activePaths.lyrics, 'Alpha Song.lrc'), 'utf8'),
    '[00:00.00]Exact project lyric',
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(activePaths.customOrder, 'utf8')), ['Alpha Song']);
  assert.equal(fs.existsSync(path.join(activePaths.lyrics, 'Other Song.lrc')), false);
  assert.equal(fs.existsSync(path.join(exactLegacy, 'lyrics', 'Alpha Song.lrc')), true);

  const second = await initializeProjectProfileScope({
    storageRoot: currentRoot,
    identity,
    managerOptions: deterministicOptions(),
  });
  assert.deepEqual(second.manager.list().map(({ name }) => name), ['Main Setlist']);
  assert.equal(
    fs.readFileSync(path.join(second.manager.getActivePaths().lyrics, 'Alpha Song.lrc'), 'utf8'),
    '[00:00.00]Exact project lyric',
  );
});

test('activating another Live Set swaps registries and restores each set independently', async (t) => {
  const storageRoot = makeRoot(t);
  const alpha = projectIdentityFromMetadata({
    song_name: 'Alpha',
    file_path: 'C:\\Shows\\Alpha Project\\Alpha.als',
  }, { platform: 'win32' });
  const beta = projectIdentityFromMetadata({
    song_name: 'Beta',
    file_path: 'C:\\Shows\\Beta Project\\Beta.als',
  }, { platform: 'win32' });
  assert.ok(alpha);
  assert.ok(beta);

  const previous = {
    globalPersistenceDir: bridgeState.globalPersistenceDir,
    manager: bridgeState.manager,
    profileManager: bridgeState.profileManager,
    projectIdentity: bridgeState.projectIdentity,
  };
  bridgeState.globalPersistenceDir = storageRoot;
  bridgeState.manager = new SetlistManager();

  try {
    await activateProjectProfileScope(alpha, deterministicOptions());
    await bridgeState.profileManager.create('Alpha Encore');
    assert.deepEqual(bridgeState.profileManager.list().map(({ name }) => name), [
      'Main Setlist',
      'Alpha Encore',
    ]);

    await activateProjectProfileScope(beta, deterministicOptions());
    assert.equal(bridgeState.projectIdentity.key, beta.key);
    assert.deepEqual(bridgeState.profileManager.list().map(({ name }) => name), ['Main Setlist']);

    await activateProjectProfileScope(alpha, deterministicOptions());
    assert.equal(bridgeState.projectIdentity.key, alpha.key);
    assert.deepEqual(bridgeState.profileManager.list().map(({ name }) => name), [
      'Main Setlist',
      'Alpha Encore',
    ]);
  } finally {
    bridgeState.globalPersistenceDir = previous.globalPersistenceDir;
    bridgeState.manager = previous.manager;
    bridgeState.profileManager = previous.profileManager;
    bridgeState.projectIdentity = previous.projectIdentity;
  }
});

test('higher-fidelity MCP path identity promotes profiles created under a window-title scope', async (t) => {
  const storageRoot = makeRoot(t);
  const titleIdentity = await resolveProjectIdentity({
    platform: 'win32',
    sessionId: 'unused',
    getProjectMetadata: async () => null,
    readWindowTitle: async () => 'Setlist Bridge - Ableton Live 12 Suite',
  });
  const pathIdentity = projectIdentityFromMetadata({
    song_name: 'Setlist Bridge',
    file_path: 'C:\\Shows\\Setlist Bridge\\Setlist Bridge.als',
  }, { platform: 'win32' });
  assert.equal(titleIdentity.source, 'window-title');
  assert.ok(pathIdentity);

  const previous = {
    globalPersistenceDir: bridgeState.globalPersistenceDir,
    manager: bridgeState.manager,
    profileManager: bridgeState.profileManager,
    projectIdentity: bridgeState.projectIdentity,
  };
  bridgeState.globalPersistenceDir = storageRoot;
  bridgeState.manager = new SetlistManager();
  bridgeState.profileManager = null;
  bridgeState.projectIdentity = null;

  try {
    await activateProjectProfileScope(titleIdentity, deterministicOptions());
    await bridgeState.profileManager.create('Second Setlist');
    await activateProjectProfileScope(pathIdentity, deterministicOptions());
    assert.equal(bridgeState.projectIdentity.source, 'mcp-path');
    assert.deepEqual(
      bridgeState.profileManager.list().map(({ name }) => name),
      ['Main Setlist', 'Second Setlist'],
    );
  } finally {
    bridgeState.globalPersistenceDir = previous.globalPersistenceDir;
    bridgeState.manager = previous.manager;
    bridgeState.profileManager = previous.profileManager;
    bridgeState.projectIdentity = previous.projectIdentity;
  }
});

test('MCP path promotion waits for an in-flight legacy lyric recovery', async (t) => {
  const storageRoot = makeRoot(t);
  const sessionIdentity = await resolveProjectIdentity({
    platform: 'linux', sessionId: 'recovery-race', getProjectMetadata: async () => null, readWindowTitle: async () => '',
  });
  const pathIdentity = projectIdentityFromMetadata({
    song_name: 'Race Show', file_path: 'C:\\Shows\\Race Show\\Race Show.als',
  }, { platform: 'win32' });
  assert.ok(pathIdentity);

  const previous = {
    globalPersistenceDir: bridgeState.globalPersistenceDir,
    manager: bridgeState.manager,
    profileManager: bridgeState.profileManager,
    projectIdentity: bridgeState.projectIdentity,
    legacyRecoveryPromise: bridgeState.legacyRecoveryPromise,
  };
  bridgeState.globalPersistenceDir = storageRoot;
  bridgeState.manager = new SetlistManager();
  bridgeState.profileManager = null;
  bridgeState.projectIdentity = null;

  let releaseRecovery;
  try {
    await activateProjectProfileScope(sessionIdentity, deterministicOptions());
    const sourcePaths = bridgeState.profileManager.getActivePaths();
    bridgeState.legacyRecoveryPromise = new Promise((resolve) => {
      releaseRecovery = () => {
        fs.mkdirSync(sourcePaths.lyrics, { recursive: true });
        fs.writeFileSync(path.join(sourcePaths.lyrics, 'Song A.lrc'), '[00:00.00]Recovered before promotion');
        resolve();
      };
    });

    const activation = activateProjectProfileScope(pathIdentity, deterministicOptions());
    const activationState = await Promise.race([
      activation.then(() => 'activated'),
      new Promise((resolve) => setTimeout(() => resolve('waiting'), 150)),
    ]);
    releaseRecovery();
    const promoted = await activation;

    assert.equal(activationState, 'waiting');
    assert.equal(
      fs.readFileSync(path.join(promoted.manager.getActivePaths().lyrics, 'Song A.lrc'), 'utf8'),
      '[00:00.00]Recovered before promotion',
    );
  } finally {
    releaseRecovery?.();
    bridgeState.globalPersistenceDir = previous.globalPersistenceDir;
    bridgeState.manager = previous.manager;
    bridgeState.profileManager = previous.profileManager;
    bridgeState.projectIdentity = previous.projectIdentity;
    bridgeState.legacyRecoveryPromise = previous.legacyRecoveryPromise;
  }
});
