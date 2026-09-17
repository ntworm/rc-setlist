# Release 0.5.1

RC Setlist 0.5.1 is here! This release brings significant usability improvements, particularly to the stage transport controls, along with crucial bug fixes to ensure bulletproof live performance reliability.

## What's New

- **Keyboard Mapping Support**: You can now map keyboard keys (like Numpad or Alphanumeric) to stage transport controls, making page turns and song navigation much easier without relying on touch or mouse.
- **Count-in Pre-roll Toggle**: You can now toggle the 1-bar pre-roll count-in directly from the Stage Control panel. This allows starting playback without a count-in when needed.
- **Hold-to-Select Mobile Improvements**: Mobile transport navigation now requires a "hold" gesture for safe jumps between songs, preventing accidental misfires. The threshold for these holds has been carefully tuned.
- **Section Editing via Double-Click**: You can now double-click to inline-edit section tags directly from the desktop Setlist view.

## Bug Fixes

- **Decoupled Show Clock**: The overall show clock and song elapsed time are now properly decoupled from Live's BPM automation, ensuring your timecode doesn't jump wildly when tempo changes.
- **Safe State Tracking**: Resolved synchronization races where the server and UI could temporarily disagree about the current playing section.
- **Robustness**: Hardened pre-roll observation races, fixed WebSocket boundaries, and stabilized the UI against fast successive clicks.

_For full details on migrating from 0.4.x, please refer to the [Installation Guide](INSTALL.md)._

_Leia estas notas em português: [NOTAS-DA-VERSAO-0.5.1.md](pt-BR/NOTAS-DA-VERSAO-0.5.1.md)._
