from typing import Tuple, Any, Callable
from .constants import OSC_LISTEN_PORT, OSC_RESPONSE_PORT
from ..pythonosc.osc_message import OscMessage, ParseError
from ..pythonosc.osc_bundle import OscBundle
from ..pythonosc.osc_message_builder import OscMessageBuilder, BuildError

import re
import time
import errno
import socket
import logging
import traceback

#--------------------------------------------------------------------------------
# A subscriber that has not sent anything for this long is dropped. Every RC
# client polls the transport several times a second, so a live client renews
# its lease constantly; a client that was closed or restarted on another port
# stops renewing and is forgotten instead of receiving updates forever.
#--------------------------------------------------------------------------------
SUBSCRIBER_LEASE_SECONDS = 60.0

class OSCServer:
    def __init__(self,
                 local_addr: Tuple[str, int] = ('0.0.0.0', OSC_LISTEN_PORT),
                 remote_addr: Tuple[str, int] = ('127.0.0.1', OSC_RESPONSE_PORT)):
        """
        Class that handles OSC server responsibilities, including support for sending
        reply messages.

        Implemented because pythonosc's OSC server causes a beachball when handling
        incoming messages. To investigate, as it would be ultimately better not to have
        to roll our own.

        Args:
            local_addr: Local address and port to listen on.
                        By default, binds to the wildcard address 0.0.0.0, which means listening on
                        every available local IPv4 interface (including 127.0.0.1).
            remote_addr: Remote address to send replies to, by default. Can be overridden in send().
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
        self.logger.info("Starting OSC server (local %s, response port %d)",
                         str(self._local_addr), self._response_port)

    def add_handler(self, address: str, handler: Callable) -> None:
        """
        Add an OSC handler.

        Args:
            address: The OSC address string
            handler: A handler function, with signature:
                     params: Tuple[Any, ...]
        """
        self._callbacks[address] = handler

    def clear_handlers(self) -> None:
        """
        Remove all existing OSC handlers.
        """
        self._callbacks = {}

    #--------------------------------------------------------------------------------
    # Subscriptions (RC Bridge)
    #--------------------------------------------------------------------------------
    def subscribe(self, topic: str, remote_addr: Tuple[str, int]) -> int:
        """
        Add remote_addr to the subscribers of topic. Returns the subscriber count.
        """
        if remote_addr is None:
            return len(self._subscribers.get(topic, ()))
        remote_addr = tuple(remote_addr)
        self._subscribers.setdefault(topic, set()).add(remote_addr)
        self._last_seen.setdefault(remote_addr, self._clock())
        return len(self._subscribers[topic])

    def unsubscribe(self, topic: str, remote_addr: Tuple[str, int]) -> int:
        """
        Remove remote_addr from the subscribers of topic. Returns how many remain.
        """
        subscribers = self._subscribers.get(topic)
        if not subscribers:
            return 0
        if remote_addr is not None:
            subscribers.discard(tuple(remote_addr))
        if not subscribers:
            del self._subscribers[topic]
            return 0
        return len(subscribers)

    def subscribers(self, topic: str) -> Tuple[Tuple[str, int], ...]:
        return tuple(sorted(self._subscribers.get(topic, ())))

    def clear_subscriptions(self) -> None:
        self._subscribers = {}

    def publish(self, topic: str, address: str, params: Tuple = ()) -> int:
        """
        Send one OSC message to every subscriber of topic. A subscriber whose
        socket has gone away is dropped rather than left to raise on every
        update. Returns how many subscribers were sent to.
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

    def touch(self, remote_addr: Tuple[str, int]) -> None:
        """Renew the lease of a client that just sent something."""
        self._last_seen[tuple(remote_addr)] = self._clock()

    def send(self,
             address: str,
             params: Tuple = (),
             remote_addr: Tuple[str, int] = None) -> None:
        """
        Send an OSC message.

        Args:
            address: The OSC address (e.g. /frequency)
            params: A tuple of zero or more OSC params
            remote_addr: The remote address to send to, as a 2-tuple (hostname, port).
                         If None, uses the default remote address.
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
            self.logger.error("AbletonOSC: OSC build error: %s" % (traceback.format_exc()))

    def process_message(self, message, remote_addr):
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
                self.send(address=message.address,
                          params=rv,
                          remote_addr=response_addr)
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
                        # Don't throw errors when trying to create listeners for properties that can't
                        # be listened for (e.g. can_be_armed, is_foldable)
                        #--------------------------------------------------------------------------------
                        continue
                    if rv is not None:
                        assert isinstance(rv, tuple)
                        self.send(address=callback_address,
                                  params=rv,
                                  remote_addr=response_addr)
        else:
            self.logger.error("AbletonOSC: Unknown OSC address: %s" % message.address)

    def process_bundle(self, bundle, remote_addr):
        for i in bundle:
            if OscBundle.dgram_is_bundle(i.dgram):
                self.process_bundle(i, remote_addr)
            else:
                self.process_message(i, remote_addr)

    def parse_bundle(self, data, remote_addr):
        if OscBundle.dgram_is_bundle(data):
            try:
                bundle = OscBundle(data)
                self.process_bundle(bundle, remote_addr)
            except ParseError:
                self.logger.error("AbletonOSC: Error parsing OSC bundle: %s" % (traceback.format_exc()))
        else:
            try:
                message = OscMessage(data)
                self.process_message(message, remote_addr)
            except ParseError:
                self.logger.error("AbletonOSC: Error parsing OSC message: %s" % (traceback.format_exc()))

    def process(self) -> None:
        """
        Synchronously process all data queued on the OSC socket.
        """
        resets = 0
        while True:
            try:
                #--------------------------------------------------------------------------------
                # Loop until no more data is available.
                #--------------------------------------------------------------------------------
                data, remote_addr = self._socket.recvfrom(65536)
            except socket.error as e:
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
                    self.logger.warning("RC Bridge: too many resets from closed client ports in one tick")
                    return
                #--------------------------------------------------------------------------------
                # Something more serious has happened
                #--------------------------------------------------------------------------------
                self.logger.error("RC Bridge: Socket error: %s" % (traceback.format_exc()))
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
                self.logger.error("RC Bridge: Error handling OSC message: %s" % e)
                self.logger.warning("RC Bridge: %s" % traceback.format_exc())

    def shutdown(self) -> None:
        """
        Shutdown the server network sockets.
        """
        self._socket.close()
