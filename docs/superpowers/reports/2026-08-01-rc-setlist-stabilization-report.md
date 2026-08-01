# RC Setlist stabilization report

Date: 2026-08-01  
Baseline: `origin/main` at `1b6efb4`  
Verified implementation: `0573ce9`

## Outcome

This pass removed the known local-first asset regression, hardened untrusted WebSocket input, made persistence completion truthful, protected ordered mutations from overlap, fixed stale lyrics acknowledgements, reduced repeated setlist work, narrowed browser DOM updates, and hardened HTTP, TLS, OSC, build, and shutdown behavior.

The implementation was compared with the primary documentation and reference implementations for [Node.js HTTP](https://nodejs.org/api/http.html), [Node.js X509Certificate](https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html), the [`ws` heartbeat pattern](https://github.com/websockets/ws), [AbletonOSC](https://github.com/ideoforms/AbletonOSC), and the [official Inter distribution](https://github.com/rsms/inter).

## Main corrections

- Self-hosted the official Inter font and restored the no-external-runtime-assets contract.
- Added a bounded runtime decoder for every client message; malformed JSON now receives a stable `invalid_message` response.
- Removed raw error/path reflection from command statuses and WebSocket operational logs.
- Made command payloads type-safe from the decoded `ClientMessage` boundary through execution handlers.
- Confirmed local commands only after their handler succeeds and kept ordered mutations serialized until the underlying operation settles. Stop and Panic retain a separate safety lane.
- Replaced direct persistence writes with atomic writes for order, lyrics, CSV, click previews, and test-session files.
- Prevented stale save acknowledgements from clearing newer lyrics edits or edits for another song.
- Blocked LRC saves containing untimestamped editor lines instead of silently discarding them.
- Restored chronological order when a profile has no custom order and preserved duplicate-title setlists.
- Required complete test-session locator creation and detected OSC sends that no socket accepted.
- Cached derived setlist state, chronological lookup, and metrics; replaced repeated linear rank lookup and narrowed active-row DOM mutations.
- Added WebSocket heartbeat cleanup and bounded log deduplication.
- Hardened `HEAD`, async HTTP failures, production-only debug flags, certificate/key matching, fatal asset-copy errors, production `NODE_ENV`, and graceful close ordering.

## Fresh verification

- `npm run ci:public`: passed.
  - source: 218 passed
  - static/documentation: 89 passed
  - Playwright: 59 passed
  - public media: 10 verified
  - release surface: 41 passed
- `npm run build:prod`: passed with the authorized local Ableton SDK and CLI archives; the production bundle loaded successfully.
- `npm run docs:check`: 20 documents, no broken local links.
- `npm run notices:check`: current.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Node test coverage run: 331 passed; 85.16% lines, 77.96% branches, 83.27% functions.

The shell runtime was Node 24.13.1, while the package declares Node >=24.16.0. Tests and both builds passed, but the release environment should still use the declared minimum or newer.

## Hot-path benchmark

The benchmark creates a setlist of the stated size, warms the cache, and measures 100,000 repeated `getState()` calls. It is a focused hot-path comparison, not an end-to-end latency claim and not a test threshold.

| Songs | Baseline ms/call | Final ms/call |
| ---: | ---: | ---: |
| 50 | 0.041 | 0.000088 |
| 100 | 0.184 | 0.000095 |
| 250 | 1.082 | 0.000090 |
| 500 | 6.189 | 0.000077 |
| 1,000 | 18.598 | 0.000102 |

The final timings stay effectively constant as setlist size grows because transport-only reads reuse derived state. Asymptotic behavior is also covered by deterministic calculation-count tests.

## Residual integration boundaries

- The production bundle was built and loaded, but this workstation run did not drive a real Ableton Live session end to end.
- AbletonOSC's cue-point fallback can confirm local UDP socket acceptance, not remote application of the cue. The setup now refuses success when the local send was not accepted and rejects incomplete batches.
- Persisted custom order is title-based for backward compatibility. Duplicate titles remain valid and retain chronological identity, but independently reordering two identically named songs would require a future stable song-ID protocol revision.

