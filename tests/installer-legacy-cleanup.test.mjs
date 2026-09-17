// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
/**
 * @module installer-legacy-cleanup.test
 * @description Regression tests for scripts/installer-cleanup-legacy.mjs.
 * Verifies that the cleanup routine removes legacy Ableton RC Setlist .ablx files
 * from fixture directories and never touches the new RC-Setlist-*.ablx package.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { cleanupLegacyAblx } from '../scripts/installer-cleanup-legacy.mjs';

/** Creates a temp directory and writes named stub .ablx files into it. */
function makeFixtureDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'rc-setlist-fixture-'));
  for (const name of files) {
    writeFileSync(join(dir, name), `stub:${name}`);
  }
  return dir;
}

let fixtureDir;

describe('installer-cleanup-legacy', () => {
  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'rc-setlist-cleanup-'));
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  describe('removes legacy Ableton RC Setlist package', () => {
    it('removes Ableton-RC-Setlist-0.5.1.ablx and exits cleanly', () => {
      const root = makeFixtureDir(['Ableton-RC-Setlist-0.5.1.ablx']);
      const result = cleanupLegacyAblx({ roots: [root] });

      assert.equal(result.removed.length, 1, 'one file removed');
      assert.ok(result.removed[0].endsWith('Ableton-RC-Setlist-0.5.1.ablx'));
      assert.equal(readdirSync(root).length, 0, 'directory is empty after cleanup');
    });

    it('removes legacy files with spaces and underscores in name', () => {
      const root = makeFixtureDir([
        'Ableton RC Setlist 0.6.0.ablx',
        'Ableton_RC_Setlist_0.7.0.ablx',
      ]);
      const result = cleanupLegacyAblx({ roots: [root] });

      assert.equal(result.removed.length, 2, 'both legacy files removed');
      assert.equal(readdirSync(root).length, 0);
    });
  });

  describe('never removes new RC-Setlist-*.ablx', () => {
    it('leaves RC-Setlist-1.0.0.ablx untouched when it is the only file', () => {
      const root = makeFixtureDir(['RC-Setlist-1.0.0.ablx']);
      const result = cleanupLegacyAblx({ roots: [root] });

      assert.equal(result.removed.length, 0, 'nothing removed');
      assert.equal(result.kept.length, 1, 'new package kept');
      assert.equal(readdirSync(root).length, 1, 'file still present');
    });

    it('removes legacy file while keeping new package in same directory', () => {
      const root = makeFixtureDir(['Ableton-RC-Setlist-0.5.1.ablx', 'RC-Setlist-1.0.0.ablx']);
      const result = cleanupLegacyAblx({ roots: [root] });

      assert.equal(result.removed.length, 1, 'only legacy file removed');
      assert.equal(result.kept.length, 1, 'new package kept');
      const remaining = readdirSync(root);
      assert.deepEqual(remaining, ['RC-Setlist-1.0.0.ablx']);
    });
  });

  describe('idempotence', () => {
    it('running twice on the same directory leaves state unchanged and exits 0 both times', () => {
      const root = makeFixtureDir(['Ableton-RC-Setlist-0.5.1.ablx', 'RC-Setlist-1.0.0.ablx']);

      const first = cleanupLegacyAblx({ roots: [root] });
      assert.equal(first.removed.length, 1);

      const second = cleanupLegacyAblx({ roots: [root] });
      assert.equal(second.removed.length, 0, 'nothing left to remove on second run');
      assert.equal(second.kept.length, 1, 'new package still kept on second run');
    });
  });

  describe('dry-run mode', () => {
    it('does not remove files in dry-run mode', () => {
      const root = makeFixtureDir(['Ableton-RC-Setlist-0.5.1.ablx']);
      const result = cleanupLegacyAblx({ roots: [root], dryRun: true });

      assert.equal(result.removed.length, 1, 'dry-run reports would-remove');
      assert.equal(readdirSync(root).length, 1, 'file still present after dry-run');
    });
  });

  describe('safety guards', () => {
    it('skips a missing directory without throwing', () => {
      const missingPath = join(fixtureDir, 'does-not-exist');
      const result = cleanupLegacyAblx({ roots: [missingPath] });

      assert.equal(result.removed.length, 0);
      assert.ok(result.skipped.length > 0, 'missing dir is skipped');
    });

    it('does not throw on an empty directory', () => {
      const emptyDir = makeFixtureDir([]);
      const result = cleanupLegacyAblx({ roots: [emptyDir] });

      assert.equal(result.removed.length, 0);
      assert.equal(result.kept.length, 0);
    });

    it('ignores non-.ablx files in the scanned directory', () => {
      const root = makeFixtureDir(['some-other-extension.asd', 'README.txt']);
      const result = cleanupLegacyAblx({ roots: [root] });

      assert.equal(result.removed.length, 0);
      assert.equal(readdirSync(root).length, 2, 'non-ablx files untouched');
    });
  });
});
