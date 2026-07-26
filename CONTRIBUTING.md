# Contributing to Ableton RC Setlist

Issues and focused pull requests are welcome. By submitting code or
documentation, you agree that your contribution may be distributed under the
project's [PolyForm Noncommercial 1.0.0](LICENSE) terms.

## Before opening work

1. Search existing issues.
2. Open an issue for behavioral changes or large refactors.
3. Never include commercial lyrics, private setlists, Ableton SDK/CLI archives,
   certificates, controller tokens or local paths.

## Public setup

Requirements: Ableton Live 12.4.5+ Suite (Beta) for manual integration testing,
and Node.js 24.16.0 or newer in the Node 24 LTS line.

```bash
npm ci
npm run ci:public
```

The public gate covers source/static tests, Playwright, a public typecheck,
licensing, content sanitization and documentation. It does not build an `.ablx`.

## Full Ableton build

The SDK and CLI are not in this repository. Authorized developers must follow
[vendor/README.md](vendor/README.md), then run:

```bash
npm run setup:ableton
npm run ci:release
```

## Structure

- `src/core/`: locator parsing, state, profiles, persistence and exports.
- `src/integration/`: OSC and external protocol boundaries.
- `src/server/`: local HTTP(S), certificates and WebSocket transport.
- `static/`: plain browser clients.
- `tests/`: source, security, UI and release contracts.
- `docs/`: public documentation and GitHub Pages landing.

## Pull-request checklist

- Add a failing test before changing behavior.
- Run `npm run ci:public`.
- Keep UI text and documentation aligned with behavior.
- Use fictional test data.
- Keep commits focused and do not commit `dist/`, `.ablx`, release candidates
  or vendor archives.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for architecture and commands.
