# Release notes — RC Setlist 1.1.0

**Release date:** 2026-11-06
**Supported version line:** `1.1.x`
**Also available in Portuguese:** [`pt-BR/NOTAS-DA-VERSAO-1.1.0.md`](pt-BR/NOTAS-DA-VERSAO-1.1.0.md)

Changes in 1.1.0, with the new Live panel first.

## Highlights

- **Live panel.** Three tabs: Main, Setlists, Network. Main shows one QR code,
  Stage Control by default, and a button that switches it to the Performance
  view; below it, the active setlist, song count, show time and song list.
- **Setlist management in the panel.** Activate, rename, delete, create and
  restore setlists while the transport is stopped. A delete is confirmed in
  the row and can be undone from the Deleted list.
- **Setlist packages.** _Export all_ writes the setlists of the Live Set
  (order, song colours and notes, lyrics) to one `.rcsetlist` file. _Import_
  adds the setlists of a package to the existing ones; a duplicate name gets a
  number, and a failed import is rolled back. Files are kept in the `packages`
  folder of the extension data, because Live allows an extension to write only
  there; the panel shows the path.
- **Second computer.** Pair a second computer running Live with a six-digit
  code. Play, Stop, jumps, click, quantization, count-in, refresh and panic are
  sent to it; setlist and marker editing stay on the main computer. A second
  status dot in the Stage Control header is green when the link is up and the
  markers match, amber when the markers differ, red when it does not answer.
- **Collapsible song list.** The three-dot button next to a song collapses its
  sections; _Fold all / Unfold all_ acts on the whole list. Hold the song name
  or number to jump; drag the grip on the right edge of the card to reorder.
- **Local certificate.** The extension creates a certificate authority for
  this computer, valid for localhost and private network addresses. The
  Network tab shows a QR code for an install page on port `4445`; with the
  certificate installed, the browser opens the pages without a warning.
- **Network address.** The QR code uses the address of the default route
  instead of the first private address, so a second network interface
  (lighting, audio) does not replace the Wi-Fi address.
- **Fixes.** The top bar stays on one row in both languages; reordering works
  on Windows; saving works when Live refuses `fsync`; pairing is
  bound to the key of the second computer, so an address change keeps the
  link.

## How to use it

1. On the **second computer**, start the RC Setlist server and open the Live
   panel. Go to the **Network** tab and press **Show** in the **Second
   computer** card. Press **Generate code** and read the six digits.
2. On the **main computer**, open the Live panel, go to the **Network** tab
   and press **Show** in the **Second computer** card. Type the second
   computer's address and the code, and press **Pair**.
3. Put both computers on the same session: Ableton **Link** on, Live's
   **Start Stop Sync** off. The relay does the transport; the native sync
   would do it twice.

A phone that opens the Stage Control page is a controller of the main
computer: it joins the main session and sees the main setlist. Pairing is
for a second machine running Live. macOS is supported on an experimental
basis; Windows is the validated platform.

## What reaches the second computer

**Play**, **Stop**, **jump**, **metronome**, **quantization**, **count-in**,
**refresh** and **panic** are sent to the paired computer. Setlist editing,
marker editing, colours, notes, lyrics, profiles, ordering and the CSV
export stay on the main computer.

## Also in this release

- On a song card, only the song name and number start a jump; the time,
  notes, badges, three-dot button and grip do not. On a touch screen a jump is
  a 500 ms hold.
- The _Fold all / Unfold all_ state is stored on the device, per setlist.
- Pairing a computer with itself is refused, and the panel states when the
  code has to be generated on the second computer.
- PANIC cancels a running count-in.

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
