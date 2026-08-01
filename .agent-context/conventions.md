# Conventions

- ESM TypeScript with strict checking; target the Node 24 runtime declared in `package.json`.
- Source tests use Node's test runner through `tsx`; browser contracts use `.mjs`; interaction tests use Playwright.
- Prefer small domain modules under `src/core`, `src/commands`, `src/server`, and `src/integration` over adding more responsibilities to `server-lifecycle.ts` or `static/setlist/setlist.js`.
- Treat public behavior, WebSocket messages, profile files, and release manifests as compatibility surfaces.
- Add a regression test for every bug fix. Avoid time-sensitive performance assertions when an algorithmic or call-count assertion can prove the property.
- Keep generated documentation media deterministic and validate it through `npm run media:check`.
