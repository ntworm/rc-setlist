"""RC Bridge protocol layer: OSC surface for Ableton Live."""

import logging
from typing import Any

from ableton.v2.control_surface.component import Component

from .osc_server import OSCServer


class AbletonOSCHandler(Component):
    """Common base for every Live-object handler (song, track, clip, scene...)."""

    def __init__(self, manager):
        """Wire the handler to its Live-side object and its OSC server."""
        super().__init__()

        self.logger = logging.getLogger("abletonosc")
        self.manager = manager
        self.osc_server: OSCServer = self.manager.osc_server
        self.init_api()
        self.listener_functions = {}
        self.listener_objects = {}
        self.class_identifier = None

    def init_api(self):
        """Override in subclasses to register handlers for the Live object."""
        pass

    def clear_api(self):
        """Drop every listener the handler registered with the OSC server."""
        self._clear_listeners()

    #--------------------------------------------------------------------------------
    # Generic callbacks
    #--------------------------------------------------------------------------------
    def _call_method(self, target, method, params: tuple | None = ()):
        """Dispatch a method call on a Live object and log it."""
        self.logger.info(
            f"Calling method for {self.class_identifier}: {method} (params {str(params)})"
        )
        getattr(target, method)(*params)

    def _set_property(self, target, prop, params: tuple) -> None:
        """Write a single Live object attribute and log it."""
        self.logger.info(
            f"Setting property for {self.class_identifier}: {prop} (new value {params[0]})"
        )
        setattr(target, prop, params[0])

    def _get_property(self, target, prop, params: tuple | None = ()) -> tuple[Any]:
        """Read one Live object attribute, log it, and return it with the params tuple."""
        try:
            value = getattr(target, prop)
        except RuntimeError:
            #--------------------------------------------------------------------------------
            # Gracefully handle errors, which may occur when querying parameters that don't apply
            # to a particular object (e.g. track.fold_state for a non-group track)
            #--------------------------------------------------------------------------------
            value = None
        self.logger.info(
            f"Getting property for {self.class_identifier}: {prop} = {value}"
        )
        return (value, *params)

    def _listener_topic(self, prop, params: tuple) -> str:
        """Build the internal subscriber topic key for one (prop, params) pair."""
        return f"{self.class_identifier}/{prop}/{repr(tuple(params))}"

    def _start_listen(self, target, prop, params: tuple | None = (), getter=None) -> None:
        """Start listening for `prop` on `target` and publish changes to subscribers.

        One Live listener serves every subscriber; the bridge keeps the Live listener
        alive as long as anyone is subscribed.

        Args:
            target: Live object whose attribute we watch.
            prop: Attribute name on `target`.
            params: Index tuple (e.g. track id, clip id).
            getter: Optional callable replacing ``getattr(target, prop)``.
        """
        params = tuple(params)
        listener_key = (prop, params)
        topic = self._listener_topic(prop, params)
        osc_address = f"/live/{self.class_identifier}/get/{prop}"

        def read_value():
            if getter is None:
                value = getattr(target, prop)
            else:
                value = getter(params)
            if type(value) is not tuple:
                value = (value,)
            return value

        def property_changed_callback():
            value = read_value()
            self.logger.debug(
                f"Property {prop} changed of {self.class_identifier} {str(params)}: {value}"
            )
            self.osc_server.publish(topic, osc_address, (*params, *value,))

        if listener_key not in self.listener_functions:
            self.logger.info(
                f"Adding listener for {self.class_identifier} {str(params)}, property: {prop}"
            )
            add_listener_function_name = f"add_{prop}_listener"
            add_listener_function = getattr(target, add_listener_function_name)
            add_listener_function(property_changed_callback)
            self.listener_functions[listener_key] = property_changed_callback
            self.listener_objects[listener_key] = target

        subscriber = self.osc_server.current_remote_addr
        self.osc_server.subscribe(topic, subscriber)
        #--------------------------------------------------------------------------------
        # Immediately send the current value, to this subscriber only
        #--------------------------------------------------------------------------------
        value = read_value()
        self.osc_server.send(osc_address, (*params, *value,), remote_addr=subscriber)

    def _stop_listen(
        self,
        target,
        prop,
        params: tuple[Any] | None = (),
        everyone: bool = False,
    ) -> None:
        """Unsubscribe one (or every) client; tear down the Live listener when empty.

        The Live listener is removed only once nobody is subscribed any more, or
        when ``everyone`` is set (a reload clears every subscription).
        """
        params = tuple(params)
        listener_key = (prop, params)
        topic = self._listener_topic(prop, params)
        if everyone:
            for subscriber in self.osc_server.subscribers(topic):
                self.osc_server.unsubscribe(topic, subscriber)
        else:
            remaining = self.osc_server.unsubscribe(topic, self.osc_server.current_remote_addr)
            if remaining > 0:
                return
        if listener_key in self.listener_functions:
            self.logger.info(
                f"Removing listener for {self.class_identifier} {str(params)}, property {prop}"
            )
            listener_function = self.listener_functions[listener_key]
            remove_listener_function_name = f"remove_{prop}_listener"
            remove_listener_function = getattr(target, remove_listener_function_name)
            try:
                remove_listener_function(listener_function)
            except RuntimeError as e:
                #--------------------------------------------------------------------------------
                # This exception may be thrown when an observer is no longer
                # connected -- e.g., when trying to stop listening for a clip
                # property of a clip that has been deleted. Ignore as benign.
                #--------------------------------------------------------------------------------
                self.logger.info(f"Exception whilst removing listener (likely benign): {e}")

            del self.listener_functions[listener_key]
            del self.listener_objects[listener_key]
        else:
            self.logger.warning(f"No listener function found for property: {prop} ({str(params)})")

    def _clear_listeners(self):
        """Drop every listener this handler owns (used on reload)."""
        for listener_key in list(self.listener_functions.keys())[:]:
            target = self.listener_objects[listener_key]
            prop, params = listener_key
            self._stop_listen(target, prop, params, everyone=True)
