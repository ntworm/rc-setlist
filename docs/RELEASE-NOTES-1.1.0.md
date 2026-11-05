# Release notes — RC Setlist 1.1.0

**Release date:** 2026-11-05
**Supported version line:** `1.1.x`
**Also available in Portuguese:** [`pt-BR/NOTAS-DA-VERSAO-1.1.0.md`](pt-BR/NOTAS-DA-VERSAO-1.1.0.md)

One show, two computers. The main computer keeps Live and the operator; the
second computer follows it, and the transport commands the operator gives are
relayed to it over a link whose certificate is pinned.

## Highlights

- **A "Second computer" row in the Live panel.** The second computer prints
  a six-digit code, the main computer types its address and the code, and
  the two are paired. The row says what the link is doing: not paired,
  connected, not answering, different markers, or a certificate that changed
  and needs a new pairing.
- **A second dot in the Stage Control header.** Green when the second
  computer is connected and both read the same markers, amber when it is
  connected and the markers differ, red when it is not answering or its
  certificate changed, and no dot at all when nothing is paired.
- **The pairing route answers over TLS only.** The code lives for ten
  minutes, works exactly once, dies after five wrong guesses, and the
  attempts that reach it are rate limited per address and in total.
- **The jump travels by beat.** The two computers may hold the songs in
  another order, so a jump crosses the wire as the beat it lands on
  (`jump_time`) and the receiving side finds the marker that sits there.
- **The pairing code can be read again.** The panel redraws itself with the
  code that is already alive, so the number on the screen is the number that
  opens the door.

## How to use it

1. On the **second computer**, start the RC Setlist server and open the Live
   panel. Press **Generate code** and read the six digits.
2. On the **main computer**, open the Live panel, expand the **Second
   computer** row, type the second computer's address and the code, and
   press **Pair**.
3. Put both computers on the same session: Ableton **Link** on, Live's
   **Start Stop Sync** off. The relay does the transport; the native sync
   would do it twice.

A phone that opens the Stage Control page is still a controller of the main
computer — it joins the main session and sees the main setlist. Pairing is
for a second machine running Live. macOS is supported here on an
experimental basis; Windows is the validated platform.

## What reaches the second computer

**Play**, **Stop**, **jump**, **metronome**, **quantization**, **count-in**,
**refresh** and **panic** travel to the paired computer. Setlist editing,
marker editing, colours, notes, lyrics, profiles, ordering and the CSV
export stay on the main computer.

## Also in this release

- **Fold the song list.** The three dots beside a song name fold that song's
  sections away and bring them back; **Fold all / Unfold all** in the
  "Songs in project" bar acts on every song. The choice is kept on the
  device, per setlist.
- **One place for each job on a song card.** Hold the song **name** to jump;
  the number, the time and the empty space do nothing. Reorder by dragging
  the **grip** on the right edge of the card, with a mouse or a finger.
  Holding the three dots no longer jumps.
- **The phone certificate.** The extension creates a certificate authority
  for this computer, limited to localhost and private addresses, and signs
  its own server certificate with it. A new **Phone certificate** row in the
  Live panel shows a QR to a plain page on port 4445 where a phone downloads
  and installs it once; after that the browser stops warning.
- **The QR points at the right network.** The address in the QR and in the
  pairing row is the one the system really routes through, so a computer
  with a lighting or audio network cable and Wi-Fi at the same time
  announces the Wi-Fi.
- **The top bar keeps one row** in English and Portuguese; longer words
  shrink its text instead of pushing buttons to a second row.
- **Reordering works on Windows again**, and saving no longer fails inside
  Live when the file system refuses `fsync`.
- **Pairing fixes.** The second computer is pinned by its key, so a new
  network address on either side no longer breaks the link; pairing a
  computer with itself is refused; the panel says when the code has to be
  generated on the second computer; PANIC cancels a running count-in.

## Contracts

`docs/CONTRACTS.md` (and `docs/pt-BR/CONTRATOS.md`) now describe the
pairing route, the peer credential, the `jump_time` frame and the
`peerStatus` field of the state frame.

## Upgrading from 1.0

Nothing to migrate. The pairing is per install and nothing is written
unless the operator pairs a second computer: no second dot and no outgoing
connection until then. Two things are new on the first start: the
extension creates its certificate authority in its data folder and signs a
new server certificate with it, so a phone that accepted the old
certificate asks once more (or stops asking after the phone certificate is
installed), and the install page answers on port 4445 while the server
runs. Live refuses to install over an existing extension folder: remove RC
Setlist in Live's extension settings first; the data folder stays.
