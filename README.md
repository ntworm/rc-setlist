# RC Setlist

[![PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-orange)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.3.0-f97316)](CHANGELOG.md)
[![CI](https://github.com/ntworm/rc-setlist/actions/workflows/ci.yml/badge.svg)](https://github.com/ntworm/rc-setlist/actions/workflows/ci.yml)

**English** · [Português (Brasil)](README.pt-BR.md)

[Landing page and screenshots](https://ntworm.github.io/rc-setlist/)

RC Setlist is an extension for Ableton Live 12 that runs a show from the
Arrangement. Mark each song and section with a locator in Live, and RC Setlist
turns them into a setlist in the browser. The operator starts songs and jumps
between sections from a laptop or tablet; the band sees the current section, the
next song and the lyrics on their phones. A second computer running Live can
follow the first one over the local network.

> **Network safety:** RC Setlist serves browser controls on your local network.
> Use it only on a trusted LAN, keep the controller URL and token private, and
> never expose port `4444` directly to the public internet. See
> [SECURITY.md](SECURITY.md).

## Requirements

- Ableton Live 12.4.5+ Suite (Beta) with Extensions support.
- RC Bridge, the bundled Remote Script (a fork of
  [AbletonOSC](https://github.com/ideoforms/AbletonOSC)), selected as a Live
  Control Surface for transport and Live Object Model operations.

Windows is the validated release platform. macOS support remains experimental
until it is exercised on real macOS hardware.

## Install

1. Download `RC-Setlist-1.3.0.ablx` and the installation kit from the
   [latest release](https://github.com/ntworm/rc-setlist/releases/latest).
2. Install RC Bridge from the kit: run `Install-RC-Bridge.cmd` (Windows) or
   `Install RC Bridge.command` (macOS), then choose RCBridge as a Control
   Surface in Live.
3. If RC Setlist is already installed, remove it in Live's extension settings
   (Live refuses to install over an existing extension folder; your data folder
   stays). Then open the `.ablx` and approve the installation in Live. With two
   computers, install the same version on each.
4. In Live, open **Extensions > RC Setlist** and start the server. Open the
   panel URL or the QR code to reach `/setlist` or `/performance`.
5. To remove the certificate warning, scan the **Certificate** QR in the panel
   once and follow the steps on that page.
6. Press **EN** or **PT** at the top right of the panel to choose English or
   Brazilian Portuguese.

Data in the [`RC-Setlist-1.0.0.ablx`](docs/RELEASE-NOTES-1.0.0.md) layout runs
without migration. To move data from the 0.x layout
(`Ableton-RC-Setlist-0.4.x`–`0.7.0`), run the kit's
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

- Both pages run in a browser on a desktop, notebook, tablet or phone on the
  network.
- Synchronized `.lrc` lyrics, timed and edited in the browser.
- Guarded transport: a 500 ms hold on the buttons, quantization feedback and
  counted loops.
- Per-profile ordering, lyrics and CSV export, stored locally.
- Several saved setlists for each Ableton Live Set.
- Song durations and the total setlist duration, calculated from the
  Arrangement.
- Show mode in Stage Control hides the setup controls and keeps the active song
  pinned.
- Fullscreen stage mode with Screen Wake Lock when the browser supports it.
- English and Brazilian Portuguese interfaces in the same `.ablx`.
- Keyboard Mapping assigns transport and view actions to Numpad or alpha keys.
- No account, cloud sync, analytics or telemetry.

## Two computers

A main computer, the **master**, can pair one or more second computers, the
**slaves**, from the **Second computer** card in the **Network** tab of the Live
panel. The slave shows a six-digit code; the master enters its address and the
code. The link uses pinned certificates.

- **Commands.** Play, Stop, jumps, metronome, quantization, count-in, refresh
  and panic given on the master go to every slave. Each slave confirms each
  command; the master resends it until its deadline and shows an alert when a
  slave did not execute it, executed it late, or has not stopped.
- **Link health.** Stage Control, `/performance` and the Live panel show each
  link as **OK**, **UNSTABLE** or **DOWN**, with the reason and the round-trip
  time. A link that goes **DOWN** opens a full-screen alarm on the stage pages;
  **Stop** stays reachable above it.
- **Playhead.** The master sends its transport target twice a second, and a
  slave corrects whole-beat gaps, a missed Play, a missed Stop and, while both
  are stopped, a different position. A mismatch that lasts `3 s` shows **Out of
  step**.
- **Slave modes.** **Follow all** runs the master's commands and every
  correction. **Follow transport** corrects only while playing. In both, Stage
  Control on the slave cannot play or jump; Stop, Panic and Refresh go up to the
  master. **Independent** receives no commands from the master and lets the
  slave navigate on its own.

Turn Ableton Link on and Start Stop Sync off on every computer, and run the same
RC Setlist version on all of them. Details are in the
[user guide](docs/USER-GUIDE.md).

## What is new in 1.3.0

Full details in the [1.3.0 release notes](docs/RELEASE-NOTES-1.3.0.md), which
also cover the 1.2.1 fixes.

- **Link health.** Each paired computer shows **OK**, **UNSTABLE** or **DOWN**
  with its reason, `RTT` and drops, after a `20 s` warm-up, with a recovery
  window, a `5 min` hold for an oscillating link and an **Acknowledge** button.
- **Link-down alarm.** A full-screen alarm on Stage Control and `/performance`,
  with a red badge above the transport after **Dismiss alarm**; **Stop** stays
  reachable above it.
- **Confirmed commands.** Slaves confirm every command. Alerts say when a slave
  did not execute a command, executed it late, or is still not stopped; Stop
  and Panic are resent until confirmed.
- **Stopped playhead and Out of step.** A stopped slave moves to the master's
  position, and a lasting mismatch shows **Out of step**.
- **Slave modes and navigation lock.** **Follow all**, **Follow transport** and
  **Independent**. A following slave's Stage Control can only send Stop, Panic
  and Refresh, which replaces the 1.2.1 behaviour where a phone on a slave drove
  the whole show.
- **Same version required.** Master and slave check the link protocol and show
  **DIFFERENT VERSIONS** when they differ.
- **Network tab.** The Second computer card sits above the Certificate card.

## Documentation

- [Getting started](docs/GETTING-STARTED.md)
- [Installation](docs/INSTALL.md)
- [User guide](docs/USER-GUIDE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Frequently asked questions](docs/FAQ.md)
- [What is new in 1.3.0](docs/RELEASE-NOTES-1.3.0.md)
- [What is new in 1.2.1](docs/RELEASE-NOTES-1.2.1.md)
- [What is new in 1.2.0](docs/RELEASE-NOTES-1.2.0.md)
- [Privacy](PRIVACY.md)
- [Security](SECURITY.md)
- [All other documents](docs/README.md)

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
Building from source needs Node.js 24.16.0 or newer, in the Node 24 LTS line;
end users install the `.ablx` and do not need Node.js.

The installation kit is built with `npm run package:kit`. It writes
`release-candidates/RC-Setlist-1.3.0-Installation-Kit.zip` with the `.ablx`,
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
