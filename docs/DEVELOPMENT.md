# Develop RC Setlist

## Requirements

- Node.js 24.16.0 or newer in the Node 24 LTS line.
- npm 11.8.0 (pinned in `package.json`).
- Ableton Live 12.4.5+ Suite (Beta) for complete integration testing.
- Authorized Ableton Extensions SDK/CLI archives for `.ablx` builds.
- Python 3.9 or newer on the PATH for `npm run test:bridge` (Live embeds its
  own interpreter; the tests only need a stock one).

## Public gate

```bash
npm ci
npm run ci:public
npm run gates:quality
npm audit --audit-level=high
```

This gate does not need or download Ableton developer archives. The
quality gates (`gates:quality`) group `lint`, `format:check`,
`deadcode` (knip), `deps:check` (dependency-cruiser) and `lint:py`
(ruff). P04 promotes them from `continue-on-error` to blocking the
public gate; until then they are reported as artifacts.

## Authorized release gate

Obtain SDK/CLI archives from Ableton's official developer channel and store them
outside the repository. Follow [vendor/README.md](../vendor/README.md), then:

```bash
npm run setup:ableton
npm run ci:release
npm run package:release
```

The path variables must be absolute. The setup command installs locally with
`--no-save` and does not add the archives to `package.json` or the lockfile.

## Test commands

```bash
npm run test:src
npm run test:static
npm run test:bridge
npm run test:ui
npm run test:release-surface
npm run build:public
npm run notices:check
```

## Quality gates

```bash
npm run lint           # ESLint (typescript-eslint + jsdoc + Prettier-friendly)
npm run format:check   # Prettier, reports files not yet formatted
npm run deadcode       # knip — exports/types/files unused (21 from AUDIT)
npm run deps:check     # dependency-cruiser — cycles + layer rules (11 from AUDIT)
npm run lint:py        # ruff — bridge Python files
npm run version:check  # sync-version.mjs — package.json == manifest.json
npm run gates:quality  # all five above in one
```

P01 ships these gates and expects them to **fail by the audit count**
(deadcode=21, deps:check=11, format:check=full report). P04 zeroes
them and promotes the `no-unsafe-*` / `no-explicit-any` / `no-empty` /
`no-unused-vars` ESLint rules to `error`.

`prettier --write .` runs **once and in its own commit** after P04
review (recorded in `.git-blame-ignore-revs`). Until then, the
`format:check` script never blocks the gate — it lists the still
non-formatted files inside `internal/CODE-HYGIENE-1.0.md` so reviewers
can focus on semantics.

## Architecture boundaries

- `src/extension.ts`, `src/context.ts` and `src/ui/panel.ts` are SDK edges.
- `src/core/` owns setlist state, parser, profiles and persistence rules.
- `src/integration/osc-client.ts` owns OSC encoding/socket behavior.
- `src/server/` and `src/server-lifecycle.ts` own the local network service.
- `static/` is shipped browser code with no runtime CDN dependency.
- `bridge/RCBridge/` is RC Bridge, the Remote Script fork of AbletonOSC that
  ships inside the `.ablx` and the installation kit; `bridge/tests/` is its
  unittest suite.

The public TypeScript configuration excludes SDK-facing files but checks the
portable core. The release gate checks the complete application.

## Generated files

Do not commit `node_modules/`, `dist/`, `.ablx`, release candidates, certificates,
tokens, `.env`, Ableton SDK/CLI archives or local test output.
