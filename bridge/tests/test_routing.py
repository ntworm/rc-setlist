"""RC Bridge routing tests.

No Live required: Live's modules are stubbed so the package imports, and the
OSC server is exercised over real loopback sockets.

Run: python -m unittest discover -s bridge/tests
"""

import os
import socket
import sys
import time
import types
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _stub_live_modules():
    for name in (
        "Live",
        "_Framework",
        "_Framework.EncoderElement",
        "ableton",
        "ableton.v2",
        "ableton.v2.control_surface",
        "ableton.v2.control_surface.component",
    ):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)
    sys.modules["ableton.v2.control_surface.component"].Component = object
    sys.modules["ableton.v2.control_surface"].ControlSurface = object
    sys.modules["_Framework.EncoderElement"].EncoderElement = object


_stub_live_modules()

from RCBridge.abletonosc import constants  # noqa: E402
from RCBridge.abletonosc.handler import AbletonOSCHandler  # noqa: E402
from RCBridge.abletonosc.osc_server import OSCServer  # noqa: E402
from RCBridge.pythonosc.osc_message import OscMessage  # noqa: E402
from RCBridge.pythonosc.osc_message_builder import OscMessageBuilder  # noqa: E402


def build(address, *args):
    """Build the raw UDP datagram that ``OscMessageBuilder`` would have sent."""
    builder = OscMessageBuilder(address)
    for arg in args:
        builder.add_arg(arg)
    return builder.build().dgram


class Client:
    """A UDP socket on an ephemeral loopback port, like an RC extension's."""

    def __init__(self):
        """Bind a loopback UDP socket and arm a short receive timeout."""
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.settimeout(0.5)
        self.addr = self.sock.getsockname()

    def send(self, server, address, *args):
        """Send one OSC message to the bridge server's bound address."""
        self.sock.sendto(build(address, *args), server._local_addr)

    def receive(self):
        """Block (briefly) for one inbound message; return ``(address, params)``."""
        data, _ = self.sock.recvfrom(65536)
        message = OscMessage(data)
        return message.address, tuple(message.params)

    def nothing_arrives(self):
        """Return True iff a short blocking receive times out (no message arrived)."""
        try:
            self.sock.recvfrom(65536)
        except TimeoutError:
            return True
        return False

    def close(self):
        """Close the loopback UDP socket."""
        self.sock.close()


class FakeLiveObject:
    """Stands in for a Live object with one listenable property."""

    def __init__(self):
        """Initialize tempo to 120 BPM with an empty listener list."""
        self.tempo = 120.0
        self.listeners = []

    def add_tempo_listener(self, fn):
        """Register ``fn`` for tempo-change notifications."""
        self.listeners.append(fn)

    def remove_tempo_listener(self, fn):
        """Forget ``fn`` for tempo-change notifications."""
        self.listeners.remove(fn)

    def change_tempo(self, value):
        """Update tempo and notify every registered listener."""
        self.tempo = value
        for fn in list(self.listeners):
            fn()


class FakeManager:
    """Bare-bones stand-in for the Live Manager; carries only the OSC server."""

    def __init__(self, server):
        """Remember the bridge's OSC server so handlers can reach it."""
        self.osc_server = server


class TempoHandler(AbletonOSCHandler):
    """Real handler bound to ``FakeLiveObject`` so routing can be tested end-to-end."""

    def __init__(self, manager, target):
        """Wire the handler to the fake Live object before the base inits."""
        self.target = target
        super().__init__(manager)
        self.class_identifier = "song"

    def init_api(self):
        """Register get/start_listen/stop_listen handlers for the ``tempo`` property."""
        self.osc_server.add_handler(
            "/live/song/get/tempo",
            lambda params: self._get_property(self.target, "tempo", params),
        )
        self.osc_server.add_handler(
            "/live/song/start_listen/tempo",
            lambda params: self._start_listen(self.target, "tempo", params),
        )
        self.osc_server.add_handler(
            "/live/song/stop_listen/tempo",
            lambda params: self._stop_listen(self.target, "tempo", params),
        )


class RoutingTest(unittest.TestCase):
    """End-to-end routing tests over real loopback sockets."""

    def setUp(self):
        """Spin up a bridge OSC server, a fake Live object, and two clients."""
        self.server = OSCServer(local_addr=("127.0.0.1", 0))
        self.live = FakeLiveObject()
        self.handler = TempoHandler(FakeManager(self.server), self.live)
        self.handler.class_identifier = "song"
        self.a = Client()
        self.b = Client()

    def tearDown(self):
        """Close both clients and the server socket."""
        self.a.close()
        self.b.close()
        self.server.shutdown()

    def pump(self):
        """Drain one tick of pending OSC traffic on the server."""
        time.sleep(0.02)
        self.server.process()

    def test_bridge_listens_on_its_own_port_by_default(self):
        """The default listen port is 11020, not the stock AbletonOSC pair."""
        # A stock AbletonOSC owns 11000/11001; the bridge must not fight it.
        self.assertEqual(constants.OSC_LISTEN_PORT, 11020)
        self.assertNotIn(constants.OSC_LISTEN_PORT, (11000, 11001))

    def test_reply_goes_back_to_the_socket_that_asked(self):
        """Replies target the asker, not every connected client."""
        self.a.send(self.server, "/live/song/get/tempo")
        self.pump()
        self.assertEqual(self.a.receive(), ("/live/song/get/tempo", (120.0,)))
        self.assertTrue(
            self.b.nothing_arrives(),
            "a bystander must not receive another client's reply",
        )

    def test_two_clients_each_get_their_own_replies(self):
        """Concurrent queries each go to the right socket."""
        self.a.send(self.server, "/live/song/get/tempo")
        self.b.send(self.server, "/live/song/get/tempo")
        self.pump()
        self.assertEqual(self.a.receive()[0], "/live/song/get/tempo")
        self.assertEqual(self.b.receive()[0], "/live/song/get/tempo")

    def test_listener_updates_reach_every_subscriber(self):
        """Listener updates fan out to every subscriber behind one Live listener."""
        self.a.send(self.server, "/live/song/start_listen/tempo")
        self.pump()
        self.assertEqual(
            self.a.receive(),
            ("/live/song/get/tempo", (120.0,)),
            "the current value goes to the new subscriber",
        )
        self.b.send(self.server, "/live/song/start_listen/tempo")
        self.pump()
        self.assertEqual(self.b.receive(), ("/live/song/get/tempo", (120.0,)))
        self.assertTrue(
            self.a.nothing_arrives(),
            "a second subscriber does not re-send the value to the first",
        )
        self.assertEqual(len(self.live.listeners), 1, "one Live listener serves both subscribers")

        self.live.change_tempo(97.5)
        self.assertEqual(self.a.receive(), ("/live/song/get/tempo", (97.5,)))
        self.assertEqual(self.b.receive(), ("/live/song/get/tempo", (97.5,)))

    def test_stop_listen_only_removes_the_requesting_client(self):
        """A stop_listen from one client leaves the other subscribed."""
        self.a.send(self.server, "/live/song/start_listen/tempo")
        self.b.send(self.server, "/live/song/start_listen/tempo")
        self.pump()
        self.a.receive()
        self.b.receive()

        self.b.send(self.server, "/live/song/stop_listen/tempo")
        self.pump()
        self.assertEqual(
            len(self.live.listeners),
            1,
            "a is still subscribed, so Live keeps its listener",
        )
        self.live.change_tempo(110.0)
        self.assertEqual(self.a.receive(), ("/live/song/get/tempo", (110.0,)))
        self.assertTrue(self.b.nothing_arrives())

        self.a.send(self.server, "/live/song/stop_listen/tempo")
        self.pump()
        self.assertEqual(self.live.listeners, [], "the last unsubscribe removes the Live listener")

    def test_reload_clears_every_subscription(self):
        """A handler reload tears down every Live listener and topic subscriber."""
        self.a.send(self.server, "/live/song/start_listen/tempo")
        self.b.send(self.server, "/live/song/start_listen/tempo")
        self.pump()
        self.handler.clear_api()
        self.assertEqual(self.live.listeners, [])
        self.assertEqual(self.server.subscribers("song/tempo/()"), ())

    def test_a_vanished_subscriber_never_costs_the_remaining_client_a_tick(self):
        """A dropped subscriber must not stall the bridge's tick."""
        # Windows reports a send to a closed port as a reset on the next receive.
        # The bridge must keep draining its socket instead of giving the tick up.
        self.a.send(self.server, "/live/song/start_listen/tempo")
        self.pump()
        self.a.receive()
        self.a.close()
        self.live.change_tempo(99.0)
        self.b.send(self.server, "/live/song/get/tempo")
        self.pump()
        self.assertEqual(self.b.receive(), ("/live/song/get/tempo", (99.0,)))
        self.a = Client()  # for tearDown

    def test_a_silent_subscriber_is_dropped_when_its_lease_runs_out(self):
        """Subscribers that stop renewing are forgotten, not published to forever."""
        # A client that was restarted lives on a new port; the old one is never
        # heard from again and must not be published to forever.
        clock = [1000.0]
        self.server._clock = lambda: clock[0]
        self.a.send(self.server, "/live/song/start_listen/tempo")
        self.b.send(self.server, "/live/song/start_listen/tempo")
        self.pump()
        self.a.receive()
        self.b.receive()
        clock[0] += 30.0
        self.b.send(self.server, "/live/song/get/tempo")  # b renews its lease
        self.pump()
        self.b.receive()
        clock[0] += 31.0  # a has been silent for 61 s, b for 31 s
        self.live.change_tempo(101.0)
        self.assertTrue(self.a.nothing_arrives())
        self.assertEqual(self.b.receive(), ("/live/song/get/tempo", (101.0,)))
        self.assertEqual(self.server.subscribers("song/tempo/()"), (self.b.addr,))


if __name__ == "__main__":
    unittest.main()
