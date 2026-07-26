# Release checklist — Ableton RC Setlist 0.4.0

Use a copy of a Live Set and a **trusted local network / LAN**. Do not perform
the first test during a real show.

## Installation

- [ ] Ableton Live 12.4.5+ Suite Beta opens normally.
- [ ] AbletonOSC appears and is selected as a Control Surface.
- [ ] `Ableton-RC-Setlist-0.4.0.ablx` installs without errors.
- [ ] With clean data, the first **Start** creates the default profile and starts the server without a persistence error.
- [ ] **Extensions > Ableton RC Setlist** opens the correct panel and shows version 0.4.0.

## Language

- [ ] The panel, Stage Control and Performance start in English.
- [ ] Selecting **Português (Brasil)** translates interface labels without changing song, section or lyric content.
- [ ] The selected language survives page reloads and extension restart.
- [ ] Switching back to English preserves the active song, section and transport state.

## First use

- [ ] The server starts and shows a local URL/QR code.
- [ ] `https://localhost:4444/setlist` opens after accepting the local certificate.
- [ ] Another device on the same LAN opens the URL shown by the panel.
- [ ] `/performance` opens fullscreen without horizontal scrolling.

## Fictional set

- [ ] Locators from `examples/` become songs and sections in the expected order.
- [ ] BPM, click, `[loop 2x]`, `[next]` and `[stop]` work as documented.
- [ ] Previous/Next require the safety hold.
- [ ] Song/section jumps, click and Refresh send real commands to Live.
- [ ] Quantization waits for confirmation from Live.
- [ ] Authorized or fictional LRC text follows transport.
- [ ] Missing legacy lyrics migrate without deleting the old folder or overwriting new lyrics.
- [ ] CSV opens as UTF-8 and contains only the current set.

## Persistence and failure states

- [ ] Profile, order, language and auto-start preference survive a Live restart.
- [ ] A brief connection loss shows reconnection state without inventing data.
- [ ] With AbletonOSC unavailable, the interface fails clearly.
- [ ] The full controller token appears in no public screenshot.

## Approval

- [ ] Windows verified on the release computer.
- [ ] macOS remains marked experimental unless tested on real hardware.
- [ ] Landing page, English/PT-BR docs, installation kit and changelog reviewed.
- [ ] `.ablx` SHA-256 matches `SHA256SUMS.txt`.
- [ ] Final result recorded before GitHub publication.
