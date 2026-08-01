// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Lyrics manager module for Setlist UI (Task 6.4)

export class LyricsController {
  constructor() {
    this.currentLyrics = { song: "", format: "none", lines: [] };
    this.currentLyricsIdx = -1;
    this.isSyncing = false;
  }

  parseRawText(rawText) {
    if (!rawText) return [];
    return rawText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((text) => ({ time: 0, text }));
  }

  formatLrcLine(seconds, text) {
    const min = Math.floor(seconds / 60);
    const sec = (seconds % 60).toFixed(2);
    const minStr = String(min).padStart(2, "0");
    const secStr = String(sec).padStart(5, "0");
    return `[${minStr}:${secStr}]${text}`;
  }

  serializeToLrc(lines) {
    return lines.map((l) => this.formatLrcLine(l.time, l.text)).join("\n");
  }

  getActiveLineIndex(lines, currentTimeSeconds) {
    if (!lines || lines.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= currentTimeSeconds) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }
}
