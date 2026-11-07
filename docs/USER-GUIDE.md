# RC Setlist user guide

RC Setlist converts Ableton Live Arrangement locators into a setlist and a stage
display. Read [INSTALL.md](INSTALL.md) before this guide.

## Interface language

The interface starts in English. In the Live panel, press **EN** or **PT** at the
top right to choose **English** or **Português (Brasil)**. In Stage Control and
in the Performance view, use the language menu of the page. The choice is
stored locally.

Song names, section names and lyric or chord content are show data. They are
never translated.

In Stage Control, change the language only while Live is stopped and the panel
is unlocked. The selector is disabled during playback and while the safety
lock is active.

## Locator grammar

A song locator has a title. A section uses `Song > Section` or the relative
syntax `> Section`, which attaches to the preceding song. Standalone action tags
such as `[stop]` and relative automation locators such as `> [stop]` belong to
the chronologically preceding song.

```text
Song A [bpm 122] [click]
> Intro
> Verse
> Chorus [loop 4x]
[stop]
Technical cue [ignore]
```

- `[loop]`: Loop the current section until disabled.
- `[loop Nx]`: Loop the section N times.
- `[stop]`: Stop when the locator is reached.
- `[next]`: Hand playback to the next song the moment this marker is reached.
  Written on a section it still leaves the song; it does not advance to the
  next section.
- `[bpm N]`: Set the target BPM.
- `[click]` / `[click off]`: Enable or disable Live's metronome.
- `[skip]`: Skip this section/song: hand playback to the next section (or song)
  the moment this marker is reached.
- `[jump NAME]`: Hand playback to the marker called NAME the moment this marker
  is reached: a section of this song, a song, or `Song > Section`. Names are
  matched with tags stripped, case ignored.
- `[hidden]`: Keep an automation anchor out of the visible setlist.
- `[ignore]`: Technical marker that hides the locator and takes precedence over
  any action tags.

Tags are case-insensitive and are removed from the display name. A locator
marked `[ignore]` creates no song, section or automation.

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

When the playhead reaches `> End`, RC Setlist moves it to the locator of
`Song B` straight away, not on the next bar line. Live's own locator jumps wait
for the global quantization, so this hand-over is not a Live cue jump. The move
happens about a tenth of a second after the marker is crossed, never before it:
the position is polled every 100 ms and AbletonOSC processes commands every
100 ms. The next song always starts from its first beat. `[skip]` hands over the
same way.

`[jump NAME]` is the same hand-over aimed anywhere. `> Verse 2 [jump Chorus]`
goes to the chorus of this song, `> Coda [jump Song B]` to the start of another
song, and `> Solo [jump Song B > Bridge]` to a section of another song. A bare
name is looked up in the sections of this song first, then among song titles,
then among every section in arrangement order. A name that matches nothing does
nothing.

Because the playhead is moved directly, Live's start marker stays where it
was. Play in RC Setlist resumes from wherever you stopped, so this only shows
if you press Stop twice in Live, which returns to the start marker.

## Editing a marker

Double-click a song row or a section chip in Stage Control to open the marker
editor. Every tag is a control there. You never type a `[tag]` by hand, and a
stray keystroke cannot delete one.

A **song** carries its name, its colour, its notes, its starting tempo, and the
`[stop]`, `[next]` and `[skip]` behaviours. It also lists its sections: click
one to edit it, and the arrow at the top of the panel brings you back to the
song.

A **section** carries its name, its tempo, its loop, its click, the same three
behaviours, and a jump target (the marker `[jump NAME]` goes to). Loop and click
are stored on the section, not on the song.

The editor guarantees three things:

- A tag the panel does not show is never deleted. Anything RC Setlist does not
  recognise, and anything it recognises but does not offer for that kind of
  marker, is carried through the save untouched.
- A section keeps the prefix it already had. Live accepts both `> Verse` and
  `Song A > Verse`; whichever spelling your set uses is preserved.
- Saving without changing anything writes nothing. Tags are compared by
  meaning, so reordering them is not a change.

Editing is refused while the transport is playing. Renaming a locator means
deleting it and creating it again, and Live can only create a cue point where
the playhead stands. With playback running, the new marker would land wherever
the playhead had reached. Stop the transport first.

### Colours and notes

Notes are one line for the stage (key, tuning, who counts in), shown under the
title on the card and on the performance display. Colours and notes are stored
beside your setlist and are never written into the Live project. The colour
follows the song through renames and moves.

The eight tones are desaturated. On the card the colour identifies the song,
and the vivid hues are used only to show state.

## Profiles

Profiles belong to the current Live Set. A saved `.als` may contain multiple
setlists for alternate show orders, rehearsals or lineups. The active setlist
selector and the **Manage setlists** button are at the top of Stage Control.
**Manage setlists** does not show profiles from another Ableton project.
Opening another Live Set switches to that Set's separate profile registry.

Within the current Live Set, profiles separate setlist order, lyrics, exports
and related state. From Stage Control you can create, select and rename
profiles, move an inactive profile to recoverable trash, and restore it later
with the same UUID and data.

Profile changes come from the controller only, and the transport must be stopped.
The active profile and the only remaining profile cannot be deleted. To move
another profile to trash, type its displayed name exactly in the confirmation
field.

A profile folder left by an earlier build is kept as a local backup and is not
mixed into **Manage setlists**. A legacy folder that matches the saved Live
Set exactly is migrated, and its source is not deleted.

## Setlist duration

Stage Control shows the song duration on each song card. The header shows the
total setlist duration. A song runs from its song locator to the next song
locator, so any transition gap is included. The final song ends at Live's
Arrangement end. The total runs from the first song locator to that same end
and also includes the transitions. An em dash means Live has not supplied a
valid final Arrangement boundary yet.

### Fixed durations

Durations are fixed schedule figures established at set load. They do not
change when Live's transport knob moves or when playback starts, so the crew
and the band read the same values.

### Arrangement tempo automation limitation

Live sets often contain tempo automations drawn directly on the master track.
However, **arrangement tempo automation envelopes cannot be inspected remotely**
by any extension. Neither the Ableton Extensions SDK, AbletonOSC, MCP tools, nor
the Live Object Model (LOM) expose arrangement tempo breakpoint lists without
physically sweeping the playback cursor. The evidence behind that conclusion,
and what RC Setlist does instead, is in
[docs/architecture/tempo-automation-limitation.md](architecture/tempo-automation-limitation.md).

### Obtaining exact durations (`[bpm N]`)

To calculate exact piecewise song and set durations, declare the tempo
explicitly in the locator name using `[bpm N]`, for example `Song A [bpm 122]`
or `> Chorus [bpm 135]`.

- With at least one `[bpm]` tag present, RC Setlist calculates exact piecewise
  durations for tagged songs and sections, carrying the tempo forward across
  untagged boundaries. The duration confidence is declared.
- With no `[bpm]` tag on any locator, RC Setlist falls back to Live's initial
  session tempo and marks the duration confidence as estimated, with an `EST.`
  badge beside the total time and the HUD timecards.

### Measurement example

In a measured 21-song production set with tempo automations spanning 93 to 166
BPM:

| Measurement                      | Duration              | Difference from the exact total |
| -------------------------------- | --------------------- | ------------------------------- |
| Exact piecewise duration         | 78:41 (4,721 seconds) | —                               |
| Single-tempo fallback at 99 BPM  | 95:40                 | 16:59 (+21.6%)                  |
| Single-tempo fallback at 136 BPM | 69:38                 | 9:03 (-11.5%)                   |

Declaring `[bpm N]` on the song locators removes the 16:59 discrepancy and
brings the total back to 78:41.

## The Live panel

The Live panel is the window the extension opens inside Live. Its tab bar
carries three tabs (**Main**, **Setlists** and **Network**) and the **EN** and
**PT** buttons at the top right, which change the language of the panel.

### Main

The **Main** tab shows one QR code in the middle. It is the QR of the Stage
Control by default. The button beside it swaps it for the **Performance
Display**, in the same place. Below it are the active setlist, the number of songs, the show time
and the number of setlists. Under the numbers are the songs of the active
setlist with their colours.

In the Stage Control, the number of a song and its whole name jump to the song.
On a touch screen a jump is a hold, so a stray tap never moves the show.

### Setlists and packages

The **Setlists** tab lists the setlists of the current Live Set. You can activate
one, rename it, delete it and create a new one. The delete asks once, in the
row, and a deleted setlist stays in the **Deleted setlists** list, ready to be
restored. All of this works while the transport is stopped.

**Export all** writes one `.rcsetlist` file with every setlist of the Live Set
(order, song colours and notes, lyrics) into the `packages` folder of the
extension data. On Windows that folder is
`%LOCALAPPDATA%\Ableton\Extensions Data\ntworm.rc-setlist\packages`. **Import**
picks one package of that folder and adds its setlists beside the ones you
already have. A name that is taken gets a `(2)`, and a failure half way undoes
everything. The **Copy path** button copies the path of the folder.

### Network

The **Network** tab keeps the address of the computer, the addresses detected on
the network, the protocol, the port and the certificate port. It also keeps the
**Certificate** card, with the QR that a phone reads to install the certificate
once, and the **Second computer** card, with the address, the **Generate code**
button and the **Pair** and **Unpair** buttons.

## Stage Control

Open `/setlist` from the tokenized controller URL shown in the Live panel.

- Drag songs to change their displayed order.
- Use Play and Stop for immediate transport actions. Play resumes where the
  transport stopped. After you jump to a song or section while stopped, or
  click in Live's Arrangement, Play starts from there instead.
- Previous and Next require a deliberate 500 ms hold.
- Select transport quantization. The jump scheduler applies the requested value
  immediately and reconciles it with a native Live reply when one is available.
- Use the lyrics dialog to create, time and edit lyric lines.
- Export the current tracklist as UTF-8 CSV.
- Use fullscreen for a compact stage workstation.

The interface keeps the last valid state visible during brief reconnects. A
reconnect notice does not confirm the old state.

### Jump tempo ordering

Explicit jumps apply the destination BPM around the cue jump. A section BPM
overrides its song BPM; an untagged section inherits the destination song BPM.
While stopped, or with quantization at None, RC Setlist uses an SDK-first tempo
write and then sends the cue jump. While playing with quantization on, the cue
jump is handed to Live at once. Live lands it on its next grid line, and the
tempo is written when that landing is observed. These are sequential
operations, not atomic operations, so they cannot guarantee sample-accurate
timing. Native Arrangement tempo automation at the destination is recommended
for sample-accurate transitions.

### One-bar count-in

`COUNT-IN 1 BAR` visually counts one bar on the Play button before Play is
sent, when Play is requested while the transport is stopped.
Live's playhead does not move, Live's transport is not touched until the count
ends, and Live's metronome is not touched. Live's built-in "Count-In" menu
only applies to recording, not to playback.

By default, the count is visual only. The browser click is optional and can be
turned on per device by setting `rc-setlist.count-in-audio` to `true` in the
browser's `localStorage`, for example through the developer console on a
notebook feeding an in-ear monitor. This is off by default so the operator's
phone does not beep through its speaker on stage.

The count runs at the tempo **the setlist declares** for that point (the last
`[bpm]` at or before the playhead) and only falls back to Live's current tempo
when the set declares nothing. This matters at a song boundary: Live is still
sitting at the previous song's tempo, so counting at that would count the
wrong speed for the song about to start.

Play is sent shortly before the last beat so the transport arrives on the
downbeat rather than after it. Pressing Play again during the count starts
immediately instead of counting again, and Stop cancels it.

This rehearsal control does not enter Record and does not arm tracks. It also
does not change live jump quantization. When Live is already playing, Play and
song/section jumps keep their existing behavior, including the current
quantization.

## Two computers

Two machines can run the same show: the **main computer**, where Ableton Live
lives and where the operator stands, and a **second computer** that follows
it. The second computer runs the same extension, works on the same session,
and receives the transport commands the operator gives on the main one.

### Pairing the second computer

1. On the **second computer**, start the RC Setlist server and open the Live
   panel. Go to the **Network** tab and press **Show** in the **Second
   computer** card. The card shows the address other machines reach it at and a
   **Generate code** button. The button stays disabled while the server is
   stopped or running without HTTPS, and the card says why: the pairing route
   only answers over TLS, because the certificate the computer presents is what
   pins it afterwards.
2. Press **Generate code**. The panel prints a six-digit code. It lives for
   ten minutes and works exactly once.
3. On the **main computer**, open the Live panel, go to the **Network** tab and
   press **Show** in the **Second computer** card. Type the second computer's
   address and the code, and press **Pair**.
4. The main computer stores the credential and the fingerprint of the
   certificate the second computer answered with, and opens the link to it.
   The card then says whether the second computer is answering.

The pairing and the link use port `4444` on the second computer, the same port
a phone opens, so its firewall has to let that port in.

**Unpair** forgets the credential and closes the link. When the stored pairing
cannot be removed, the panel says so and the second computer stays paired,
because a pairing left on disk would come back on the next start. A certificate
that changed is reported as such: the link refuses to talk to a computer that
presents another certificate, and the row asks for a new pairing.

### Both computers on the same session

- Ableton **Link** must be **on** on both computers, so they work on the same
  Arrangement and read the same markers.
- Live's **Start Stop Sync** must be **off**. RC Setlist relays the transport
  itself; leaving the native sync on would drive the transport twice.
- The markers must match. A jump travels as the beat it lands on, so the second
  computer lands on the same place only when both read the same markers. When
  they do not, the dot says so.

### The dot in the Stage Control header

The Stage Control page shows a second dot beside the connection dot:

- **green**: the second computer is connected and both read the same markers.
- **amber**: it is connected, but the markers are different.
- **red**: it is not answering, or its certificate changed and it has to be
  paired again.
- **no dot**: there is no second computer paired, and nothing is sent
  anywhere.

### What reaches the second computer

These travel to the paired computer: **Play**, **Stop**, **jump** (as the beat
it lands on), **metronome**, **quantization**, **count-in**, **refresh** and
**panic**.

These stay on the main computer: setlist editing, marker editing, colours,
notes, lyrics, profiles, ordering and the CSV export. The second computer
keeps its own setlist and its own profiles.

### A phone is not a second computer

A phone or a tablet that opens the Stage Control page is a **controller** of
the main computer: it joins the main computer's session and sees the main
computer's setlist. Pairing is for a second machine running Live, not for a
phone. macOS is supported as the second computer on an experimental basis;
Windows is the validated platform.

## Performance

Open `/performance` for a high-contrast, mostly read-only display. It shows the
active/next song and section, timecode, bar/beat, BPM/click state and lyric
context.

The Stage Control view can show a conditional tempo-difference warning when a
locator declares an expected BPM and Live reports another value. The warning is
hidden during normal operation and is not part of the Performance display.

Press `F` or use the fullscreen button. When supported, Screen Wake Lock is
held while stage fullscreen is active and released when you leave it.

## Lyrics

Use original, licensed or otherwise authorized text only.

RC Setlist accepts timed LRC lines:

```text
[00:00.00] First line
[00:04.50] Second line
```

The song selector at the top of the lyrics dialog applies to **Create**,
**Sync** and **Edit**, and opens on the current Arrangement song. Existing
lyrics for that song load automatically. You can paste lines, advance through
them while audio plays, edit timestamps and save. Inspecting another song in
the dialog does not replace the synchronized line for the song currently shown
in Stage Control. The text is stored in the active profile. Plain text is also
accepted for sequential display.

## Setlist ordering and CSV

Custom order is presentation state; it does not move locators inside the Live
Set. CSV export includes one row per visible song with the active `setlist`,
`start_beat`, declared BPM, numeric and readable duration, `sections_count`,
named `sections`, locator `automations` and `lyric_lines`. It does not add a
musical key, a per-song signature, play counts or a last-played history. The
file uses semicolon separators with UTF-8 BOM for spreadsheet compatibility,
is saved in the active profile directory under `exports/` and is sent to your
browser's Downloads.

## Auto-start

The panel can remember whether the local server should start with the
extension. Leave auto-start disabled on machines where the network service
should only run during rehearsals and shows.

## Safe show practice

- Rehearse the exact Live Set and extension build before a performance.
- Keep the host and controller on a dedicated trusted network.
- Save a fallback setlist outside RC Setlist.
- Do not change profiles, network or AbletonOSC installation during a show.
- Verify the active profile and transport lock before enabling control.

RC Setlist reads Arrangement locators. Session View is not supported. The local
Stage Control and Performance links use HTTPS.

## Tempo automation drawn in Live

If your Arrangement has its own tempo automation, keep **Set Live tempo on jump**
switched **off** in the Live panel. The setting ships off.

An explicit jump can write the destination tempo into Live before it moves the
playhead. Writing `song.tempo` overrides Live's tempo automation: the
arrangement stops following its own envelope until you press **Re-Enable
Automation** in the transport bar. One jump mid-show would hold that tempo for
the rest of the set.

RC Setlist watches for this on its own. When the tempo Live reports differs from
the `[bpm N]` tag declared at that point in the setlist, the extension concludes
that something other than the setlist owns the tempo and refuses to write it,
even if the setting is on.

A `[bpm N]` tag tells RC Setlist how to measure the duration. It does not
impose that tempo on Live. Tagging your songs is safe with tempo automation,
and it is what turns an estimated set duration into an exact one.

Turn the setting on only when the tags are your source of truth for tempo and
the Arrangement has no tempo automation.

## How RC Setlist recognises your songs

**The Ableton locator is the only source of a song's identity.** RC Setlist
recognises a song by name and position, in that order.

- Rename a song and it stays the same song: the position did not move.
- Drag it somewhere else and it stays the same song: the name did not change.
- Change both at once and it is treated as a new song.

Anything RC Setlist stores outside the Live project follows that identity.
Delete a locator by accident and recreate it, and RC Setlist restores the data
it stored.

The full reasoning is in
[docs/architecture/song-identity.md](architecture/song-identity.md).
