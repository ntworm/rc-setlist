# Changelog

All notable public changes to Ableton RC Setlist are recorded here.

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
