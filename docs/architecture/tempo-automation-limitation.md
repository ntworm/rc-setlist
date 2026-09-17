# Ableton Live Arrangement Tempo Automation Limitation & Sampling Feasibility

**Date**: 2026-09-07
**Status**: Accepted / Architectural Record
**Applies to**: RC Setlist (`rc-setlist`)

---

## 1. Executive Summary

RC Setlist computes song and setlist durations to provide musicians with exact stage timings. However, when an Ableton Live set contains arrangement master tempo automations (varying BPM across songs or sections) without explicit bracketed tags (`[bpm N]`), the extension cannot read the automation envelope.

This document establishes the technical evidence proving that arrangement tempo automation breakpoints are inaccessible via all available integration protocols (Extensions SDK, AbletonOSC, MCP, and LOM), quantifies the empirical error caused by single-tempo fallback, and defines the technical design and constraints for off-stage automated tempo sampling.

---

## 2. Technical Investigation & API Surface Analysis

To determine whether arrangement master tempo automation can be read non-invasively, all four integration layers available to Ableton Live were audited:

### A. Ableton Extensions SDK (`1.0.0-beta.0`)

- **Inspection**: Audited `src/ableton-sdk-public.d.ts` and runtime object model.
- **Finding**: The SDK exposes `song.tempo` as a single scalar property and emits change events when the instantaneous tempo changes during playback.
- **Limitation**: The SDK provides no API to inspect Arrangement automation tracks, master mixer devices, or time-stamped tempo breakpoints. No method exists to query "what will the tempo be at beat $X$?" without moving the playhead.

### B. AbletonOSC

- **Inspection**: Audited AbletonOSC protocol endpoints and `src/osc/registration.ts`.
- **Finding**: AbletonOSC exposes `/live/song/get/tempo` and `/live/song/start_listen/tempo`, which query and stream the current playback tempo.
- **Limitation**: No OSC address exists for arrangement automation envelopes or tempo curve introspection.

### C. Ableton Model Context Protocol (MCP)

- **Inspection**: Surveyed all 97 tools exposed by the Ableton MCP server.
- **Finding**: `get_clip_automation` inspects automation curves within individual MIDI/audio clips. No tool inspects Arrangement master tempo automation envelopes or timeline-wide tempo breakpoints.

### D. Live Object Model (LOM) Python API

- **Inspection**: Audited Python Remote Script architecture (`Live.Song.Song.master_track.mixer_device.song_tempo`).
- **Finding**: While parameter automation curves exist internally within Live's C++ core, the exposed Python LOM does not grant read access to arrangement automation breakpoint lists. The parameter only yields its instantaneous value at the current song playhead position (`song.current_song_time`).

### Conclusion

**Arrangement tempo automation envelopes cannot be queried statically by any remote protocol.** The only mechanism to observe tempo automation from Live without prior declaration is by advancing `song.current_song_time` to each locator and reading the resulting `song.tempo`.

---

## 3. Empirical Measurement & Error Magnitude

On 2026-09-07, a 21-song production Ableton set containing tempo automations across arrangement locators was measured.

### Setlist Breakdown (Actual Arrangement Data)

| #   | Song Locator     | Start Beat | Span (Beats) | True BPM | True Duration |
| --- | ---------------- | ---------- | ------------ | -------- | ------------- |
| 1   | INTRO            | 0          | 240          | 136      | 1:46          |
| 2   | ORQUESTRA        | 240        | 532          | 130      | 4:06          |
| 3   | DERRETE          | 772        | 364          | 110      | 3:19          |
| 4   | J�LIA            | 1136       | 538          | 160      | 3:22          |
| 5   | WELTON           | 1674       | 502          | 118      | 4:15          |
| 6   | �GUA GELADA      | 2176       | 360          | 93       | 3:52          |
| 7   | DESCONFORTO      | 2536       | 532          | 115      | 4:38          |
| 8   | SOM�LIA          | 3068       | 395          | 140      | 2:49          |
| 9   | SOLISURTO        | 3463       | 584          | 136      | 4:18          |
| 10  | BOSSA            | 4047       | 520          | 97       | 5:22          |
| 11  | TTD              | 4567       | 128          | 116      | 1:06          |
| 12  | T� TUDO DAN�ANDO | 4695       | 396          | 116      | 3:25          |
| 13  | REV�S            | 5091       | 620          | 120      | 5:10          |
| 14  | NTNV             | 5711       | 700          | 166      | 4:13          |
| 15  | DEVANEIO         | 6411       | 448          | 99       | 4:32          |
| 16  | MOINHOS          | 6859       | 548          | 104      | 5:16          |
| 17  | DOURADDO         | 7407       | 384          | 126      | 3:03          |
| 18  | ARRAIAS C�US     | 7791       | 448          | 126      | 3:33          |
| 19  | AREIA NO TETO    | 8239       | 440          | 130      | 3:23          |
| 20  | CIDADE DO SUOR   | 8679       | 384          | 103      | 3:44          |
| 21  | AR EM ROMA       | 9063       | 408          | 116      | 3:31          |

### Drift & Distortion Analysis

- **Piecewise Sum (True Duration)**: **78:41** (4,721 seconds).
- **Single Fallback at 99 BPM (Playhead at DEVANEIO)**: 95:40 (5,740 seconds) � **+16:59 (+21.6%) distortion**.
- **Single Fallback at 136 BPM (Initial Session BPM)**: 69:38 (4,178 seconds) � **-9:03 (-11.5%) distortion**.

A 17-minute discrepancy over a 79-minute show confirms that single-tempo fallback cannot serve as an authoritative timing basis for production shows.

---

## 4. Architecture Solutions

### Action A: Confidence Derivation & UI Signaling

1. **Server (`SetlistManager`)**:
   - Evaluates whether at least one locator contains a declared `[bpm N]` tag.
   - Sets `durationConfidence: 'declared'` if $\ge 1$ tag exists; otherwise `'estimated'`.
2. **Client Surfaces (`/setlist/`, `/performance/`, `/panel/`)**:
   - Emits visual badge `EST.` in `--t-stage-micro` alongside total duration and HUD timecard.
   - Non-chromatic and persistent: never relies on color alone or hover tooltips.

### Action B1: Deterministic In-Place Declarations

- Explicit locator naming using `[bpm N]` (e.g., `DEVANEIO [bpm 99]`).
- Instantaneous piecewise calculation with zero engine polling overhead.

---

## 5. Action B2: Automated Off-Stage Tempo Sampler Specification

An automated sampler function can scan song positions, query live tempo at each boundary, and propose cue point renames with `[bpm N]` tags.

### Feasibility Assessment

- **Extensions SDK Feasibility**: High. The SDK provides `song.setCurrentSongTime(beat)` and listens to `song.tempo`. However, after repositioning the playhead, Live updates tempo asynchronously across an engine tick (typically 10�50 ms). The sampler must wait for the tempo callback before proceeding to the next cue.
- **AbletonOSC Feasibility**: High. Can send `/live/song/set/current_song_time` followed by `/live/song/get/tempo`.

### Mandatory Operational Constraints

1. **Transport Guard**:
   - The sampler MUST ONLY be invokable when `isPlaying === false`.
   - If playback starts while sampling is in flight, the sampler must immediately abort.
2. **State Restoration Invariant**:
   - Before moving the playhead to the first locator, record `initialPlayheadTime = song.currentTime`.
   - On completion or abort, restore `song.setCurrentSongTime(initialPlayheadTime)`.
3. **Atomic Undo Batch**:
   - Renaming locators must occur through a batch cue point update (e.g., `bulk_create_cue_points` or single undo transaction) so the user can revert the entire tagging operation with a single `Ctrl+Z` / `Cmd+Z`.
4. **Explicit Operator Confirmation**:
   - The UI must display the list of detected locators and proposed BPMs before writing to the Live session.
5. **Fail-Closed on Disconnect**:
   - If the Bridge loses connection to Live during sampling, the operation aborts without partial writes.
