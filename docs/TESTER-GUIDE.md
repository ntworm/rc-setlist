# Ableton RC Setlist 0.4.0 tester guide

Use only the release-candidate directory supplied by the maintainer. Start with
`START-HERE.html` and record every result in its PT-BR checklist.

## Environment record

- Operating system and version
- Ableton Live version and edition
- Ableton RC Setlist version shown in the panel
- AbletonOSC version/commit if known
- Browser and controller device
- Network type (trusted private LAN only)

## Installation

1. Verify the SHA-256 listed in `SHA256SUMS.txt`.
2. Install AbletonOSC from upstream.
3. Install `Ableton-RC-Setlist-0.4.0.ablx`.
4. Open **Extensions > Ableton RC Setlist** and start the server.
5. Confirm no private path, SDK archive or real song content appears in the kit.
6. With a fresh extension-data directory, confirm the first Start creates the
   default profile and starts the server without a persistence error.

## Functional matrix

- Load the fictional example locators.
- Confirm song and section parsing.
- Confirm `[bpm]`, `[click]`, `[click off]`, `[loop 2x]` and `[stop]`.
- Confirm operator Play/Stop and the 500 ms Previous/Next hold.
- Confirm song/section jumps, click controls and Refresh all produce an OSC
  action rather than only updating the browser display.
- Confirm setlist reordering and persistence after restart.
- Create, edit, save and reload fictional lyrics.
- Confirm performance-view lyric progression.
- If previous extension data exists, confirm its missing lyrics migrate into the
  default profile and its project-specific lyrics appear as separate profiles.
- Export CSV and open it in a spreadsheet.
- Confirm controller/read-only behavior with and without the token.
- Confirm empty set, malformed locator and missing AbletonOSC states are explained.
- Confirm fullscreen and Wake Lock fallback remain usable.

## Network and resilience

- Restart the browser while Live continues running.
- Stop/start the server from the panel.
- Disconnect/reconnect Wi-Fi on the controller.
- Confirm stale state is labeled and no transport command executes without control authorization.

## Platform decision

Windows must pass before publication. A macOS result is recorded separately and
does not change experimental status unless the entire matrix passes on real
hardware.

Do not authorize publication while any release-blocking item is unresolved.
