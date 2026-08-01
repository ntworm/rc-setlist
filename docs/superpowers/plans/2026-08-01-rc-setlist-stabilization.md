# RC Setlist stabilization implementation plan

> Execute inline in this task. Use a failing regression test before each functional change and keep commits scoped to one subsystem.

**Goal:** Restore green CI and harden RC Setlist against data loss, malformed network input, delayed safety commands, stale connections, hot-path recalculation, and production packaging failures without changing public UX.

**Architecture:** Keep `src/server-lifecycle.ts` as composition root while extracting validation and persistence primitives into small modules. Make the WebSocket boundary decode `unknown` before dispatch, make command completion metadata canonical, cache immutable setlist derivations, and extract browser-only state helpers from `setlist.js` into a tested runtime module.

**Stack:** Node 24, TypeScript 5.9, npm 11, Node test runner, Playwright, `ws`, `osc-min`, `selfsigned`, esbuild.

---

## Task 1: Restore the local-first landing contract

**Files:**

- Modify: `docs/index.html`
- Modify: `tests/documentation-contract.test.mjs`
- Optionally add: `docs/fonts/InterVariable.woff2`
- Optionally add: `docs/fonts/OFL.txt`
- Modify when adding assets: `public-files.txt`, `THIRD_PARTY_NOTICES.md`

**Red:** Extend the documentation contract to assert that every landing stylesheet/font URL is repository-relative and that the selected font asset, when referenced, is part of the public surface.

Run: `node --test --test-force-exit tests/documentation-contract.test.mjs`

Expected: failure on the Google Fonts links from `1b6efb4`.

**Green:** Remove Google Fonts `preconnect`/stylesheet requests. Prefer a self-hosted official Inter WOFF2 plus OFL notice if deterministic Inter layout is required by the media renderer; otherwise retain the corrected spacing with the existing system stack. Do not introduce another CDN.

Run the narrow test, `npm run media:check`, `npm run docs:check`, and `npm run notices:check`.

**Commit:** `fix: restore local-first landing assets`

## Task 2: Decode untrusted WebSocket messages

**Files:**

- Add: `src/server/client-message.ts`
- Add: `tests/client-message.test.mjs`
- Modify: `src/server-lifecycle.ts`
- Modify: `src/types.ts`
- Modify: `package.json` to include the new test in `test:src`

**Red:** Cover non-object JSON, missing/unknown types, invalid command IDs, invalid booleans/enums/numbers, non-array or non-string reorder entries, empty profile/song identifiers, oversized lyric strings, and valid legacy commands without IDs.

The decoder result should be shaped as:

```ts
type DecodeResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: 'invalid_message'; message: string; commandId?: string };
```

Run: `node --import tsx --test --test-force-exit tests/client-message.test.mjs`

Expected: module-not-found failure, then assertion failures as the decoder is introduced incrementally.

**Green:** Implement a discriminated `ClientMessage` union and field validators using `unknown`. Decode immediately after `JSON.parse`; send a structured error, including a safe command ID when present, and return before auth, mutation, persistence, or command registration on failure.

Run the new test plus `tests/ws-auth.test.mjs`, `tests/ws-sync-race.test.mjs`, and `tests/profile-ws.test.mjs`.

**Commit:** `fix: validate websocket commands at the boundary`

## Task 3: Make command completion and safety priority deterministic

**Files:**

- Modify: `src/core/command-bus.ts`
- Modify: `src/types.ts`
- Modify: `src/server-lifecycle.ts`
- Add: `tests/command-bus.test.mjs`
- Modify: `tests/jump-authority.test.mjs`
- Modify: `package.json`

**Red:** Prove that:

- `metronome` confirms against `state.metronome` rather than expiring under unused names.
- Local commands (`refresh`, `reorder`, `save_lyrics`, exports/previews, preflight, mode/safety/profile operations) confirm only after their handler resolves.
- A rejected local handler settles as failed.
- `stop` and `set_panic(active=true)` execute while a long non-safety handler remains pending.
- No `retry_required` event is emitted without an implemented retry executor.
- Constructor state does not accept/store an OSC client it never uses.

Run: `node --import tsx --test --test-force-exit tests/command-bus.test.mjs tests/jump-authority.test.mjs`

**Green:** Replace switch/set duplication with a single immutable command metadata table. Remove dead acknowledged/retry/idempotence state. Execute safety-lane commands immediately while preserving ordered execution for other commands. Keep observable confirmation for play/stop/metronome/quantization/jump; confirm local commands after successful execution.

Include failure `reason` in the `command_status` broadcast without exposing stack traces or secrets.

**Commit:** `fix: harden command completion and safety priority`

## Task 4: Make user-data persistence asynchronous and atomic

**Files:**

- Add: `src/util/atomic-write.ts`
- Add: `tests/atomic-write.test.mjs`
- Modify: `src/commands/handlers.ts`
- Modify: `tests/profile-ws.test.mjs`
- Modify: `package.json`

**Red:** Cover successful replace, cleanup after a failed rename, preservation of an existing target after failure, and rejection of invalid reorder/lyrics data before state changes. Add an integration assertion that a failed lyrics write reports a failed command status.

Run: `node --import tsx --test --test-force-exit tests/atomic-write.test.mjs tests/profile-ws.test.mjs`

**Green:** Implement same-directory temporary writes followed by rename. Use `node:fs/promises` for reorder, lyrics, CSV, click preview, and test-session lyric files. For reorder, persist before publishing the new manager order, or explicitly roll the manager back on persistence failure. Ensure test-session setup throws when no OSC client exists and propagates incomplete/fatal failure rather than confirming silently.

**Commit:** `fix: persist command data atomically`

## Task 5: Preserve lyrics edits until backend confirmation

**Files:**

- Add: `static/setlist/controller-runtime.js`
- Add: `static/setlist/controller-runtime.test.mjs`
- Modify: `static/setlist/index.html`
- Modify: `static/setlist/setlist.js`
- Modify: `static/shared/i18n.js`
- Modify: `static/ui.test.mjs`
- Modify: `package.json`

**Red:** Cover a small pending-command tracker that retains lyrics drafts on disconnect, unauthorized/error, timeout, failed/expired/cancelled status, and clears only on matching `confirmed`. Cover safe JSON storage fallback and URL token removal while preserving unrelated query parameters.

Run: `node --test --test-force-exit static/setlist/controller-runtime.test.mjs static/ui.test.mjs`

**Green:** Load the runtime before `setlist.js`. Replace direct MIDI `JSON.parse` with schema-aware fallback. After storing a controller token, remove only `token` from the visible URL with `history.replaceState`.

Generate a command ID for both lyrics editor and synchronization saves. Disable only the relevant save action while pending; do not clear dirty state, log success, reset synchronization, or close the modal until the matching status is confirmed. On failure/disconnect keep the buffer and show localized feedback. Reject saves while read-only or unsynchronized before sending.

**Commit:** `fix: retain lyrics until persistence is confirmed`

## Task 6: Remove repeated setlist sorting and metric calculation

**Files:**

- Modify: `src/core/setlist-metrics.ts`
- Modify: `src/core/setlist-manager.ts`
- Modify: `tests/setlist-metrics.test.mjs`
- Modify: `tests/core.test.mjs`

**Red:** Add tests that count/observe metric recomputation and prove transport-only updates reuse derived songs. Cover invalidation after cues, custom order, tempo, and arrangement-end changes. Cover chronological active-song lookup under custom display order and duplicate start-time behavior.

Run: `node --import tsx --test --test-force-exit tests/setlist-metrics.test.mjs tests/core.test.mjs`

**Green:** Calculate durations directly from adjacent entries in one sorted pass. Maintain a chronological song/index structure rebuilt only when songs/order change. Cache the duration-enriched `songs` array and total duration behind a derivation revision; invalidate on cues, order, tempo changes that affect fallback BPM, or arrangement end.

Avoid `includes`/`indexOf` inside sorting by precomputing title ranks and song-to-display indices. Use binary search or reverse traversal of the cached chronological array for active lookup.

Run a repeatable benchmark script before/after and record results in the final handoff; do not add a wall-clock test threshold.

**Commit:** `perf: cache chronological setlist derivations`

## Task 7: Avoid full active-state DOM traversal

**Files:**

- Modify: `static/setlist/controller-runtime.js`
- Modify: `static/setlist/controller-runtime.test.mjs`
- Modify: `static/setlist/setlist.js`
- Modify: `static/ui.test.mjs`

**Red:** Test an active-element transition helper with initial selection, song change, section change, missing nodes, and list rebuild. Add a structural contract preventing `querySelectorAll('.song-item')` in transport-only active updates.

Run: `node --test --test-force-exit static/setlist/controller-runtime.test.mjs static/ui.test.mjs`

**Green:** Cache the active song/section elements and toggle only old/new nodes. Reset the cache after `innerHTML` rebuild. Cache stable HUD elements currently queried on every animation frame and update text/classes only when the rendered value changes. Preserve the existing beat-flash behavior.

**Commit:** `perf: narrow setlist dom updates`

## Task 8: Detect stale WebSocket clients and deduplicate logs

**Files:**

- Modify: `src/types.ts`
- Modify: `src/server/ws.ts`
- Modify: `tests/ws-auth.test.mjs`

**Red:** Use short injected heartbeat intervals in tests to prove pong keeps a client, a non-responsive client is terminated, and `stop()` clears heartbeat work. Prove identical log content inside the dedupe window is broadcast once even though timestamps differ, while later repeats are allowed.

Run: `node --import tsx --test --test-force-exit tests/ws-auth.test.mjs`

**Green:** Add `isAlive` to the augmented socket, mark true on `pong`, ping on a configurable interval, and terminate on the next missed interval. Track log dedupe by stable key and last timestamp, not serialized payload. Report send failures at a bounded diagnostic level instead of empty catches.

**Commit:** `fix: monitor websocket liveness`

## Task 9: Harden HTTP, production build, certificates, and OSC diagnostics

**Files:**

- Modify: `src/server/http.ts`
- Modify: `src/server-lifecycle.ts`
- Modify: `src/server/cert.ts`
- Modify: `src/integration/osc-client.ts`
- Modify: `build.ts`
- Modify: `tests/http-security.test.mjs`
- Modify: `tests/server-lifecycle.test.mjs`
- Add or modify: `tests/cert.test.mjs`
- Modify: `tests/osc.test.mjs`, `tests/osc-diagnostics.test.mjs`
- Modify: `tests/binpack-build.test.mjs`
- Modify: `package.json`

**Red:** Cover `ENABLE_DEBUG_SNAPSHOT=0` in production, controlled HTTP 500 on rejected handlers/resolvers, HEAD without file-body reads where observable, `server.close()` initiation before `closeAllConnections()`, expired/malformed/missing-SAN certificates, shared OSC socket listen-port reporting, and production static-copy failure propagation/NODE_ENV definition.

Run the affected narrow suites.

**Green:** Add a request wrapper around `handleHttp`; parse boolean debug switches explicitly. For HEAD, stat and return headers without reading the file. Start graceful HTTP close, then force remaining connections. Replace custom DER scanning with Node 24 `X509Certificate.checkIP()`/`checkHost()` and validity checks.

Type the shared OSC globals and set `listenPort` from the reused socket address. Keep existing `/live/song/get/<property>` handling: upstream AbletonOSC already documents listener replies on those addresses, so do not add unsupported alternate behavior.

Make static copy errors fatal outside watch-mode diagnostics and define `process.env.NODE_ENV` through esbuild according to `--production`.

**Commit:** `fix: harden server lifecycle and production build`

## Task 10: Full verification, review, and context refresh

**Files:**

- Modify if findings require it: `.agent-context/*.md`
- Do not change release version or changelog unless requested.

Run fresh, in order:

```powershell
npm run ci:public
npm run docs:check
npm run notices:check
npm audit --audit-level=high
node --import tsx --test --experimental-test-coverage --test-force-exit tests/*.test.mjs
git diff --check origin/main...HEAD
git status --short --branch
```

Run `npm run build:prod` only if `npm run verify:ableton` confirms the bundled Ableton dependency surface. Re-run the setlist benchmark using the same Node version and dataset as the baseline.

Review every changed network/persistence path for token, local-path, or lyric leakage. Confirm no unrelated user changes exist. Refresh/finalize persistent context with `repo_context.py` after the final code state.

Because this task does not authorize parallel sub-agents, perform the code review inline: inspect the full diff, search for empty catches/new `any`/sync filesystem calls in server callbacks, and rerun the coupled suites after review fixes.

**Commit:** `test: verify stabilization regressions` only if verification or review adds files; otherwise leave the final functional commit as the tip.
