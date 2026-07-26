/**
 * Shared lyrics timing and synchronization utility.
 * Loaded synchronously in both staging setlist and stage performance views.
 */

function calculateSongElapsedBeats(estimatedBeats, activeSong) {
  return activeSong ? Math.max(0, estimatedBeats - activeSong.time) : estimatedBeats;
}

function convertBeatsToSeconds(beats, bpm) {
  const activeBpm = bpm || 120;
  return beats * 60 / activeBpm;
}

function formatSecondsToLrcTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const totalCentiseconds = Math.round(safeSeconds * 100);
  const minutes = Math.floor(totalCentiseconds / 6000);
  const remainingCentiseconds = totalCentiseconds % 6000;
  const wholeSeconds = Math.floor(remainingCentiseconds / 100);
  const centiseconds = remainingCentiseconds % 100;
  return `[${minutes.toString().padStart(2, '0')}:${wholeSeconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}]`;
}

function findActiveLyricLine(currentLyrics, currentTimeSec) {
  if (!currentLyrics || !currentLyrics.lines || currentLyrics.lines.length === 0) {
    return -1;
  }
  let bestIdx = -1;
  for (let i = 0; i < currentLyrics.lines.length; i++) {
    const l = currentLyrics.lines[i];
    const t = typeof l.time === 'number' ? l.time : 0;
    if (t <= currentTimeSec + 0.05) { // 50ms leeway matching production behavior
      bestIdx = i;
    } else {
      break;
    }
  }
  return bestIdx;
}
