// Transport tracking that used to live inside `SetlistManager`. Tracks the
// playhead position when the transport is stopped and answers
// `shouldContinuePlayback` from that snapshot, so Play can resume from where
// the operator saw the playhead rather than jumping to the start marker.
//
// Lifted to its own module so the manager can stay focused on the song list /
// transport state and so the rules around "resting" and "drift" are written
// once. The tracker is stateless across calls; the manager passes in the
// current playhead state and receives a decision back.

const REST_SETTLE_BEATS = 2;

export interface TransportTrackerState {
  /** The beat the transport last came to rest at, or null when it is rolling. */
  restingAt: number | null;
  /** Whether the transport is currently playing. */
  isPlaying: boolean;
  /** The most recently observed song time. */
  currentSongTime: number;
}

/**
 * Update the resting beat. A small forward drift right after stopping is
 * read as the transport settling, not a relocation: where Live actually
 * came to rest, so Play resumes from the resting beat instead of being a
 * beat or two behind. Relocating forward by less than `REST_SETTLE_BEATS`
 * while stopped is therefore read as drift too; backward movement is always
 * a relocation.
 *
 * The function mutates the passed-in `state.restingAt` so the caller's Set
 * (which is the live field on `SetlistManager`) stays in sync, and also
 * returns the new value so primitive fields can be written back if the
 * caller prefers to copy them out.
 */
export function trackRestingPosition(
  time: number,
  isPlaying: boolean,
  state: TransportTrackerState,
): { restingAt: number | null } {
  if (isPlaying) {
    state.restingAt = null;
    return { restingAt: null };
  }
  if (state.isPlaying || state.restingAt === null) {
    state.restingAt = time;
    return { restingAt: time };
  }
  const drift = time - state.restingAt;
  if (drift >= 0 && drift <= REST_SETTLE_BEATS) {
    state.restingAt = time;
    return { restingAt: time };
  }
  return { restingAt: state.restingAt };
}

/**
 * True when Play should resume where the transport stopped
 * (`continue_playing`); false when the playhead was relocated while stopped
 * and Play must start from the start marker (`start_playing`). A running
 * transport always continues: `start_playing` would restart it.
 */
export function shouldContinuePlayback(state: TransportTrackerState): boolean {
  if (state.isPlaying) return true;
  if (state.restingAt === null) return true;
  return Math.abs(state.currentSongTime - state.restingAt) < 0.01;
}
