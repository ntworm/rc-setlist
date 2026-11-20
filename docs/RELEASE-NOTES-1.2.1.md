# RC Setlist 1.2.1 release notes

**Release date:** 2026-11-20
**Supported version line:** `1.2.x`
**Also available in Portuguese:** [`pt-BR/NOTAS-DA-VERSAO-1.2.1.md`](pt-BR/NOTAS-DA-VERSAO-1.2.1.md)

## Fixes

- **Ready to pair shows an address that answers.** When the second computer
  (the slave) has two network interfaces on the same subnet, **Ready to pair**
  could list an address the main computer (the master) cannot reach. The
  announcement now carries the slave's LAN addresses, and the master tries them
  on the announced port and lists the first one that answers.
- **A phone on a slave drives the whole show.** When the master is connected,
  commands sent from a phone or from the Live panel on a slave — play, stop,
  jumps, metronome, quantization, count-in, refresh and panic — go up to the
  master, which runs them and sends them to every slave. Without the master
  connected, the slave runs them alone, as before, and says so in the log.

## Upgrading

Live refuses to install over an existing extension folder: remove RC Setlist
in Live's extension settings first (your data folder stays), then replace the
`.ablx` on every computer. The RC Bridge Remote Script did not change, so you do
not need to reinstall it. Master and slaves should all run 1.2.1 for the
phone-on-slave control to work: a 1.2.0 master ignores commands handed up by a
1.2.1 slave, and the slave reports the timeout.
