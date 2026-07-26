# Fictional demo setlist

Everything under `demo-setlist/` was written for Ableton RC Setlist. The song names and
text are fictional and may be used to test the extension without copying a
commercial work.

## Locator example

Create Arrangement locators in this order:

```text
Neon Signal [bpm 122] [click]
Neon Signal > Intro
Neon Signal > Verse
Neon Signal > Chorus [loop 2x]

Open Circuit [bpm 132]
Open Circuit > Intro
Open Circuit > Bridge [loop]
Open Circuit > Outro

Night Transit [bpm 96] [click off]
Night Transit > Verse
Night Transit > Chorus

Last Light [bpm 108]
Last Light > Verse
Last Light > Outro [stop]
```

Supported examples include `[loop]`, `[loop 2x]`, `[bpm 122]`, `[click]`,
`[click off]`, `[next]`, `[stop]`, `[skip]` and `[hidden]`.

For timed lyrics, import the matching files from `demo-setlist/` through the
lyrics editor. The timestamps are intentionally short so the complete flow can
be checked quickly.
