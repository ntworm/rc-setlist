# Ableton RC Setlist 0.5.0 release notes

[Português (Brasil)](pt-BR/NOTAS-DA-VERSAO-0.5.0.md)

Released on August 1, 2026. Version 0.5.0 promotes the field-tested locator,
automation, Stage Control and reliability integration that was rehearsed in a
real Ableton Live project.

## Locator and show control compatibility

- Explicit locators such as `SONG > Section` and relative locators such as
  `> Section` work together. A relative section remains attached to the
  preceding chronological song.
- Legacy song and tag-only automation locators remain compatible.
- `[ignore]`, `[IGNORE]`, `_hidden` and `[hidden]` keep technical locators out
  of the visible setlist. `[ignore]` overrides action tags.
- Song and section BPM, loop counts, stop, next, click and skip actions preserve
  their chronological locator identity.
- The owner verified song detection, section following, counted-loop release,
  stop/next transitions, transport control and multiple setlists in a real Live
  project before this promotion.

## Complete tracklist CSV

The CSV export now contains only information the runtime can verify. Each row
identifies the active `setlist`, song `title`, `start_beat`, declared `bpm`,
numeric `duration_sec`, readable `duration`, `sections_count`, named `sections`,
locator `automations` and `lyric_lines`.

The former `signature`, `key`, `plays`, `custom_order`, `in_setlist`,
`cues_count` and `last_played_at` placeholders were removed. The extension does
not invent musical key, per-song signature or play-history data it does not
track. The file remains UTF-8 with BOM, semicolon-delimited and saved both in
the active profile and the browser Downloads folder.

## Reliability and performance

- WebSocket commands are decoded and bounded before dispatch, revalidate safety
  at execution time and report completion only after the corresponding action.
- Reorder, lyrics, CSV and click-preview data use atomic replacement and reject
  stale completion after a Live Set or profile change.
- Lyrics remain dirty until the exact save command confirms, and delayed
  confirmation cannot reopen a modal the operator already closed.
- WebSocket heartbeat/backpressure, TLS validation, HTTP error handling and
  ordered shutdown prevent stale clients and partial runtime cleanup.
- Setlist derivations and active-card updates are cached so normal transport
  polling avoids rebuilding the complete song list.
- The compact responsive Stage Control design, lyrics workspace, profiles,
  transport dock, total duration and bilingual interface remain intact.

## Compatibility and scope

- Ableton Live 12.4.5+ Suite (Beta) with Extensions support.
- AbletonOSC remains an external Control Surface dependency.
- Windows is validated. macOS remains experimental.
- Arrangement locators remain the source of setlist structure; Session View is
  not part of this release.

Rehearse transport, locators, automation and LAN access with a copy of the Live
Set before stage use.
