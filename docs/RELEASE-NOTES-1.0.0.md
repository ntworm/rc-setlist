# Release notes — RC Setlist 1.0.0

**Release date:** 2026-09-14
**Supported version line:** `1.0.x`
**Also available in Portuguese:** [`pt-BR/NOTAS-DA-VERSAO-1.0.0.md`](pt-BR/NOTAS-DA-VERSAO-1.0.0.md)

This is the first release of RC Setlist as a single consolidated line.
The 0.6.0, 0.6.1 and 0.7.0 release notes still live in the repository
as historical record; their content is folded into the **Since 0.5.1**
section below for anyone crossing over from the public 0.5.1 line.

## Highlights

- **Renamed to "RC Setlist"** following Ableton's brand guidelines,
  which prohibit "Ableton" in the name of a third-party product.
- **One-time migration** for users coming from 0.x: the kit ships
  `Migrate-RC-Setlist-Data.cmd` (Windows) and
  `Migrate RC Setlist Data.command` (macOS) that copy profiles,
  project-setlists, token and preferences into the new layout without
  touching the old one.
- **Quality gates** — ESLint, Prettier, knip, dependency-cruiser, ruff,
  html-validate and `@axe-core/playwright` are now part of `ci:public`.
- **Contracts document** at `docs/CONTRACTS.md` (and `docs/pt-BR/CONTRATOS.md`)
  describes the WS protocol version 3, the on-disk formats, the
  locator grammar, the OSC addresses, the HTTP endpoints and the SemVer
  policy. Every assertion is exercised by `tests/release-contracts.test.mjs`.
- **Cycle and layer cleanup** — 5 dependency cycles removed, `bridgeState`
  moved from `core/` to `runtime/`, `handlers.ts` split into a dispatcher
  and six per-family modules, `setlist-manager.ts` delegates tag
  evaluation and transport tracking to dedicated helpers.
- **Static analysis strictness** — `verbatimModuleSyntax` is on; the
  TypeScript build resolves the SDK only through a checked-in type
  boundary.

### Stage acceptance fixes (2026-09-16)

- **Panel CSS loading**: restored styles by removing the HTML `<link>` self-closing slash, which caused the browser to ignore the stylesheet.
- **Telemetry cards layout**: fixed clipping in mobile portrait orientation by introducing a wrapping layout constraint and 58/42 proportion.
- **Count-in audio**: muted the metronome on mobile devices by default. It is now an opt-in browser setting via the `rc-setlist.count-in-audio` local storage key.
- **Jump target autocomplete**: the marker editor now cleanly displays target names without duplicate `[jump]` or `[loop]` tags in the dropdown.

## Since 0.5.1

### RC Bridge (bundled Live control surface)

The Remote Script the extension talks to now ships inside the extension
and the installation kit, as a fork of the MIT-licensed AbletonOSC
(upstream `0ca6821`). Nobody downloads AbletonOSC by hand any more:
the kit has `Install-RC-Bridge.cmd` (Windows) and
`Install RC Bridge.command` (macOS) that copy it into Live's User
Library and print the one remaining step. Selecting **RCBridge**
under Settings › Link, Tempo & MIDI › Control Surface stays the user's
step, because Live offers no way to do it for them. The fork also
exposes `last_event_time`, which upstream never did, so the show's
total duration no longer needs the MCP bridge.

A stock AbletonOSC sends every reply and every listener update to one
fixed port, 11001, so only one client per machine could hear it —
RC Surface and RC Setlist in the same Live could not both work, and the
loser showed "OSC return port busy". RC Bridge listens on its own port
(11020, so a stock AbletonOSC can keep running beside it), replies to
whichever socket asked, and publishes each listener's updates to every
subscriber, with one Live listener per property and a 60-second lease
that forgets clients that went away. The extension probes for RC
Bridge first and falls back to a stock AbletonOSC when it is absent, and
the panel's OSC line says which one it is talking to
(`via RC Bridge 1.0.0 on port 11020`).

### `[jump NAME]`

A marker that hands playback to a _named_ marker instead of the next one
— a section of the same song, a song, or `Song > Section`. Names match
with tags stripped and case ignored; a bare name is resolved in this
song's sections first, then song titles, then every section in
arrangement order. It uses the same immediate hand-over as `[next]` and
`[skip]`, has its own field in the marker editor and a badge on the
card, and a name that matches nothing does nothing. Along the way the
locator parser stopped splitting `Song > Section` on a `>` that sits
inside a tag.

### Notes per song

One line for the stage — key, tuning, who counts in — edited on the
song panel beside the colour, shown under the title on the card and on
the performance display. Stored in the song book with the colour, so
it follows the song through renames and moves and never touches the
Live project.

### Count-In rethought (0.6.1)

The count-in used to rewind Live's playhead one bar and start the
transport there. That bar is real arrangement time belonging to the
previous song, so the count was heard at the previous song's tempo and
its audio played too. Making the count audible also meant switching
Live's metronome on, which overrode a click the operator had
deliberately turned off. The count was moved to the browser at the tempo
the setlist declares for the playhead, Live starts on the beat it was
already sitting on, and its transport and metronome are never touched
to produce it. Play is sent shortly before the last beat so the
transport arrives on the downbeat; pressing Play again during the
count starts immediately, and Stop cancels it. The "count-in shortened"
warning is gone with the rewind that caused it.

**1.0.0: browser click off by default.** The browser audio count is now turned off
by default, making the count visual-only so the operator's phone does not beep
through its speaker on stage. The click can be enabled per device via the
`rc-setlist.count-in-audio` key in the browser's `localStorage`.

### Empty Live Set clears songs (0.6.1)

A valid empty SDK cue list now clears the displayed songs and locator
targets, including when the last locator is deleted. Unavailable data
and read errors still preserve the last valid snapshot.

### Stop disarms a pending jump (0.6.1)

A jump waiting for its quantization boundary stayed armed through
Stop, and the scheduler executed a pending jump as soon as a reported
position passed its landing beat. Live's Stop moves the playhead, so
the next sample after Stop could carry the transport off to a section
the operator had already changed their mind about — arriving as a jump
to a seemingly random part of the set, seconds after Stop. Stop now
disarms it.

### `[next]` and `[skip]` hand the playhead over directly (0.6.1)

`[next]` and `[skip]` were executed through Live's cue jump, which Live
quantizes to the global launch quantization: measured on the owner's
set, NEXT fired at beat 872.3 and Live jumped at 876.0, the next bar
line. For a `[next]` placed where a song's audio ends and followed by
one empty bar — the reason the tag exists — the jump landed exactly
where the next song was starting anyway, so the marker appeared to do
nothing, and a two-bar gap only lost one bar. Both tags now relocate
the playhead directly, which Live does at once: the hand-over happens
about a tenth of a second after the marker is crossed (position poll
plus AbletonOSC's command tick), never before it, and the next song
starts from its first beat.

### Stopped jump moves the playhead immediately (0.6.1)

While stopped, the jump target is adopted at once; the rehearsal case
the count-in exists for is "jump to a section while stopped, then Play
straight away". Live's API offers two starts and neither is "from the
playhead": `start_playing` begins at the start marker, which a cue
jump or an Arrangement click while stopped moves but a stop does not;
`continue_playing` resumes where the transport last came to rest and
ignores everything done to the playhead since — a cue jump while
stopped, a click, a written position (all measured on Live 12.4).

### Quantized jump lands on the announced beat (0.6.1)

While playing with quantization on, the cue jump was sent when this
side's clock passed the landing beat — just past Live's grid line —
and Live, which quantizes cue jumps to its next grid line, landed it a
full quantization period later. Every quantized jump arrived one bar
after the page said it had. The jump is now handed to Live the moment
it is requested and Live lands it on the very grid line the page shows;
the landing sample applies the destination's tempo and loop.

### Song list no longer rebuilds every two seconds (0.6.1)

Cues arrive from the Live SDK every 100ms and from AbletonOSC every
2000ms, and the two do not agree to the last decimal. The manager
compared exact floats while its callers compared a fingerprint
quantized to 1/100 of a beat, so each source looked like a change to
the other: every OSC poll reparsed the setlist and the client rebuilt
the whole song list, which on screen is the page flickering. The
manager now uses the same quantized fingerprint — a difference below
1/100 of a beat cannot change how a locator parses. The renderer now
compares the markup it builds against what is on screen and leaves the
DOM alone when they match.

### Beat flash without full layout (0.6.1)

The tempo card restarted its CSS animation by reading `offsetWidth`,
which flushes layout for the whole document — twice a second at 120
BPM, on a page holding twenty songs and a couple of hundred section
chips. Both stage views now flash through the Web Animations API,
which invalidates no layout and recycles a single animation.

### Tools menu fits its labels (0.6.1)

The popover was a fixed 11rem box while its grid column sized to the
widest label, so "Mapeamento de Teclado" pushed every button past the
right edge. The popover is now sized by its widest label, capped to the
viewport.

### Native select lists are readable (0.6.1)

The setlist picker's dropdown opened as a white list with near-white
text, because Chromium paints the option list from the select's own
background. Every native select now paints its options dark.

### Help guide tells `[next]` and `[skip]` apart (0.6.1)

The two rows read alike. The guide now says where each tag takes the
playhead, that `[next]` never advances to the next section, that both
hand over at the marker rather than on the next bar, and shows the
chaining case — an end marker with `[next]` followed by the next song.

### Count digit replaces the play triangle (0.6.1)

It was drawn over the glyph, leaving both visible at once.

### Second press silences the count (0.6.1)

Cancelling cleared the timers, which stopped the digits changing, but
the blips were already scheduled on the audio clock and kept sounding
underneath the playback that second press had started.

### Song-level tags fire again (0.6.1)

The automation evaluator chose one target, `section || song`, so once
the playhead was inside any section the song's own tags were never read
again. A song-level `[stop]`, `[next]`, `[skip]`, `[loop]`, `[bpm]`
or `[click]` therefore only fired in the gap between the song's
locator and its first section, and when a section began on the song's
own beat — the ordinary case — it never fired at all. The marker
editor offers STOP, NEXT and SKIP on the song panel, so this was a
control the user could set and watch do nothing. Song and section tags
are now evaluated independently: the song's fire once when the song
is entered and are not renewed at each section boundary, the
section's fire on their own entry, and a section declaring the same
tag is applied last so the more specific value wins.

### Why a fork of AbletonOSC (0.6.1)

AbletonOSC sends every reply and every listener update to one fixed
port, 11001, so only one client per machine could hear it — RC Surface
and RC Setlist in the same Live could not both work, and the loser
showed "OSC return port busy". RC Bridge listens on its own port
(11020, so a stock AbletonOSC can keep running beside it), replies to
whichever socket asked, and publishes each listener's updates to every
subscriber, with one Live listener per property and a 60-second lease
that forgets clients that went away. It also stops logging every
property read at INFO, which had grown one owner's log to 34 million
lines. The extension probes for RC Bridge first and falls back to a
stock AbletonOSC when it is absent.

### Play plays from where the playhead is (0.6.1)

Live offers two starts and neither is "from the playhead". Play
resumes when the playhead has not moved since the transport stopped,
and starts from the start marker when a jump or a click moved it.

### The first play after start-up resumes where Live is (0.6.1)

The SDK reports the tempo every 100ms from the moment the extension
starts, and that report was routed through the transport update,
presenting a position of zero as the first stopped observation. Tempo-only
reports now have their own path.

### OSC-only transport regression (0.6.1)

The OSC-only transport path, which a set-up without the Ableton MCP
uses and which the owner's own machine never exercises, now has an
end-to-end regression test for the playhead hand-over on `[next]`.

### Command Bus and Error Sanitization (0.7.0)

The command bus now attaches operator-facing error messages
(`OperatorError` and `ProfileError`) to `command_status.error`, while
internal exceptions (such as raw filesystem paths) remain strictly
sanitized and arrive as generic `execution_failed`.

### Locator Tag Parsing Cleaned Up (0.7.0)

Tag extraction and section construction were refactored into a single
coherent pipeline without duplicated branches.

### Song Book Cache Follows Active Profile (0.7.0)

Song colors and notes are cached per profile; switching profiles now
clears the cache immediately, preventing one profile's edits from
leaking into another.

### MCP Sync Tick Logs Unexpected Failures Quietly (0.7.0)

Bridge connection timeouts/refusals stay silent as expected when the
MCP is absent, while internal callback errors log cleanly.

### Dead Code and Orphaned Tests Removed (0.7.0)

Retired test-session locator creation utilities and orphaned tests
were removed cleanly.

## Changed in 1.0

### Renamed to "RC Setlist"

The product name no longer includes "Ableton" (Ableton trademark
guidelines). Old 0.x data lives in `<Extensions Data>/ntworm.ableton-rc-setlist`;
the kit migrates it to `<Extensions Data>/ntworm.rc-setlist` and the
old Live extension entry must be removed from
**Settings > Extensions**.

### Contracts documented

`docs/CONTRACTS.md` and `docs/pt-BR/CONTRATOS.md` describe every
external surface. Every contract is enforced by an assertion in
`tests/release-contracts.test.mjs`.

### Quality gates

`ci:public` now includes `lint`, `format:check`, `deadcode`,
`deps:check`, `lint:py`, `html-validate` and the `@axe-core/playwright`
landing scan. The `gates:quality` script collects them for manual
runs.

### Cycle and layer cleanup

- `bridgeState` moved from `src/core/` to `src/runtime/`.
- `commands/handlers.ts` split into a dispatcher and six per-family
  modules under `src/commands/handlers/`.
- `setlist-manager.ts` delegates tag evaluation to
  `src/core/automation-evaluator.ts` and transport tracking to
  `src/core/transport-tracker.ts`.
- 5 dependency cycles removed.

## Fixed in 1.0

- The kit's `Migrate-RC-Setlist-Data` scripts are idempotent and
  never overwrite a file at the destination.
- The panel now prompts the operator to run the migration when the new
  data folder is empty.
- `verbatimModuleSyntax` is enabled; type-only imports are explicit.
- `tsconfig.json` enforces `noUnusedLocals`, `noUnusedParameters`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`.

## Removed in 1.0

- The `Ableton RC Setlist` product name in all public surfaces (only
  CHANGELOG historical entries and migration-context prose retain it).
- The `Ableton-RC-Setlist-<version>` release artifact naming; 1.0
  ships `RC-Setlist-1.0.0.ablx` and
  `RC-Setlist-1.0.0-Installation-Kit.zip`.
- Dead code reported by `knip` and unreachable exports from the
  `no-explicit-any` rule's narrowing pass.
- `console.*` calls in user-facing paths; all such logs now go through
  `src/util/log.ts` with the operator-facing message and a
  machine-readable scope.
- Release notes for 0.6.0, 0.6.1 and 0.7.0 (folded into "Since 0.5.1"
  above and into `CHANGELOG.md`).

## Security

See `internal/SECURITY-REVIEW-1.0.md` for the per-item review and
`SECURITY.md` for the supported-version line and how to report issues.

## Upgrading from 0.x

1. Install `RC-Setlist-1.0.0.ablx` from the release.
2. In Live, open **Settings > Extensions** and remove the old
   **Ableton RC Setlist** entry.
3. Run `Migrate-RC-Setlist-Data.cmd` (Windows) or
   `Migrate RC Setlist Data.command` (macOS) once before opening Live
   for the first time with 1.0. The script copies profiles,
   project-setlists, token and preferences into the new folder
   without touching the old one.
4. Restart Live; the new extension picks up where the old one left
   off.

Skipping the migration or leaving both extensions installed makes
your old profiles invisible to the new extension.
