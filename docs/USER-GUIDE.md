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
| `[next]` | Move to the next song. |
| `[bpm N]` | Set the target BPM. |
| `[click]` / `[click off]` | Enable or disable Live's metronome. |
| `[skip]` | Skip this section/song. |
| `[hidden]` | Keep an automation anchor out of the visible setlist. |
| `[ignore]` | Technical marker that hides the locator and takes precedence over any action tags. |

Tags are case-insensitive and removed from the display name. The `[ignore]` tag takes precedence over automation tags, hiding the marker and ignoring any action tags on that locator without creating songs, sections, or automations.

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
transitions.

Durations are estimates based on the song locator BPM, falling back to Live's
current tempo. Tempo automation inside a song is not integrated into the estimate.
An em dash means Live has not supplied a valid final Arrangement boundary yet.

## Operator workspace

Open `/setlist` from the tokenized controller URL shown in the Live panel.

- Drag songs to change their displayed order.
- Use Play and Stop for immediate transport actions.
- Previous and Next require a deliberate 500 ms hold.
- Select transport quantization; the jump scheduler applies the requested value
  immediately and reconciles it with a native Live reply when one is available.
- Use the lyrics dialog to create, time and edit lyric lines.
- Export the current tracklist as UTF-8 CSV (saves a copy in the active profile's `exports/` folder and downloads to your browser's Downloads folder).
- Use fullscreen for a compact stage workstation.

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
