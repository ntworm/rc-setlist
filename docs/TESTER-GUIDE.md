# RC Setlist tester guide

Use only the release-candidate directory supplied by the maintainer. Start with
`START-HERE.html` and record every result in its checklist. The version under
test is the one printed in the kit's `README.txt` and shown in the Live panel.

## Environment record

- Operating system and version
- Ableton Live version and edition
- RC Setlist version shown in the panel
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
4. Open **Extensions > RC Setlist** and start the server. The OSC line must
   read `via RC Bridge`.
5. Confirm that the kit contains no private path, no SDK archive and no real
   song content.
6. With a fresh extension-data directory, confirm that the first Start creates
   the default profile and starts the server without a persistence error.

## Functional matrix

- Load the fictional example locators.
- Confirm that songs and sections are parsed, including a `Song > Section`
  locator whose tag text contains `>`.
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
  locator name, and its text appears under the title on the card and on the
  performance display.
- Confirm the operator Play/Stop and the 500 ms Previous/Next hold.
- Count-in (`COUNT-IN 1 BAR`): while stopped, press Play and confirm that one
  bar is counted in the browser at the tempo the setlist declares for the
  playhead, then Live starts on the beat it was sitting on. Live's playhead
  must not move during the count and its metronome must not be touched.
- Start with Click off and confirm that it is still off after the count;
  repeat with Click on and confirm that it stays on.
- Start at beat zero and confirm that the count runs and Live starts at beat
  zero (nothing is rewound).
- Press Stop during the count and confirm that it is cancelled; press Play
  again during the count and confirm that Live starts immediately.
- Change the manual Click during the count and confirm that the manual choice
  wins.
- While already playing, jump with quantization enabled and confirm that no
  count-in runs and the jump lands on the grid line the page announces.
- Stop, jump to a section, then press Play: Live must start from that section,
  not from where it was stopped. Stop without jumping, then Play: Live must
  resume where it stopped.
- Confirm that song/section jumps, click controls and Refresh all produce an
  OSC action rather than only updating the browser display.
- Confirm that setlist reordering survives a restart.
- Colour a song and write a note, switch to a second profile, and confirm that
  the second profile shows neither; switch back and confirm that both are
  still there.
- Create, edit, save and reload fictional lyrics.
- Open Lyrics while a timed lyric is active, switch the shared song selector
  and all three tabs, and confirm that the active Stage Control lyric never
  disappears.
- Confirm that Stage Control selects the active Arrangement song and loads its
  saved text when the Lyrics dialog opens.
- Edit a lyric without saving, close and reopen the dialog, and confirm that
  the unsaved line and the enabled Save action remain intact.
- Confirm the progression of the lyrics in the performance view.
- If previous extension data exists, confirm that its missing lyrics migrate
  into the default profile and that its project-specific lyrics appear as
  separate profiles.
- Export CSV and open it in a spreadsheet. Confirm that it identifies the
  active setlist and includes named `sections`, `sections_count`, `automations`
  and `lyric_lines`, without placeholder play-history columns.
- Confirm the controller/read-only behavior with and without the token.
- Confirm that the panel and Stage Control explain the empty set, the malformed
  locator and the missing Remote Script.
- Confirm that fullscreen and the Wake Lock fallback remain usable.
- Confirm that Stage Control disables language changes during playback and
  while locked, enables them only when stopped and unlocked, and shows the
  lock warning in the selected interface language.
- During continuous playback, watch several Bars/Beats/Sixteenths transitions,
  especially beat `4` into beat `1`, and confirm that the label never flashes
  back to the previous sixteenth. Then confirm that a real backward section
  jump, a loop and a stopped-position change still reposition the label
  immediately.

## Network and resilience

- Restart the browser while Live continues running.
- Stop and start the server from the panel.
- Disconnect and reconnect the Wi-Fi on the controller.
- Confirm that a stale state is labeled and that no transport command executes
  without control authorization.
- With RC Surface (or another OSC client) running beside RC Setlist, confirm
  that both keep receiving replies; the OSC line must not report a port
  conflict.

## Platform decision

Windows must pass before publication. A macOS result is recorded separately and
does not change the experimental status unless the entire matrix passes on
real hardware.

Do not authorize publication while any release-blocking item is unresolved.
