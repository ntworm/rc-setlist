# RC Setlist 1.1.0 release notes

**Release date:** 2026-11-06
**Supported version line:** `1.1.x`
**Also available in Portuguese:** [`pt-BR/NOTAS-DA-VERSAO-1.1.0.md`](pt-BR/NOTAS-DA-VERSAO-1.1.0.md)

## New features

- **Live panel.** A new Live panel has three tabs: **Main**, **Setlists** and
  **Network**. **Main** shows one QR code, the Stage Control page by default
  and a button that swaps it for the Performance page; below it, the active
  setlist, the song count, the show time and the song list.
- **Setlist management.** The **Setlists** tab activates, renames, deletes,
  creates and restores setlists while the transport is stopped. A delete is
  confirmed in the row and can be undone from the **Deleted setlists** list.
- **Setlist packages.** **Export all** in the **Setlists** tab writes every
  setlist of the Live Set (order, song colours and notes, lyrics) to one
  `.rcsetlist` file, and **Import** adds the setlists of a package to the ones
  already there: a repeated name gets a number, and a failed import is rolled
  back. The files stay in the `packages` folder of the extension data, because
  Live lets an extension write only there, and the panel shows the path.
- **Second computer.** The **Network** tab pairs a second computer running
  Live with a six-digit code. A second status dot in the Stage Control header
  is green when the link is up and the markers match, amber when the markers
  differ and red when the computer does not answer.
- **Collapsible song list.** The three-dot button next to a song folds its
  sections, and **Fold all / Unfold all** acts on the whole list. Hold the
  song name or its number to jump; drag the grip on the right edge of the
  card to reorder.
- **Local certificate.** The extension creates a certificate authority for
  this computer, valid for localhost and private network addresses. The
  **Network** tab shows a QR code for an install page on port `4445`; with the
  certificate installed, the browser opens the pages without a warning.
- **Network address.** The QR code uses the address of the default route
  instead of the first private address, so a second network interface
  (lighting, audio) does not replace the Wi-Fi address.

## Fixes

- The top bar stays on one row in both languages.
- Reordering works on Windows.
- Saving works when Live refuses `fsync`.
- The pairing is bound to the key of the second computer, so an address change
  keeps the link.

## Pairing a second computer

1. On the **second computer**, start the RC Setlist server and open the Live
   panel. Go to the **Network** tab and press **Show** in the **Second
   computer** card. Press **Generate code** and read the six digits.
2. On the **main computer**, open the Live panel, go to the **Network** tab and
   press **Show** in the **Second computer** card. Type the second computer's
   address and the code, and press **Pair**.
3. Put both computers on the same session: Ableton **Link** on, Live's **Start
   Stop Sync** off. RC Setlist relays the transport; the native sync would
   drive it twice.

A phone that opens the Stage Control page is a controller of the main
computer: it joins the main session and sees the main setlist. Pairing is for
a second machine running Live. macOS is supported on an experimental basis;
Windows is the validated platform.

## What reaches the second computer

**Play**, **Stop**, **jump**, **metronome**, **quantization**, **count-in**,
**refresh** and **panic** are sent to the paired computer. Setlist editing,
marker editing, colours, notes, lyrics, profiles, ordering and the CSV export
stay on the main computer.

## Other changes

- On a song card, only the song name and its number start a jump; the time,
  the notes, the badges, the three-dot button and the grip do not. On a touch
  screen a jump is a 500 ms hold.
- The **Fold all / Unfold all** state is stored on the device, per setlist.
- Pairing a computer with itself is refused, and the panel says when the code
  has to be generated on the second computer.
- **panic** cancels a running count-in.

## Contracts

`docs/CONTRACTS.md` (and `docs/pt-BR/CONTRATOS.md`) describe the pairing
route, the peer credential, the `jump_time` frame and the `peerStatus` field
of the state frame.

## Upgrading from 1.0

Nothing to migrate. The pairing is per install and nothing is written unless
the operator pairs a second computer: no second dot and no outgoing connection
until then. On the first start the extension signs a new server certificate,
so a phone that accepted the old certificate asks once more, or stops asking
after the phone certificate is installed. The install page answers while the
server runs. Live refuses to install over an existing extension folder:
remove RC Setlist in Live's extension settings first; the data folder stays.
