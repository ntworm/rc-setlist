# Develop Ableton RC Setlist

## Requirements

- Node.js 24.16.0 or newer in the Node 24 LTS line.
- npm 11.8.0 (pinned in `package.json`).
- Ableton Live 12.4.5+ Suite (Beta) for complete integration testing.
- Authorized Ableton Extensions SDK/CLI archives for `.ablx` builds.

## Public gate

```bash
npm ci
npm run ci:public
npm audit --audit-level=high
```

This gate does not need or download Ableton developer archives.

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
npm run test:ui
npm run test:release-surface
npm run build:public
npm run notices:check
```

## Architecture boundaries

- `src/extension.ts`, `src/context.ts` and `src/ui/panel.ts` are SDK edges.
- `src/core/` owns setlist state, parser, profiles and persistence rules.
- `src/integration/osc-client.ts` owns OSC encoding/socket behavior.
- `src/server/` and `src/server-lifecycle.ts` own the local network service.
- `static/` is shipped browser code with no runtime CDN dependency.

The public TypeScript configuration excludes SDK-facing files but checks the
portable core. The release gate checks the complete application.

## Generated files

Do not commit `node_modules/`, `dist/`, `.ablx`, release candidates, certificates,
tokens, `.env`, Ableton SDK/CLI archives or local test output.
