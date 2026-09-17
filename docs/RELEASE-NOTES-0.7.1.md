# Release 0.7.1

RC Setlist 0.7.1 incorporates stage acceptance fixes from the 2026-09-16 rehearsal,
improves panel visibility and mobile layouts, cleans up legacy installations, and
aligns the product name with brand guidelines.

## What's New

- **Product Name Alignment**: Renamed to **RC Setlist** in compliance with
  Ableton's brand guidelines for third-party products.
- **One-Time Data Migration**: Upgrading from 0.x seamlessly copies profiles,
  project setlists, preferences and tokens to the new layout without altering the
  original files (scripts/migrate-data.mjs).
- **High-Contrast Panel Plate**: A 2px amber border (
gba(255, 168, 38, 0.45))
  with subtle glow ensures the Live panel stands out clearly against both dark and
  light Live themes.
- **Legacy Extension Cleanup**: The installer kit and script
  (scripts/uninstall-pre-1.0-extensions.ps1) automatically clean pre-0.7.1 packages
  from the User Library so Live only lists one active RC Setlist in the Extensions menu.

## Fixed

- **Panel CSS Loading**: Restored styles by fixing HTML <link> tag parsing in the
  Live extension container.
- **Mobile Telemetry Layout**: Telemetry cards in portrait mode now use a 58/42 split,
  preventing clipping on phones.
- **Mobile Count-In Muting**: Browser count-in audio is now silenced by default on
  mobile devices to prevent unexpected audio bleed into monitors or PA; it remains an
  opt-in setting via 
c-setlist.count-in-audio.
- **Marker Editor Autocomplete**: Target selection dropdown cleanly displays markers
  without duplicating [jump] or [loop] tags.

*For full details on installing, please refer to the [Installation Guide](INSTALL.md).*

*Leia estas notas em português: [NOTAS-DA-VERSAO-0.7.1.md](pt-BR/NOTAS-DA-VERSAO-0.7.1.md).*
