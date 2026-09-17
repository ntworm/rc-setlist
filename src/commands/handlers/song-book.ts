// Side-data writes that live beside the setlist (colour and notes per song):
// they are allowed while playing because they never touch the Live project.
import {
  bridgeState,
  broadcastState,
  setSongColorAtTime,
  setSongNotesAtTime,
} from '../../runtime/bridge-state.js';
import type { ClientMessageOf } from './shared.js';

/**
 * ExecuteSetSongColor — implementation detail.
 */
export function executeSetSongColor(msg: ClientMessageOf<'set_song_color'>): void {
  // Colour is RC Setlist's own memory. It never touches the Live project, so
  // it is allowed while playing — unlike a locator rename.
  const applied = setSongColorAtTime(msg.time, msg.color ?? undefined);
  if (applied) broadcastState();
  else bridgeState.wsServer?.broadcastLog('No song is known at that position yet.', 'warn');
}

/**
 * ExecuteSetSongNotes — implementation detail.
 */
export function executeSetSongNotes(msg: ClientMessageOf<'set_song_notes'>): void {
  // Same memory as the colour: beside the setlist, never in the Live project.
  const applied = setSongNotesAtTime(msg.time, msg.notes ?? undefined);
  if (applied) broadcastState();
  else bridgeState.wsServer?.broadcastLog('No song is known at that position yet.', 'warn');
}
