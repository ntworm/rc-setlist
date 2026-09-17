/*
 * Count-in — the one bar you hear before the transport starts.
 *
 * This used to be done by rewinding Live's playhead one bar and starting
 * there, which had three consequences the operator felt on stage: the bar
 * belonged to the previous song, so the count was heard at that song's tempo;
 * that bar's audio played; and making the count audible meant switching Live's
 * metronome on, overriding a click the operator had deliberately turned off.
 *
 * So the count is produced here instead, in the browser, and Live is started at
 * the beat it was already sitting on. Live's transport and metronome are never
 * touched to produce it.
 *
 * The planning is pure and returns offsets in milliseconds from the moment the
 * count begins. The caller converts those to whatever clock it schedules on —
 * the Web Audio clock for the sound, so the beats do not drift with the main
 * thread, and a timer for the Play command.
 */
(function countInModule(globalScope) {
  'use strict';

  /** Beats per bar outside this range are a misread signature, not a count. */
  const MIN_BEATS = 1;
  const MAX_BEATS = 16;
  const MIN_BPM = 20;
  const MAX_BPM = 300;

  /**
   * The tempo to count at.
   *
   * `declaredTempo` is what the setlist declares for the playhead — the last
   * `[bpm]` at or before it. `tempo` is whatever Live is sitting at, which in a
   * set with arrangement automation is whatever the previous song left behind.
   * Counting at the declared tempo is the whole point of moving the count here,
   * so Live's tempo is only the fallback for a set that declares nothing.
   */
  function countInTempo(state) {
    const usable = (value) =>
      typeof value === 'number' && Number.isFinite(value) && value >= MIN_BPM && value <= MAX_BPM
        ? value
        : null;
    if (!state) return null;
    const declared = usable(state.declaredTempo);
    return declared !== null ? declared : usable(state.tempo);
  }

  /**
   * Lay out one bar of clicks and decide when to send Play.
   *
   * Returns null when the inputs cannot describe a bar, and the caller then
   * starts playback with no count rather than inventing one.
   *
   * `latencyMs` is how long Play takes to travel to Live and be heard: the
   * WebSocket hop, the OSC hop and Live's own scheduling. Play is therefore
   * sent that far ahead of the downbeat, so the transport arrives on it rather
   * than after it. It is never sent before the count begins — with a very slow
   * tempo or an implausible latency, an early send would start playback under
   * the count instead of after it.
   */
  function planCountIn(options) {
    const opts = options || {};
    const bpm = opts.bpm;
    if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) {
      return null;
    }

    const raw = opts.beatsPerBar;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    const beatsPerBar = Math.round(raw);
    if (beatsPerBar < MIN_BEATS || beatsPerBar > MAX_BEATS) return null;

    const latencyMs =
      typeof opts.latencyMs === 'number' && Number.isFinite(opts.latencyMs) && opts.latencyMs >= 0
        ? opts.latencyMs
        : 0;

    const intervalMs = 60000 / bpm;
    const beats = [];
    for (let index = 0; index < beatsPerBar; index++) {
      beats.push({ index, offsetMs: index * intervalMs, accent: index === 0 });
    }

    const downbeatOffsetMs = beatsPerBar * intervalMs;
    const sendPlayOffsetMs = Math.max(0, downbeatOffsetMs - latencyMs);

    return { bpm, beatsPerBar, intervalMs, beats, downbeatOffsetMs, sendPlayOffsetMs };
  }

  const AUDIO_STORAGE_KEY = 'rc-setlist.count-in-audio';
  function browserCountInAudioEnabled(storage) {
    if (!storage) return true;
    try {
      const val = storage.getItem(AUDIO_STORAGE_KEY);
      // Default ON; only disabled when explicitly set to 'false'
      return val !== 'false';
    } catch (e) {
      return true;
    }
  }

  globalScope.RcCountIn = {
    countInTempo,
    planCountIn,
    MIN_BPM,
    MAX_BPM,
    AUDIO_STORAGE_KEY,
    browserCountInAudioEnabled,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
