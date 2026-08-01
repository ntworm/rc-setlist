# Ableton RC Setlist 0.4.2 local test notes

[Português (Brasil)](pt-BR/NOTAS-DA-VERSAO-0.4.2.md)

Version 0.4.2 is a local test candidate for Ableton Live verification. It is
not a published release, and the public website and latest download remain on
0.4.1 until rehearsal testing is complete.

## What to verify

- The new relative locator form `> Section` keeps the section attached to the
  preceding song. Relative automation markers work the same way, and `[ignore]`
  hides technical locators even when another action tag is present.
- The complete 0.4.1 Stage Control visual design remains intact: compact header,
  song cards, lyrics workspace, profiles, transport dock and responsive layouts.
- Lyrics edits stay marked as unsaved until the matching disk write is confirmed.
  A failure, timeout or disconnect keeps the text available for another attempt.
- Duplicate song titles, custom order, song durations, loops, stop/next actions
  and hidden technical markers still resolve by chronological locator identity.

## Reliability changes

- Incoming WebSocket messages are validated before command dispatch. Safety
  controls are rechecked at execution time and urgent stop/panic work is not
  trapped behind ordinary commands.
- Reorder, lyrics, CSV and click-preview files use atomic replacement and reject
  stale completion after the active Live Set or profile changes.
- The bridge monitors WebSocket clients with bounded heartbeat checks, retains
  its existing backpressure thresholds, validates saved TLS certificates and
  closes HTTP connections in a defined shutdown order.
- Setlist derivations and active-card updates are cached so normal transport
  polling avoids rebuilding the whole song list.

## Test status

The automated source, static, browser, documentation and packaging gates are
part of this candidate. It must still be installed and rehearsed in Ableton Live
before stage use. No remote release, tag or public download was created by this
local promotion.
