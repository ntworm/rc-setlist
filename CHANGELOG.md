# Changelog

All notable public changes to Ableton RC Setlist are recorded here.

## [0.3.0] - Unreleased

### Added

- Public source-available release under PolyForm Noncommercial 1.0.0.
- Sanitized fictional demonstration set and automated content checks.
- Public dependency/test gate that does not redistribute Ableton SDK or CLI archives.
- Complete installation, user, tester, development, privacy, security and support documentation.
- GitHub Pages landing page and deterministic local installation kit.
- Generated third-party notices and release-surface verification.

### Changed

- Product name standardized as Ableton RC Setlist.
- Development floor updated to Node.js 24.16.0 in the Node 24 LTS line.
- `osc-min` updated to 2.1.2 and `ws` updated to 8.21.1.
- Public source history starts from a sanitized snapshot rather than the private development history.

### Fixed

- First-run profile initialization no longer depends on `structuredClone`, which is unavailable in Ableton's embedded runtime.
- Outgoing OSC transport, navigation, click and refresh commands no longer depend on global `TextEncoder`/`TextDecoder` support.
- Existing lyrics and custom order are migrated without overwriting data when upgrading from the previous extension storage identities.

### Security

- Removed private Ableton SDK/CLI archives and local/internal materials from the public surface.
- Resolved the high-severity `brace-expansion` audit finding by removing the vulnerable private CLI dependency chain from the public lockfile.
- Added secret, content, archive and link verification gates.

## Private development history

Versions before 0.3.0 were internal development builds. Their implementation
details and artifacts are intentionally not part of the sanitized public history.
