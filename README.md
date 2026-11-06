# RC Setlist

[![PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-orange)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.0-f97316)](CHANGELOG.md)
[![CI](https://github.com/ntworm/rc-setlist/actions/workflows/ci.yml/badge.svg)](https://github.com/ntworm/rc-setlist/actions/workflows/ci.yml)

**English** · [Português (Brasil)](README.pt-BR.md)

> **[Landing page and screenshots](https://ntworm.github.io/rc-setlist/)**

**RC Setlist** is a setlist, synchronized-lyrics and stage-display extension for
**Ableton Live 12**. It turns Arrangement locators into a setlist the operator
runs from a laptop or tablet (Stage Control) and a read-only stage display for
the band on any phone (Performance), with synchronized lyrics, tempo and click
feedback, and guarded transport controls for rehearsals and live shows. It is
free for noncommercial use and source-available.

[Landing page](https://ntworm.github.io/rc-setlist/) ·
[Installation](docs/INSTALL.md) ·
[User guide](docs/USER-GUIDE.md) ·
[Português (Brasil)](README.pt-BR.md) ·
[1.1.0 pre-release](https://github.com/ntworm/rc-setlist/releases/tag/v1.1.0) ·
[Stable 1.0.0](https://github.com/ntworm/rc-setlist/releases/tag/v1.0.0)

> **1.1.0 is a pre-release for testing.** It adds a second computer that
> follows the show, a song list that folds, the phone certificate and a QR
> that finds the right network. 1.0.0 stays the stable version until 1.1.0 is
> promoted. See [what is new in 1.1.0](docs/RELEASE-NOTES-1.1.0.md).

> **Network safety:** RC Setlist serves browser controls on your local network.
> Use it only on a trusted LAN, keep the controller URL/token private, and never
> expose port `4444` directly to the public internet. See [SECURITY.md](SECURITY.md).

## New in 1.1.0

- **Two computers, one show.** Pair a second computer running Live from the
  panel with a six-digit code. Play, Stop, jumps, metronome, quantization,
  count-in, refresh and panic are relayed to it; setlist and marker editing
  stay on the main computer. A second dot in the Stage Control header is
  green when it follows, amber when its markers differ and red when it does
  not answer.
- **A song list that folds.** The three dots beside a song name fold its
  sections; **Fold all / Unfold all** acts on every song. Hold the song name
  to jump; drag the grip on the right edge of the card to reorder, with a
  mouse or a finger.
- **The phone certificate.** The extension creates a certificate authority
  for this computer, valid only for localhost and private network
  addresses. The **Phone certificate** row in the panel shows a QR to a page
  on port `4445` where a phone installs it once; after that the browser stops
  warning.
- **The QR finds the right network.** The address in the QR is the one the
  system really routes through, so a computer with a lighting or audio
  network cable beside the Wi-Fi announces the Wi-Fi.
- The top bar keeps one row in both languages, reordering works on Windows
  again, saving no longer fails when Live refuses `fsync`, and pairing is
  pinned by key, so a new address on either side keeps the link.

## Highlights

- Locator-driven songs and sections with `[loop]`, `[loop Nx]`, `[stop]`,
  `[next]`, `[bpm N]`, `[click]`, `[click off]`, `[skip]` and `[hidden]` tags.
- Setlist and performance views for desktop, notebook, tablet and phone.
- Synchronized `.lrc` lyrics plus an in-browser timing and editing workflow.
- Guarded transport, quantization feedback and counted-loop handling.
- Per-profile ordering, lyrics and CSV export stored locally.
- Multiple saved setlists scoped to the current Ableton Live Set, with
  recoverable delete/restore.
- Song durations and total setlist duration calculated from the Arrangement.
- Fullscreen stage mode with Screen Wake Lock when the browser supports it.
- English and Brazilian Portuguese interfaces in the same `.ablx`.
- No account, cloud sync, analytics or telemetry.
- Keyboard Mapping for assigning transport and view actions to Numpad or alpha keys.
- A second computer that follows the show: pair it from the Live panel and
  the transport commands travel to it over a pinned link.
- A Live panel with three tabs, Main, Setlists and Network, where the QR code,
  the setlists and the second computer live together.
- Setlist packages: every setlist of a Live Set in one file, ready to import
  again.

## Requirements

- Ableton Live 12.4.5+ Suite (Beta) with Extensions support.
- RC Bridge, the bundled Remote Script (a fork of
  [AbletonOSC](https://github.com/ideoforms/AbletonOSC)), selected as a Live
  Control Surface for transport and Live Object Model operations.
- Node.js 24.16.0 or newer in the Node 24 LTS line only when developing from
  source. End users install the `.ablx` and do not need Node.js.

Windows is the validated release platform. macOS support remains experimental
until this release is exercised on real macOS hardware.

## Quick start

1. Install RC Bridge: run the kit's `Install-RC-Bridge.cmd` / `Install RC Bridge.command`, then choose RCBridge as a Control Surface in Live.
2. Download `RC-Setlist-1.1.0.ablx` and the installation kit from the
   [1.1.0 pre-release](https://github.com/ntworm/rc-setlist/releases/tag/v1.1.0).
3. Coming from 1.0, remove RC Setlist in Live's extension settings first
   (Live refuses to install over an existing extension folder; your data
   folder stays). Then open the `.ablx` and approve installation in Live.
4. In Live, open **Extensions > RC Setlist** and start the server.
5. Use the panel URL or QR code to open `/setlist` or `/performance`.
6. To stop the certificate warning, scan the **Phone certificate** QR in the
   panel once and follow the steps on that page.
7. Choose English or **Português (Brasil)** from the language menu.

Users upgrading from 0.x (`Ableton-RC-Setlist-0.4.x`–`0.7.0`) run the kit's
`Migrate-RC-Setlist-Data.cmd` (Windows) or `Migrate RC Setlist Data.command`
(macOS) once before opening Live with 1.0. The script copies profiles,
project-setlists and preferences into the new layout without touching the old
one. Users coming from 1.0 (`RC-Setlist-1.0.0.ablx`) have nothing to migrate.
On the first start, 1.1.0 signs a new server certificate with the
certificate authority of this computer, so a browser that accepted the old
certificate asks once more, or stops asking once the phone certificate is
installed.
Full instructions are in [docs/INSTALL.md](docs/INSTALL.md).

## Locator format

```text
Neon Signal [bpm 122] [click]
Neon Signal > Intro
Neon Signal > Chorus [loop 2x]
Neon Signal > Outro [stop]
```

All examples in this repository are fictional. See [examples/README.md](examples/README.md)
for a complete demonstration set.

## Architecture

```text
Ableton Live + RC Bridge (bundled fork of AbletonOSC)
          │ OSC 11020, replies to the asking socket
          │ (stock AbletonOSC on 11000/11001 still accepted)
          ▼
     RC Setlist extension
          │ local HTTP(S) + WebSocket :4444
          ├── /setlist       operator workspace
          └── /performance   stage display
```

The extension is local-first. The SDK-facing files sit at the edge; parser,
state, transport policy, persistence and browser clients are testable through
the public dependency gate.

## Development

```bash
npm ci
npm run ci:public
```

The Ableton SDK and CLI are not redistributed in this source repository.
Authorized developers can configure a complete build using
[vendor/README.md](vendor/README.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Documentation

- [Documentation index](docs/README.md)
- [What is new in 1.1.0](docs/RELEASE-NOTES-1.1.0.md)
- [Notas da versão 1.1.0 (pt-BR)](docs/pt-BR/NOTAS-DA-VERSAO-1.1.0.md)
- [What is new in 1.0.0](docs/RELEASE-NOTES-1.0.0.md)
- [Notas da versão 1.0.0 (pt-BR)](docs/pt-BR/NOTAS-DA-VERSAO-1.0.0.md)
- [Installation](docs/INSTALL.md)
- [User guide](docs/USER-GUIDE.md)
- [Português (Brasil)](docs/pt-BR/README.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Tester guide](docs/TESTER-GUIDE.md)
- [Development](docs/DEVELOPMENT.md)
- [Contracts](docs/CONTRACTS.md)
- [Privacy](PRIVACY.md)
- [Security](SECURITY.md)
- [Support](SUPPORT.md)
- [Contributing](CONTRIBUTING.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

RC Setlist is source-available under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Noncommercial use,
modification and redistribution are permitted under its terms; commercial use
is not permitted. This is not an OSI-approved open-source license.

Required Notice: Copyright © 2026 Gabriel Worm<br>
<https://github.com/ntworm/rc-setlist>

Ableton and Ableton Live are trademarks of Ableton AG. RC Setlist is an
independent project and is not affiliated with or endorsed by Ableton AG.
