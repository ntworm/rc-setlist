# Ableton RC Setlist user guide

Ableton RC Setlist converts Ableton Live Arrangement locators into a setlist and stage
display. Read [INSTALL.md](INSTALL.md) before this guide.

## Interface language

The interface starts in English. Use the language menu in the Live panel, Stage
Control or Performance view to select **English** or **Português (Brasil)**. The
choice is stored locally. Song names, section names and lyric/chord content are
show data and are never translated.

In Stage Control, change the language only while Live is stopped and the panel
is unlocked. The selector is disabled during playback or while the safety lock
is active so the show surface cannot be reconfigured accidentally.

## Locator grammar

A song locator has a title. A section uses `Song > Section` or the relative syntax `> Section` (which attaches to the preceding song). Standalone action tags like `[stop]` and relative automation locators like `> [stop]` belong to the chronologically preceding song.

```text
Song A [bpm 122] [click]
> Intro
> Verse
> Chorus [loop 4x]
[stop]
Technical cue [ignore]
```

| Tag | Effect |
| --- | --- |
| `[loop]` | Loop the current section until disabled. |
| `[loop Nx]` | Loop the section N times. |
| `[stop]` | Stop when the locator is reached. |
| `[next]` | Hand playback to the next song the moment this marker is reached. Written on a section it still leaves the song — it does not advance to the next section. |
| `[bpm N]` | Set the target BPM. |
| `[click]` / `[click off]` | Enable or disable Live's metronome. |
| `[skip]` | Skip this section/song: hand playback to the next section (or song) the moment this marker is reached. |
| `[hidden]` | Keep an automation anchor out of the visible setlist. |
| `[ignore]` | Technical marker that hides the locator and takes precedence over any action tags. |

Tags are case-insensitive and removed from the display name. The `[ignore]` tag takes precedence over automation tags, hiding the marker and ignoring any action tags on that locator without creating songs, sections, or automations.

### Chaining songs with `[next]`

To go straight from the end of one song into the next, skipping the empty bars
between them, put a marker where the song's audio ends and give it `[next]`:

```text
Song A [bpm 122]
> Verse
> Chorus
> End [next]
Song B [bpm 96]
```

When the playhead reaches `> End`, RC Setlist moves it to `Song B`'s locator
straight away — not on the next bar line. Live's own locator jumps are
quantized to the global quantization, which for a marker followed by a one-bar
gap would have landed exactly where `Song B` was starting anyway; that is why
this transition is not a Live cue jump. The hand-over happens about a tenth of
a second after the marker is crossed (the position is polled every 100 ms and
AbletonOSC processes commands every 100 ms), never before it, and the next
song always starts from its first beat. `[skip]` hands over the same way.

Because the playhead is moved directly, Live's start marker stays where it was.
Play in RC Setlist resumes from wherever you stopped, so this only shows if you
press Stop twice in Live, which returns to the start marker.

## Editing a marker

Double-click a song row or a section chip in Stage Control to open the marker
editor. Every tag is a control there — you never type a `[tag]` by hand, and you
cannot delete one with a stray keystroke.

A **song** carries its name, its colour, its starting tempo, and the `[stop]`,
`[next]` and `[skip]` behaviours. It also lists its sections; click one to edit
it, and the arrow at the top of the panel brings you back to the song.

A **section** carries its name, its tempo, its loop, its click, and the same
three behaviours. Loop and click live here rather than on the song because that
is where the music is structured.

Three things the editor guarantees:

- **A tag the panel does not show is never deleted.** Anything RC Setlist does
  not recognise, and anything it recognises but does not offer for that kind of
  marker, is carried through the save untouched.
- **A section keeps the prefix it already had.** Live accepts both `> Verse` and
  `Song A > Verse`; whichever spelling your set uses is preserved.
- **Saving without changing anything writes nothing.** Tags are compared by
  meaning, so reordering them is not a change.

Editing is refused while the transport is playing. Renaming a locator means
deleting it and creating it again, and Live can only create a cue point where
the playhead stands — with playback running, the new marker would land wherever
the playhead had reached. Stop the transport first.

Colour is RC Setlist's own memory. It is stored beside your setlist and never
written into the Live project, and it follows the song through renames and
moves. The eight tones are deliberately desaturated: on the card, colour is
identity, and the vivid hues are reserved for state.

## Profiles

Profiles belong to the current Live Set. A saved `.als` may contain multiple
setlists for alternate show orders, rehearsals or lineups. The active setlist selector
and **Manage Setlists** button are located at the top of Stage Control.
Manage Setlists does not show profiles from another Ableton project. Opening another Live Set
switches to that Set's separate profile registry.

Within the current Live Set, profiles separate setlist order, lyrics, exports
and related state. From Stage Control you can create, select and rename
profiles, move an inactive profile to recoverable trash, and restore it later
with the same UUID and data. Deletion is not a permanent erase.

Profile changes are controller-only and the transport must be stopped. The active
profile and the only remaining profile cannot be deleted. To move another profile
to trash, type its displayed name exactly in the confirmation field.

Older global profile storage is retained as a local backup but is not mixed into
Manage Setlists. An exact legacy folder for the saved Live Set is migrated
without deleting its source.

## Setlist duration

Stage Control shows the song duration on each song card. The header shows the
total setlist duration. A song runs from its song locator to the next song locator,
so any transition gap is included. The final song ends at Live's Arrangement end;
the total runs from the first song locator to that same end and also includes
transitions. An em dash means Live has not supplied a valid final Arrangement boundary yet.

### Duration methodology and stage stability

Durations are fixed schedule figures established at set load and do not fluctuate
when Live's transport knob moves or playback starts. In a live stage environment,
timing readouts must remain predictable targets for the crew and band rather than
shifting with instantaneous tempo adjustments.

### Arrangement tempo automation limitation

Live sets often contain tempo automations drawn directly on the master track.
However, **arrangement tempo automation envelopes cannot be inspected remotely**
by any extension. Neither the Ableton Extensions SDK, AbletonOSC, MCP tools, nor
the Live Object Model (LOM) expose arrangement tempo breakpoint lists without
physically sweeping the playback cursor. The evidence behind that conclusion,
and what RC Setlist does instead, is in
[docs/architecture/tempo-automation-limitation.md](architecture/tempo-automation-limitation.md).

### Obtaining exact durations (`[bpm N]`)

To calculate exact piecewise song and set durations, declare the tempo explicitly
in the locator name using `[bpm N]` (e.g. `Song A [bpm 122]` or `> Chorus [bpm 135]`).

- **Declared confidence**: When at least one `[bpm]` tag is present, RC Setlist
  calculates exact piecewise durations for tagged songs and sections, carrying
  tempo forward across untagged boundaries.
- **Estimated confidence (`EST.`)**: When no locator declares a `[bpm]` tag,
  RC Setlist falls back to Live's initial session tempo, marks the duration
  confidence as estimated, and displays an `EST.` badge beside the total time
  and HUD timecards.

### Empirical measurement example

In a measured 21-song production set with tempo automations spanning 93 to 166 BPM:
- **Exact piecewise duration**: **78:41** (4,721 seconds).
- **Single-tempo fallback at 99 BPM**: 95:40 — **a 16:59 (+21.6%) distortion**.
- **Single-tempo fallback at 136 BPM**: 69:38 — **a 9:03 (-11.5%) distortion**.

Declaring `[bpm N]` tags on song locators resolves the 16:59 discrepancy, restores
the exact 78:41 total, and clears the `EST.` warning badge.

## Operator workspace

Open `/setlist` from the tokenized controller URL shown in the Live panel.

- Drag songs to change their displayed order.
- Use Play and Stop for immediate transport actions. Play resumes where the
  transport stopped; after you jump to a song or section while stopped (or
  click in Live's Arrangement), Play starts from there instead.
- Previous and Next require a deliberate 500 ms hold.
- Select transport quantization; the jump scheduler applies the requested value
  immediately and reconciles it with a native Live reply when one is available.
- Use the lyrics dialog to create, time and edit lyric lines.
- Export the current tracklist as UTF-8 CSV (saves a copy in the active profile's `exports/` folder and downloads to your browser's Downloads folder).
- Use fullscreen for a compact stage workstation.

### Jump tempo ordering

Explicit jumps apply the destination BPM around the cue jump. A section BPM
overrides its song BPM; an untagged section inherits the destination song BPM.
While stopped, or with quantization at None, RC Setlist uses an SDK-first tempo
write and then sends the cue jump. While playing with quantization on, the cue
jump is handed to Live at once — Live lands it on its next grid line — and the
tempo is written when that landing is observed. These are sequential
operations, not atomic operations, so they cannot guarantee sample-accurate
timing. Native Arrangement tempo automation at the destination is recommended
for sample-accurate transitions.

### One-bar count-in

`COUNT-IN 1 BAR` sounds one bar in the browser before Play is sent, when Play
is requested while the transport is stopped. Live's playhead does not move and
Live's metronome is not touched: the count is browser audio, and the transport
starts on the beat it was already sitting on.

The count runs at the tempo **the setlist declares** for that point — the last
`[bpm]` at or before the playhead — and only falls back to Live's current tempo
when the set declares nothing. This matters at a song boundary: Live is still
sitting at the previous song's tempo, so counting at that would count the wrong
speed for the song about to start.

Play is sent shortly before the last beat so the transport arrives on the
downbeat rather than after it. Pressing Play again during the count starts
immediately instead of counting again, and Stop cancels it.

Because the count no longer borrows Live's Click, a click you have switched off
stays off through the count-in, and one you have switched on is unaffected.

This rehearsal control does not enter Record and does not arm tracks. It also
does not change live jump quantization. When Live is already playing, Play and
song/section jumps keep their existing behavior, including the current
quantization.

The UI keeps the last valid state visible during brief reconnects. A reconnect
notice does not mean the old state is newly confirmed.

## Performance view

Open `/performance` for a high-contrast, mostly read-only display. It shows the
active/next song and section, timecode, bar/beat, BPM/click state and lyric context.

The Stage Control view can show a conditional tempo-difference warning when a
locator declares an expected BPM and Live reports another value. The warning is
hidden during normal operation and is not part of the Performance display.

Press `F` or use the fullscreen button. When supported, Screen Wake Lock is held
while stage fullscreen is active and released when you leave it.

## Lyrics

Use original, licensed or otherwise authorized text only.

Ableton RC Setlist accepts timed LRC lines:

```text
[00:00.00] The room wakes under amber light
[00:04.50] A quiet pulse becomes our guide
```

The song selector at the top of the lyrics dialog applies to Create, Sync and
Edit and opens on the current Arrangement song. Existing lyrics for that song
load automatically. You can paste lines, advance through them while audio plays,
edit timestamps and save. Inspecting another song in the dialog does not replace
the synchronized line for the song currently shown in Stage Control. The text is
stored in the active profile. Plain text is also accepted for sequential display.

## Setlist ordering and CSV

Custom order is presentation state; it does not move locators inside the Live
Set. CSV export includes one row per visible song with the active `setlist`,
`start_beat`, declared BPM, numeric and readable duration, `sections_count`,
named `sections`, locator `automations` and `lyric_lines`. It intentionally does
not invent musical key, per-song signature, play counts or last-played history.
The file uses semicolon separators with UTF-8 BOM for spreadsheet compatibility,
is saved in the active profile directory under `exports/` and is sent to your
browser's Downloads.

## Auto-start

The panel can remember whether the local server should start with the extension.
Leave auto-start disabled on machines where the network service should only run
during rehearsals/shows.

## Safe show practice

- Rehearse the exact Live Set and extension build before a performance.
- Keep the host and controller on a dedicated trusted network.
- Save a fallback setlist outside Ableton RC Setlist.
- Do not change profiles, network or AbletonOSC installation during a show.
- Verify the active profile and transport lock before enabling control.

This release reads Arrangement locators. Session View support is deferred. The
local Stage Control and Performance links continue to use HTTPS.

## Tempo automation drawn in Live

If your Arrangement has its own tempo automation, keep **Set Live tempo on jump**
switched **off** in the Live panel. It ships off, and this is why.

An explicit jump can write the destination tempo into Live before it moves the
playhead. Writing `song.tempo` overrides Live's tempo automation: the arrangement
stops following its own envelope until you press **Re-Enable Automation** in the
transport bar. One jump mid-show would flatten the tempo for the rest of the set.

RC Setlist also watches for this on its own. When the tempo Live reports differs
from the `[bpm N]` tag declared at that point in the setlist, the extension
concludes that something other than the setlist owns the tempo and refuses to
write it, even if the setting is on.

A `[bpm N]` tag means "measure the duration with this". It does not mean "impose
this on Live". Tagging your songs is safe with tempo automation, and it is what
turns an estimated set duration into an exact one.

Turn the setting on only when the tags are your source of truth for tempo and the
Arrangement has no tempo automation.

## How RC Setlist recognises your songs

**The Ableton locator is the source of truth. RC Setlist never writes anything
hidden into your project.** It recognises a song by name and position, in that
order.

- Rename a song and it stays the same song — the position did not move.
- Drag it somewhere else and it stays the same song — the name did not change.
- Change both at once and it is treated as a new song.

Anything RC Setlist keeps on the side follows that identity. Delete a locator by
accident and recreate it, and what it remembered comes back.

The full reasoning is in [docs/architecture/song-identity.md](architecture/song-identity.md).
