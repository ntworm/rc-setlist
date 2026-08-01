// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// View rendering module for Setlist UI (Task 6.4)

export class SetlistViewController {
  constructor(containerElement) {
    this.container = containerElement;
  }

  formatDuration(seconds) {
    if (typeof seconds !== "number" || isNaN(seconds) || seconds < 0) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  renderHUD(hudElements, state) {
    if (!hudElements) return;
    const { song, section, bpm, time, bar } = state;
    if (hudElements.hudSong && song !== undefined) hudElements.hudSong.textContent = song;
    if (hudElements.hudSection && section !== undefined) hudElements.hudSection.textContent = section;
    if (hudElements.hudBpm && bpm !== undefined) hudElements.hudBpm.textContent = `${bpm} BPM`;
    if (hudElements.hudTime && time !== undefined) hudElements.hudTime.textContent = time;
    if (hudElements.hudBar && bar !== undefined) hudElements.hudBar.textContent = bar;
  }

  updateLockStatus(lockButton, isLocked) {
    if (!lockButton) return;
    if (isLocked) {
      lockButton.classList.add("locked");
      lockButton.setAttribute("aria-pressed", "true");
    } else {
      lockButton.classList.remove("locked");
      lockButton.setAttribute("aria-pressed", "false");
    }
  }
}
