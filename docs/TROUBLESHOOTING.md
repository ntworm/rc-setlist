# Troubleshooting

## Ableton RC Setlist does not appear in Live

- Confirm Ableton Live 12.4.5+ Suite (Beta).
- Reopen the `.ablx` and follow Live's installation prompt.
- Restart Live and check **Extensions > Ableton RC Setlist**.

## AbletonOSC does not appear

- Install it at `User Library/Remote Scripts/AbletonOSC`, not Live's hidden
  `User Remote Scripts` preferences folder.
- Confirm `AbletonOSC/__init__.py` exists directly inside that folder, with no
  extra nested `AbletonOSC` directory.
- Restart Live after copying it.
- Select AbletonOSC as a Control Surface; its Input and Output can remain
  `None`.
- Follow the [upstream AbletonOSC instructions](https://github.com/ideoforms/AbletonOSC).

## The panel starts but OSC controls or playhead do not respond

- Choose **Check OSC** in the RC Setlist panel.
- `Live connected` means AbletonOSC replies are reaching RC Setlist.
- `Waiting for AbletonOSC` means the local server is running, but no reply has
  arrived. Recheck the exact folder above, the Control Surface selection and
  then restart Live.
- `AbletonOSC connection interrupted` means replies were received previously
  but have stopped.
- Play/Stop and the moving playhead are the clearest end-to-end OSC checks.

## No songs appear

- Confirm the Live Set has Arrangement locators.
- Start locator names with a song name; sections use `Song > Section`.
- Use the panel restart action after changing the integration setup.

## The browser page does not open

- On the first connection, `ERR_CERT_AUTHORITY_INVALID` is the expected warning
  for RC Setlist's local self-signed certificate. Continue only when the address
  exactly matches the IP shown in the Live panel and you are on a trusted LAN.
  Each browser/device may require this once.
- Open `https://localhost:4444/health` on the host.
- Confirm the panel reports the server as running.
- Allow inbound TCP `4444` only on the private network profile.
- Put host and controller on the same non-guest LAN.
- Accept the self-signed certificate only for that exact panel address.

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

AbletonOSC sends every reply to its fixed UDP port `11001`. If another RC
extension already owns that port, RC Setlist falls back to UDP 11101; it may
still send commands, but it cannot receive AbletonOSC's replies. The compact
panel reports this as `Live active · OSC return port busy`.

When the local Ableton MCP bridge is also available, the **MCP fallback** keeps
the playhead, play state and tempo synchronized and supplies **Total Duration**.
RC Setlist also keeps the operator's **requested quantization** locally, so
choosing `None` makes section jumps immediate even while native OSC replies are
busy. **Check OSC** still reports the port conflict truthfully; it does not call
the fallback a native OSC connection.

If the MCP bridge is absent too, stop the other RC extension, restart RC Setlist
and choose **Check OSC** again. Do not force two sockets to share `11001` on
Windows; only one listener can receive each reply. For native OSC diagnostics,
keep automatic start enabled for only one OSC-dependent RC extension.

## Setlists from another Live Set appear

Current builds save every profile operation immediately inside the current Live
Set scope. They do not show the global profile list from older builds, and a new
unsaved Live Set never imports another temporary session automatically.

Legacy global data is preserved as a backup and is not deleted. Only the former
per-project folder that exactly matches the current saved Live Set is imported
automatically.

If project metadata arrives after startup, or you use **Save As** without
changing the Song handle, the temporary project scope may be promoted to the
saved `.als` scope only when that delayed metadata still matches the same Live
session and profile scope. Profiles created during that delay, including
`Second Setlist`, are copied without deleting the temporary source.

After switching Live Sets, restart RC Setlist before attaching the intended
saved `.als`. The temporary scope created during a handle change is durable for
manual recovery, but its profiles are blocked from automatic migration. Other
historical temporary folders are also left untouched for manual recovery. For an
unidentified Set, missing lyrics are recovered only when one legacy custom order
matches the complete current song list; ambiguous matches are left untouched.

## What to include in a bug report

Include OS, Live version/edition, Ableton RC Setlist version, browser, exact reproduction
and sanitized logs. Remove controller tokens, certificate material, local paths
and real setlist/lyrics content. See [SUPPORT.md](../SUPPORT.md).
