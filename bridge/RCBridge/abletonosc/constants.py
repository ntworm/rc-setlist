"""RC Bridge protocol layer: OSC surface for Ableton Live."""


RCBRIDGE_NAME = "RC Bridge"
RCBRIDGE_VERSION = "1.0.0"
RCBRIDGE_UPSTREAM = "abletonosc 0ca6821"
OSC_LISTEN_PORT = 11020
OSC_RESPONSE_PORT = 11021
OSC_SHOW_KEYS = ("playing", "tempo", "signature_numerator", "signature_denominator",
                 "metronome", "current_song_time", "cue_points")
