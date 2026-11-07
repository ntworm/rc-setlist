# Getting started with RC Setlist

This guide walks through the first show: enable the extension, build a setlist
from Live locators and control it from a phone. Install RC Setlist and RC
Bridge first (see [INSTALL.md](INSTALL.md)). If anything here disagrees with
what you see on screen, open an issue with the `docs/wrong` label.

- [Enable the extension](#enable-the-extension)
- [Build a setlist from locators](#build-a-setlist-from-locators)
- [Read the panel](#read-the-panel)
- [Connect the phone](#connect-the-phone)
- [Next steps](#next-steps)

## Enable the extension

1. Launch Ableton Live.
2. Open Live's **Preferences → Extensions** and confirm `RC Setlist` appears in
   the list with status **Enabled**.
3. **Extensions → RC Setlist → Open panel** opens the host panel.
4. The panel shows the local URL, the controller token as a QR code, and the
   auto-detected LAN IP.

The URL is `https://<lan-ip>:4444/`; the QR embeds the same URL with the token
in the query string. Treat the QR like a password: anyone who scans it can stop
the transport.

## Build a setlist from locators

Live uses **locators** (cue points in the Arrangement). Each one carries the
song title plus optional tags inside `[ ]` brackets. RC Setlist parses them
into songs and sections.

Start a new Live Set, set the tempo to 120 BPM, and add three locators:

| Beat | Name               | Notes            |
| ---- | ------------------ | ---------------- |
| 0    | `INTRO`            | First song       |
| 16   | `> Verse`          | Section of INTRO |
| 48   | `SONG 2 [bpm 100]` | Next song at 100 |

Open the panel and confirm you see:

- `INTRO` listed as the current song
- `Verse` listed as a section under INTRO
- `SONG 2` listed as a separate song with BPM 100

If the panel shows nothing, check the logs panel for a malformed locator.

## Read the panel

The Live panel is the window RC Setlist opens inside Live. The operator works
in the Stage Control page in the browser: it shows the current song, the
running timer, the next locator, and the controls to play, stop, jump and edit.

The full reference is in [USER-GUIDE.md](USER-GUIDE.md#the-live-panel).

## Connect the phone

1. On the stage phone, scan the QR from the panel.
2. The phone opens the Stage Control page at the same URL with the token
   already in the query string.
3. Tap **Confirm controller** to register the phone as a controller for this
   session.

The phone shows the next song, the section index, the running timer, and the
lyrics. It needs a modern browser (Safari 17+, Chrome 121+).

The Performance view at `https://<host-ip>:4444/performance` is read-only and
shows the show state to the band.

There is no separate pairing app; the only piece of state the phone needs is
the URL. If the phone loses the connection, the panel re-renders and the URL
stays valid until you restart Live.

## Next steps

- [USER-GUIDE.md](USER-GUIDE.md): full panel + Stage Control reference.
- [CONTRACTS.md](CONTRACTS.md): the public contract (HTTP, WS, locator
  grammar). Read this if you want to write your own controller.
- [THEME_CONTRACT.md](THEME_CONTRACT.md): palette and typography if you want
  a custom skin for Stage Control.
- [TESTER-GUIDE.md](TESTER-GUIDE.md): what to check on a release candidate
  before you ship it to the band.
- [DEVELOPMENT.md](DEVELOPMENT.md): how to run the source tests and build the
  extension locally.
