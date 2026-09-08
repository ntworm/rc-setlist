# Song identity — the locator is the source of truth

This is a product concept, not an implementation detail. It decides how RC
Setlist recognises your songs, and therefore what happens to anything it keeps
on the side: colour, notes, and whatever comes later.

## The rule, in one paragraph

**The Ableton locator is the source of truth. RC Setlist never writes anything
hidden into your project.** It recognises a song by name and position, in that
order. Rename a song and it stays the same song, because the position did not
move. Drag it somewhere else and it stays the same song, because the name did
not change. Change both at once and RC Setlist treats it as a new song.

That is the whole contract. It fits on one line of a manual and it is worth
learning, because everything the extension remembers about a song follows it.

## Why identity has to be worked out at all

A Live cue point has no id. The only handles are its name and its beat
position, and both of them move. Nothing in the Live Object Model or in the
Extensions SDK gives a stable reference.

So the id is assigned and maintained by RC Setlist, by matching what it has
stored against what Live reports every time the cue list reloads.

## How the matching runs

Three passes, most certain first. Every pass refuses to guess: it only matches
when exactly one candidate exists on each side.

1. **Name and position both unchanged.** Nothing to interpret.
2. **Same position, different name.** Somebody renamed it.
3. **Same name, different position.** Somebody dragged it.

Cues left over are new songs. Stored entries left over are remembered as
tombstones rather than deleted — delete a locator by accident, recreate it, and
its colour comes back. A tombstone is forgotten for good after twenty reloads
without reappearing.

## The case that has no answer, and the bias that resolves it

If a song's name **and** position both changed in the same reload, that is
indistinguishable from deleting one song and adding another. The information
needed to tell them apart does not exist.

RC Setlist treats it as a new song, and the old entry becomes a tombstone.

This is the same bias every pass uses: **an ambiguous case loses the
association rather than attaching it to the wrong song.** A lost colour is two
clicks to restore. A colour on the wrong card is discovered on stage, in the
dark, while the reader is looking for the next song.

Matching by name similarity would recover more cases. It was considered and
rejected for exactly that reason: it raises the hit rate and introduces the
chance of being confidently wrong.

## Why not stamp an id into the locator name

Writing something like `[id 7f3a]` into every locator would make identity exact,
and it was considered seriously. Two things sank it.

It is only exact if **every** rename goes through RC Setlist. The moment a
locator is renamed by hand in Live and the stamp goes with it — or a locator is
copied, or a section duplicated — identity is lost anyway, and the same
ambiguous case is back. The stamp trades a rare failure for a fragile
dependency on the user never editing in Live.

And the cost is permanent: every locator in the Arrangement carries visible
clutter forever, in the lane the user also reads while working in Live.

Reconciliation does not depend on the user cooperating. Rename in Live, drag in
Live, edit in RC Setlist — it reconciles the same way. It is robust against real
behaviour rather than ideal behaviour.

## Where this lives

`src/core/song-identity.ts` — `reconcileSongIdentities`, a pure function.
Neither the clock nor a random source is read directly; both are injected, so
the reconciliation is a pure function of its inputs and is tested exactly.

`tests/song-identity.test.mjs` covers rename, move, a bis with a repeated title,
renaming one half of a bis, delete and recreate, tombstone ageing, the ambiguous
pair, and order preservation.

## The bug this prevents

An earlier build keyed observed tempo by song **title**. In a set with a bis —
the same song played twice — the two occurrences collapsed into one, and a
value observed at the first contaminated the second. Identity by name alone is
not enough, and this module is why that class of bug does not come back.
