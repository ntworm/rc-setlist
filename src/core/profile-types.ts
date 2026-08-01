// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist

export interface SongEntry {
  id: string;
  name: string;
  artist?: string;
  bpm?: number;
  key?: string;
  durationSeconds?: number;
  notes?: string;
  color?: string;
  lyrics?: string;
}

export interface Setlist {
  id: string;
  name: string;
  songs: SongEntry[];
  createdMs?: number;
  updatedMs?: number;
}

export interface SetlistProfile {
  id: string;
  name: string;
  setlists: Setlist[];
  activeSetlistId?: string;
  activeSongId?: string;
}
