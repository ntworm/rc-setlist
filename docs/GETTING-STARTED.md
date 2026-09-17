# Getting started with RC Setlist 1.0

This guide takes you from a fresh Live install to a running setlist in
under 15 minutes. If anything here disagrees with what you see on
screen, open an issue with the `docs/wrong` label.

- [1. Install](#1-install)
- [2. Open Live and enable RC Setlist](#2-open-live-and-enable-rc-setlist)
- [3. First setlist in three locators](#3-first-setlist-in-three-locators)
- [4. Open the panel](#4-open-the-panel)
- [5. Pair the stage phone](#5-pair-the-stage-phone)
- [Next steps](#next-steps)

## 1. Install

You need:

- Ableton Live 12.4.5 Suite (Beta) or newer, with Extensions enabled.
- macOS 13+ (release path) or Windows 11 23H2+ (release path). Linux is
  not supported by the host; the bridge is Python and runs anywhere
  Live does.
- A modern phone browser (Safari 17+, Chrome 121+) for the stage
  control.

Open the kit you downloaded from the
[release page](https://github.com/ntworm/rc-setlist/releases/latest) and
double-click the installer for your platform. The installer copies RC
Bridge into Live's User Library and prints the final URL of the local
panel.

If you prefer to do it by hand, follow
[INSTALL.md](INSTALL.md). The 1.0 install is one RC Bridge folder plus
the `.ablx` extension; nothing else needs to be on disk.

## 2. Open Live and enable RC Setlist

1. Launch Ableton Live.
2. Open Live's **Preferences → Extensions** and confirm `RC Setlist`
   appears in the list with status **Enabled**.
3. **Extensions → RC Setlist → Open panel** opens the host panel.
4. The panel shows the local URL, the controller token as a QR code,
   and the auto-detected LAN IP.

The URL is `https://<lan-ip>:4444/`; the QR embeds the same URL with the
token in the query string. Treat the QR like a password — anyone who
scans it can stop the transport.

## 3. First setlist in three locators

Live uses **locators** (cue points in the Arrangement). Each one
carries the song title plus optional tags inside `[ ]` brackets. RC
Setlist parses them into songs and sections.

Start a new Live Set, set the tempo to 120 BPM, and add three
locators:

| Beat | Name               | Notes            |
| ---- | ------------------ | ---------------- |
| 0    | `INTRO`            | First song       |
| 16   | `> Verse`          | Section of INTRO |
| 48   | `SONG 2 [bpm 100]` | Next song at 100 |

Open the panel and confirm you see:

- `INTRO` listed as the current song
- `Verse` listed as a section under INTRO
- `SONG 2` listed as a separate song with BPM 100

If the panel shows nothing, check the logs panel; a malformed
locator is the most common cause.

## 4. Open the panel

The panel is the operator's primary interface. It shows the current
song, the running timer, the next locator, and the controls to play,
stop, jump and edit. Pressing **Space** toggles play/stop; **N** and
**P** jump to the next and previous locator; **J** opens a small
dialog to type a marker name and jump to it.

The full reference is in
[USER-GUIDE.md](USER-GUIDE.md#panel-controls).

## 5. Pair the stage phone

1. On the stage phone, scan the QR from the panel.
2. The phone opens the Stage Control page at the same URL with the
   token already in the query string.
3. Tap **Confirm controller** to register the phone as a controller
   for this session.

The phone now shows the next song, the section index, the running
timer, and the lyrics. There is no separate pairing app; the only
piece of state the phone needs is the URL.

If the phone loses the connection, the panel re-renders and the URL
stays valid until you restart Live.

## Next steps

- [USER-GUIDE.md](USER-GUIDE.md) — full panel + Stage Control
  reference.
- [CONTRACTS.md](CONTRACTS.md) — the public contract (HTTP, WS,
  locator grammar). Read this if you want to write your own
  controller.
- [THEME_CONTRACT.md](THEME_CONTRACT.md) — palette and typography if
  you want a custom skin for Stage Control.
- [TESTER-GUIDE.md](TESTER-GUIDE.md) — what to check on a release
  candidate before you ship it to the band.
- [DEVELOPMENT.md](DEVELOPMENT.md) — how to run the source tests and
  build the extension locally.
