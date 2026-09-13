# Ableton RC Setlist tester guide

Use only the release-candidate directory supplied by the maintainer. Start with
`START-HERE.html` and record every result in its checklist. The version under
test is the one printed in the kit's `README.txt` and shown in the Live panel.

## Environment record

- Operating system and version
- Ableton Live version and edition
- Ableton RC Setlist version shown in the panel
- Which Remote Script the panel reports (`via RC Bridge 1.0.0 on port 11020`,
  or `via AbletonOSC on port 11000`)
- Browser and controller device
- Network type (trusted private LAN only)

## Installation

1. Verify the SHA-256 listed in `SHA256SUMS.txt`.
2. Run the RC Bridge installer from the kit's `RC-Bridge` folder
   (`Install-RC-Bridge.cmd` on Windows, `Install RC Bridge.command` on macOS),
   then choose **RCBridge** under Settings › Link, Tempo & MIDI › Control
   Surface.
3. Install the `.ablx` package named in the kit's `README.txt`.
4. Open **Extensions > Ableton RC Setlist** and start the server. The OSC line
   must read `via RC Bridge`.
5. Confirm no private path, SDK archive or real song content appears in the kit.
6. With a fresh extension-data directory, confirm the first Start creates the
   default profile and starts the server without a persistence error.

## Functional matrix

- Load the fictional example locators.
- Confirm song and section parsing, including a `Song > Section` locator whose
  tag text contains `>`.
- Confirm `[bpm]`, `[click]`, `[click off]`, `[loop 2x]`, `[stop]`, `[next]`,
  `[skip]` and `[jump NAME]`.
- Place `[next]` on a marker at the end of a song with one empty bar before the
  next song: playback must land on the next song's first beat within about a
  tenth of a second of crossing the marker, never before it.
- Place `[jump Chorus]` on a section: playback must move to the section called
  Chorus of the same song; `[jump Other Song > Bridge]` must reach that song's
  section.
- Open the marker editor on a song and on a section: the Jump-to field writes
  `[jump NAME]` into the locator; the Notes field (song only) never changes the
  locator name and its text appears under the title on the card and on the
  performance display.
- Confirm operator Play/Stop and the 500 ms Previous/Next hold.
- Count-in (`COUNT-IN 1 BAR`): while stopped, press Play and confirm one bar is
  counted in the browser at the tempo the setlist declares for the playhead,
  then Live starts on the beat it was sitting on. Live's playhead must not move
  during the count and its metronome must not be touched.
- Start with Click off and confirm it is still off after the count; repeat with
  Click on and confirm it stays on.
- Start at beat zero and confirm the count runs and Live starts at beat zero
  (nothing is rewound).
- Press Stop during the count and confirm it is cancelled; press Play again
  during the count and confirm Live starts immediately.
- Change the manual Click during the count and confirm that manual choice wins.
- While already playing, jump with quantization enabled and confirm no count-in
  runs and the jump lands on the grid line the page announces.
- Stop, jump to a section, then press Play: Live must start from that section,
  not from where it was stopped. Stop without jumping, then Play: Live must
  resume where it stopped.
- Confirm song/section jumps, click controls and Refresh all produce an OSC
  action rather than only updating the browser display.
- Confirm setlist reordering and persistence after restart.
- Colour a song and write a note, switch to a second profile, and confirm the
  second profile shows neither; switch back and confirm both are still there.
- Create, edit, save and reload fictional lyrics.
- Open Lyrics while a timed lyric is active, switch the shared song selector and
  all three tabs, and confirm the active Stage Control lyric never disappears.
- Confirm Stage Control selects the active Arrangement song and loads its saved
  text when the Lyrics dialog opens.
- Edit a lyric without saving, close and reopen the dialog, and confirm the
  unsaved line and enabled Save action remain intact.
- Confirm performance-view lyric progression.
- If previous extension data exists, confirm its missing lyrics migrate into the
  default profile and its project-specific lyrics appear as separate profiles.
- Export CSV and open it in a spreadsheet. Confirm it identifies the active
  setlist and includes named `sections`, `sections_count`, `automations` and
  `lyric_lines` without placeholder play-history columns.
- Confirm controller/read-only behavior with and without the token.
- Confirm empty set, malformed locator and missing Remote Script states are
  explained in the panel and in Stage Control.
- Confirm fullscreen and Wake Lock fallback remain usable.
- Confirm Stage Control disables language changes during playback and while
  locked, enables them only when stopped and unlocked, and shows the lock warning
  in the selected interface language.
- During continuous playback, watch several Bars/Beats/Sixteenths transitions,
  especially beat `4` into beat `1`, and confirm the label never flashes back to
  the previous sixteenth. Then confirm a real backward section jump, loop and
  stopped-position change still reposition the label immediately.

## Network and resilience

- Restart the browser while Live continues running.
- Stop/start the server from the panel.
- Disconnect/reconnect Wi-Fi on the controller.
- Confirm stale state is labeled and no transport command executes without control authorization.
- With RC Surface (or another OSC client) running beside RC Setlist, confirm
  both keep receiving replies; the OSC line must not report a port conflict.

## Platform decision

Windows must pass before publication. A macOS result is recorded separately and
does not change experimental status unless the entire matrix passes on real
hardware.

Do not authorize publication while any release-blocking item is unresolved.
