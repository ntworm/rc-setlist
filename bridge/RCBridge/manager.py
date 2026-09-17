"""RC Bridge protocol layer: OSC surface for Ableton Live."""

import importlib
import logging
import os
import traceback

import Live
from ableton.v2.control_surface import ControlSurface

from . import abletonosc

logger = logging.getLogger("abletonosc")


class Manager(ControlSurface):
    """Live Remote Script entry point: wires the OSC server and per-object handlers."""

    def __init__(self, c_instance):
        """Build the OSC server, register handlers, and start the 100ms tick."""
        ControlSurface.__init__(self, c_instance)

        # RC Bridge: upstream logged every property read at INFO, which on a
        # setlist tool polling the playhead ten times a second grew the log by
        # gigabytes over a season. Warnings and errors only, unless asked.
        self.log_level = "warning"

        self.handlers = []
        self.midi_mappings = {}

        try:
            self.osc_server = abletonosc.OSCServer()
            self.schedule_message(0, self.tick)

            self.start_logging()
            self.init_api()

            self.show_message(
                f"{abletonosc.RCBRIDGE_NAME} {abletonosc.RCBRIDGE_VERSION}: "
                f"listening for OSC on port {abletonosc.OSC_LISTEN_PORT}"
            )
            logger.warning(
                f"Started {abletonosc.RCBRIDGE_NAME} {abletonosc.RCBRIDGE_VERSION} "
                f"on address {str(self.osc_server._local_addr)}"
            )
        except OSError as msg:
            self.show_message(
                f"{abletonosc.RCBRIDGE_NAME}: couldn't bind to port "
                f"{abletonosc.OSC_LISTEN_PORT} ({msg})"
            )
            logger.error(f"Couldn't bind to port {abletonosc.OSC_LISTEN_PORT} ({msg})")

    def start_logging(self):
        """Write logs to disk and relay error messages back to the client over OSC."""
        module_path = os.path.dirname(os.path.realpath(__file__))
        log_dir = os.path.join(module_path, "logs")
        if not os.path.exists(log_dir):
            os.mkdir(log_dir, 0o755)
        log_path = os.path.join(log_dir, "abletonosc.log")
        self.log_file_handler = logging.FileHandler(log_path)
        self.log_file_handler.setLevel(self.log_level.upper())
        formatter = logging.Formatter("(%(asctime)s) [%(levelname)s] %(message)s")
        self.log_file_handler.setFormatter(formatter)
        logger.addHandler(self.log_file_handler)

        class LiveOSCErrorLogHandler(logging.StreamHandler):
            """Forward every ERROR record to the client as ``/live/error``."""

            def emit(handler, record):
                message = record.getMessage()
                message = message[message.index(":") + 2:]
                try:
                    self.osc_server.send("/live/error", (message,))
                except OSError:
                    # If the connection is dead, silently ignore errors as there's
                    # not much more we can do.
                    pass

        self.live_osc_error_handler = LiveOSCErrorLogHandler()
        self.live_osc_error_handler.setLevel(logging.ERROR)
        logger.addHandler(self.live_osc_error_handler)

    def stop_logging(self):
        """Detach the log file handler and the OSC error forwarder."""
        logger.removeHandler(self.log_file_handler)
        logger.removeHandler(self.live_osc_error_handler)

    def init_api(self):
        """Register the top-level /live/* handlers and every per-object handler."""

        def test_callback(params):
            """Smoke test: reply ``(ok,)`` and show a banner in Live."""
            self.show_message("Received OSC OK")
            return ("ok",)

        def version_callback(params):
            """Let the client tell this fork from a stock AbletonOSC.

            The name, version and upstream commit are returned so a client can
            decide where replies should go before sending any further traffic.
            """
            return (
                abletonosc.RCBRIDGE_NAME,
                abletonosc.RCBRIDGE_VERSION,
                abletonosc.RCBRIDGE_UPSTREAM,
            )

        def reload_callback(params):
            """Reload every bridge module (used during development)."""
            self.reload_imports()

        def get_log_level_callback(params):
            """Return the current bridge log level."""
            return (self.log_level,)

        def set_log_level_callback(params):
            """Update the bridge log level at runtime (debug/info/warning/error/critical)."""
            log_level = params[0]
            assert log_level in ("debug", "info", "warning", "error", "critical")
            self.log_level = log_level
            self.log_file_handler.setLevel(self.log_level.upper())

        def show_message_callback(params):
            """Show a one-line banner inside Live's status bar."""
            self.show_message(params[0])

        self.osc_server.add_handler("/live/test", test_callback)
        self.osc_server.add_handler("/live/rcbridge/version", version_callback)
        self.osc_server.add_handler("/live/api/reload", reload_callback)
        self.osc_server.add_handler("/live/api/get/log_level", get_log_level_callback)
        self.osc_server.add_handler("/live/api/set/log_level", set_log_level_callback)
        self.osc_server.add_handler("/live/api/show_message", show_message_callback)

        with self.component_guard():
            self.handlers = [
                abletonosc.SongHandler(self),
                abletonosc.ApplicationHandler(self),
                abletonosc.ClipHandler(self),
                abletonosc.ClipSlotHandler(self),
                abletonosc.TrackHandler(self),
                abletonosc.DeviceHandler(self),
                abletonosc.ViewHandler(self),
                abletonosc.SceneHandler(self),
                abletonosc.MidiMapHandler(self),
            ]

    def clear_api(self):
        """Drop every per-object handler and the /live/* callbacks."""
        self.osc_server.clear_handlers()
        for handler in self.handlers:
            handler.clear_api()

    def tick(self):
        """Drain the OSC socket once every Live tick (~100ms)."""
        #--------------------------------------------------------------------------------
        # Called once per 100ms "tick".
        # Live's embedded Python implementation does not appear to support threading,
        # and beachballs when a thread is started. Instead, this approach allows
        # long-running processes such as the OSC server to perform operations.
        #--------------------------------------------------------------------------------
        logger.debug("Tick...")
        self.osc_server.process()
        self.schedule_message(1, self.tick)

    def reload_imports(self):
        """Reload every bridge module and rebuild the handler set."""
        try:
            importlib.reload(abletonosc.application)
            importlib.reload(abletonosc.clip)
            importlib.reload(abletonosc.clip_slot)
            importlib.reload(abletonosc.device)
            importlib.reload(abletonosc.handler)
            importlib.reload(abletonosc.osc_server)
            importlib.reload(abletonosc.scene)
            importlib.reload(abletonosc.song)
            importlib.reload(abletonosc.track)
            importlib.reload(abletonosc.view)
            importlib.reload(abletonosc)
        except RuntimeError:
            exc = traceback.format_exc()
            logging.warning(exc)

        self.clear_api()
        self.init_api()
        logger.info("Reloaded code")

    def disconnect(self):
        """Live teardown: stop logging, close the socket, hand back to ControlSurface."""
        self.show_message("Disconnecting...")
        logger.info("Disconnecting...")
        self.stop_logging()
        self.osc_server.shutdown()
        super().disconnect()

    def build_midi_map(self, midi_map_handle):
        """Register the ``midi_mappings`` table into Live's MIDI map."""
        logger.debug("Building MIDI map...")

        for channel, cc in self.midi_mappings.keys():
            parameter = self.midi_mappings[(channel, cc)]
            Live.MidiMap.map_midi_cc(
                midi_map_handle,
                parameter,
                channel,
                cc,
                Live.MidiMap.MapMode.absolute,
                1,
            )
            logger.debug(
                f"Mapped CC {cc} on channel {channel} to parameter {parameter.name}"
            )
