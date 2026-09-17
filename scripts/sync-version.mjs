// P05 sync-version: `package.json` is the single source of truth for the
// version. `--check` exits non-zero if any surface disagrees; `--write`
// rewrites every surface to match.
//
// Surfaces covered:
//   - `manifest.json`                    (JSON `version` + `minimumApiVersion`)
//   - `release-template/README.txt`      (line 2: `RC SETLIST X.Y.Z — INSTALLATION KIT`)
//   - `release-template/START-HERE.html` (page `<title>`: `RC Setlist X.Y.Z — Start here`)
//
// Surfaces NOT covered (intentional, no version literal in the file):
//   - `docs/site-i18n.js`                (reads version at runtime via `manifest.json`)
//   - `scripts/media-kit-template.html`  (rendered by `render-media-kit.mjs`, not version-pinned)
//   - `docs/index.html`                  (hand-authored landing; rendered-docs pipeline keeps the title via `pageShell` if needed)
//
// Add a target by appending to `TARGETS` with the regex/serialiser for the
// surface; the rest of the script does not need to change.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = new Set(process.argv.slice(2));

const VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?/;

function isVersion(value) {
  return VERSION_PATTERN.test(value);
}

const TARGETS = [
  {
    file: 'manifest.json',
    load(filePath) {
      const raw = readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    },
    save(filePath, value) {
      writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
    },
    current(value) {
      return value.version;
    },
    apply(version, value) {
      value.version = version;
      // The Ableton Extensions API requires minimumApiVersion to track the
      // major line (https://github.com/ntworm/ableton-extensions-sdk). Keep
      // it in sync with the published major version.
      const major = version.split('.')[0];
      value.minimumApiVersion = `${major}.0.0`;
      return value;
    },
  },
  {
    file: 'release-template/README.txt',
    load(filePath) {
      return readFileSync(filePath, 'utf8');
    },
    save(filePath, value) {
      writeFileSync(filePath, value, 'utf8');
    },
    current(value) {
      const match = value.match(/RC SETLIST (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
      return match ? match[1] : null;
    },
    apply(version, value) {
      return value.replace(
        /RC SETLIST \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g,
        `RC SETLIST ${version}`,
      );
    },
  },
  {
    file: 'release-template/START-HERE.html',
    load(filePath) {
      return readFileSync(filePath, 'utf8');
    },
    save(filePath, value) {
      writeFileSync(filePath, value, 'utf8');
    },
    current(value) {
      const match = value.match(/<title>RC Setlist (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
      return match ? match[1] : null;
    },
    apply(version, value) {
      return value.replace(
        /<title>RC Setlist \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g,
        `<title>RC Setlist ${version}`,
      );
    },
  },
];

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

if (!isVersion(version)) {
  console.error(`sync-version: package.json version "${version}" is not a SemVer string`);
  process.exit(1);
}

const mismatches = [];
const seen = new Set();

for (const target of TARGETS) {
  const filePath = path.join(root, target.file);
  seen.add(target.file);
  const loaded = target.load(filePath);
  const current = target.current(loaded);
  if (current === version) {
    process.stdout.write(`ok    ${target.file}: ${current}\n`);
    continue;
  }
  if (args.has('--write')) {
    const next = target.apply(version, loaded);
    target.save(filePath, next);
    process.stdout.write(`write ${target.file}: ${current ?? '(none)'} → ${version}\n`);
  } else {
    mismatches.push({ file: target.file, current: current ?? '(none)', expected: version });
    process.stdout.write(`drift ${target.file}: ${current ?? '(none)'} ≠ ${version}\n`);
  }
}

if (!args.has('--write') && mismatches.length > 0) {
  console.error(
    `\nsync-version: ${mismatches.length} surface(s) drift from package.json@${version}`,
  );
  console.error('run `node scripts/sync-version.mjs --write` to reconcile');
  process.exit(1);
}

if (args.has('--write')) {
  process.stdout.write(`\nsync-version: wrote ${seen.size} surface(s) to ${version}\n`);
} else {
  process.stdout.write(`\nsync-version: ok, ${seen.size} surface(s) on ${version}\n`);
}
