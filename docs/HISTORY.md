# RC Setlist — release history

This page lists every public release of RC Setlist with the headline
change set. The 0.x development line is summarised for context; the
1.x line is the published, supported line (security fixes only — see
[SECURITY.md](../SECURITY.md) for the support window).

- [1.0.0 — first public release](#100--2026-09-15)
- [0.x — private development](#0x--private-development-2025-09--2026-08)

## 1.0.0 — 2026-09-15

First public release. PolyForm-Noncommercial-1.0.0 license; published
to GitHub with a signed kit and `.ablx` extension. Headline changes
versus the last private 0.7.x build:

- **Contracts.** `docs/CONTRACTS.md` and `docs/pt-BR/CONTRATOS.md`
  document the on-disk format, the WebSocket protocol (v3), the
  locator grammar, the OSC integration, the HTTP endpoints, and the
  SemVer policy. Every claim has a regression test in
  `tests/release-contracts.test.mjs`. The renderer no longer masks
  Prettier failures (the `|| exit 0` is gone from `format:check`); the
  rendered HTML is now byte-idêntico across runs and prettier-clean.
- **Reliability Core.** Command bus settles with a stable status
  (`created` → `sent` → `acknowledged` → `confirmed` / `failed` /
  `expired` / `cancelled`), WS frames carry a monotonic
  `stateVersion`, and `sync_confirm` re-broadcasts the cached state on
  reconnection. `OperatorError` is the only catch-all a handler
  may throw; anything else settles as `execution_failed` and the
  original error goes to `events.log` only.
- **WebSocket hardening.** Origin/Host check on upgrade, per-IP
  auth-attempt rate limit (5/min/IP, sliding 60-second window),
  malformed-JSON structured error, sanitized `log` frames, max payload
  size, heartbeat ping/pong, console-token leakage prevention,
  backpressure thresholds.
- **HTTP hardening.** `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, CSP on stage pages, no path
  traversal on `/exports/`, `/audio/`, `/static/` (encoded slashes
  and Unicode names rejected), `/debug/snapshot` off by default and
  token-gated.
- **Profiles.** Per-profile UUID identity, NFKC + case-folded name
  uniqueness, transaction-safe registry commits with rollback on
  failure, index recovery from `index.json.bak`, project-scoped
  registry that survives unsaved Sessions.
- **Profiles migration.** `scripts/migrate-data.mjs` (with
  PowerShell/sh wrappers in the kit) copies the 0.x storage tree to
  the 1.0 location; never overwrites a destination file; idempotent.
- **Performance baseline.** `scripts/bench-state-broadcast.mjs`
  measures the broadcast path against the mock OSC and a 40-song /
  200-section setlist; results land in
  `internal/PERFORMANCE-BASELINE-1.0.md`. Producer `getState()` +
  serialise p95 stays well under 5 ms; the loop rate is bounded by
  Node's `setInterval` drift, not by producer capacity.
- **Landing, getting started, theme.** New landing page with axe
  accessibility, `docs/GETTING-STARTED.md` and pt-BR counterpart, full
  i18n table, theme contract for custom skins, Playwright suite under
  `tests/ui/` covers landing, setlist, performance, mobile-target-hold,
  and pre-roll flows.

Full notes: [`RELEASE-NOTES-1.0.0.md`](RELEASE-NOTES-1.0.0.md).

## 0.x — private development (2025-09 → 2026-08)

Private development line shipped only to early-access testers. The
0.6.0 / 0.6.1 / 0.7.0 release notes were folded into the **Since 0.5.1**
section of [`RELEASE-NOTES-1.0.0.md`](RELEASE-NOTES-1.0.0.md) and are
no longer in the repository as separate files; their binaries were
never distributed publicly. Schema and storage paths changed several
times; treat anything pre-1.0 as draft.

| Release | Headline                                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 0.7.0   | Profile migration foundation; song-book colours and notes; LRC + txt lyrics; storage migration path; PROJECT-PROFILE-SCOPE tagged stable. |
| 0.6.1   | Reliability Core scaffold (settled status enum, command ack/confirmed); WS reconnect hardening; per-IP backpressure thresholds.           |
| 0.6.0   | Atlas-style reliability pass on the transport (deduped backpressure, panic mode, bounded command queue).                                  |
| 0.5.1   | Multi-profile + per-profile storage; `profile.json` v1; `index.json` schema; first project-identity scope.                                |

The 0.4.x and 0.3.x notes remain for completeness but those binaries
were never distributed; the storage shape is not loadable by 1.0
without the migration in §1 above.

Pre-1.0 versions are **unsupported**. See [SECURITY.md](../SECURITY.md)
for the support window.
