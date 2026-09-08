# Release 0.6.0

Ableton RC Setlist 0.6.0 rebuilds two things the app leaned on and neither of
them was solid: how it measures a show, and how you change a marker. It also
gives the stage views a surface designed for a dark room rather than a bright
desk.

## What's New

- **Marker editor**: double-click a song or a section and every tag becomes a
  control. A song carries its name, its colour, its starting tempo and the stop,
  next and skip behaviours, plus a list of its sections to step into and back out
  of. Loop and click belong to a section, because that is where the music is
  structured. The raw text field this replaces put the name and its tags in one
  input, where `[bpm 107]` — the tag the duration engine reads — could be deleted
  by a stray keystroke.
- **Song colours**: sixteen desaturated colours in an eight by two matrix. Hue
  climbs across each row and tone deepens down each column, so two colours that
  read apart on a dark stage are two that sit apart on the strip. Colour is RC
  Setlist's own memory: it is stored beside your setlist, never written into the
  Live project, and it follows a song through renames and moves.
- **Songs are recognised by name and position**: rename a song and it stays the
  same song; drag it elsewhere and it stays the same song. Change both at once and
  it is honestly treated as a new one. Delete a locator by accident and recreate
  it, and what RC Setlist remembered comes back.
- **Dedicated stage typography**: self-hosted Martian Mono for the interface and
  Barlow Semi Condensed for sung lyrics, which fits roughly 45% more words per
  line on a phone without dropping below the 12px stage floor. Accents and
  cedillas no longer clip.
- **Duration confidence**: an `EST.` badge appears whenever a setlist carries no
  `[bpm N]` tags, so a uniform estimate is never mistaken for an exact figure.
- **Tempo automation safety**: a **Set Live tempo on jump** toggle, off by
  default. RC Setlist also detects arrangement tempo automation on its own and
  refuses to write tempo when it finds it, even with the toggle on.

## Bug Fixes

- **Show duration no longer depends on what was playing.** A captured field fed
  the live tempo back into the song's own duration, so a set with tempo
  automation measured itself differently on every pass — up to 16:59 of drift on
  a 79-minute show. Durations now come from the tempo the locators declare,
  integrated piecewise across one chronological timeline for the whole setlist.
- **Renaming a locator no longer risks losing it.** The rename happens in place
  instead of deleting the cue point and creating a replacement, and Live's own
  cue list is read back rather than the bridge's word being taken for it.
- **Section prefixes are preserved.** Live accepts both `> Verse` and
  `Song > Verse`; the editor used to rewrite the first form into the second and
  renamed every section it touched.
- **Editing is refused while the transport is playing**, in every mode. A rename
  moves the playhead to act on the cue, so with playback running the write landed
  at whatever beat playback had reached.
- **Marker edits refresh immediately.** Cue points are polled every two seconds,
  and inside that window the editor reopened on stale values and wrote them back
   — which made tags look like they landed at random.
- **Every tag the panel writes now has a badge.** `[skip]` and `[click]` changed
  what happens on stage while leaving no mark on the card.
- **Play no longer swaps to a pause glyph**, which had implied that pressing it
  again would pause.

*For full details on migrating from 0.5.x, please refer to the [Installation Guide](INSTALL.md).*

*Leia estas notas em português: [NOTAS-DA-VERSAO-0.6.0.md](pt-BR/NOTAS-DA-VERSAO-0.6.0.md).*
