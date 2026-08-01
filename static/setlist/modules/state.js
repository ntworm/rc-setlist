// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Application state & store module for Setlist UI (Task 6.4)

export class SetlistState {
  constructor() {
    this.isConnected = false;
    this.isPlaying = false;
    this.currentSongIndex = -1;
    this.songs = [];
    this.profiles = [];
    this.activeProfileId = null;
    this.language = "en";
  }

  setSongs(songsList) {
    this.songs = Array.isArray(songsList) ? songsList : [];
  }

  setPlaybackState(isPlaying, songIndex) {
    this.isPlaying = Boolean(isPlaying);
    if (typeof songIndex === "number") {
      this.currentSongIndex = songIndex;
    }
  }

  setConnectionState(connected) {
    this.isConnected = Boolean(connected);
  }
}
