# RC Setlist repository guidance

RC Setlist is a source-available Node.js 24 / TypeScript extension for controlling and presenting Ableton Live setlists through AbletonOSC, a local HTTP(S)/WebSocket bridge, and browser clients. Keep the public release local-first: controller tokens, generated TLS material, local paths, and user setlist/profile data must never be committed or exposed.

## Stack and commands

- Install with npm 11; the supported runtime is Node `>=24.16.0 <25`.
- Build: `npm run build:public` for the public TypeScript surface; `npm run build:prod` for an Ableton-enabled production bundle.
- Main public verification: `npm run ci:public`.
- Additional repository checks: `npm run docs:check` and `npm run notices:check`.
- There is no configured linter; TypeScript is strict and tests are the executable contract.

## Structure and boundaries

- `src/server-lifecycle.ts` wires the manager, OSC client, command bus, HTTP server, and WebSocket server.
- `src/core/` owns setlist/profile state; `src/commands/` owns write operations; `src/server/` is the network boundary; `src/integration/` contains AbletonOSC and MCP adapters.
- `static/` contains the shipped browser clients. `docs/` is the public landing/documentation surface.
- `tests/` and `static/**/*.test.mjs` cover source, security, UI, documentation, and release contracts.
- Files listed by `public-files.txt`, generated media, notices, and release templates are part of the public release surface.

## Working rules

- Preserve protocol and UI compatibility unless the task explicitly changes them.
- Reproduce bugs with a failing test before fixing them; keep safety commands and user data paths conservative.
- Do not introduce external runtime assets into the local-first application or landing page.
- Run the narrow affected test first, then `npm run ci:public`, `npm run docs:check`, and `npm run notices:check` before completion.
- Read `.agent-context/` on demand for architecture, dependencies, hot files, and risks.
