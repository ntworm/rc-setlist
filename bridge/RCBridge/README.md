# RC Bridge

The Ableton Live remote script that Ableton RC Setlist talks to. It is a fork
of [AbletonOSC](https://github.com/ideoforms/AbletonOSC) by Daniel John Jones
and contributors (MIT — see `LICENSE.md`), taken at upstream commit
`0ca68214bd62c9b5cb641ca34006cfd70ba94430` (2025-11-19). The OSC address
space is AbletonOSC's; anything that speaks AbletonOSC speaks RC Bridge.

## Why a fork

AbletonOSC listens on port 11000 and sends every reply and every listener
update to one fixed port, 11001, on the machine that asked. That is one client
per machine. Two RC extensions in the same Live (RC Setlist and RC Surface)
cannot both hear it, and the one that loses the port gets nothing. It also
logs every property read at INFO, which for a tool polling the playhead ten
times a second means a log file that grows without bound.

## What is different

- **Own port.** RC Bridge listens on **11020**, so it runs beside a stock
  AbletonOSC without either failing to bind. (`abletonosc/constants.py`)
- **Replies go to whoever asked** — host *and* port — instead of a fixed
  response port. A client binds any port it likes. (`osc_server.py`,
  `process_message`)
- **Listener updates are published to every subscriber.** One Live listener per
  property serves any number of clients; `start_listen` subscribes the sender,
  `stop_listen` unsubscribes only the sender, and the Live listener is removed
  when nobody is left. A subscriber that goes silent for 60 s is dropped.
  (`osc_server.py` subscriptions, `handler.py`, the beat listener in `song.py`)
- **A reset from a closed client port does not cost a tick** on Windows.
  (`osc_server.py`, `process`)
- **`/live/rcbridge/version`** answers `("RC Bridge", version, upstream)`, so a
  client can tell the fork from a stock AbletonOSC before choosing how to
  listen. (`manager.py`)
- **Log level defaults to `warning`.** `/live/api/set/log_level` raises it.

Everything else is upstream, untouched: `pythonosc/`, the track/clip/device/
scene/view handlers, the MIDI map.

## Tests

`python -m unittest discover -s bridge/tests` — Live's modules are stubbed, the
OSC server runs over real loopback sockets. `npm run test:bridge` from the
repository root finds a Python for you.

## Installing

The installation kit ships `Install-RC-Bridge.cmd` / `Install RC Bridge.command`.
By hand: copy this folder into Live's `User Library/Remote Scripts/` and choose
**RCBridge** under Settings › Link, Tempo & MIDI › Control Surface. The
extension cannot do the copy itself — Live's ExtensionHost sandboxes the
filesystem to the extension's own directories.

Beyond the routing, the fork exposes `last_event_time` (read-only, the beat of
the last Arrangement event) which upstream never did; RC Setlist reads it for
the show's total duration.
