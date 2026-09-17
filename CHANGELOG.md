# Changelog

All notable public changes to Ableton RC Setlist are recorded here.

## [Unreleased]

## [1.0.0] - 2026-09-14

### Added

- **Renamed to "RC Setlist"** following Ableton's brand guidelines, which prohibit "Ableton" in the name of a third-party product.
- **One-time migration** for users upgrading from 0.x: `Migrate-RC-Setlist-Data.cmd` (Windows) and `Migrate RC Setlist Data.command` (macOS) copy profiles, project-setlists, token and preferences into the new layout without touching the old one.
- **High-contrast panel frame**: 2px amber border (`rgba(255, 168, 38, 0.45)`) with subtle glow ensures readability on dark and light Live themes.
- **Contracts document** (`docs/CONTRACTS.md` and `docs/pt-BR/CONTRATOS.md`) describes the WS protocol v3, on-disk formats, locator grammar, OSC addresses, HTTP endpoints and SemVer policy. Every contract is enforced by `tests/release-contracts.test.mjs`.
- **Quality gates**: ESLint, Prettier, knip, dependency-cruiser, ruff, html-validate and `@axe-core/playwright` are part of `ci:public`. The `gates:quality` script collects them for manual runs.
- **Security review** (`internal/SECURITY-REVIEW-1.0.md`) documents per-item threats, decisions and the tests that enforce them.
- **Performance baseline** (`internal/PERFORMANCE-BASELINE-1.0.md`) records the broadcast-path numbers and the thresholds that gate regressions.

### Changed

- **Cycle and layer cleanup**: 5 dependency cycles removed, `bridgeState` moved from `src/core/` to `src/runtime/`, `commands/handlers.ts` split into a dispatcher plus six per-family modules, `setlist-manager.ts` delegates tag evaluation and transport tracking to dedicated helpers.
- **Static analysis strictness**: `verbatimModuleSyntax` is on; the TypeScript build resolves the SDK only through a checked-in type boundary.
- **Release artefact naming**: `RC-Setlist-0.7.1.ablx` and `RC-Setlist-0.7.1-Installation-Kit.zip` replace the `Ableton-RC-Setlist-<version>` convention.

### Fixed

- **Stage acceptance fixes (2026-09-16 rehearsal)**:
  - **Panel CSS loading**: restored styles by removing the HTML `<link>` self-closing slash, which caused the browser to ignore the stylesheet.
  - **Telemetry cards layout**: fixed clipping in mobile portrait orientation by introducing a wrapping layout constraint and 58/42 proportion.
  - **Count-in audio**: muted the metronome on mobile devices by default. It is now an opt-in browser setting via the `rc-setlist.count-in-audio` local storage key.
  - **Jump target autocomplete**: the marker editor now cleanly displays target names without duplicate `[jump]` or `[loop]` tags in the dropdown.
- **Installer removes legacy 0.x package automatically**: `Install-RC-Bridge.ps1` (Windows) and `Install RC Bridge.command` (macOS) clean up pre-0.7.1 packages from legacy User Library / Extensions locations so Live only displays one RC Setlist entry in the Extensions menu.
- Kit migration scripts are idempotent and never overwrite a file at the destination.
- The panel now prompts the operator to run the migration when the new data folder is empty.

### Removed

- The `Ableton RC Setlist` product name in all public surfaces (CHANGELOG historical entries and migration-context prose retain it).
- Dead code reported by `knip` and unreachable exports from the `no-explicit-any` narrowing pass.
- `console.*` calls in user-facing paths; all such logs now go through `src/util/log.ts` with the operator-facing message and a machine-readable scope.

### Security

- See `internal/SECURITY-REVIEW-1.0.md` for the per-item review and `SECURITY.md` for the supported-version line and how to report issues.

## [0.7.0] - 2026-09-13

### Added

- **RC Bridge, the bundled Live control surface**: the Remote Script the extension talks to now ships inside the extension and the installation kit, as a fork of the MIT-licensed AbletonOSC (upstream `0ca6821`). Nobody downloads AbletonOSC by hand any more: the kit has `Install-RC-Bridge.cmd` (Windows) and `Install RC Bridge.command` (macOS) that copy it into Live's User Library and print the one remaining step. Selecting **RCBridge** under Settings › Link, Tempo & MIDI › Control Surface stays the user's step, because Live offers no way to do it for them — and the copy itself cannot happen from inside Live either: the ExtensionHost sandboxes the filesystem to the extension's own folders, so the panel reports which script is in use and shows the steps instead of pretending to install. The fork also exposes `last_event_time`, which upstream never did, so the show's total duration no longer needs the MCP bridge.
- **`[jump NAME]`**: a marker that hands playback to a *named* marker instead of the next one — a section of the same song, a song, or `Song > Section`. Names match with tags stripped and case ignored; a bare name is resolved in this song's sections first, then song titles, then every section in arrangement order. It uses the same immediate hand-over as `[next]` and `[skip]`, has its own field in the marker editor and a badge on the card, and a name that matches nothing does nothing. Along the way the locator parser stopped splitting `Song > Section` on a `>` that sits inside a tag.
- **Notes per song**: one line for the stage — key, tuning, who counts in — edited on the song panel beside the colour, shown under the title on the card and on the performance display. Stored in the song book with the colour, so it follows the song through renames and moves and never touches the Live project.
- **Why a fork**: AbletonOSC sends every reply and every listener update to one fixed port, 11001, so only one client per machine could hear it — RC Surface and RC Setlist in the same Live could not both work, and the loser showed "OSC return port busy". RC Bridge listens on its own port (11020, so a stock AbletonOSC can keep running beside it), replies to whichever socket asked, and publishes each listener's updates to every subscriber, with one Live listener per property and a 60-second lease that forgets clients that went away. It also stops logging every property read at INFO, which had grown one owner's log to 34 million lines. The extension probes for RC Bridge first and falls back to a stock AbletonOSC when it is absent, and the panel's OSC line says which one it is talking to (`via RC Bridge 1.0.0 on port 11020`).

### Changed

- **Command Bus and Error Sanitization**: the command bus now attaches operator-facing error messages (`OperatorError` and `ProfileError`) to `command_status.error`, while internal exceptions (such as raw filesystem paths) remain strictly sanitized and arrive as generic `execution_failed`.
- **Locator Tag Parsing Cleaned Up**: tag extraction and section construction were refactored into a single coherent pipeline without duplicated branches.

### Fixed

- **Song Book Cache Follows Active Profile**: song colors and notes are cached per profile; switching profiles now clears the cache immediately, preventing one profile's edits from leaking into another.
- **MCP Sync Tick Logs Unexpected Failures Quietly**: bridge connection timeouts/refusals stay silent as expected when the MCP is absent, while internal callback errors log cleanly.
- **Dead Code and Orphaned Tests Removed**: retired test-session locator creation utilities and orphaned tests were removed cleanly.

## [0.6.1] - 2026-09-12

### Changed

- **The Count-In Is Sounded In the Browser**: It used to rewind Live's playhead one bar and start the transport there. That bar is real arrangement time belonging to the previous song, so the count ran at the previous song's tempo and that bar's audio played — starting a 160 BPM song after a 110 BPM one counted at 110. Making the count audible also meant switching Live's metronome on, which overrode a click the operator had deliberately switched off. The count is now browser audio at the tempo the setlist declares for the playhead, Live starts on the beat it was already sitting on, and its transport and metronome are never touched to produce it. Play is sent shortly before the last beat so the transport arrives on the downbeat; pressing Play again during the count starts immediately, and Stop cancels it. The "count-in shortened" warning is gone with the rewind that caused it.

### Fixed

- **An Empty Live Set Clears the Previous Songs**: A valid empty SDK cue list now clears the displayed songs and locator targets, including when the last locator is deleted. Unavailable data and read errors still preserve the last valid snapshot.
- **OSC Tests No Longer Intercept Live Commands**: The test mock now uses an ephemeral loopback port, supports the current Play command, and has bounded waits and socket cleanup. A stranded mock on Live's command port caused the alternating real and fabricated song lists; the earlier attribution to SDK placeholder data was incorrect.
- **Stop No Longer Fires an Abandoned Jump**: A jump waiting for its quantization boundary stayed armed through Stop, and the scheduler executes a pending jump as soon as a reported position passes its landing beat. Live's Stop moves the playhead, so the next sample after Stop could carry the transport off to a section the operator had already changed their mind about — arriving as a jump to a seemingly random part of the set, seconds after Stop. Stop now disarms it. Stop itself is unchanged — it is exactly Live's `stop_playing`.
- **A Stopped Jump Moves the Playhead Immediately**: Live is only told to jump, and where the playhead actually is comes back on the position poll up to half a second later. The count-in counts at the tempo declared at the playhead, so jumping to a section and pressing Play straight away counted at the tempo of wherever the playhead had been — the rehearsal case the count-in exists for. While stopped, the jump target is adopted at once.
- **Play Plays From Where You See the Playhead**: Live offers two starts and neither is "from the playhead". `start_playing` begins at the start marker, which a cue jump or an Arrangement click while stopped moves but a stop does not; `continue_playing` resumes where the transport last came to rest and ignores everything done to the playhead since — a cue jump while stopped, a click, a written position (all measured on Live 12.4). An earlier fix in this cycle switched Play to `continue_playing`, which cured Play after Stop rewinding to the start marker but made "jump to a section while stopped, then Play" resume where the transport had stopped instead. Play now resumes when the playhead has not moved since the transport stopped, and starts from the start marker when a jump or a click moved it. The small forward drift a stop shows while its last samples settle is not a relocation; a running transport always continues, since `start_playing` would restart it.
- **A Quantized Jump Lands on the Beat the Page Announces**: while playing with quantization on, the cue jump was sent when this side's clock passed the landing beat — just past Live's grid line — and Live, which quantizes cue jumps to its next grid line, landed it a full quantization period later. Every quantized jump arrived one bar after the page said it had. The jump is now handed to Live the moment it is requested and Live lands it on the very grid line the page shows; the landing sample applies the destination's tempo and loop. Live cancels an armed cue jump on Stop (measured on Live 12.4), so Stop's `jump_cancelled` stays truthful.
- **The First Play After Start-Up Resumes Where Live Is**: the SDK reports the tempo every 100ms from the moment the extension starts, and that report was routed through the transport update, presenting a position of zero as the first stopped observation. The first real position then read as a relocation and Play would have started from Live's start marker. Tempo-only reports now have their own path.
- **A `[next]` Marker at the End of a Song Actually Skips the Gap**: `[next]` and `[skip]` were executed through Live's cue jump, which Live quantizes to the global launch quantization: measured on the owner's set, NEXT fired at beat 872.3 and Live jumped at 876.0, the next bar line. For a `[next]` placed where a song's audio ends and followed by one empty bar — the reason the tag exists — the jump landed exactly where the next song was starting anyway, so the marker appeared to do nothing, and a two-bar gap only lost one bar. Both tags now relocate the playhead directly, which Live does at once: the hand-over happens about a tenth of a second after the marker is crossed (position poll plus AbletonOSC's command tick), never before it, and the next song starts from its first beat. Arming Live's quantized jump a bar early would be sample-exact, but AbletonOSC exposes no bar phase, so a marker off Live's grid — a time-signature change earlier in the set is enough — would have Live jump *before* the marker and cut the end of the song; being a tenth of a second late is the safe side of that. The OSC-only transport path, which a set-up without the Ableton MCP uses and which the owner's own machine never exercises, now has an end-to-end regression test for this.
- **The Song List No Longer Rebuilds Every Two Seconds**: cues arrive from the Live SDK every 100ms and from AbletonOSC every 2000ms, and the two do not agree to the last decimal. The manager compared exact floats while its callers compared a fingerprint quantized to 1/100 of a beat, so each source looked like a change to the other: every OSC poll reparsed the setlist and the client rebuilt the whole song list, which on screen is the page flickering. The manager now uses the same quantized fingerprint — a difference below 1/100 of a beat cannot change how a locator parses. Independently, the renderer now compares the markup it builds against what is on screen and leaves the DOM alone when they match, so nothing upstream can throw away the list, its scroll position, or the card under a finger.
- **The Beat Flash No Longer Forces a Full Layout**: the tempo card restarted its CSS animation by reading `offsetWidth`, which flushes layout for the whole document — twice a second at 120 BPM, on a page holding twenty songs and a couple of hundred section chips, and regardless of whether the click was on. As the cards grew badges, an identity band and a colour wash, the cost of that per-beat reflow grew with them. Both stage views now flash through the Web Animations API, which invalidates no layout and recycles a single animation instead of leaving one behind on every beat.
- **The Tools Menu Fits Its Labels**: the popover was a fixed 11rem box while its grid column sized to the widest label, so "Mapeamento de Teclado" pushed every button past the right edge and the border cut across them. The popover is now sized by its widest label, capped to the viewport.
- **Native Select Lists Are Readable**: the setlist picker's dropdown opened as a white list with near-white text, because Chromium paints the option list from the select's own background and that select is drawn transparent over the dark control. Every native select now paints its options dark.
- **The Help Guide Tells [next] and [skip] Apart**: the two rows read alike. The guide now says where each tag takes the playhead, that [next] never advances to the next section, that both hand over at the marker rather than on the next bar, and shows the chaining case — an end marker with [next] followed by the next song.
- **The Count Digit Replaces the Play Triangle**: it was drawn over the glyph, leaving both visible at once.
- **A Second Press Silences the Count**: cancelling cleared the timers, which stopped the digits changing, but the blips were already scheduled on the audio clock and kept sounding underneath the playback that second press had started.
- **Song-Level Tags Fire Again**: The automation evaluator chose one target, `section || song`, so once the playhead was inside any section the song's own tags were never read again. A song-level `[stop]`, `[next]`, `[skip]`, `[loop]`, `[bpm]` or `[click]` therefore only fired in the gap between the song's locator and its first section, and when a section began on the song's own beat — the ordinary case — it never fired at all. The marker editor offers STOP, NEXT and SKIP on the song panel, so this was a control the user could set and watch do nothing. Song and section tags are now evaluated independently: the song's fire once when the song is entered and are not renewed at each section boundary, the section's fire on their own entry, and a section declaring the same tag is applied last so the more specific value wins. A song-level `[skip]` leaves the song rather than skipping into its own first section.

## [0.6.0] - 2026-09-08

### Added

- **Tempo Automation Safety**: A new **Set Live tempo on jump** panel toggle, **off by default**. Explicit jumps used to write the destination `[bpm]` into Live, which overrides tempo automation drawn in the Arrangement — Live then stops following its own envelope until you press Re-Enable Automation. RC Setlist now also detects automation on its own, by comparing the tempo Live reports against the tag declared at that point, and refuses to write the tempo when they diverge, even if the toggle is on. Tagging songs for accurate durations is now safe alongside Arrangement tempo automation.

- **Duration Confidence & Estimation Indicators**: Stage Control, Performance view, and the Live panel now display an `EST.` badge whenever a setlist does not contain explicit `[bpm N]` locator tags, alerting operators that durations are uniform estimates rather than exact piecewise calculations.
- **Dedicated Lyric Typography**: Sung lyrics now use self-hosted **Barlow Semi Condensed** (`--ui-font-lyric`), fitting ~45% more lyrics per line on phones and tablets without sacrificing legibility or clipping uppercase accents.
- **Stage Design System Alignment**: Public landing page and documentation now share the core brutalist design tokens, zero-radius geometry, and self-hosted **Martian Mono** typography of the live performance views.

### Changed

- **Piecewise Multi-Tempo Duration Engine**: Setlist timing calculation has been thoroughly overhauled for precision:
  - Untagged songs inherit tempo from the nearest preceding tagged song rather than falling back to the Live session tempo.
  - Songs without an initial tag inherit tempo from their first tagged section.
  - Sections with distinct `[bpm N]` tags calculate exact individual segment durations instead of projecting a single tempo across the whole song.
  - Tempo carries across song boundaries from the *last* tempo event in the preceding song.
  - Mid-song section tags no longer retroactively alter the tempo of earlier sections.
  - Total show duration is summed from exact fractional seconds rather than accumulating rounded integer values.
  - CSV exports and elapsed show clocks reference the stable `durationBpm` basis, preventing clocks from drifting or stalling when the live tempo knob moves.
- **Stage Transport Visibility**: The Play button now uses solid block inversion and non-chromatic SVG icon swaps (play/pause) instead of diffuse glowing shadows, maintaining clear visual state under bright or saturated stage lighting.
- **Mobile Touch Safety**: Button hover states are now guarded by `@media (hover: hover) and (pointer: fine)` to prevent mobile browsers from sticking on pressed button styles after tapping.
- **Font Weight & Accent Clearance**: Removed low-level `wght` overrides in `font-variation-settings` to restore standard CSS `font-weight` rendering across the application. Added accent-safe line heights (`--ui-line-accent-safe`) to prevent diacritics (such as `Ç` and `Ã`) from clipping.

### Fixed

- **Marker Editor Replaces Raw Text Editing**: Double-clicking a song or a section now opens a form where every tag is a control, and the whole song header is the target rather than the title alone. The raw text field it replaces exposed the name and its tags together, and a `[bpm]` tag — the one that feeds the show duration — could be deleted with a stray keystroke. A tag the panel does not display is carried through untouched, tags are compared by meaning rather than by text so a save that changes nothing writes nothing, and `[hidden]` and `[ignore]`, which remove a marker from the setlist entirely, are no longer switchable from the panel.
- **Section Prefixes Are Preserved**: Saving a section no longer rewrites its locator prefix. Live accepts both `> VERSO`, where a section belongs to the song locator above it, and `JÚLIA > VERSO`, which names the song outright; the editor used to rebuild the second form unconditionally and renamed every section it touched in a set written in the first.
- **Locator Renames Happen In Place**: A rename used to delete the cue point and create a replacement, because that is how the raw Live API expresses one — a cue point is made by toggling one at the playhead, so a delete that silently failed turned the create into a second delete and the marker disappeared. It also left a window with no marker at the position at all. The bridge renames in place instead, and Live's own cue list is read back afterwards rather than the bridge's word being taken for it.
- **Locator Edits Are Blocked While Playing**: A rename moves the playhead to the cue's position to act on it, so with the transport rolling Live services the write wherever playback has advanced to and the marker lands at the wrong beat. This is now refused in every mode, at the moment of the write as well as when the editor opens.
- **Song Colours Repaint Immediately**: Assigning a colour changes no setlist structure, so the list's render fast path skipped it and the colour did not appear until the next structural change.
- **Song Colour Is Legible From a Distance**: The colour now fills an 8px identity band down the leading edge of the card as well as the number chip. It sits inside the 4px state bar rather than replacing it, so a playing song shows both its state and its identity at once.
- **A Way Back From a Section**: Opening a section from the song panel replaced it with no route back to the song it belongs to.
- **Sixteen Song Colours, Arranged as a Matrix**: The palette doubled and is now laid out as eight columns by two rows. Hue climbs across each row — warm, yellow, green, cyan, blue, purple, back to red, neutral last — and tone deepens down each column, so two colours that read apart on a dark stage are two that sit apart on the strip. The lower row is not the upper row darkened: its hues fall between the ones above, giving fifteen distinct hues plus two neutrals. Every colour stays under 0.35 saturation, because desaturation is what separates identity from state. The original eight are unchanged hex for hex, so a colour already assigned to a song keeps its paint.
- **The Marker Panel Fits Its Content**: A song with a dozen sections showed four at a time behind a scrollbar. The panel is wider, sections flow into as many columns as fit, and the short fields — tempo, loop, times, click — pair up instead of stacking, which also keeps Save on screen in a short window. Narrow viewports still get a single column.
- **Card Washes Run In Opposite Directions**: The ACTIVE wash faded from the leading edge inward, burying the identity band and the state bar — the two hard marks the eye uses to find a card. It now enters from the trailing edge instead. A song colour lays a faint wash of its own from the leading edge, continuing out of the band and the number chip so the three read as one mark, and the two washes meet head-on rather than smearing together.
- **The Jump Ring Clears the Title**: The song header carries no padding of its own, so the inset ring drawn while a jump is armed landed flush against the text and read as a box cutting through it.
- **`[skip]` and `[click]` Are Visible**: Both tags changed what happens on stage while leaving no mark on the card, so setting one and seeing nothing appear read as a save that had failed. Every tag the marker panel can write now has a badge.
- **Locator Edits Refresh Immediately**: Cue points are polled every two seconds. For up to two seconds after a rename the client still held the previous name, so reopening the marker straight away showed stale values and the next save wrote them back — the earlier edit looked randomly dropped, when it only depended on how fast the user was. The cue list is now pulled back as soon as a rename lands, the rename is verified against Live rather than assumed, and a marker whose save is still in flight cannot be reopened.
- **Panel No Longer Closes Mid-Edit**: A click event fires on the common ancestor of the press and the release, so selecting text in a field and releasing past the panel edge counted as a click on the backdrop and dismissed the panel. Dismissal now requires the press to start on the backdrop as well.
- **12px Stage Readout Floor**: Enforced the 12px minimum font size floor (`--t-stage-micro`) across all stage readouts and metadata cards.

## [0.5.1] - 2026-08-14

### Added

- **Keyboard Mapping Support**: You can now map keyboard keys (like Numpad or Alphanumeric) to stage transport controls, making page turns and song navigation much easier without relying on touch or mouse.
- **Count-in Pre-roll Toggle**: Added `COUNT-IN 1 BAR` beside Click in Stage Control. You can now toggle the 1-bar pre-roll count-in directly from the setlist HUD. From stopped transport, Play now optionally uses Live's native metronome and transport for a one-bar pre-roll.
- **Enhanced Transport Controls**: Added explicit song and section transport controls, mobile hold-to-select and hold-to-reorder for songs and sections, and a setlist-relative `SHOW` and `SONG` time display in place of the raw Arrangement coordinate.
- **Inline Section Edit**: Double-click section tags in the desktop setlist for fast text editing.
- **[ws] Protocol Version 3**: Added shared `preRollEnabled` state in `protocolVersion 3` for the process-scoped one-bar count-in toggle; `profiles_state` remains version 2.

### Changed

- **Improved Mobile Transport Safety**: Improved mobile transport safety by requiring a firm touch hold to execute song jumps.
- **Decoupled Show Clock**: Decoupled the show clock and absolute timeline progress from real-time Live BPM automations.
- **Tempo Write Boundary**: Explicit jumps now apply the destination BPM before the cue jump: a section BPM overrides its song BPM, with an SDK-first tempo write and an AbletonOSC fallback at the existing execution boundary. The tempo write and cue jump are sequential, not atomic; use native Arrangement tempo automation at the destination for sample-accurate transitions.

### Fixed

- **Pre-roll Acknowledge Barrier**: Count-In no longer waits for Live to acknowledge the pre-roll before starting playback. The count-in now sends the temporary Click, the position and Play in one ordered burst, decides Click restoration from playhead samples alone, and treats any observed stop as the end of the pre-roll.
- **Elapsed Show Time Calculation**: Elapsed show and song time no longer move backwards when the tempo changes. Song durations are derived from each song's declared BPM.
- **WebSocket Boundaries**: Hardened WebSocket boundaries and internal command routing to resolve dropping successive fast events.

## [0.5.0] - 2026-08-01

### Added

- Field-tested compatibility between explicit `Song > Section`, relative
  `> Section`, legacy song/tag-only locators and `[ignore]` technical markers.
- A truthful one-row-per-song CSV with active `setlist`, `start_beat`, declared
  BPM, numeric/readable duration, `sections_count`, named sections,
  `automations` and saved lyric-line count.
- Bilingual final release notes and a complete 0.5.0 installation kit.

### Changed

- Promoted the compact responsive Stage Control, profiles, lyrics, transport,
  duration and automation behavior from the rehearsed 0.4.2 local candidate.
- Removed CSV placeholders for signature, key, plays, custom order, setlist
  membership, cue count and last-played history because the runtime did not own
  reliable values for those fields.
- Isolated project-detector test mode from the live MCP bridge so an open
  Ableton project cannot change a test's profile scope.

### Fixed

- CSV exports now identify their active setlist and include actual named
  sections, automation-only locators and locator actions instead of empty
  columns.
- A delayed lyrics confirmation closes an open editor but never reopens an
  editor the operator already dismissed.

## [0.4.2] - 2026-08-01

> Local test candidate for Ableton verification; this is not a published release.

### Added

- Relative section locator syntax `> Section` attached to the preceding song
  (for example `> Intro` and `> Chorus [loop 4x]`) plus relative automation
  markers that remain inside the active song.
- Explicit `[ignore]` locator tags for technical Arrangement markers that must
  not become songs, sections or automation actions.
- Clearer discovery tooltips and documentation for Manage Setlists at the top of Stage Control (explaining that profile mutations require Live stopped).
- Detailed CSV export toast and tooltips clarifying that tracklists download to browser Downloads and save a copy in active profile `exports/`.

### Changed

- Preserved the complete 0.4.1 Stage Control visual layout while narrowing
  transport-only DOM updates and caching chronological setlist derivations.
- Added bounded WebSocket heartbeat monitoring and stable-content log
  deduplication without changing the existing 512 KiB drop and 2 MiB disconnect
  backpressure limits.
- Made production builds fail on missing static assets, define production mode
  explicitly and self-host the Inter webfont used by the landing page.
- Replaced ad-hoc certificate scanning with validity, SAN and private-key checks
  using Node's X.509 APIs.

### Fixed

- Lyrics edits and synchronized buffers now remain available until the matching
  persistence command is confirmed; failures, disconnects and timeouts no longer
  report a false save.
- WebSocket messages are decoded into canonical commands before dispatch, with
  bounded priority handling and safety revalidation immediately before execution.
- Reorder, lyrics, CSV and click-preview writes now use project-scope snapshots
  and atomic replacement so a late profile switch cannot receive stale output.
- Test-session locator checks now distinguish a sent OSC packet from a locator
  actually observed in Ableton Live.
- Removed invalid classic loading of helper modules while retaining every module
  asset in the package.
- Shutdown now drains the command bus and pending event log before local test
  storage can be removed.

### Security

- Controller tokens are removed from the visible URL after safe local storage,
  encoded token keys are redacted in HTTP logs, and async request failures return
  a controlled response without exposing resolver details.

## [0.4.1] - 2026-07-29

### Added

- Song duration on every Stage Control song card and total setlist duration in
  the header, using chronological Arrangement boundaries.
- Complete Stage Control profile management: create, select, rename, recoverable
  delete and restore with stable UUIDs and profile data.
- Explicit first-connection guidance for the expected local self-signed
  certificate warning in both languages.
- Compact Live-panel OSC diagnostics with stopped, waiting, connected,
  interrupted and OSC return-port-busy states.
- One shared song selector above Create, Sync and Edit in the Lyrics dialog.

### Changed

- Profile removal is recoverable only: inactive profiles move to local trash,
  active/only profiles are protected, exact-name confirmation is required and
  all profile mutations require controller permission with stopped transport.
- Profiles are scoped to the current Live Set: one saved `.als` can own multiple
  setlists without showing profiles from another Ableton project. The former
  global registry remains preserved as a local legacy backup.
- `[ws]` `profiles_state` version 2 preserves the previous profile fields and
  adds `deletedProfiles` plus `canMutate`.
- `[ws]` Setlist state metrics `durationSeconds` and `totalDurationSeconds` are optional;
  `arrangementEndTime` and `protocolVersion` also remain
  compatible with clients that ignore unknown fields or receive no final boundary.
- Duration estimates include transition gaps and use the next song or Arrangement
  end as the boundary; tempo automation inside a span is not integrated.
- HTTPS transport and URL schemes are unchanged. Session View support remains
  deferred; 0.4.1 continues to use Arrangement locators.
- AbletonOSC installation guidance now distinguishes
  `User Library/Remote Scripts/AbletonOSC` from Live's hidden
  `User Remote Scripts` preferences folder and verifies
  `AbletonOSC/__init__.py`.
- Certificate, installation-path and detailed OSC recovery explanations now
  stay in installation/troubleshooting documentation instead of occupying the
  compact Live panel.

### Fixed

- Tag-only `[stop]` and `[loop]` locators are now automation sections of the
  preceding song instead of blank song cards.
- Newly discovered Arrangement songs are inserted at their chronological
  position while preserving the user's saved custom order.
- The Live panel no longer lets its footer cover the two
  **Open on this computer** links, and late translation no longer changes a
  running server label back to `Server stopped`.
- Mobile rename fields keep their focus, draft text and keyboard while normal
  Live transport updates continue; Enter can confirm the rename.
- Legacy per-project lyrics/order are imported only when their saved Ableton
  Project matches the current Live Set, instead of listing every historical
  project in Manage Setlists.
- Requested quantization now becomes the local jump-scheduler authority
  immediately, so `None` no longer falls back to `1 bar` when the OSC reply port
  is occupied.
- The single-flight MCP fallback now supplies transport observation and the
  Arrangement end used by Total Duration without building a delayed request
  backlog.
- A temporary project scope is promoted when saved-set metadata arrives late;
  additional profiles such as `Second Setlist` and compatible legacy lyrics are
  copied without deleting or overwriting their recoverable sources.
- Recent MCP transport observations now take clock authority over delayed OSC
  playhead replies, preventing a one-frame Bars/Beats/Sixteenths rollback while
  retaining automatic OSC fallback when MCP becomes stale.
- The Stage Control Bars/Beats/Sixteenths label now rejects small backward poll
  corrections during playback, eliminating boundary flicker without delaying
  real cue jumps, loops or stopped-position changes.
- Stage Control now disables its language selector while Live is playing or the
  panel is locked, and resolves the localized lock warning every time it opens.
- The Lyrics dialog now keeps one active-song selector above Create, Sync and
  Edit; editor requests for other songs can no longer replace the synchronized
  lyrics shown for the song currently playing, and closing/reopening the dialog
  preserves an unsaved edit buffer.

### Security

- Language preferences remain local; no account, telemetry or external service
  was added.
- The public snapshot continues to exclude owner-only media, SDK/CLI archives,
  tokens, certificates, local profiles and real show content.

## [0.4.0] - 2026-07-26

### Added

- English and Brazilian Portuguese interfaces in a single `.ablx`, with English
  as the default language and a persistent local language selector.
- Bilingual GitHub Pages landing page at the existing canonical URL.
- Complete PT-BR installation, user, troubleshooting and FAQ documentation.
- English and PT-BR release checklists and installation-kit navigation.
- Matching English/PT-BR product screenshots generated from the real interfaces.

### Changed

- The Live panel, Stage Control and Performance views share one translation
  contract while leaving song, section, lyric and chord content untouched.
- Public landing artwork now uses locale-specific 16:9 images without cropping
  or stretching.
- The installation kit now contains one installer and separate `en/` and
  `pt-BR/` documentation folders.

### Security

- Language preferences remain local; no account, telemetry or external service
  was added.
- The public snapshot continues to exclude owner-only media, SDK/CLI archives,
  tokens, certificates, local profiles and real show content.

## [0.3.0] - 2026-07-26

### Added

- Public source-available release under PolyForm Noncommercial 1.0.0.
- Sanitized fictional demonstration set and automated content checks.
- Public dependency/test gate that does not redistribute Ableton SDK or CLI archives.
- Complete installation, user, tester, development, privacy, security and support documentation.
- GitHub Pages landing page and deterministic local installation kit.
- Generated third-party notices and release-surface verification.

### Changed

- Product name standardized as Ableton RC Setlist.
- Fixed product interface copy standardized in English for the international release.
- Fresh installations now use `Main Setlist` as the default profile while preserving legacy `Setlist Principal` profiles.
- Development floor updated to Node.js 24.16.0 in the Node 24 LTS line.
- `osc-min` updated to 2.1.2 and `ws` updated to 8.21.1.
- Public source history starts from a sanitized snapshot rather than the private development history.

### Fixed

- First-run profile initialization no longer depends on `structuredClone`, which is unavailable in Ableton's embedded runtime.
- Outgoing OSC transport, navigation, click and refresh commands no longer depend on global `TextEncoder`/`TextDecoder` support.
- Existing lyrics and custom order are migrated without overwriting data when upgrading from the previous extension storage identities.
- Previous installations using either the English or legacy Portuguese default profile name migrate into the active profile without duplication.

### Security

- Removed private Ableton SDK/CLI archives and local/internal materials from the public surface.
- Resolved the high-severity `brace-expansion` audit finding by removing the vulnerable private CLI dependency chain from the public lockfile.
- Added secret, content, archive and link verification gates.

## Private development history

Versions before 0.3.0 were internal development builds. Their implementation
details and artifacts are intentionally not part of the sanitized public history.
