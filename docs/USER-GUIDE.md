# Ableton RC Setlist user guide

Ableton RC Setlist converts Ableton Live Arrangement locators into a setlist and stage
display. Read [INSTALL.md](INSTALL.md) before this guide.

## Locator grammar

A song locator has a title. A section uses `Song > Section`.

```text
Neon Signal [bpm 122] [click]
Neon Signal > Intro
Neon Signal > Verse
Neon Signal > Chorus [loop 2x]
Neon Signal > Outro [stop]
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

Tags are case-insensitive and removed from the display name.

## Profiles

Profiles separate setlist order, lyrics and related state. Create, select and
rename profiles from the operator workspace. Use distinct profiles for separate
shows instead of renaming files in extension storage.

## Operator workspace

Open `/setlist` from the tokenized controller URL shown in the Live panel.

- Drag songs to change their displayed order.
- Use Play and Stop for immediate transport actions.
- Previous and Next require a deliberate 500 ms hold.
- Select transport quantization and wait for Live to confirm the change.
- Use the lyrics dialog to create, time and edit lyric lines.
- Export the current tracklist as UTF-8 CSV.
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

In the lyrics dialog you can paste lines, advance through them while audio plays,
edit timestamps and save. The text is stored in the active profile. Plain text
is also accepted for sequential display.

## Setlist ordering and CSV

Custom order is presentation state; it does not move locators inside the Live
Set. CSV export includes the visible song data and uses semicolon separators with
UTF-8 BOM for spreadsheet compatibility.

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
