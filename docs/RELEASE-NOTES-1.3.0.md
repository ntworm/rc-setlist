# RC Setlist 1.3.0 release notes

**Release date:** 2026-11-25
**Supported version line:** `1.3.x`
**Also available in Portuguese:** [`pt-BR/NOTAS-DA-VERSAO-1.3.0.md`](pt-BR/NOTAS-DA-VERSAO-1.3.0.md)

Windows is the validated platform; macOS is experimental. This release is about
the link between the main computer (the **master**) and the second computers
(the **slaves**). The [user guide](USER-GUIDE.md) describes each state and
alert, and [troubleshooting](TROUBLESHOOTING.md) says what to do about each one.

## New features

- **Link health.** Stage Control, in Edit and in Show mode, `/performance` and
  the Live panel show one row per paired computer with its state, **OK**,
  **UNSTABLE** or **DOWN**, the reason, the round-trip time (`RTT`), the drops
  in the last 5 minutes, the last drop and the last frame seen. The two
  computers exchange heartbeats in both directions and measure the link.
- **Warm-up, recovery and oscillation hold.** A new link stays **UNSTABLE** for
  a `20 s` warm-up. After a drop, a lost heartbeat (`> 1.5 s`) or high latency
  (`RTT p95 > 150 ms`), it needs `60 s` without trouble to return to **OK**. A
  link that drops `3` or more times in `5 min` stays **UNSTABLE** for `5 min`.
- **Acknowledge.** When an **UNSTABLE** link has calmed down, **Acknowledge** on
  Stage Control or in the Live panel shortens the clean window to `10 s` on
  both computers. It never skips the warm-up or the `5 min` hold.
- **Link-down alarm.** When a link goes **DOWN** (no frame for `3 s`, the socket
  closed, or Live or OSC unavailable on either computer), a full-screen red
  alarm opens on Stage Control and `/performance`. **Dismiss alarm** closes it
  and keeps a red **LINK DOWN** badge above the transport dock. **Stop** stays
  reachable above the alarm.
- **Status dot.** The second-computer dot on Stage Control follows the measured
  state: green for **OK**, amber for **UNSTABLE**, red for **DOWN**,
  **DIFFERENT VERSIONS** or **CERTIFICATE CHANGED**.
- **Confirmed commands.** The slave confirms every command the master sends,
  and the master resends it every `150 ms` until its deadline. Stage Control
  shows a `3 s` tick per computer: Pending, Executed or Failed.
- **Command alerts.** A command that misses its deadline or fails on the slave
  shows `SLAVE DID NOT EXECUTE: <command>` on Stage Control and in the Live
  panel. A confirmation that arrives after the deadline changes it to
  `Executed late: <command>`.
- **Safety resend for Stop and Panic.** While the master stays stopped or in
  panic, Stop and Panic do not expire: they are resent across reconnects. If
  the slave has not confirmed within `1 s`, `SLAVE STILL NOT STOPPED` shows
  until it does. A delayed Play behind a newer Stop or Panic is discarded and
  never runs out of order.
- **Stopped playhead follows the master.** When both computers are stopped and
  the slave is more than half a beat away for three targets in a row, the slave
  moves to the master's marker, or to the exact beat between markers. This also
  happens within `2 s` of a reconnect.
- **Out of step.** A playhead mismatch that lasts `3 s` outside a pending
  quantized jump or an active loop shows **UNSTABLE** with the reason **Out of
  step** on both computers.
- **Slave modes.** On a slave, the **Second computer** card of the **Network**
  tab has **Slave mode** with three buttons:
  - **Follow all** (default): the slave runs the master's commands and corrects
    its playhead while playing and while stopped.
  - **Follow transport**: the slave runs the master's commands and corrects its
    playhead while playing; stopped at another beat, it only alerts.
  - **Independent**: the master sends no commands to that slave and raises no
    alert for it, and the slave refuses any that arrive. The master shows an
    **Independent** tag beside that computer.

  The choice is kept after a restart. A slave that ran a 1.3.0 test build with
  the **Auto-correct playhead on slave** checkbox keeps its choice: checked
  becomes **Follow all**, unchecked becomes **Follow transport**.

- **Slave navigation lock.** In **Follow all** and **Follow transport**, while
  the link to the master is up, Stage Control on the slave cannot play, jump,
  count in, or change the metronome, the quantization or the pre-roll. A banner
  says the slave is following the main computer. **Stop**, **Panic** and
  **Refresh** stay available and go up to the master, so a Stop on the slave
  stops the whole show. In **Independent**, Stage Control on the slave runs on
  that computer only.
- **Link protocol check.** Master and slave exchange a link protocol version.
  A computer on another version shows **DIFFERENT VERSIONS**, and no command is
  relayed to it.

## Changes

- **A phone on a slave no longer drives the whole show.** In 1.2.1, play, jump,
  metronome, quantization and count-in commands from a phone or the Live panel
  on a slave went up to the master and moved every computer. In 1.3.0, a slave
  in **Follow all** or **Follow transport** only sends **Stop**, **Panic** and
  **Refresh** up. To navigate on a slave on its own, choose **Independent**.
- **Network tab.** The **Second computer** card sits above the **Certificate**
  card.

## Included from 1.2.1

Version 1.2.1 was tagged without a release page. Its fixes are part of 1.3.0:

- **Ready to pair shows an address that answers.** When a slave has two network
  interfaces on the same subnet, the announcement carries its LAN addresses and
  the master lists the first one that answers on the announced port.
- **Commands from a slave reach the master.** With the master connected, the
  commands a slave hands up are run by the master and sent to every slave; in
  1.3.0 this applies to **Stop**, **Panic** and **Refresh** while the slave
  follows the master.

## Upgrading

Nothing to migrate; the data folder and the pairings stay. Live refuses to
install over an existing extension folder: remove RC Setlist in Live's
extension settings first, then open the `.ablx`. Install 1.3.0 on the master
and on every slave. Both computers must run the same version: when a 1.2.x
computer is paired with a 1.3.0 computer, the 1.3.0 side shows **DIFFERENT
VERSIONS** and no command passes between them. The RC Bridge Remote Script did not change, so you do not need to
reinstall it.
