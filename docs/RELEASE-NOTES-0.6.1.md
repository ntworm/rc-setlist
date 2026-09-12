# Release 0.6.1

Ableton RC Setlist 0.6.1 is the stage pass over 0.6.0. Everything in it came
out of running the extension against a real Live Set: the count-in, the way
songs hand over to each other, what Play means after a stop, and a handful of
things that only show on a phone in a dark room.

## What's New

- **The count-in is sounded in the browser.** It used to rewind Live's playhead
  one bar and start the transport there — real arrangement time belonging to
  the previous song, so the count ran at that song's tempo and its audio played.
  Making it audible also meant switching Live's metronome on, overriding a click
  you had deliberately turned off. The count is now browser audio at the tempo
  the setlist declares for the playhead. Live starts on the beat it was sitting
  on, and its transport and metronome are never touched to produce it. Play is
  sent shortly before the last beat so the transport arrives on the downbeat;
  pressing Play again during the count starts immediately, and Stop cancels it.
- **The help guide tells `[next]` and `[skip]` apart** and shows the chaining
  case: an end marker carrying `[next]`, followed by the next song.

## Bug Fixes

- **A `[next]` marker at the end of a song actually skips the gap.** `[next]`
  and `[skip]` were executed through Live's cue jump, which Live quantizes to
  the global launch quantization: measured on a real set, the marker fired at
  beat 872.3 and Live jumped at 876.0, the next bar line. For a `[next]` placed
  where a song's audio ends and followed by one empty bar — the reason the tag
  exists — the jump landed exactly where the next song was starting anyway, so
  the marker appeared to do nothing. Both tags now relocate the playhead
  directly: the hand-over happens about a tenth of a second after the marker is
  crossed, never before it, and the next song starts from its first beat.
- **Play plays from where you see the playhead.** Live offers two starts and
  neither is "from the playhead": one begins at the start marker, the other
  resumes where the transport last came to rest and ignores everything done to
  the playhead since — a jump to a section while stopped included. Play now
  resumes when the playhead has not moved since the transport stopped, and
  starts from the start marker when a jump or a click moved it.
- **A quantized jump lands on the beat the page announces.** The cue jump used
  to be sent when RC Setlist's own clock passed the landing beat — just past
  Live's grid line — so Live, which quantizes cue jumps to its next grid line,
  landed it a full bar later than shown. The jump is now handed to Live the
  moment it is requested, and Live lands it on the grid line the page shows.
- **The first Play after start-up resumes where Live is**, instead of reading
  the tempo reports that arrive before any position as a stopped playhead at
  zero.
- **Stop no longer fires an abandoned jump.** A jump waiting for its
  quantization boundary stayed armed through Stop and could carry the transport
  off to a section you had already changed your mind about, seconds later.
- **A jump while stopped moves the playhead immediately**, so the count-in
  reads the tempo of the section you just chose, not of wherever the playhead
  had been.
- **Song-level tags fire again.** A `[stop]`, `[next]`, `[skip]`, `[loop]`,
  `[bpm]` or `[click]` written on a song was never read once the playhead was
  inside any of its sections — which, with a section starting on the song's own
  beat, was always. Song and section tags are now evaluated independently.
- **An empty Live Set clears the previous songs**, including when the last
  locator is deleted.
- **The song list no longer rebuilds itself every two seconds**, and the beat
  flash no longer forces a full page layout on every beat.
- **The count digit replaces the play triangle** instead of being drawn over
  it, and a second press silences the count instead of leaving the bar sounding
  under the playback it started.
- **The Tools menu fits its labels.** "Mapeamento de Teclado" pushed every
  button past the popover's edge.
- **Native select lists are readable.** The setlist picker opened as a white
  list with near-white text.

*For full details on installing, please refer to the [Installation Guide](INSTALL.md).*

*Leia estas notas em português: [NOTAS-DA-VERSAO-0.6.1.md](pt-BR/NOTAS-DA-VERSAO-0.6.1.md).*
