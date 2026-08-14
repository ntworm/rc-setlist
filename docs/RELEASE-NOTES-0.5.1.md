# Release 0.5.1

Ableton RC Setlist 0.5.1 focuses on safer stage navigation, clearer timing and
more flexible physical controls. It also consolidates the profile, lyrics and
CSV workflows introduced across the 0.4.x and 0.5.0 releases.

## New and changed

- **Previous and next song controls:** the outer Stage Control arrows jump to
  the start of the adjacent song. The buttons disable at setlist boundaries and
  require a 500 ms hold on touch or pointer input.
- **Previous and next section controls:** the inner arrows preserve section-level
  navigation with the same guarded hold behavior.
- **Song reorder target:** desktop drag and mobile hold-and-drag show one
  insertion target preview before the new order is committed.
- **Keyboard Mapping:** transport and view actions can be assigned to Numpad or
  letter keys. Existing MIDI Mapping remains available for MIDI note,
  control-change and program-change messages.
- **Count-in Pre-roll:** `COUNT-IN 1 BAR` enables an optional one-bar start from
  stopped transport using Live's native metronome. It does not arm tracks or
  enter Record and does not change jump quantization.
- **Inline section editing:** double-click a section tag in the desktop Setlist
  view to edit it in place.
- **Show and song clocks:** the Stage Control display uses setlist-relative SHOW
  and SONG time instead of exposing the raw Arrangement coordinate.

## Fixes

- SHOW and SONG elapsed time no longer moves backward when Live tempo automation
  changes; duration estimates use each song's declared BPM.
- Count-in startup no longer waits indefinitely for a separate acknowledgement
  before sending the ordered Click, position and Play commands.
- WebSocket and command-routing boundaries handle rapid successive events more
  consistently while retaining authorization checks.
- The public source export now includes the real build entry point and these
  release notes, while leaving the external AbletonOSC checkout out of the
  repository so GitHub Pages can publish the static documentation.

## Before stage use

Install and compatibility requirements remain in the
[Installation Guide](INSTALL.md). Windows is the validated release platform;
macOS remains experimental until tested on real macOS hardware. Rehearse the
exact Live Set, controller and network setup before using it on stage.

*Leia estas notas em português: [NOTAS-DA-VERSAO-0.5.1.md](pt-BR/NOTAS-DA-VERSAO-0.5.1.md).*
