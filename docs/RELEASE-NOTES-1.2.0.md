# RC Setlist 1.2.0 release notes

**Release date:** 2026-11-18
**Supported version line:** `1.2.x`
**Also available in Portuguese:** [`pt-BR/NOTAS-DA-VERSAO-1.2.0.md`](pt-BR/NOTAS-DA-VERSAO-1.2.0.md)

## New features

- **Several second computers.** One main computer, the **master**, pairs
  several second computers, the **slaves**. The **Second computer** card of the
  **Network** tab lists each slave with its state and its own **Unpair**, and
  every transport command goes to all of them. Pairing or unpairing one slave
  leaves the links of the others up.
- **Master and slave in the panel.** The bar at the bottom of the Live panel
  says the role of this computer: **Master** with how many slaves are
  connected, or **Slave** and whether the master is talking to it. A slave
  remembers its master after a restart and names it in the card.
- **The slave keeps the beat of the master.** The master sends where its
  playhead is twice a second. When Link launched a Play or a quantized jump one
  bar late on a slave, the slave moves by the whole beats it is off; when it
  missed a Play it starts on the next bar of the master, and when it missed a
  Stop it stops. Nothing moves while a jump waits for its grid, while a loop
  runs, under panic or a lock, or right after a relayed command, and a gap that
  is not whole beats is reported as a Link problem instead of corrected.
- **Ready to pair.** While a slave shows a pairing code it announces its name
  and port on the local network, on UDP port `4447`. The master lists it under
  **Ready to pair**, and a click fills the address. The announcement never
  carries the code.
- **Bring from master.** On a slave, **Bring from master** in the **Import**
  card brings the active setlist of the master, with its order, song colours,
  notes and lyrics, as a new setlist of the slave. Live has to be stopped on the
  slave.
- **Show mode.** A switch in the Stage Control top bar picks **Edit** or
  **Show**. Show hides the setup controls, the fold dots, the drag grip and the
  setlist selector, refuses the marker editor and reordering, and keeps only
  the active song open, pinned at the top of the list on every screen.
- **Next Song Now and Previous Song Now.** Two MIDI and keyboard actions jump
  at once while playing, without waiting for the quantization grid.
- **Time signature changes.** The bar display counts the bars of each stretch
  of the set in its own time signature, and counts beats in the unit of the
  denominator, so 6/8 shows six eighths per bar.
- **Rename a package.** A double click on a package name in the **Import**
  card renames the file in the packages folder.

## Fixes

- **Setlists on macOS.** The Live Set is recognised by the title of Live's
  window on macOS too, through System Events with the Accessibility
  permission, so the setlists no longer start empty after every restart of
  Live.
- **Manage setlists** says why it is locked: not connected, read-only page,
  Live playing or the Live Set changing. A refused setlist command no longer
  leaves the window waiting.
- **Pairing** accepts the address with its port, as the card shows it, and a
  code typed with spaces; a refused pairing names the address it read.
- A relayed command is dropped only when the link to the slave is stalled, not
  behind a frame that is still on its way out.
- A command sent again with the same id gets its saved status back instead of
  no answer.
- The token files and `peer.json` are kept owner-only, and user data is written
  atomically.

## Other changes

- **Check OSC** runs from the OSC status in the bar at the bottom of the Live
  panel; the button left the bar.

## Upgrading from 1.1

Nothing to migrate: a pairing stored by 1.1 loads as the first slave of the
list. Live refuses to install over an existing extension folder: remove RC
Setlist in Live's extension settings first; the data folder stays. Install
1.2.0 on the master and on every slave. On macOS, allow Ableton Live in
**System Settings > Privacy & Security > Accessibility** and **Automation**
when macOS asks, then restart RC Setlist. Setlists made on a Mac before 1.2.0
were kept in temporary folders, which stay on disk for manual recovery.
