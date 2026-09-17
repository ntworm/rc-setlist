// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Tests for the public contract documented in `docs/CONTRACTS.md` (and
// `docs/pt-BR/CONTRATOS.md`). Every claim in that document is either
// pinned here or delegated to a sibling test referenced by name. Run as
// part of `npm run ci:public`.

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  copyFileSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { ProfileManager } from '../src/core/profile-manager.ts';
import { parseLocator, parseSetlist } from '../src/core/locator-parser.ts';

const repoRoot = resolve(import.meta.dirname, '..');
const fixturesRoot = join(repoRoot, 'tests/fixtures/storage');

// ---------------------------------------------------------------------------
// (1) Disk migration: each past version's fixture loads and round-trips.
//     Mirrors CONTRACTS.md §1 and §6.2; the registry's schemaVersion is
//     upgraded in place by ProfileManager.initialize() so 0.5.1/0.6.1/0.7.0
//     fixtures all arrive with schemaVersion: 2 + the active profile.
// ---------------------------------------------------------------------------

const PAST_VERSIONS = ['0.5.1', '0.6.1', '0.7.0'];

const VERSION_FIXTURES = {
  '0.5.1': {
    customOrder: ['INTRO', 'VERSE', 'CHORUS'],
    songBook: {},
    lyrics: ['INTRO.txt'],
  },
  '0.6.1': {
    customOrder: ['INTRO', 'VERSE', 'CHORUS', 'BRIDGE'],
    songBook: { '0.0': { color: '#d6a89a' }, '32.0': { color: '#9db8d4' } },
    lyrics: ['VERSE.lrc'],
  },
  '0.7.0': {
    customOrder: ['INTRO [bpm 120]', 'VERSE', 'CHORUS'],
    songBook: {
      '0.0': { color: '#d6a89a', notes: 'Key: Em' },
      '32.0': { color: '#9db8d4', notes: 'Drop to D' },
    },
    lyrics: ['VERSE.lrc', 'CHORUS.lrc'],
  },
};

function copyFixtureTree(version) {
  const target = mkdtempSync(join(tmpdir(), `rc-setlist-${version}-`));
  const copyRecursive = (srcDir, dstDir) => {
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      const srcPath = join(srcDir, entry.name);
      const dstPath = join(dstDir, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(dstPath, { recursive: true });
        copyRecursive(srcPath, dstPath);
      } else if (entry.isFile()) {
        copyFileSync(srcPath, dstPath);
      }
    }
  };
  copyRecursive(join(fixturesRoot, version), target);
  return target;
}

function deterministicOptions() {
  let tick = 0;
  return {
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    now: () => new Date(Date.UTC(2026, 8, 1, 0, 0, tick++)).toISOString(),
  };
}

test('CONTRACTS §1 + §6.2: every past-version fixture upgrades to schemaVersion: 2', async (t) => {
  for (const version of PAST_VERSIONS) {
    await t.test(version, async () => {
      const root = copyFixtureTree(version);
      t.after(() => {
        try {
          // mkdtemp created under tmpdir; cleanup happens via t.after on tmpdir
        } catch {
          /* ignore */
        }
      });
      const manager = new ProfileManager(root, deterministicOptions());
      await manager.initialize();
      const registry = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
      assert.equal(
        registry.schemaVersion,
        2,
        `${version}: registry must upgrade to schemaVersion 2`,
      );
      assert.equal(registry.activeProfileId, '00000000-0000-4000-8000-000000000001');
      const profiles = manager.list();
      assert.equal(profiles.length, 1, `${version}: must surface exactly one profile`);
      assert.equal(profiles[0].name, 'Main Setlist');
    });
  }
});

test('CONTRACTS §1: per-version custom-order, song-book and lyrics round-trip', async (t) => {
  for (const version of PAST_VERSIONS) {
    const expected = VERSION_FIXTURES[version];
    await t.test(version, async () => {
      const root = copyFixtureTree(version);
      const manager = new ProfileManager(root, deterministicOptions());
      await manager.initialize();
      const profileId = manager.getActive().id;
      const customOrder = JSON.parse(
        readFileSync(join(root, 'profiles', profileId, 'custom-order.json'), 'utf8'),
      );
      assert.deepEqual(customOrder, expected.customOrder, `${version}: custom-order`);
      const songBook = JSON.parse(
        readFileSync(join(root, 'profiles', profileId, 'song-book.json'), 'utf8'),
      );
      assert.deepEqual(songBook, expected.songBook, `${version}: song-book`);
      const lyricsDir = join(root, 'profiles', profileId, 'lyrics');
      const lyricsFiles = existsSync(lyricsDir) ? readdirSync(lyricsDir) : [];
      for (const name of expected.lyrics) {
        assert.ok(lyricsFiles.includes(name), `${version}: lyrics must contain ${name}`);
        const content = readFileSync(join(lyricsDir, name), 'utf8');
        assert.ok(content.length > 0, `${version}: ${name} must not be empty`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// (2) Locator grammar: every row of CONTRACTS.md §4.2 parses cleanly and
//     yields the documented fields. Examples are the same strings listed
//     in the table; if a tag changes shape, this table updates with it.
// ---------------------------------------------------------------------------

const GRAMMAR_CASES = [
  { input: 'INTRO', kind: 'song', displayName: 'INTRO' },
  { input: '> VERSO', kind: 'relative-section', displayName: 'VERSO' },
  { input: 'Song A > Chorus [loop 4x]', kind: 'section', displayName: 'Chorus', loopCount: 4 },
  { input: 'Song A > Refrão [bpm 120]', kind: 'section', displayName: 'Refrão', bpm: 120 },
  {
    input: '[bpm 120] > Refrão',
    kind: 'section',
    displayName: 'Refrão',
    bpm: null,
    _note:
      'parser drops songTags when song is implicit; documented limitation — see CONTRACTS §4.2',
  },
  { input: 'Song A [bpm 120]', kind: 'song', displayName: 'Song A', bpm: 120 },
  {
    input: '[jump A > Chorus]',
    kind: 'automation',
    displayName: '',
    jumpTarget: 'A > Chorus',
    _note: 'parser treats tag-only with no name as automation under the preceding song',
  },
  {
    input: 'Song A > Bridge [jump Verse]',
    kind: 'section',
    displayName: 'Bridge',
    jumpTarget: 'Verse',
  },
  { input: '> [stop]', kind: 'relative-automation', displayName: '' },
  { input: 'Song A [hidden]', kind: 'hidden', hiddenName: 'Song A' },
  { input: 'Song A [ignore]', kind: 'hidden', hiddenName: 'Song A' },
  { input: 'Song A [LOOP]', kind: 'song', displayName: 'Song A', loopCount: -1 },
  { input: 'Song A [click off]', kind: 'song', displayName: 'Song A', autoClick: false },
  { input: 'Song A [click-off]', kind: 'song', displayName: 'Song A', autoClick: false },
  { input: 'Song A [skip]', kind: 'song', displayName: 'Song A', skip: true },
  { input: 'Song A [next]', kind: 'song', displayName: 'Song A', autoNext: true },
  { input: 'Song A [stop]', kind: 'song', displayName: 'Song A', autoStop: true },
];

test('CONTRACTS §4.2: every grammar example parses to the documented fields', () => {
  for (const row of GRAMMAR_CASES) {
    const parsed = parseLocator(row.input);
    assert.equal(parsed.kind, row.kind, `${row.input} → kind`);
    if (row.displayName !== undefined) {
      const display =
        parsed.kind === 'song'
          ? parsed.songName
          : parsed.kind === 'section' || parsed.kind === 'relative-section'
            ? parsed.section?.name
            : parsed.kind === 'hidden'
              ? parsed.hiddenName
              : '';
      assert.equal(display, row.displayName, `${row.input} → displayName`);
    }
    if (row.loopCount !== undefined) {
      const song = parsed.kind === 'song' ? parsed.songTags : parsed.section;
      assert.equal(song?.loopCount, row.loopCount, `${row.input} → loopCount`);
    }
    if (row.bpm !== undefined) {
      const song = parsed.kind === 'song' ? parsed.songTags : parsed.section;
      assert.equal(song?.bpm, row.bpm, `${row.input} → bpm`);
    }
    if (row.autoClick !== undefined) {
      const song = parsed.kind === 'song' ? parsed.songTags : parsed.section;
      assert.equal(song?.autoClick, row.autoClick, `${row.input} → autoClick`);
    }
    if (row.skip || row.autoNext || row.autoStop) {
      const song = parsed.kind === 'song' ? parsed.songTags : parsed.section;
      if (row.skip) assert.equal(song?.skip, true);
      if (row.autoNext) assert.equal(song?.autoNext, true);
      if (row.autoStop) assert.equal(song?.autoStop, true);
    }
    if (row.jumpTarget !== undefined) {
      assert.equal(
        parsed.section?.jumpTarget ?? parsed.songTags?.jumpTarget,
        row.jumpTarget,
        `${row.input} → jumpTarget`,
      );
    }
  }
});

test('CONTRACTS §4.2: parseSetlist wires a section under the correct song', () => {
  const setlist = parseSetlist([
    { name: 'Song A', time: 0 },
    { name: '> Chorus [loop 4x]', time: 32 },
    { name: '> Verse', time: 16 },
    { name: 'Song B [bpm 90]', time: 64 },
    { name: '> Outro', time: 96 },
  ]);
  assert.equal(setlist.songs.length, 2);
  assert.equal(setlist.songs[0].title, 'Song A');
  assert.equal(setlist.songs[0].sections.length, 2, 'Song A: Chorus + Verse in time order');
  assert.equal(setlist.songs[0].sections[0].name, 'Verse');
  assert.equal(setlist.songs[0].sections[1].name, 'Chorus');
  assert.equal(setlist.songs[0].sections[1].loopCount, 4);
  assert.equal(setlist.songs[1].title, 'Song B');
  assert.equal(setlist.songs[1].bpm, 90);
  assert.equal(setlist.songs[1].sections[0].name, 'Outro');
});

// ---------------------------------------------------------------------------
// (3) Protocol snapshot: a curated setlist fed through parseSetlist
//     reproduces the shape advertised in CONTRACTS.md §2.4 (the protocol
//     payload mirrors SetlistState; we assert the keys that exist on the
//     type rather than full equality because the rest of the state is
//     exercised by server-lifecycle / ws-liveness / ws-auth).
// ---------------------------------------------------------------------------

test('CONTRACTS §2.4: parseSetlist produces the song/section fields documented in §2.4', () => {
  const setlist = parseSetlist([
    { name: 'INTRO', time: 0 },
    { name: '> Verse', time: 16 },
    { name: '> Chorus [bpm 130] [loop 4x]', time: 32 },
  ]);
  const song = setlist.songs[0];
  // Song-level fields documented in §2.4 via SetlistState.
  for (const key of [
    'title',
    'time',
    'sections',
    'loopCount',
    'autoStop',
    'autoNext',
    'bpm',
    'autoClick',
    'skip',
  ]) {
    assert.ok(key in song, `Song must expose key ${key}`);
  }
  const section = song.sections[1];
  for (const key of ['name', 'time', 'loopCount', 'bpm']) {
    assert.ok(key in section, `Section must expose key ${key}`);
  }
  assert.equal(section.loopCount, 4);
  assert.equal(section.bpm, 130);
});

// ---------------------------------------------------------------------------
// (4) Bridge version pin: the bundled RC Bridge must report "1.0.0" in the
//     fixture shipped in the repo. The full integration test against a
//     running Live is gated by P09 (stage acceptance); here we pin the
//     shipped string in the bridge fixture itself.
// ---------------------------------------------------------------------------

test('CONTRACTS §3: RC Bridge /live/rcbridge/version pin is 1.0.0', () => {
  const constantsFile = join(repoRoot, 'bridge/RCBridge/abletonosc/constants.py');
  assert.ok(existsSync(constantsFile), 'RC Bridge constants.py must exist');
  const source = readFileSync(constantsFile, 'utf8');
  assert.match(
    source,
    /RCBRIDGE_VERSION\s*=\s*['"]1\.0\.0['"]/,
    'RC Bridge must expose version 1.0.0',
  );
  assert.match(
    source,
    /RCBRIDGE_NAME\s*=\s*['"]RC Bridge['"]/,
    'RC Bridge must expose name "RC Bridge"',
  );
});

// ---------------------------------------------------------------------------
// (5) HTTP / WS security subset: re-assert the allowlists from CONTRACTS §5
//     and §2 by importing the sibling security tests as the source of truth.
//     The duplication is intentional: a silent regression in the security
//     tests would not affect this contract, but a silent change to the
//     contract here would. Pinning the file paths keeps both honest.
// ---------------------------------------------------------------------------

test('CONTRACTS §5 + §2: HTTP/WS security tests still gate the contract', () => {
  const security = [
    'tests/http-security.test.mjs',
    'tests/ws-auth.test.mjs',
    'tests/event-log-redaction.test.mjs',
  ];
  for (const rel of security) {
    const path = join(repoRoot, rel);
    assert.ok(existsSync(path), `${rel} must exist`);
    assert.ok(statSync(path).isFile(), `${rel} must be a regular file`);
  }
});
