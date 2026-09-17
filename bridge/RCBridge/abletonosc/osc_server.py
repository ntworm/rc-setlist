"""RC Bridge protocol layer: OSC surface for Ableton Live."""

import errno
import logging
import re
import socket
import time
import traceback
from collections.abc import Callable

from ..pythonosc.osc_bundle import OscBundle
from ..pythonosc.osc_message import OscMessage, ParseError
from ..pythonosc.osc_message_builder import BuildError, OscMessageBuilder
from .constants import OSC_LISTEN_PORT, OSC_RESPONSE_PORT

#--------------------------------------------------------------------------------
# A subscriber that has not sent anything for this long is dropped. Every RC
# client polls the transport several times a second, so a live client renews
# its lease constantly; a client that was closed or restarted on another port
# stops renewing and is forgotten instead of receiving updates forever.
#--------------------------------------------------------------------------------
SUBSCRIBER_LEASE_SECONDS = 60.0


class OSCServer:
    """Bespoke OSC UDP server (replaces pythonosc's blocking one) with subscribers."""

    def __init__(
        self,
        local_addr: tuple[str, int] = ('0.0.0.0', OSC_LISTEN_PORT),
        remote_addr: tuple[str, int] = ('127.0.0.1', OSC_RESPONSE_PORT),
    ):
        """Bind the server socket and remember the default reply target.

        Implemented because pythonosc's OSC server causes a beachball when
        handling incoming messages.

        Args:
            local_addr: Local (host, port) to bind. ``0.0.0.0`` listens on every
                IPv4 interface, including loopback.
            remote_addr: Default (host, port) for replies when not overridden.
        """
        self._local_addr = local_addr
        self._remote_addr = remote_addr
        self._response_port = remote_addr[1]

        self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._socket.setblocking(0)
        self._socket.bind(self._local_addr)
        self._local_addr = self._socket.getsockname()
        self._callbacks = {}

        #--------------------------------------------------------------------------------
        # RC Bridge: the sender of the message currently being handled, so that a
        # handler registering a listener can subscribe that sender; and the
        # subscription registry itself, keyed by topic. Upstream AbletonOSC sends
        # every reply and every listener update to one fixed port, which means one
        # client per machine. Two RC extensions in one Live need both to hear it.
        #--------------------------------------------------------------------------------
        self.current_remote_addr = None
        self._subscribers = {}
        self._last_seen = {}
        self._clock = time.monotonic

        self.logger = logging.getLogger("abletonosc")
        self.logger.info(
            "Starting OSC server (local %s, response port %d)",
            str(self._local_addr),
            self._response_port,
        )

    def add_handler(self, address: str, handler: Callable) -> None:
        """Register ``handler`` for OSC ``address`` (wildcard ``*`` supported)."""
        self._callbacks[address] = handler

    def clear_handlers(self) -> None:
        """Drop every registered handler."""
        self._callbacks = {}

    #--------------------------------------------------------------------------------
    # Subscriptions (RC Bridge)
    #--------------------------------------------------------------------------------
    def subscribe(self, topic: str, remote_addr: tuple[str, int]) -> int:
        """Add a client to the subscriber set for ``topic``; returns the new size."""
        if remote_addr is None:
            return len(self._subscribers.get(topic, ()))
        remote_addr = tuple(remote_addr)
        self._subscribers.setdefault(topic, set()).add(remote_addr)
        self._last_seen.setdefault(remote_addr, self._clock())
        return len(self._subscribers[topic])

    def unsubscribe(self, topic: str, remote_addr: tuple[str, int]) -> int:
        """Drop a client from a topic; returns how many subscribers remain."""
        subscribers = self._subscribers.get(topic)
        if not subscribers:
            return 0
        if remote_addr is not None:
            subscribers.discard(tuple(remote_addr))
        if not subscribers:
            del self._subscribers[topic]
            return 0
        return len(subscribers)

    def subscribers(self, topic: str) -> tuple[tuple[str, int], ...]:
        """Return every currently-subscribed (host, port) for ``topic``."""
        return tuple(sorted(self._subscribers.get(topic, ())))

    def clear_subscriptions(self) -> None:
        """Forget every subscriber across every topic (used on reload)."""
        self._subscribers = {}

    def publish(self, topic: str, address: str, params: tuple = ()) -> int:
        """Send one OSC update to every active subscriber of ``topic``.

        Returns how many subscribers were reached (expired or dead clients
        are dropped, not reported).
        """
        sent = 0
        now = self._clock()
        for remote_addr in list(self._subscribers.get(topic, ())):
            if now - self._last_seen.get(remote_addr, now) > SUBSCRIBER_LEASE_SECONDS:
                self.unsubscribe(topic, remote_addr)
                continue
            try:
                self.send(address, params, remote_addr=remote_addr)
                sent += 1
            except OSError:
                self.unsubscribe(topic, remote_addr)
        return sent

    def touch(self, remote_addr: tuple[str, int]) -> None:
        """Renew the lease of a client that just sent something."""
        self._last_seen[tuple(remote_addr)] = self._clock()

    def send(
        self,
        address: str,
        params: tuple = (),
        remote_addr: tuple[str, int] = None,
    ) -> None:
        """Send one OSC message to ``remote_addr`` (default reply target).

        Args:
            address: OSC address (e.g. ``/frequency``).
            params: Tuple of zero or more OSC args.
            remote_addr: (host, port); falls back to the default reply target.
        """
        msg_builder = OscMessageBuilder(address)
        for param in params:
            msg_builder.add_arg(param)

        try:
            msg = msg_builder.build()
            if remote_addr is None:
                remote_addr = self._remote_addr
            self._socket.sendto(msg.dgram, remote_addr)
        except BuildError:
            self.logger.error(f"AbletonOSC: OSC build error: {traceback.format_exc()}")

    def process_message(self, message, remote_addr):
        """Set the current sender, dispatch, then clear it."""
        #--------------------------------------------------------------------------------
        # RC Bridge: a reply goes back to the socket that asked - host and port -
        # not to a fixed response port. Handlers see the sender through
        # current_remote_addr while they run.
        #--------------------------------------------------------------------------------
        response_addr = tuple(remote_addr)
        self.current_remote_addr = response_addr
        try:
            self._process_message(message, response_addr)
        finally:
            self.current_remote_addr = None

    def _process_message(self, message, response_addr):
        if message.address in self._callbacks:
            callback = self._callbacks[message.address]
            rv = callback(message.params)

            if rv is not None:
                assert isinstance(rv, tuple)
                self.send(
                    address=message.address,
                    params=rv,
                    remote_addr=response_addr,
                )
        elif "*" in message.address:
            regex = message.address.replace("*", "[^/]+")
            for callback_address, callback in self._callbacks.items():
                if re.match(regex, callback_address):
                    try:
                        rv = callback(message.params)
                    except ValueError:
                        #--------------------------------------------------------------------------------
                        # Don't throw errors for queries that require more arguments
                        # (e.g. /live/track/get/send with no args)
                        #--------------------------------------------------------------------------------
                        continue
                    except AttributeError:
                        #--------------------------------------------------------------------------------
                        # Don't throw errors when trying to create listeners
                        # for properties that can't be listened for
                        # (e.g. can_be_armed, is_foldable)
                        #--------------------------------------------------------------------------------
                        continue
                    if rv is not None:
                        assert isinstance(rv, tuple)
                        self.send(
                            address=callback_address,
                            params=rv,
                            remote_addr=response_addr,
                        )
        else:
            self.logger.error(f"AbletonOSC: Unknown OSC address: {message.address}")

    def process_bundle(self, bundle, remote_addr):
        """Recurse into ``bundle`` and process each element (message or nested bundle)."""
        for i in bundle:
            if OscBundle.dgram_is_bundle(i.dgram):
                self.process_bundle(i, remote_addr)
            else:
                self.process_message(i, remote_addr)

    def parse_bundle(self, data, remote_addr):
        """Decode one datagram (message or bundle) and dispatch it."""
        if OscBundle.dgram_is_bundle(data):
            try:
                bundle = OscBundle(data)
                self.process_bundle(bundle, remote_addr)
            except ParseError:
                self.logger.error(
                    f"AbletonOSC: Error parsing OSC bundle: {traceback.format_exc()}"
                )
        else:
            try:
                message = OscMessage(data)
                self.process_message(message, remote_addr)
            except ParseError:
                self.logger.error(
                    f"AbletonOSC: Error parsing OSC message: {traceback.format_exc()}"
                )

    def process(self) -> None:
        """Synchronously drain the OSC socket of every pending datagram."""
        resets = 0
        while True:
            try:
                #--------------------------------------------------------------------------------
                # Loop until no more data is available.
                #--------------------------------------------------------------------------------
                data, remote_addr = self._socket.recvfrom(65536)
            except OSError as e:
                if e.errno == errno.ECONNRESET and resets < 64:
                    #--------------------------------------------------------------------------------
                    # Windows reports a UDP send to a closed port as a reset on the next
                    # receive. It is benign — the stale subscriber is dropped when its
                    # lease runs out — and it must not cost this tick: keep draining.
                    #--------------------------------------------------------------------------------
                    resets += 1
                    continue
                if e.errno == errno.EAGAIN or e.errno == errno.EWOULDBLOCK:
                    #--------------------------------------------------------------------------------
                    # No data waiting on the non-blocking socket: this tick is done.
                    #--------------------------------------------------------------------------------
                    return
                if e.errno == errno.ECONNRESET:
                    self.logger.warning(
                        "RC Bridge: too many resets from closed client ports in one tick"
                    )
                    return
                #--------------------------------------------------------------------------------
                # Something more serious has happened
                #--------------------------------------------------------------------------------
                self.logger.error(f"RC Bridge: Socket error: {traceback.format_exc()}")
                return
            try:
                #--------------------------------------------------------------------------------
                # The most recent client is the default target for unsolicited
                # messages only (/live/error). Replies and listener updates are
                # routed to their own senders and subscribers.
                #--------------------------------------------------------------------------------
                self._remote_addr = tuple(remote_addr)
                self.touch(remote_addr)
                self.parse_bundle(data, remote_addr)
            except Exception as e:
                self.logger.error(f"RC Bridge: Error handling OSC message: {e}")
                self.logger.warning(f"RC Bridge: {traceback.format_exc()}")

    def shutdown(self) -> None:
        """Close the server socket."""
        self._socket.close()
