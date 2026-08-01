# RC Setlist stabilization design

**Date:** 2026-08-01
**Status:** Approved direction, recorded before implementation

## Context

The local checkout was clean at `667feef`, one commit behind `origin/main`. It was fast-forwarded to `1b6efb4` so this work includes the latest PT-BR landing corrections. The full local public suite passed on the previous commit, but the latest remote CI fails on Linux, Windows, and macOS because the landing now loads Google Fonts while `tests/documentation-contract.test.mjs` explicitly requires no external runtime assets.

The audit also found correctness and operational risks in lyrics persistence, WebSocket input validation, command acknowledgement/retry behavior, safety-command queueing, browser startup recovery, WebSocket liveness, setlist metric calculation, OSC listener handling, production build flags, HTTP shutdown/error handling, certificate validation, and synchronous persistence inside server callbacks.

## Goals

1. Restore a green cross-platform CI on the latest `main`.
2. Prevent false-success and data-loss paths for synchronized and edited lyrics.
3. Reject malformed controller messages before they can mutate or persist state.
4. Make command status, timeout, local completion, and safety priority deterministic.
5. Remove avoidable repeated sorting/traversal from the 100 ms transport path.
6. Improve connection, build, TLS, and persistence reliability without changing public UX or protocol semantics.
7. Establish regression coverage around every corrected failure mode.

## Non-goals

- Implementing open feature issues such as next-song UI, removal, drag affordances, or performance-view transport.
- Changing the intended parsing behavior for standalone `> section` markers without a separate product decision.
- Rewriting the entire frontend or changing the visual design in this stabilization round.
- Broad dependency upgrades unrelated to a reproduced defect.

## Options considered

### Surgical patches only

This has the smallest diff but would leave duplicated command policy, weak network boundaries, and the frontend hot path structurally unchanged. It is appropriate only as an emergency CI repair.

### Architecture-first rewrite

Splitting the frontend, protocol, manager, and server lifecycle at once would produce cleaner boundaries but combines too many behavioral changes for stage-control software. Regression diagnosis and rollback would be difficult.

### Layered stabilization — selected

Correct data integrity and safety behavior through narrow tested seams first. Refactor only the code touched by those tests, then optimize measured hot paths without altering messages or UX. Larger frontend extraction becomes a later, separately reviewed phase.

## Proposed design

### 1. Release and landing integrity

Replace the external Google Fonts request with a repository-owned Inter webfont only if the exact font is needed for deterministic layout. Include the OFL license and update notices/public-file allowlists as required. If the asset adds no tested layout value, use the existing system stack. The landing must make zero external runtime requests, and its media render must remain deterministic.

Make production build intent explicit at bundle time. Static-copy failures must fail the build. Boolean environment switches must distinguish `1`/`true` from `0`/`false` instead of relying on string truthiness.

### 2. Typed controller boundary

Introduce a small runtime decoder that converts untrusted JSON into a discriminated command union. It validates required fields, finite numeric ranges, enum values, arrays of strings, and command IDs before dispatch. Invalid input returns a structured failure and performs no manager, filesystem, OSC, or profile mutation.

Keep existing successful message shapes compatible. Dynamic inputs should remain `unknown` until decoded; do not spread `any` through command handlers.

### 3. Command execution and stage safety

Define command metadata once: canonical type, authorization, execution class, acknowledgement source, timeout, retry eligibility, and idempotence. Remove dead policy names and unused retry/status concepts or implement them completely—there must be no policy that suggests reliability the runtime does not provide.

Local commands confirm only after their handler finishes successfully. OSC-confirmed commands resolve against the canonical command type and observed state. Safety commands such as stop and panic use an immediate lane that cannot be held behind a multi-second test-session operation. Non-safety commands remain serialized where ordering matters.

### 4. Lossless lyrics workflow

Every lyrics write carries a command ID. The browser enters a pending state but keeps the edit buffer dirty and keeps the synchronization modal available until a matching success status arrives. Disconnect, unauthorized state, timeout, or backend write error produces a visible failure and retains the user's buffer. Only confirmed persistence clears dirty state or closes the modal.

The server uses asynchronous, atomic persistence for user-authored lyrics. A failed write must not update in-memory state as if durable unless rollback is explicit and tested.

### 5. State and rendering performance

Compute chronological song order and per-song/setlist metrics in one pass. Cache the derived snapshot behind a manager revision that changes only when cues, order, hidden songs, tempo-derived duration inputs, or end markers change. Transport time updates reuse the cached song metadata.

Maintain a chronological index for active-song lookup instead of sorting and calling `indexOf` on every update. In the browser, update the previously active and newly active nodes directly; do not traverse every song/section element when the list structure is unchanged. Cache stable DOM references and avoid rewriting unchanged frame values.

Performance tests should prove reduced calculation/sort counts or asymptotic behavior. Wall-clock benchmarks are reported for comparison but are not used as brittle pass/fail thresholds.

### 6. WebSocket and OSC reliability

Add the heartbeat pattern recommended by `ws`: mark connections alive on `pong`, periodically `ping`, and terminate stale sockets. Clear timers during shutdown. Deduplicate logs using stable content fields rather than a payload containing the current timestamp.

Handle AbletonOSC property listener replies on the documented `/live/song/get/<property>` addresses. Keep polling as a recovery/backstop until listener behavior has regression coverage. Reused UDP sockets must report their actual bound port in diagnostics.

### 7. HTTP, TLS, and persistence hardening

Wrap the async HTTP handler so rejected requests receive a controlled error response and do not become unhandled rejections. Initiate `server.close()` before force-closing remaining connections, matching Node's documented shutdown ordering.

Replace the custom ASN.1 SAN parser with Node 24 `X509Certificate`. Validate required IP SANs, localhost hostname coverage where required, validity dates, and certificate/key usability. Regenerate invalid or expired local credentials through the existing recovery path.

Move command-path filesystem operations away from synchronous APIs. Startup-only reads may remain synchronous where they simplify boot and are measured as insignificant.

## Error handling and observability

- Boundary failures are structured and include the command ID when available.
- User-facing failures never claim a write succeeded.
- Logs exclude secrets and user content where not required.
- Recoverable connection errors keep the browser buffer/state and trigger normal reconnection.
- Fatal build inputs fail loudly; runtime recovery is reserved for corrupt local cache/certificate material where regeneration is safe.

## Test strategy

Work proceeds in red-green-refactor cycles:

1. Add a failing test that demonstrates one observed defect.
2. Run the narrow test and confirm it fails for the expected reason.
3. Implement the smallest correction.
4. Run the narrow suite, then coupled suites.
5. Refactor only after green.

Coverage will include documentation external-resource contracts, message decoding, command completion and safety priority, lyrics failure/reconnect behavior, corrupt `localStorage`, metric cache invalidation, WebSocket heartbeat cleanup, OSC listener replies, production build flags/copy failures, HTTP rejected handlers/shutdown order, and native certificate validation.

Final verification is `npm run ci:public`, `npm run docs:check`, `npm run notices:check`, a production build when Ableton dependencies are available, `npm audit --audit-level=high`, fresh coverage, Git diff review, and a benchmark comparison against the recorded baseline.

## Acceptance criteria

- GitHub CI passes on Ubuntu, Windows, and macOS.
- The public landing has no external runtime font or analytics request.
- A failed/disconnected/unauthorized lyrics save cannot clear the buffer or display success.
- Malformed WebSocket commands cannot mutate or corrupt persistent state.
- Stop/panic are not blocked by long-running non-safety commands.
- Command statuses resolve or fail through canonical, tested rules without dead retry behavior.
- State calculation avoids repeated sorting and per-song linear searches on transport-only updates.
- Stale WebSocket clients are detected and cleaned up.
- Production bundle flags and static assets are deterministic and fail closed.
- All public, documentation, notice, and affected release tests pass with no audit vulnerability.
