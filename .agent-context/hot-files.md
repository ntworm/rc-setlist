# Hot files

- `src/server-lifecycle.ts`: composition and shutdown ordering; exercise `tests/server-lifecycle.test.mjs`, WebSocket auth, and HTTP security tests after changes.
- `src/core/setlist-manager.ts` and `src/core/setlist-metrics.ts`: stage state and timing calculations; exercise core, metrics, jump, and sync tests.
- `src/commands/command-bus.ts` and `src/commands/handlers.ts`: controller writes and safety actions; preserve command-status compatibility and failure reporting.
- `src/server/ws.ts`: authentication and broadcast boundary; exercise `tests/ws-auth.test.mjs` and `tests/ws-sync-race.test.mjs`.
- `static/setlist/setlist.js`: large controller client combining state, rendering, MIDI, lyrics, and commands; prefer extracting tested helpers instead of extending the monolith.
- `docs/index.html`, `docs/site-i18n.js`, and `scripts/render-media-kit.mjs`: landing copy, fonts, and generated screenshots are coupled to documentation-contract and media checks.
- `build.ts`, `public-files.txt`, `release-template/`, `NOTICE`, and `THIRD_PARTY_NOTICES.md`: release packaging and legal surface; run release-surface and notices checks.
