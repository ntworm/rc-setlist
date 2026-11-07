# RC Setlist

[![PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-orange)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.0-f97316)](CHANGELOG.md)
[![CI](https://github.com/ntworm/rc-setlist/actions/workflows/ci.yml/badge.svg)](https://github.com/ntworm/rc-setlist/actions/workflows/ci.yml)

**English** · [Português (Brasil)](README.pt-BR.md)

[Landing page and screenshots](https://ntworm.github.io/rc-setlist/)

RC Setlist is an extension for Ableton Live 12 that runs the setlist of a show
from the Arrangement. It reads the Arrangement locators of a Live Set and shows
them in the browser: a setlist for the operator (Stage Control) and a read-only
display for the band (Performance). The timing comes from Live.

> **Network safety:** RC Setlist serves browser controls on your local network.
> Use it only on a trusted LAN, keep the controller URL and token private, and
> never expose port `4444` directly to the public internet. See
> [SECURITY.md](SECURITY.md).

## Requirements

- Ableton Live 12.4.5+ Suite (Beta) with Extensions support.
- RC Bridge, the bundled Remote Script (a fork of
  [AbletonOSC](https://github.com/ideoforms/AbletonOSC)), selected as a Live
  Control Surface for transport and Live Object Model operations.
- Node.js 24.16.0 or newer in the Node 24 LTS line, only when developing from
  source. End users install the `.ablx` and do not need Node.js.

Windows is the validated release platform. macOS support remains experimental
until it is exercised on real macOS hardware.

## Install

1. Install RC Bridge: run the kit's `Install-RC-Bridge.cmd` (Windows) or
   `Install RC Bridge.command` (macOS), then choose RCBridge as a Control
   Surface in Live.
2. Download `RC-Setlist-1.1.0.ablx` and the installation kit from the
   [1.1.0 release](https://github.com/ntworm/rc-setlist/releases/tag/v1.1.0).
3. If RC Setlist is already installed, remove it in Live's extension settings
   (Live refuses to install over an existing extension folder; your data folder
   stays). Then open the `.ablx` and approve the installation in Live.
4. In Live, open **Extensions > RC Setlist** and start the server. Open the
   panel URL or the QR code to reach `/setlist` or `/performance`.
5. To remove the certificate warning, scan the **Certificate** QR in the panel
   once and follow the steps on that page.
6. Press **EN** or **PT** at the top right of the panel to choose English or
   Brazilian Portuguese.

Data in the `RC-Setlist-1.0.0.ablx` layout runs without migration. To move data
from the 0.x layout (`Ableton-RC-Setlist-0.4.x`–`0.7.0`), run the kit's
`Migrate-RC-Setlist-Data.cmd` (Windows) or `Migrate RC Setlist Data.command`
(macOS) once before opening Live; the script copies profiles, project setlists
and preferences into the 1.x layout and leaves the old folder untouched.

Full instructions are in [docs/INSTALL.md](docs/INSTALL.md).

## How it works

RC Bridge, the Remote Script that ships with the extension, is the Live side of
the link:

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

Songs and sections come from the locators. The supported tags are `[loop]`,
`[loop Nx]`, `[stop]`, `[next]`, `[bpm N]`, `[click]`, `[click off]`, `[skip]`
and `[hidden]`.

```text
Neon Signal [bpm 122] [click]
Neon Signal > Intro
Neon Signal > Chorus [loop 2x]
Neon Signal > Outro [stop]
```

All examples in this repository are fictional. See
[examples/README.md](examples/README.md) for a complete demonstration set.

## Features

- Both pages run in a desktop, notebook, tablet or phone browser on the
  network.
- Synchronized `.lrc` lyrics, with the timing and the editing in the browser.
- Guarded transport with a 500 ms hold on the buttons, quantization feedback
  and counted-loop handling.
- Per-profile ordering, lyrics and CSV export, stored locally.
- Multiple saved setlists scoped to the current Ableton Live Set.
- Song durations and total setlist duration calculated from the Arrangement.
- Fullscreen stage mode with Screen Wake Lock when the browser supports it.
- English and Brazilian Portuguese interfaces in the same `.ablx`.
- Keyboard Mapping for assigning transport and view actions to Numpad or alpha
  keys.
- No account, cloud sync, analytics or telemetry.

## What is new in 1.1.0

Full details in the [1.1.0 release notes](docs/RELEASE-NOTES-1.1.0.md).

- **Live panel.** Three tabs, Main, Setlists and Network: the QR code, the
  active setlist and the second computer.
- **Setlist management in the panel.** Activate, rename, delete, create and
  restore setlists while the transport is stopped.
- **Setlist packages.** Export all the setlists of a Live Set to one
  `.rcsetlist` file and import them again.
- **Second computer.** Pair a second computer running Live with a six-digit
  code; the transport commands are sent to it.
- **Collapsible song list.** Collapse the sections of a song, fold or unfold the
  whole list, hold the song name to jump and drag the grip to reorder.
- **Local certificate.** The extension creates a certificate authority for this
  computer, valid for localhost and private network addresses, and the Network
  tab shows a QR code for the install page on port `4445`.
- **Network address.** The QR code uses the address of the default route.

## Documentation

- [Documentation index](docs/README.md)
- [Getting started](docs/GETTING-STARTED.md)
- [Installation](docs/INSTALL.md)
- [User guide](docs/USER-GUIDE.md)
- [What is new in 1.1.0](docs/RELEASE-NOTES-1.1.0.md)
- [What is new in 1.0.0](docs/RELEASE-NOTES-1.0.0.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Frequently asked questions](docs/FAQ.md)
- [Tester guide](docs/TESTER-GUIDE.md)
- [Develop from source](docs/DEVELOPMENT.md)
- [Contracts](docs/CONTRACTS.md)
- [Release history](docs/HISTORY.md)
- [Theme contract](docs/THEME_CONTRACT.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Privacy](PRIVACY.md)
- [Security](SECURITY.md)
- [Support](SUPPORT.md)
- [Contributing](CONTRIBUTING.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Development

```bash
npm ci
npm run ci:public
```

The extension is local-first. The SDK-facing files are at the boundary, and the
parser, state, transport policy, persistence and browser clients are testable
through the public dependency gate.

The Ableton SDK and CLI are not redistributed in this source repository.
Authorized developers can configure a complete build using
[vendor/README.md](vendor/README.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

The installation kit is built with `npm run package:kit`. It writes
`release-candidates/RC-Setlist-1.1.0-Installation-Kit.zip` with the `.ablx`,
the `START-HERE.html` page, the `README.txt` instructions, the `RC-Bridge/`
installers, the 0.x migration scripts and the documentation folders `en/` and
`pt-BR/`.

## License

RC Setlist is source-available under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Noncommercial use,
modification and redistribution are permitted under its terms; commercial use
is not permitted. This is not an OSI-approved open-source license.

Required Notice: Copyright © 2026 Gabriel Worm<br>
<https://github.com/ntworm/rc-setlist>

Ableton and Ableton Live are trademarks of Ableton AG. RC Setlist is an
independent project and is not affiliated with or endorsed by Ableton AG.
