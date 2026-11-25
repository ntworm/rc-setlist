# Release checklist — RC Setlist 1.3.0

Use a copy of a Live Set and a **trusted local network / LAN**. Do not perform
the first test during a real show.

## Installation

- [ ] Ableton Live 12.4.5+ Suite Beta opens normally.
- [ ] `RC-Bridge/Install-RC-Bridge.cmd` (or `Install RC Bridge.command`) runs
      and reports the install path; `RCBridge/__init__.py` exists directly inside
      `User Library/Remote Scripts/RCBridge`.
- [ ] RCBridge appears and is selected as a Control Surface.
- [ ] After Start, the RC Setlist panel's OSC line reads
      `via RC Bridge 1.0.0 on port 11020`.
- [ ] With a stock AbletonOSC selected instead, the OSC line reads
      `via AbletonOSC on port 11000` and the transport still works.
- [ ] `RC-Setlist-1.3.0.ablx` installs without errors.
- [ ] With clean data, the first **Start** creates the default profile and starts the server without a persistence error.
- [ ] **Extensions > RC Setlist** opens the correct panel and shows version 1.3.0.

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
- [ ] With no control surface selected, the interface fails clearly.
- [ ] **Check OSC** distinguishes stopped, waiting, connected, interrupted and
      OSC return-port-busy states with a compact label.
- [ ] The full controller token appears in no public screenshot.

## Two computers

- [ ] When a slave has two network interfaces on the same subnet, **Ready to
      pair** shows an address that answers.
- [ ] Master and slave run 1.3.0; each link row reaches **OK** after the
      20 s warm-up.
- [ ] Unplugging the network cable turns the link **DOWN** within 3 s and opens
      the full-screen alarm; **Stop** works above it and **Dismiss alarm**
      leaves the red badge above the transport.
- [ ] A Play or jump on the master runs once on every slave and shows the
      Executed tick on Stage Control.
- [ ] Stopped with the slave at another marker, the slave moves to the master's
      position in **Follow all** and only alerts in **Follow transport**.
- [ ] In **Follow all** and **Follow transport**, Stage Control on the slave
      cannot play or jump, and a Stop on the slave stops the master and every
      slave.
- [ ] In **Independent**, the master shows the **Independent** tag and sends
      nothing to that slave, and Stage Control on the slave navigates on its own.
- [ ] With a 1.2.x computer paired, the 1.3.0 computer shows **DIFFERENT
      VERSIONS** and no command passes between them.

## Approval

- [ ] Windows verified on the release computer.
- [ ] macOS remains marked experimental unless tested on real hardware.
- [ ] Landing page, English/PT-BR docs, installation kit and changelog reviewed.
- [ ] `.ablx` SHA-256 matches `SHA256SUMS.txt`.
- [ ] Final result recorded before GitHub publication.
