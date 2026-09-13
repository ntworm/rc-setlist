# Release 0.7.0

Ableton RC Setlist 0.7.0 retires the bridge's manual install, adds a marker
that hands playback to a named target, and puts one line of notes on every
song.

## What's New

- **RC Bridge ships inside the extension.** Until now, the Control Surface the
  extension talks to was a separate download — AbletonOSC, fetched and
  installed by hand into Live's User Library. It now ships as RC Bridge, a
  fork of the MIT-licensed AbletonOSC, and the installation kit copies it for
  you: `Install-RC-Bridge.cmd` on Windows, `Install RC Bridge.command` on
  macOS. Selecting **RCBridge** under Settings › Link, Tempo & MIDI › Control
  Surface stays your step, because Live offers no way to do it for you — and
  the copy itself cannot happen from inside Live either: the ExtensionHost
  sandboxes the filesystem to the extension's own folders, so the panel names
  the script in use and shows the remaining step instead of pretending to
  install it.
  The fork is also what makes two extensions on one machine possible.
  AbletonOSC sends every reply and listener update to one fixed port, so only
  one client could hear it — RC Surface and RC Setlist in the same Live could
  not both work. RC Bridge listens on its own port (11020, so a stock
  AbletonOSC keeps running beside it), replies to whichever socket asked, and
  publishes each listener's updates to every subscriber, with a 60-second
  lease that forgets clients that went away. The extension probes for RC
  Bridge first and falls back to a stock AbletonOSC when it is absent; the
  panel's OSC line says which one it is talking to
  (`via RC Bridge 1.0.0 on port 11020`). The fork also answers
  `last_event_time`, which upstream never did, so the show's total duration no
  longer needs the MCP bridge.
- **`[jump NAME]` — a marker that hands playback to a *named* target.** A
  section of the same song, a song, or the form `Song > Section`. Names match
  with tags stripped and case ignored; a bare name resolves in this song's
  sections first, then song titles, then every section in arrangement order.
  The hand-over is the same immediate one `[next]` and `[skip]` use — no
  waiting for the next bar — and the marker editor and the card both show it.
  A name that matches nothing does nothing, on purpose.
- **One line of notes per song.** Key, tuning, who counts in — a single line
  for the stage, edited on the song panel beside the colour, shown under the
  title on the card and on the performance display. It is stored with the song
  in the song book, so it follows renames and moves and never touches the Live
  project.

## Fixed

- **Operator errors survive sanitization.** The command bus now attaches
  operator-facing messages (`OperatorError` and `ProfileError`) to
  `command_status.error`, while internal exceptions — raw filesystem paths
  included — remain strictly sanitized and arrive as a generic
  `execution_failed`.
- **The song book cache follows the active profile.** Colours and notes are
  cached per profile and the cache is dropped on a profile switch, so one
  profile's edits cannot leak into another.
- **The locator parser stopped splitting `Song > Section` on a `>` that sits
  inside a tag.**

*For full details on installing, please refer to the [Installation Guide](INSTALL.md).*

*Leia estas notas em português: [NOTAS-DA-VERSAO-0.7.0.md](pt-BR/NOTAS-DA-VERSAO-0.7.0.md).*
