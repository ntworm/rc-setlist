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
(ruff). They are a blocking step: the workflow runs
`npm run gates:quality` on every push and pull request to `main`, and
a failing gate fails the job.

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
npm run lint           # ESLint (typescript-eslint + jsdoc), --max-warnings 0
npm run format:check   # Prettier, reports files not yet formatted
npm run deadcode       # knip — exports/types/files unused
npm run deps:check     # dependency-cruiser — cycles + layer rules
npm run lint:py        # ruff — bridge Python files
npm run version:check  # sync-version.mjs — package.json == manifest.json
npm run gates:quality  # all five above in one
```

`npm run lint` runs `eslint . --max-warnings 0`: every rule this
repository registers is an `error`, so a warning fails the gate the
same way an error does. The `no-unsafe-*` / `no-explicit-any` /
`no-empty` / `no-unused-vars` families are among them, and the SDK
boundary (`src/ableton-sdk-public.d.ts`) keeps the Ableton Extensions
SDK surface typed instead of `any`.

`format:check` is part of the same blocking gate, so the tree has to
stay formatted; the script itself lists the files that drifted.

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
portable core. The release gate checks the complete application. The
type-aware ESLint rules use `tsconfig.eslint.json`, which extends the
same configuration and resolves `@ableton-extensions/sdk` through
`src/ableton-sdk-public.d.ts`, so the linter and the public typecheck
see the same SDK surface.

## Public site

`docs/` is published by GitHub Pages at <https://ntworm.github.io/rc-setlist/>.
`docs/index.html`, `docs/site-i18n.js`, `docs/llms.txt` and the Markdown guides
are written by hand; the Portuguese pages, the structured data, the sitemap and
`docs/llms-full.txt` are rendered from them:

```bash
npm run site:render   # re-render after editing the landing, its strings, the README or a guide
npm run site:check    # fails when a rendered file is stale
```

Keep `docs/googlea8031c5d5ee880ce.html` (Google Search Console verification)
and `docs/72299ed2a8455f83ed49011642aeb172.txt` (IndexNow key) exactly as they
are. Why the site is built this way:
[architecture/site-discoverability.md](architecture/site-discoverability.md).

## Generated files

Do not commit `node_modules/`, `dist/`, `.ablx`, release candidates, certificates,
tokens, `.env`, Ableton SDK/CLI archives or local test output.
