# Ableton RC Setlist 0.4.1 release notes

[Português (Brasil)](pt-BR/NOTAS-DA-VERSAO-0.4.1.md)

Released on July 29, 2026. Version 0.4.1 is a backward-compatible update for
the existing Arrangement-based workflow.

## What is new

- Every song card shows its song duration, and the header shows total setlist duration
  when Live provides the Arrangement end.
- **Manage Setlists** can create, select, rename, recoverably delete and restore
  multiple saved setlists for the current Ableton Live Set. Setlists from other
  projects stay hidden.
- The lyrics workspace now has one shared song selector above Create, Sync and
  Edit. Opening the editor no longer replaces the synchronized lyrics in the
  show display, and unsaved edits survive closing and reopening the dialog.
- The Live panel has a compact AbletonOSC connection diagnostic without filling
  the panel with installation text.

## Fixes

- `[stop]` and `[loop]` markers remain sections of the preceding song, and newly
  added songs enter the saved list at their Arrangement position.
- Quantized and unquantized jumps keep the selected Live quantization even when
  another RC extension occupies AbletonOSC's fixed reply port.
- Total Duration, playback position and jump confirmation use a serialized MCP
  fallback without accumulating delayed requests.
- The Bars/Beats/Sixteenths bar display no longer flickers backward at normal
  beat boundaries, while cue jumps, loops, stop/start and reconnects still
  update immediately.
- Mobile setlist rename keeps keyboard focus during live state updates.
- Language changes are disabled while Live is playing or the panel is locked;
  the lock warning is displayed in the active language.
- The embedded Live panel keeps both **Open on this computer** actions visible
  and clickable at the supported panel size.

## Installation notes

- Install AbletonOSC directly at
  `User Library/Remote Scripts/AbletonOSC`, then confirm that
  `AbletonOSC/__init__.py` is directly inside that folder. Do not use the hidden
  `User Remote Scripts` preferences folder.
- On the first browser connection, `ERR_CERT_AUTHORITY_INVALID` is expected for
  the local self-signed certificate. Continue only when the address exactly
  matches the IP shown in the Live panel and you are on a trusted LAN.
- Session View support is not included. Version 0.4.1 continues to use
  Arrangement locators.

See the [installation guide](INSTALL.md), [user guide](USER-GUIDE.md) and
[troubleshooting guide](TROUBLESHOOTING.md) for the complete workflow.
