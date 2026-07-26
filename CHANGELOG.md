# Changelog

All notable public changes to Ableton RC Setlist are recorded here.

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
