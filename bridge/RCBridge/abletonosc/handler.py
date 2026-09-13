from ableton.v2.control_surface.component import Component
from typing import Optional, Tuple, Any
import logging
from .osc_server import OSCServer

class AbletonOSCHandler(Component):
    def __init__(self, manager):
        super().__init__()

        self.logger = logging.getLogger("abletonosc")
        self.manager = manager
        self.osc_server: OSCServer = self.manager.osc_server
        self.init_api()
        self.listener_functions = {}
        self.listener_objects = {}
        self.class_identifier = None

    def init_api(self):
        pass

    def clear_api(self):
        self._clear_listeners()

    #--------------------------------------------------------------------------------
    # Generic callbacks
    #--------------------------------------------------------------------------------
    def _call_method(self, target, method, params: Optional[Tuple] = ()):
        self.logger.info("Calling method for %s: %s (params %s)" % (self.class_identifier, method, str(params)))
        getattr(target, method)(*params)

    def _set_property(self, target, prop, params: Tuple) -> None:
        self.logger.info("Setting property for %s: %s (new value %s)" % (self.class_identifier, prop, params[0]))
        setattr(target, prop, params[0])

    def _get_property(self, target, prop, params: Optional[Tuple] = ()) -> Tuple[Any]:
        try:
            value = getattr(target, prop)
        except RuntimeError:
            #--------------------------------------------------------------------------------
            # Gracefully handle errors, which may occur when querying parameters that don't apply
            # to a particular object (e.g. track.fold_state for a non-group track)
            #--------------------------------------------------------------------------------
            value = None
        self.logger.info("Getting property for %s: %s = %s" % (self.class_identifier, prop, value))
        return (value, *params)

    def _listener_topic(self, prop, params: Tuple) -> str:
        return "%s/%s/%s" % (self.class_identifier, prop, repr(tuple(params)))

    def _start_listen(self, target, prop, params: Optional[Tuple] = (), getter = None) -> None:
        """
        Start listening for the property named `prop` on the Live object `target`.
        `params` is typically a tuple containing the track/clip index.

        getter can be used for a customer getter when we're accessing native objects
        e.g. in view.py we don't return the selected_scene, but the selected_scene index.

        RC Bridge: one Live listener per (prop, params), and any number of
        subscribers behind it. The client that sent this request is subscribed;
        every later change is published to all of them. Upstream registered a
        new listener per request and sent updates to a single fixed port, so a
        second client silently took the updates away from the first.

        Args:
            target:
            prop:
            params:
            getter:
        """
        params = tuple(params)
        listener_key = (prop, params)
        topic = self._listener_topic(prop, params)
        osc_address = "/live/%s/get/%s" % (self.class_identifier, prop)

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
            self.logger.debug("Property %s changed of %s %s: %s" % (prop, self.class_identifier, str(params), value))
            self.osc_server.publish(topic, osc_address, (*params, *value,))

        if listener_key not in self.listener_functions:
            self.logger.info("Adding listener for %s %s, property: %s" % (self.class_identifier, str(params), prop))
            add_listener_function_name = "add_%s_listener" % prop
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
    def _stop_listen(self, target, prop, params: Optional[Tuple[Any]] = (), everyone: bool = False) -> None:
        """
        Unsubscribe the requesting client. The Live listener itself is removed
        only once nobody is subscribed any more, or when `everyone` is set (a
        reload clears every subscription).
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
            self.logger.info("Removing listener for %s %s, property %s" % (self.class_identifier, str(params), prop))
            listener_function = self.listener_functions[listener_key]
            remove_listener_function_name = "remove_%s_listener" % prop
            remove_listener_function = getattr(target, remove_listener_function_name)
            try:
                remove_listener_function(listener_function)
            except Exception as e:
                #--------------------------------------------------------------------------------
                # This exception may be thrown when an observer is no longer connected --
                # e.g., when trying to stop listening for a clip property of a clip that has been deleted.
                # Ignore as it is benign.
                #--------------------------------------------------------------------------------
                self.logger.info("Exception whilst removing listener (likely benign): %s" % e)

            del self.listener_functions[listener_key]
            del self.listener_objects[listener_key]
        else:
            self.logger.warning("No listener function found for property: %s (%s)" % (prop, str(params)))

    def _clear_listeners(self):
        """
        Clears all listener functions, to prevent listeners continuing to report after a reload.
        """
        for listener_key in list(self.listener_functions.keys())[:]:
            target = self.listener_objects[listener_key]
            prop, params = listener_key
            self._stop_listen(target, prop, params, everyone=True)
