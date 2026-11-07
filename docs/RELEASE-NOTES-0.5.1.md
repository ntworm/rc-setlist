# Release 0.5.1

RC Setlist 0.5.1 updates stage transport controls, keyboard mapping and show clock synchronization.

## What's New

- **Keyboard Mapping Support**: Allows mapping keyboard keys (like Numpad or Alphanumeric) to stage transport controls for page turns and song navigation.
- **Count-in Pre-roll Toggle**: Adds a toggle for the 1-bar pre-roll count-in in the Stage Control panel.
- **Hold-to-Select Mobile Navigation**: Mobile transport navigation requires a hold gesture for jumps between songs to avoid unintended activation.
- **Section Editing via Double-Click**: Double-click opens inline editing for section tags in the desktop Setlist view.

## Bug Fixes

- **Decoupled Show Clock**: The overall show clock and song elapsed time are now properly decoupled from Live's BPM automation, ensuring your timecode doesn't jump wildly when tempo changes.
- **Safe State Tracking**: Resolved synchronization races where the server and UI could temporarily disagree about the current playing section.
- **Robustness**: Hardened pre-roll observation races, fixed WebSocket boundaries, and stabilized the UI against fast successive clicks.

_For full details on migrating from 0.4.x, please refer to the [Installation Guide](INSTALL.md)._

_Leia estas notas em português: [NOTAS-DA-VERSAO-0.5.1.md](pt-BR/NOTAS-DA-VERSAO-0.5.1.md)._
