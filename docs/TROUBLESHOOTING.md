# Troubleshooting

## Ableton RC Setlist does not appear in Live

- Confirm Ableton Live 12.4.5+ Suite (Beta).
- Reopen the `.ablx` and follow Live's installation prompt.
- Restart Live and check **Extensions > Ableton RC Setlist**.

## RCBridge does not appear in the Control Surface list

- Install it at `User Library/Remote Scripts/RCBridge`, not Live's hidden
  `User Remote Scripts` preferences folder. The kit's `Install-RC-Bridge.cmd`
  / `Install RC Bridge.command` puts it in the right place.
- Confirm `RCBridge/__init__.py` exists directly inside that folder, with no
  extra nested `RCBridge` directory.
- Close and reopen Live after copying it; Live reads the folder at start-up.
- Select RCBridge as a Control Surface; its Input and Output can remain
  `None`.
- The panel's OSC line says which script the extension is actually talking
  to (`via RC Bridge 1.0.0 on port 11020`, or `via AbletonOSC on port 11000`),
  and spells out the install steps when RC Bridge is not the one answering.

## The panel starts but OSC controls or playhead do not respond

- Choose **Check OSC** in the RC Setlist panel.
- `Live connected` means replies from the remote script are reaching RC Setlist.
- `Waiting for AbletonOSC` means the local server is running, but no reply has
  arrived. Recheck the exact folder above, the Control Surface selection and
  then restart Live.
- `AbletonOSC connection interrupted` means replies were received previously
  but have stopped.
- The extension decides which script to use when the server starts. If you
  installed and selected RC Bridge with the server already running, press
  **Restart** in the panel.
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

This only happens with a stock AbletonOSC. It sends every reply to its fixed
UDP port `11001`; if another RC extension already owns that port, RC Setlist
falls back to UDP 11101, may still send commands, but cannot receive
AbletonOSC's replies. The compact panel reports this as
`Live active · OSC return port busy`.

The fix is RC Bridge: it answers whichever port asked, so every RC extension
gets its replies and nothing is shared. Install it (see [INSTALL](INSTALL.md)),
select it as a Control Surface, and restart the server.

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
