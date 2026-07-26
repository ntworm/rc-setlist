# Troubleshooting

## Ableton RC Setlist does not appear in Live

- Confirm Ableton Live 12.4.5+ Suite (Beta).
- Reopen the `.ablx` and follow Live's installation prompt.
- Restart Live and check **Extensions > Ableton RC Setlist**.

## AbletonOSC does not appear

- Confirm the `AbletonOSC` folder is directly inside the Remote Scripts folder.
- Restart Live after copying it.
- Follow the [upstream AbletonOSC instructions](https://github.com/ideoforms/AbletonOSC).

## The panel starts but no songs appear

- Confirm the Live Set has Arrangement locators.
- Start locator names with a song name; sections use `Song > Section`.
- Confirm AbletonOSC is active and UDP is not blocked locally.
- Use the panel restart action after changing the integration setup.

## The browser page does not open

- Open `https://localhost:4444/health` on the host.
- Confirm the panel reports the server as running.
- Allow inbound TCP `4444` only on the private network profile.
- Put host and controller on the same non-guest LAN.
- Accept the self-signed certificate only for the expected host.

## Controls are read-only

Open the controller URL or scan the controller QR code from the panel. The token
is required for transport/write actions. Do not share it publicly.

If songs, lyrics and timecode update but every transport or navigation action
fails, confirm you are running 0.3.0 or newer. Earlier release candidates could
fail while encoding outgoing OSC commands in Ableton's embedded runtime.

## First start reports a profile persistence error

Install 0.3.0 or newer. Earlier release candidates could write the initial
profile and then fail because an unavailable runtime API was used after the
write. If the error remains on a current build, capture a sanitized
`ExtensionHost.txt` excerpt and open a bug report without deleting profile data.

## Lyrics do not match the song

- Confirm the active profile.
- Confirm the lyric entry is assigned to the cleaned song title.
- Remove locator tags from the lyric song name.
- Re-save from the built-in editor and refresh the state.

When upgrading from an earlier **RC SETLIST** or **Ableton Setlist Bridge** build,
restart the server once on the current version. Ableton RC Setlist imports missing
lyrics and custom order from the known previous extension-data folders. It does
not delete the old folders or overwrite files already present in the new profile.

## Another extension uses OSC port 11001

Ableton RC Setlist uses a cooperative listener design for compatible sibling extensions.
Use current versions of both. If either logs a bind failure, restart Live and
capture sanitized logs for a bug report.

## What to include in a bug report

Include OS, Live version/edition, Ableton RC Setlist version, browser, exact reproduction
and sanitized logs. Remove controller tokens, certificate material, local paths
and real setlist/lyrics content. See [SUPPORT.md](../SUPPORT.md).
