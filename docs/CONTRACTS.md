# RC Setlist Contracts

This document is the public contract for RC Setlist 1.0. Every behaviour
documented here has a regression test in
[`tests/release-contracts.test.mjs`](../tests/release-contracts.test.mjs);
behaviour outside this document is implementation detail and may change
without notice. Anything documented here stays in place until the next
major version (2.0) per the SemVer policy in §7.

Audience: extension authors writing a controller that talks to RC Setlist
over WebSocket, integrators reading or writing RC Setlist profiles on
disk, and contributors changing any of the surfaces below.

Locale: [Português (Brasil)](./pt-BR/CONTRATOS.md)

---

## 1. On-disk formats

Profiles live under a single storage root. 1.0 derives the root from
`manifest.json` `name` (`RC Setlist`), the publisher (`ntworm`) and the
Live suite version, so a Windows user with Ableton 12 sees
`%LOCALAPPDATA%\Ableton\Extensions Data\ntworm.rc-setlist\` and a macOS
user sees `~/Library/Application Support/Ableton/Extensions
Data/ntworm.rc-setlist/`. The `0.x` lineage used `ntworm.ableton-rc-setlist`;
the 1.0 migration kit (`Migrate-RC-Setlist-Data.{cmd,ps1}` /
`Migrate RC Setlist Data.command`, `scripts/migrate-data.mjs`) copies the
old tree to the new one without overwriting destination files.

Inside a profile directory:

| File                                | Owner   | Stable since | Notes                                                              |
| ----------------------------------- | ------- | ------------ | ------------------------------------------------------------------ |
| `index.json`                        | manager | 0.5.1        | Registry of profiles (UUID, name, created/updated, schemaVersion). |
| `index.json.bak`                    | manager | 0.5.1        | Recovery shadow written alongside `index.json`.                    |
| `profile.json`                      | manager | 0.5.1        | Profile metadata + path root + `lastSavedAt`.                      |
| `profile.json.bak`                  | manager | 0.5.1        | Recovery shadow.                                                   |
| `profiles/<uuid>/profile.json`      | manager | 0.5.1        | Per-profile metadata.                                              |
| `profiles/<uuid>/custom-order.json` | manager | 0.5.1        | `string[]` of song titles in display order.                        |
| `profiles/<uuid>/song-book.json`    | manager | 0.5.1        | Per-song colour (`#rrggbb`, palette in §6.3) and one-line notes.   |
| `profiles/<uuid>/lyrics/<song>.lrc` | lyrics  | 0.5.1        | LRC with optional `ar`/`ti`/`al`/`by` headers; UTF-8.              |
| `profiles/<uuid>/lyrics/<song>.txt` | lyrics  | 0.5.1        | Plain text; one line per beat, server assigns pseudo-time.         |
| `certs/<hostname>.pem` + `.key`     | server  | 0.5.1        | Self-signed certificate per detected LAN hostname.                 |
| `token`                             | server  | 0.5.1        | Plain text token used for HTTP/WS auth.                            |
| `ui-locale`                         | prefs   | 0.5.1        | `en` or `pt-BR`; anything else rejected by the panel.              |
| `auto-start`                        | prefs   | 0.5.1        | `1` or `0`; toggles Live auto-launch.                              |
| `events.log`                        | log     | 0.5.1        | NDJSON, append-only, 10 MiB rotation; redacts secrets (see §2.5).  |

The 1.0 registry carries `schemaVersion: 2`. Profiles migrated from 0.x
arrive with `schemaVersion: 1` and are upgraded in place the first time
they are opened. `schemaVersion: 3` is reserved for the next major and
currently rejects the profile with `future_schema`.

The fixture `tests/fixtures/storage/{0.5.1,0.6.1,0.7.0}/` carries one
minimal, anonymised profile per past version so the migration path stays
covered.

---

## 2. WebSocket protocol (v3)

The HTTPS server on `https://<host>:<port>/` upgrades a WebSocket
connection at the same origin. The handshake requires `Origin` /
`Host` to be a loopback address (`127.0.0.1`, `::1`) or a local-LAN
address; anything else is rejected with HTTP 403 before the upgrade.
After upgrade, every frame is a JSON text frame.

### 2.1 Server → Client frames

Every server frame carries `type` and (for state) `stateVersion` so a
client that connects late or reconnects can reject an out-of-order frame.

| `type`              | Required fields                                                        | Sent when                                                                         |
| ------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `state`             | `stateVersion`, `SetlistState` (§2.4)                                  | Initial connect (`sync_confirm` triggers re-broadcast) and on every state change. |
| `log`               | `level` (`debug`/`info`/`warn`/`error`), `scope`, `message`, `fields?` | Server-side log line routed to console; redacted per §2.5.                        |
| `pong`              | `ts`                                                                   | Heartbeat reply.                                                                  |
| `auth_success`      | `clientId`, `controller: true`                                         | Manual `auth` succeeds.                                                           |
| `auth_failure`      | `reason`                                                               | Manual `auth` rejected; client may retry up to 3 times/minute/IP.                 |
| `command_ack`       | `commandId`, `status`                                                  | Server accepted a command from §2.2.                                              |
| `command_confirmed` | `commandId`, `status`, `commandType`, `details?`                       | Handler completed; `status` is one of `confirmed`/`failed`/`expired`/`cancelled`. |
| `disconnect_notice` | `reason`                                                               | Forced close (backpressure, origin rejection, …).                                 |

### 2.2 Client → Server frames

The decoder is `src/server/client-message.ts`. Every message validates
`type` against `^[a-z][a-z0-9_]{0,63}$`; anything else returns
`invalid_message`. Command IDs match `^[A-Za-z0-9._:-]+$` and are
required on every command.

| `type`           | Required fields                       | Effect                                                                                                                           |
| ---------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `handshake`      | `clientId`                            | Begin Reliability Core sync; replies with `state` once handshake completes.                                                      |
| `sync_confirm`   | `stateVersion`                        | Re-broadcast the cached `state` if the version matches; otherwise no-op.                                                         |
| `auth`           | `token`                               | Re-attempt auth; succeeds only if `token === server.token` and server.token is non-empty.                                        |
| `play`           | `commandId`                           | Resume transport at the resting position.                                                                                        |
| `stop`           | `commandId`                           | Stop transport; disarms any pending jump.                                                                                        |
| `toggle_play`    | `commandId`                           | Play if stopped, stop if playing.                                                                                                |
| `next`           | `commandId`                           | Cue-jump to the next song's first beat (quantized or immediate per global quantization).                                         |
| `prev`           | `commandId`                           | Relocate to the previous song.                                                                                                   |
| `jump`           | `commandId`, `locator`                | Cue-jump to a marker by name (locator grammar in §4).                                                                            |
| `bpm`            | `commandId`, `bpm` (20–300)           | Set tempo.                                                                                                                       |
| `click`          | `commandId`, `enabled`                | Toggle metronome.                                                                                                                |
| `pre_roll`       | `commandId`, `enabled`                | Toggle pre-roll.                                                                                                                 |
| `set_panic`      | `commandId`, `enabled`                | Enter / leave panic mode (stops transport, locks non-safety commands).                                                           |
| `set_song_color` | `commandId`, `songTime`, `color`      | Colour the song at the given beat position; colour must be in §6.3.                                                              |
| `set_song_notes` | `commandId`, `songTime`, `notes`      | Set the one-line notes; `null` clears.                                                                                           |
| `set_loop`       | `commandId`, `enabled`, `count?`      | Arm / disarm loop on the current song.                                                                                           |
| `reorder`        | `commandId`, `order`                  | Custom display order; must contain every current song exactly once.                                                              |
| `profile_*`      | `commandId`                           | Profile management (`profile_create`, `profile_select`, `profile_rename`, `profile_delete`, `profile_restore`); controller-only. |
| `export_csv`     | `commandId`                           | Write a UTF-8-BOM CSV of the active setlist to the resolved export path.                                                         |
| `edit_locator`   | `commandId`, `currentName`, `newName` | Rename the cue in the Set (controller-only).                                                                                     |

Bounded sizes enforced by the decoder: commandId ≤ 128 chars; clientId ≤
128; profile fields ≤ 80; song titles ≤ 255; lyrics body ≤ 96 KiB;
reorder ≤ 4096 songs; structured-text fields (notes, song title, lyrics
header) reject C0/C1 controls.

### 2.3 Reliability Core

Every command is acknowledged twice: `command_ack` (server accepted the
command into the bus) and `command_confirmed` (handler finished). The
`status` enum in `command_confirmed` is
`created` → `sent` → `acknowledged` → `confirmed` (or `failed`/`expired`/
`cancelled`). A handler that throws `OperatorError` keeps the rejection
inside `failed` with a stable `reason`; a handler that throws anything
else settles with `execution_failed` and the original error is written
to `events.log`, never the WS frame.

The server emits `state` with a monotonically increasing `stateVersion`.
`sync_confirm` with a stale version is a no-op; the client should send
`handshake` to recover.

### 2.4 SetlistState shape

Mirrors [`src/types.ts`](../src/types.ts) `SetlistState`. The 1.0
contract adds `protocolVersion: 3` (the schema version of this frame,
not of on-disk profiles), `preRollEnabled`, `durationBpm`,
`declaredTempo`, `songColors`, `songNotes`, `durationConfidence`,
`loopIteration`, `loopCount`, `currentLoopIteration`,
`clipTriggerQuantization`. Reliability Core adds `stateVersion`,
`connection`, `transport`, `currentSongId`, `currentSectionId`,
`pendingCommands`, `mode` (`rehearsal` | `show`), `safety`.

### 2.5 Log redaction

Server logs and `log` WS frames redact, by key name or value pattern:

- Field names matching `/(?:token|password|secret|^key$|authToken|passwordHash|apiKey)/i`
  are replaced with `[REDACTED]`.
- Windows absolute paths (`C:\…`), UNC (`\\…`), macOS (`/Users/…`) and
  Linux (`/home/…`) keep the last two path segments, normalised.
- `token=…` query-string values are replaced with `***`.

This is asserted by `tests/release-contracts.test.mjs`.

---

## 3. OSC integration

RC Setlist prefers **RC Bridge** (the fork of AbletonOSC shipped inside
the extension and the kit) and falls back to a stock AbletonOSC when no
bridge answers the probe.

| Layer                 | UDP port | Behaviour                                                                                                           |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| RC Bridge             | 11020    | Replies to `/live/rcbridge/version` on each client socket; chosen port is the ephemeral source port of the request. |
| AbletonOSC (fallback) | 11000    | Standard OSC; replies go to the source port of the request.                                                         |
| AbletonOSC (listen)   | 11001    | Standard OSC; client listens here for unsolicited state.                                                            |

The probe runs for 700 ms (RC Bridge answers in well under 200 ms in
practice). RC Bridge version is `/live/rcbridge/version` and replies with
a string of the form `RC Bridge 1.0.0`.

OSC addresses the client listens on or sends:

- `/live/song/get/tempo` and `/live/song/start_listen/tempo` — current
  song tempo.
- `/live/clip/get/cues` — list of cues (`name`, `time`).
- `/live/song/get/current_song_time` — current playhead position.
- `/live/song/get/is_playing` — transport state.
- `/live/clip/get/name` — cue rename.
- `/live/song/set/tempo` — set tempo (when SDK sync is unavailable).
- `/live/clip/fire` — cue jump.

---

## 4. Locator grammar

A cue name in Live follows the grammar below. The parser
([`src/core/locator-parser.ts`](../src/core/locator-parser.ts)) accepts
the exact form; anything outside the table either splits into multiple
cues (`>` separator) or is treated as a plain title.

### 4.1 Song vs section

- `Song Title` — a song locator (title only).
- `> Section` — a section of the most recently seen song.
- `Song Title > Section` — a section of an explicitly named song.
- `Song Title >` (trailing `>`) — an automation-only section of `Song
Title` (no display title, but the section's tags still fire).

The `>` splits outside `[ ]` brackets, so `[jump A > Chorus]` keeps the
`>` inside the tag.

### 4.2 Tag table

All tags are case-insensitive (`[LOOP]` ≡ `[loop]`). Whitespace inside
the tag is collapsed.

| Tag                           | Value        | Effect                                                                                                                                                      |
| ----------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[stop]`                      | none         | Stop the transport when the cue is reached.                                                                                                                 |
| `[next]`                      | none         | Relocate to the next song's first beat when reached late.                                                                                                   |
| `[skip]`                      | none         | Skip over this song on `next`.                                                                                                                              |
| `[loop]`                      | none         | Arm an infinite loop on the cue (released by the next loop arm / `[stop]` / `[next]`).                                                                      |
| `[loop Nx]` / `[loop N]`      | integer ≥ 1  | Arm a counted loop on the cue; N iterations before release.                                                                                                 |
| `[bpm N]`                     | float        | Declare the tempo at this cue; durations fall back to this instead of the live tempo.                                                                       |
| `[click]`                     | none         | Turn the metronome on when reached.                                                                                                                         |
| `[click off]` / `[click-off]` | none         | Turn the metronome off when reached.                                                                                                                        |
| `[hidden]`                    | none         | Hide this cue from the visible setlist (kept in `hidden[]`).                                                                                                |
| `[ignore]`                    | none         | Same effect as `[hidden]`; preferred form for new cues.                                                                                                     |
| `[jump NAME]`                 | string       | When reached, hand over to the marker called NAME. Resolution: section of the same song → song → any section, case-insensitive; tags ignored on the target. |
| `_pre-roll`                   | legacy alias | Treated as `[hidden] + preRoll` for backward compatibility with 0.x.                                                                                        |

Examples, all valid:

- `INTRO`
- `> VERSO`
- `Song A > Chorus [loop 4x]`
- `Song A > Refrão [bpm 120]` — `[bpm]` on a named section.
- `Song A [bpm 120]`
- `Song A > Bridge [jump Verse]` (handover to the section "Verse")
- `Song A [hidden]` (kept in `hidden[]`, not in `songs[]`)

**Known parser quirks** (the parser handles these cases; the inputs above
with an explicit song are the recommended forms):

- `[bpm 120] > Refrão` (implicit empty song) — the parser parses the
  `[bpm]` tag as belonging to the implicit song, not the section. The
  resulting `section.bpm` is `null`. Use `Song A > Refrão [bpm 120]`
  to pin the tag on the section.
- `[jump A > Chorus]` (no name) — the parser classifies this as
  `kind: 'automation'` because the display name is empty; the
  `jumpTarget` is preserved on the section fields. Use
  `Song A > Bridge [jump Verse]` to keep the `section` kind.
- `> [stop]` (tag-only relative automation) — the parser classifies
  this as `kind: 'relative-automation'`. The `[stop]` tag still fires
  when the playhead reaches the implicit cue.

These quirks are documented as they exist in 1.0; any change to the
parser is held for `2.0.0` per §7.

### 4.3 What is not in the grammar

- `[anything-other]` — ignored, with the literal `[anything-other]`
  stripped from the display title.
- Nested brackets: `[a [b]]` — not supported; treat as text.
- Unicode whitespace inside tags: not normalised beyond `trim()`.
- Comments inside a cue: not supported; the cue is one line in Live.

---

## 5. HTTP endpoints

Base URL: `https://<host>:<port>/` (default port `4444`, but the server
binds the first free port in the `RC_SETLIST_HTTP_PORT` hint range). The
token is at `Authorization: Bearer <token>` or in the `?token=<token>`
query parameter (the latter is the QR pairing flow and is the only place
the token may appear in a URL). Every response carries
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a
CSP that disallows inline scripts in stage pages.

| Method | Path                  | Auth | Purpose                                                                                                           |
| ------ | --------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/`                   | no   | Landing HTML (redirect to `/setlist`).                                                                            |
| GET    | `/setlist`            | no   | Stage Control HTML.                                                                                               |
| GET    | `/performance`        | no   | Performance display HTML.                                                                                         |
| GET    | `/panel`              | no   | Live-side panel HTML (token injected via `window.INITIAL_TOKEN`).                                                 |
| GET    | `/health`             | no   | `HEAD`/`GET` — returns 200 with no body.                                                                          |
| GET    | `/static/<path>`      | no   | Serves `static/`; `..`, encoded slashes and Unicode names are rejected.                                           |
| GET    | `/exports/<file>.csv` | yes  | Returns a generated CSV; filename must match `[A-Za-z0-9_.-]+\.csv`.                                              |
| GET    | `/audio/<file>`       | yes  | Returns an audio asset; filename allowlist per-profile.                                                           |
| GET    | `/lyrics/<song>`      | yes  | Returns the saved lyrics (`.lrc` or `.txt`).                                                                      |
| GET    | `/state`              | yes  | Returns the current `SetlistState` as JSON.                                                                       |
| GET    | `/api/snapshot`       | yes  | Internal diagnostics; disabled in production.                                                                     |
| POST   | `/api/command`        | yes  | Accepts a single client message (`src/server/client-message.ts`); replies `command_ack` then `command_confirmed`. |

`/api/*` paths require a controller token; `/health`, `/static/*` and
the HTML pages do not. Any unknown path returns `404 text/plain` without
leaking the server header.

---

## 6. Compatibility helpers

### 6.1 Version with single source

`package.json` `version` is the only source of truth. `scripts/sync-version.mjs`:

- `npm run version:check` (alias `node scripts/sync-version.mjs --check`)
  reads `package.json`, `manifest.json`, `docs/site-i18n.js`, and the
  release-template files. Exits 1 with a diff if any surface disagrees.
- `node scripts/sync-version.mjs --write` rewrites every surface listed
  above to match `package.json`. The release pipeline calls `--check`
  and fails if any drift has been left unfixed.

### 6.2 Migration 0.x → 1.0

`scripts/migrate-data.mjs` is the testable core; the kit ships PowerShell
(Windows) and shell (macOS) wrappers around it. Behaviour:

- Source: `%LOCALAPPDATA%\Ableton\Extensions Data\ntworm.ableton-rc-setlist`
  (Windows) or `~/Library/Application Support/Ableton/Extensions Data/ntworm.ableton-rc-setlist`
  (macOS). The wrappers probe both candidates.
- Destination: the 1.0 root (see §1). Created if missing.
- Copy `profiles/`, `project-setlists/`, `token`, `ui-locale`,
  `auto-start`, `certs/`. Never overwrite an existing destination file.
- Idempotent: a second run with the same source is a no-op.

### 6.3 Song colour palette

Sixteen swatches in two rows; the server rejects anything outside the
palette so a rogue client cannot paint a song in a reserved state
colour. Defined once in `src/server/client-message.ts` and mirrored in
`static/setlist/marker-editor.js`; the test
`tests/client-message.test.mjs` reads the client file and fails if the
two ever diverge.

---

## 7. SemVer policy

`1.0.x` is the public line on `https://github.com/ntworm/rc-setlist`
from the date of release. Security fixes are provided for the latest
`1.x.y` only; older `1.x` and the `0.x` lineage are unsupported. The
next breaking change is `2.0.0`; `1.x` is additive only.

| Surface                | Backwards-compatible in 1.x?                                   |
| ---------------------- | -------------------------------------------------------------- |
| WebSocket protocol     | Yes — additive fields only; old clients ignore unknown fields. |
| On-disk profile layout | Yes — registry `schemaVersion: 2` is read-only here.           |
| HTTP endpoints         | Yes — additive; old paths keep their semantics.                |
| Locator grammar        | Yes — additive tags only; existing tags keep their meaning.    |
| OSC addresses          | Yes — additive; the probe keeps its 700 ms timeout.            |

Anything that needs a breaking change is held for `2.0.0`. The release
notes for `1.0.0` are at
[`RELEASE-NOTES-1.0.0.md`](./RELEASE-NOTES-1.0.0.md).

---

## 8. How changes to this document are tested

Every claim in this document is a regression test in
[`tests/release-contracts.test.mjs`](../tests/release-contracts.test.mjs):

1. **Disk migration** — for each past version in `tests/fixtures/storage/`,
   load via the public manager API and assert profiles / order / colours
   / notes / lyrics arrive identical. A corrupted fixture must not
   destroy the original.
2. **Protocol snapshot** — `getState()` over a curated setlist is compared
   to `tests/fixtures/state/snapshot.json`; mismatch = `task verify` fails.
3. **Locator grammar** — the tag table in §4.2 is read by the test (or
   duplicated as JSON) and every row passes through `parseLocator`.
4. **Bridge version** — the bridge `/live/rcbridge/version` reply is
   pinned to `1.0.0`; any drift in the bridge fixtures fails the suite.
5. **HTTP / WS security** — `tests/http-security.test.mjs` and
   `tests/ws-auth.test.mjs` exercise the §5 and §2 allowlists; the
   release-contracts test re-runs the security-critical subset to
   prevent silent drift.

Changing a contract here without changing the test, or vice versa,
breaks `npm run ci:public` and `npm run version:check`. Both run in CI
before any tagged release.
