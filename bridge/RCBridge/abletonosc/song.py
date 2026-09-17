"""RC Bridge protocol layer: OSC surface for Ableton Live."""

import json
import os
import sys
import tempfile
from functools import partial
from typing import Any

import Live

from .handler import AbletonOSCHandler


class SongHandler(AbletonOSCHandler):
    """OSC surface for the Live Song object: methods, properties, tracks, scenes, cues."""

    def __init__(self, manager):
        """Initialize the Song handler and tag the Live object as the song root."""
        super().__init__(manager)
        self.class_identifier = "song"

    def init_api(self):
        """Register every /live/song/* OSC handler the bridge exposes."""
        #--------------------------------------------------------------------------------
        # Callbacks for Song: methods
        #--------------------------------------------------------------------------------
        for method in [
            "capture_and_insert_scene",
            "capture_midi",
            "continue_playing",
            "create_audio_track",
            "create_midi_track",
            "create_return_track",
            "create_scene",
            "delete_return_track",
            "delete_scene",
            "delete_track",
            "duplicate_scene",
            "duplicate_track",
            "force_link_beat_time",
            "jump_by",
            "jump_to_prev_cue",
            "jump_to_next_cue",
            "redo",
            "re_enable_automation",
            "set_or_delete_cue",
            "start_playing",
            "stop_all_clips",
            "stop_playing",
            "tap_tempo",
            "trigger_session_record",
            "undo",
        ]:
            callback = partial(self._call_method, self.song, method)
            self.osc_server.add_handler(f"/live/song/{method}", callback)

        #--------------------------------------------------------------------------------
        # Callbacks for Song: properties (read/write)
        #--------------------------------------------------------------------------------
        properties_rw = [
            "arrangement_overdub",
            "back_to_arranger",
            "clip_trigger_quantization",
            "current_song_time",
            "groove_amount",
            "is_ableton_link_enabled",
            "loop",
            "loop_length",
            "loop_start",
            "metronome",
            "midi_recording_quantization",
            "nudge_down",
            "nudge_up",
            "punch_in",
            "punch_out",
            "record_mode",
            "root_note",
            "scale_name",
            "session_record",
            "signature_denominator",
            "signature_numerator",
            "tempo",
        ]

        #--------------------------------------------------------------------------------
        # Callbacks for Song: properties (read-only)
        #--------------------------------------------------------------------------------
        properties_r = [
            "can_redo",
            "can_undo",
            "is_playing",
            #--------------------------------------------------------------------------------
            # RC Bridge: the beat of the last event in the Arrangement, read-only in
            # the Live Object Model. Upstream never exposed it; RC Setlist polls it
            # for the show's total duration and used to need the MCP bridge for it.
            #--------------------------------------------------------------------------------
            "last_event_time",
            "song_length",
            "session_record_status",
        ]

        for prop in properties_r + properties_rw:
            self.osc_server.add_handler(
                f"/live/song/get/{prop}", partial(self._get_property, self.song, prop)
            )
            self.osc_server.add_handler(
                f"/live/song/start_listen/{prop}",
                partial(self._start_listen, self.song, prop),
            )
            self.osc_server.add_handler(
                f"/live/song/stop_listen/{prop}",
                partial(self._stop_listen, self.song, prop),
            )
        for prop in properties_rw:
            self.osc_server.add_handler(
                f"/live/song/set/{prop}", partial(self._set_property, self.song, prop)
            )

        #--------------------------------------------------------------------------------
        # Callbacks for Song: Track properties
        #--------------------------------------------------------------------------------
        self.osc_server.add_handler(
            "/live/song/get/num_tracks", lambda _: (len(self.song.tracks),)
        )

        def song_get_track_names(params):
            """Return track names in ``[min, max)`` (defaults to all)."""
            if len(params) == 0:
                track_index_min, track_index_max = 0, len(self.song.tracks)
            else:
                track_index_min, track_index_max = params
                if track_index_max == -1:
                    track_index_max = len(self.song.tracks)
            return tuple(
                self.song.tracks[index].name
                for index in range(track_index_min, track_index_max)
            )

        self.osc_server.add_handler("/live/song/get/track_names", song_get_track_names)

        def song_get_track_data(params):
            """Return a row-per-track list of named properties.

            Properties must be of the form ``track.x`` or ``clip.x``. For
            example, ``/live/song/get/track_data 0 12 track.name clip.name
            clip.length`` queries tracks 0..11 and returns, in order:

            [track_0_name, clip_0_0_name, ..., clip_0_7_name,
             clip_1_0_length, ..., clip_1_7_length,
             track_1_name, ...]
            """
            track_index_min, track_index_max, *properties = params
            track_index_min = int(track_index_min)
            track_index_max = int(track_index_max)
            self.logger.info(
                f"Getting track data: {properties} (tracks {track_index_min}..{track_index_max})"
            )
            if track_index_max == -1:
                track_index_max = len(self.song.tracks)
            rv = []
            for track_index in range(track_index_min, track_index_max):
                track = self.song.tracks[track_index]
                for prop in properties:
                    obj, property_name = prop.split(".")
                    if obj == "track":
                        if property_name == "num_devices":
                            value = len(track.devices)
                        else:
                            value = getattr(track, property_name)
                            if isinstance(value, Live.Track.Track):
                                #--------------------------------------------------------------------------------
                                # Map Track objects to their track_index to return via OSC
                                #--------------------------------------------------------------------------------
                                value = list(self.song.tracks).index(value)
                        rv.append(value)
                    elif obj == "clip":
                        for clip_slot in track.clip_slots:
                            if clip_slot.clip is not None:
                                rv.append(getattr(clip_slot.clip, property_name))
                            else:
                                rv.append(None)
                    elif obj == "clip_slot":
                        for clip_slot in track.clip_slots:
                            rv.append(getattr(clip_slot, property_name))
                    elif obj == "device":
                        for _device_index, device in enumerate(track.devices):
                            rv.append(getattr(device, property_name))
                    else:
                        self.logger.error(
                            f"Unknown object identifier in get/track_data: {obj}"
                        )
            return tuple(rv)

        self.osc_server.add_handler("/live/song/get/track_data", song_get_track_data)

        def song_export_structure(params):
            """Dump the song structure (tracks, clips, devices) to a temp JSON file."""
            tracks = []
            for track_index, track in enumerate(self.song.tracks):
                group_track = None
                if track.group_track is not None:
                    group_track = list(self.song.tracks).index(track.group_track)
                track_data = {
                    "index": track_index,
                    "name": track.name,
                    "is_foldable": track.is_foldable,
                    "group_track": group_track,
                    "clips": [],
                    "devices": [],
                }
                for clip_index, clip_slot in enumerate(track.clip_slots):
                    if clip_slot.clip:
                        clip_data = {
                            "index": clip_index,
                            "name": clip_slot.clip.name,
                            "length": clip_slot.clip.length,
                        }
                        track_data["clips"].append(clip_data)

                for _device_index, device in enumerate(track.devices):
                    device_data = {
                        "class_name": device.class_name,
                        "type": device.type,
                        "name": device.name,
                        "parameters": [],
                    }
                    for parameter in device.parameters:
                        device_data["parameters"].append(
                            {
                                "name": parameter.name,
                                "value": parameter.value,
                                "min": parameter.min,
                                "max": parameter.max,
                                "is_quantized": parameter.is_quantized,
                            }
                        )
                    track_data["devices"].append(device_data)

                tracks.append(track_data)
            song = {"tracks": tracks}

            if sys.platform == "darwin":
                #--------------------------------------------------------------------------------
                # On macOS, TMPDIR by default points to a process-specific directory.
                # We want to use a global temp dir (typically, tmp) so that other processes
                # know where to find this output .json, so unset TMPDIR.
                #--------------------------------------------------------------------------------
                os.environ["TMPDIR"] = ""
            fd = open(
                os.path.join(tempfile.gettempdir(), "abletonosc-song-structure.json"), "w"
            )
            json.dump(song, fd)
            fd.close()
            self.logger.warning(
                f"Exported song structure to directory {tempfile.gettempdir()}"
            )
            return (1,)

        self.osc_server.add_handler("/live/song/export/structure", song_export_structure)

        #--------------------------------------------------------------------------------
        # Callbacks for Song: Scene properties
        #--------------------------------------------------------------------------------
        self.osc_server.add_handler(
            "/live/song/get/num_scenes", lambda _: (len(self.song.scenes),)
        )

        def song_get_scene_names(params):
            """Return scene names in ``[min, max)`` (defaults to all)."""
            if len(params) == 0:
                scene_index_min, scene_index_max = 0, len(self.song.scenes)
            else:
                scene_index_min, scene_index_max = params
            return tuple(
                self.song.scenes[index].name
                for index in range(scene_index_min, scene_index_max)
            )

        self.osc_server.add_handler("/live/song/get/scenes/name", song_get_scene_names)

        #--------------------------------------------------------------------------------
        # Callbacks for Song: Cue point properties
        #--------------------------------------------------------------------------------
        def song_get_cue_points(song, _):
            """Flatten the cue list into ``(name_0, time_0, name_1, time_1, ...)``."""
            cue_points = song.cue_points
            cue_point_pairs = [
                (cue_point.name, cue_point.time) for cue_point in cue_points
            ]
            return tuple(element for pair in cue_point_pairs for element in pair)

        self.osc_server.add_handler(
            "/live/song/get/cue_points", partial(song_get_cue_points, self.song)
        )

        def song_jump_to_cue_point(song, params: tuple[Any] = ()):
            """Jump the Live transport to the named or indexed cue point."""
            cue_point_index = params[0]
            if isinstance(cue_point_index, str):
                for cue_point in song.cue_points:
                    if cue_point.name == cue_point_index:
                        cue_point.jump()
            elif isinstance(cue_point_index, int):
                cue_point = song.cue_points[cue_point_index]
                cue_point.jump()

        self.osc_server.add_handler(
            "/live/song/cue_point/jump", partial(song_jump_to_cue_point, self.song)
        )

        self.osc_server.add_handler(
            "/live/song/cue_point/add_or_delete",
            partial(self._call_method, self.song, "set_or_delete_cue"),
        )

        def song_cue_point_set_name(song, params: tuple[Any] = ()):
            """Rename one cue point by index."""
            cue_point_index = params[0]
            new_name = params[1]
            cue_point = song.cue_points[cue_point_index]
            cue_point.name = new_name

        self.osc_server.add_handler(
            "/live/song/cue_point/set/name", partial(song_cue_point_set_name, self.song)
        )

        #--------------------------------------------------------------------------------
        # Listener for /live/song/get/beat
        #--------------------------------------------------------------------------------
        self.last_song_time = -1.0
        self.beat_topic = "song/beat"
        self.beat_listener_attached = False

        def stop_beat_listener(params: tuple[Any] = ()):
            """Unsubscribe the requesting client from beat updates."""
            remaining = self.osc_server.unsubscribe(
                self.beat_topic, self.osc_server.current_remote_addr
            )
            if remaining > 0 or not self.beat_listener_attached:
                return
            try:
                self.song.remove_current_song_time_listener(self.current_song_time_changed)
                self.logger.info("Removing beat listener")
            except RuntimeError:
                pass
            self.beat_listener_attached = False

        def start_beat_listener(params: tuple[Any] = ()):
            """Subscribe the requesting client and start beat notifications."""
            self.osc_server.subscribe(self.beat_topic, self.osc_server.current_remote_addr)
            if self.beat_listener_attached:
                return
            self.logger.info("Adding beat listener")
            self.song.add_current_song_time_listener(self.current_song_time_changed)
            self.beat_listener_attached = True

        self.osc_server.add_handler("/live/song/start_listen/beat", start_beat_listener)
        self.osc_server.add_handler("/live/song/stop_listen/beat", stop_beat_listener)

    def current_song_time_changed(self):
        """Emit ``/live/song/get/beat`` whenever the playhead jumps or ticks over."""
        #--------------------------------------------------------------------------------
        # If song has rewound or skipped to next beat, send a /live/beat message
        #--------------------------------------------------------------------------------
        if (self.song.current_song_time < self.last_song_time) or (
            int(self.song.current_song_time) > int(self.last_song_time)
        ):
            self.osc_server.publish(
                self.beat_topic,
                "/live/song/get/beat",
                (int(self.song.current_song_time),),
            )
        self.last_song_time = self.song.current_song_time

    def clear_api(self):
        """Tear down handlers and drop the beat listener (parent + own cleanup)."""
        super().clear_api()
        try:
            self.song.remove_current_song_time_listener(self.current_song_time_changed)
        except RuntimeError:
            pass
