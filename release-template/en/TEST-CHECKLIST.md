# Release checklist — Ableton RC Setlist 0.5.1

Use a copy of a Live Set and a **trusted local network / LAN**. Do not perform
the first test during a real show.

## Installation

- [ ] Ableton Live 12.4.5+ Suite Beta opens normally.
- [ ] AbletonOSC is at `User Library/Remote Scripts/AbletonOSC`, not the hidden
  `User Remote Scripts` preferences folder, and `AbletonOSC/__init__.py` exists
  directly inside it.
- [ ] AbletonOSC appears and is selected as a Control Surface.
- [ ] `Ableton-RC-Setlist-0.5.1.ablx` installs without errors.
- [ ] With clean data, the first **Start** creates the default profile and starts the server without a persistence error.
- [ ] **Extensions > Ableton RC Setlist** opens the correct panel and shows version 0.5.1.

## Language

- [ ] The panel, Stage Control and Performance start in English.
- [ ] Selecting **Português (Brasil)** translates interface labels without changing song, section or lyric content.
- [ ] The selected language survives page reloads and extension restart.
- [ ] Switching back to English preserves the active song, section and transport state.

## First use

- [ ] The server starts and shows a local URL/QR code.
- [ ] The installation/troubleshooting guide explains that `ERR_CERT_AUTHORITY_INVALID` is expected for the local self-signed certificate; continue only when the address exactly matches the IP shown in the Live panel on a trusted LAN.
- [ ] `https://localhost:4444/setlist` opens after accepting the local certificate once for this browser/device.
- [ ] Another device on the same LAN opens the URL shown by the panel.
- [ ] `/performance` opens fullscreen without horizontal scrolling.

## Fictional set

Create a disposable Arrangement with these locators in chronological order:

```text
TEST 01 [bpm 120] [click]
TEST 01 > VERSE
[loop 2x]
TEST 01 > FINAL
[stop]
TEST 02 [bpm 128] [click off]
TEST 02 > CHORUS
```

- [ ] The two tag-only locators appear as automation sections inside TEST 01,
  not as blank songs.
- [ ] Add `TEST 01B` between TEST 01 and TEST 02; Refresh places it in the
  chronological position instead of appending it.
- [ ] Song duration appears on every song and total setlist duration updates.
- [ ] BPM, click, `[loop 2x]` and `[stop]` work as documented.
- [ ] Previous/Next require the safety hold.
- [ ] Play, Stop, song/section jumps, click and Refresh send real commands to Live.
- [ ] Quantization waits for confirmation from Live.
- [ ] Both **Stage Control** and **Performance Display** open from the Live panel.
- [ ] Authorized or fictional LRC text follows transport.
- [ ] Missing legacy lyrics migrate without deleting the old folder or overwriting new lyrics.
- [ ] CSV opens as UTF-8, identifies the current setlist and includes
  `sections_count`, named `sections`, locator `automations` and `lyric_lines`.

## Persistence and failure states

- [ ] Profile, order, language and auto-start preference survive a Live restart.
- [ ] With transport stopped, create, select and rename a second Active Setlist,
  delete it while inactive, and restore it from recoverable trash.
- [ ] On a phone, the rename field keeps the keyboard/focus while Live remains
  stopped, and Enter confirms the new name.
- [ ] A setlist created in this Live Set does not appear after opening another
  saved `.als`; reopening the first Set restores it.
- [ ] A brief connection loss shows reconnection state without inventing data.
- [ ] With AbletonOSC unavailable, the interface fails clearly.
- [ ] **Check OSC** distinguishes stopped, waiting, connected, interrupted and
  OSC return-port-busy states with a compact label.
- [ ] The full controller token appears in no public screenshot.

## Approval

- [ ] Windows verified on the release computer.
- [ ] macOS remains marked experimental unless tested on real hardware.
- [ ] Landing page, English/PT-BR docs, installation kit and changelog reviewed.
- [ ] `.ablx` SHA-256 matches `SHA256SUMS.txt`.
- [ ] Final result recorded before GitHub publication.
