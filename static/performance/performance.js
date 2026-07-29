

function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const i18n = RcSetlistI18n;
const t = (key, params) => i18n.t(key, params);
i18n.bindSelector(document.getElementById('languageSelect'));

let ws;
const port = window.location.port || '4444';
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

const songTitle = document.getElementById('songTitle');
const nextSong = document.getElementById('nextSong');
const sectionName = document.getElementById('sectionName');
const nextSection = document.getElementById('nextSection');
const timecode = document.getElementById('timecode');
const bpm = document.getElementById('bpm');
const barcode = document.getElementById('barcode');
const clickCard = document.getElementById('clickCard');
const clickState = document.getElementById('clickState');
const perfLoopIter = document.getElementById('perfLoopIter');

let lastState = null;
let lastReceivedTime = 0;
let lastFlashBeat = -1;
let currentLyrics = { song: '', format: 'none', lines: [] };
let lyricsFetchInFlight = false;
let lastActiveLyricIdx = -1;

// click-to-jump scheduler state removed in v0.2.0-simplified:
// the server's JumpScheduler handles ~1-bar pre-wait; the UI just
// flashes the section button briefly while the WS jump_pending event
// is in flight.

// MIDI Mapping State
let midiAccess = null;

function showConnectionFailure() {
  const hasState = Boolean(lastState);
  const overlay = document.getElementById('networkErrorOverlay');
  document.body.classList.toggle('connection-stale', hasState);
  document.body.classList.toggle('connection-empty', !hasState);
  overlay.querySelector('h2').textContent = t(hasState ? 'status.reconnecting' : 'status.bridgeUnavailable');
  overlay.querySelector('p').textContent = hasState
    ? t('status.performanceLost')
    : t('status.noState');
  overlay.classList.add('visible');
}

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.hostname}:${port}/ws`;
  console.log('[WS] connecting to', url);
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[WS] connected');
    statusDot.className = 'status-dot connected';
    statusText.textContent = t('status.connectedUpper');
    document.body.classList.remove('connection-stale');
    document.body.classList.remove('connection-empty');
    document.getElementById('networkErrorOverlay').classList.remove('visible');
    
    // Send handshake
    ws.send(JSON.stringify({
      type: 'handshake',
      clientId: 'browser-performance-' + Math.random().toString(36).substring(7)
    }));
  };

  ws.onerror = (event) => {
    console.error('[WS] error:', event);
    statusDot.className = 'status-dot error';
    statusText.textContent = t('status.wsErrorUpper');
  };

  ws.onclose = (event) => {
    console.log('[WS] closed:', event.code, event.reason || '(no reason)');
    statusDot.className = 'status-dot';
    statusText.textContent = t(lastState ? 'status.reconnectingUpper' : 'status.offline');
    showConnectionFailure();
    setTimeout(connect, 3000);
  };

  ws.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data);
      if (payload.type === 'handshake_ack') {
        // Send sync_confirm
        ws.send(JSON.stringify({ type: 'sync_confirm', stateVersion: payload.stateVersion }));
        ws.send(JSON.stringify({ type: 'get_lyrics' }));
        if (payload.state) {
          lastState = payload.state;
          updateUINonTimeSensitive(lastState);
        }
        return;
      }
      if (payload.type === 'state') {
        lastState = payload.state;
        lastReceivedTime = performance.now();
        document.body.classList.remove('connection-stale');
        document.body.classList.remove('connection-empty');
        document.getElementById('networkErrorOverlay').classList.remove('visible');
        updateUINonTimeSensitive(lastState);

        // Fetch lyrics if the active song changed and doesn't match currentLyrics
        const activeSong = lastState.songs[lastState.activeSongIndex];
        if (activeSong && activeSong.title !== currentLyrics.song && !lyricsFetchInFlight) {
          lyricsFetchInFlight = true;
          ws.send(JSON.stringify({ type: 'get_lyrics' }));
          setTimeout(() => { lyricsFetchInFlight = false; }, 250);
        }
      } else if (payload.type === 'lyrics') {
        displayLyrics(payload.song, payload.lines, payload.format);
      } else if (payload.type === 'jump_executed') {
        // Performance view is display-only — no clickable sections to flash.
        // The setlist view handles the visual confirmation.
      }
    } catch (err) {
      console.error(err);
    }
  };
}

const lyricsCard = document.getElementById('lyricsCard');
const lyricsContainer = document.getElementById('lyricsContainer');

function displayLyrics(song, lines, format) {
  currentLyrics = {
    song: song || '',
    format: format || 'none',
    lines: lines || []
  };
  lastActiveLyricIdx = -1;
  document.body.classList.toggle('has-lyrics', Boolean(lines && lines.length > 0));

  if (!lines || lines.length === 0) {
    lyricsCard.style.display = 'none';
    lyricsContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); margin-top: 3rem; font-size: 1.1rem; font-style: italic;">${escapeHtml(t('performance.noLyrics'))}</div>`;
    return;
  }

  lyricsCard.style.display = 'flex';

  if (format === 'txt') {
    lyricsContainer.innerHTML = lines.map(line => `<div class="lyric-line active">${escapeHtml(line.text)}</div>`).join('');
  } else {
    lyricsContainer.innerHTML = lines.map((line, idx) => `<div class="lyric-line" id="lyric-line-${idx}">${escapeHtml(line.text)}</div>`).join('');
  }
  lyricsContainer.scrollTop = 0;
}

function formatBeatsAsTime(beats, bpmSource) {
  if (typeof beats !== 'number' || isNaN(beats)) return '0:00:00';
  let bpm = 120;
  if (typeof bpmSource === 'number') {
    bpm = bpmSource;
  } else if (bpmSource && typeof bpmSource.bpm === 'number') {
    bpm = bpmSource.bpm;
  } else if (lastState && lastState.tempo) {
    bpm = lastState.tempo;
  }
  const seconds = beats * 60 / bpm;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
}

const latencyCompensationMs = 90; // compensate for polling intervals + socket transit

function getEstimatedBeats() {
  if (!lastState) return 0;
  if (!lastState.isPlaying) return lastState.currentSongTime;
  const elapsedMs = (performance.now() - lastReceivedTime) + latencyCompensationMs;
  const elapsedBeats = (elapsedMs / 1000) * (lastState.tempo / 60);
  return lastState.currentSongTime + elapsedBeats;
}

function sectionDisplayName(section) {
  if (!section) return t('common.none').toUpperCase();
  return section.automationOnly || !section.name
    ? t('setlist.automationMarker')
    : section.name;
}

function updateUINonTimeSensitive(state) {
  // Find current and next song
  const currentSong = state.songs[state.activeSongIndex];
  const nextSongObj = state.songs[state.activeSongIndex + 1];

  songTitle.textContent = currentSong ? currentSong.title : t('common.none').toUpperCase();
  nextSong.textContent = nextSongObj ? nextSongObj.title : t('performance.endSet');

  // Find current and next section
  const currentSection = currentSong ? currentSong.sections[state.activeSectionIndex] : null;
  let nextSectionObj = null;
  let nextIsCurrent = false;

  if (currentSong) {
    if (state.loopActive) {
      if (state.loopCount === -1 || state.currentLoopIteration < state.loopCount) {
        nextIsCurrent = true;
      }
    }

    if (nextIsCurrent) {
      nextSectionObj = currentSection;
    } else {
      nextSectionObj = currentSong.sections[state.activeSectionIndex + 1];
      if (!nextSectionObj && nextSongObj) {
        nextSectionObj = nextSongObj.sections[0];
      }
    }
  }

  sectionName.textContent = sectionDisplayName(currentSection);
  
  if (nextIsCurrent && nextSectionObj) {
    nextSection.textContent = t('next.repeat', { name: sectionDisplayName(nextSectionObj) });
  } else {
    nextSection.textContent = nextSectionObj
      ? `${sectionDisplayName(nextSectionObj)}${nextSectionObj.loopCount !== null ? ' [L]' : ''}`
      : t('performance.end');
  }

  // Render Song Badges
  let songBadgeHtml = '';
  if (currentSong) {
    if (currentSong.loopCount !== null) {
      songBadgeHtml += `<span class="perf-badge loop-badge">${currentSong.loopCount === -1 ? '↻ LOOP' : `↻ LOOP ${currentSong.loopCount}x`}</span>`;
    }
    if (currentSong.autoStop) songBadgeHtml += `<span class="perf-badge stop-badge">■ STOP</span>`;
    if (currentSong.autoNext) songBadgeHtml += `<span class="perf-badge next-badge">⏭ NEXT</span>`;
    if (typeof currentSong.bpm === 'number') songBadgeHtml += `<span class="perf-badge bpm-badge">♩ ${currentSong.bpm} BPM</span>`;
  }
  document.getElementById('songBadges').innerHTML = songBadgeHtml;

  // Render Section Badges
  let sectionBadgeHtml = '';
  if (currentSection) {
    if (currentSection.loopCount !== null) {
      sectionBadgeHtml += `<span class="perf-badge loop-badge">${currentSection.loopCount === -1 ? '↻ LOOP' : `↻ LOOP ${currentSection.loopCount}x`}</span>`;
    }
    if (currentSection.autoStop) sectionBadgeHtml += `<span class="perf-badge stop-badge">■ STOP</span>`;
    if (currentSection.autoNext) sectionBadgeHtml += `<span class="perf-badge next-badge">⏭ NEXT</span>`;
    if (typeof currentSection.bpm === 'number') sectionBadgeHtml += `<span class="perf-badge bpm-badge">♩ ${currentSection.bpm} BPM</span>`;
  }
  document.getElementById('sectionBadges').innerHTML = sectionBadgeHtml;
}

function tick() {
  if (lastState) {
    bpm.textContent = lastState.tempo ? lastState.tempo.toFixed(1) : '120.0';

    const estimatedBeats = getEstimatedBeats();
    const activeSong = lastState.songs[lastState.activeSongIndex];
    const songElapsedBeats = calculateSongElapsedBeats(estimatedBeats, activeSong);
    timecode.textContent = formatBeatsAsTime(estimatedBeats, lastState.tempo);

    const songTimecodeEl = document.getElementById('songTimecode');
    if (songTimecodeEl) {
      if (activeSong) {
        songTimecodeEl.textContent = t('performance.songTime', {
          time: formatBeatsAsTime(songElapsedBeats, lastState.tempo),
        });
        songTimecodeEl.style.display = 'inline-block';
      } else {
        songTimecodeEl.style.display = 'none';
      }
    }

    // Bar calculation (Bars.Beats.Sixteenths)
    const num = lastState.signatureNumerator || 4;
    const bar = Math.floor(estimatedBeats / num) + 1;
    const remainingBeats = estimatedBeats % num;
    const beat = Math.floor(remainingBeats) + 1;
    const sixteenths = Math.floor((remainingBeats % 1) * 4) + 1;
    barcode.textContent = `${bar}.${beat}.${sixteenths}`;

    // Metronome Visual Beat Flash
    const currentIntBeat = Math.floor(estimatedBeats);
    if (Math.abs(currentIntBeat - lastFlashBeat) > 4) {
      lastFlashBeat = currentIntBeat;
    } else if (currentIntBeat > lastFlashBeat && lastState.isPlaying) {
      lastFlashBeat = currentIntBeat;
      const isDownbeat = currentIntBeat % num === 0;
      clickCard.classList.remove('beat-flash-accent', 'beat-flash-normal');
      void clickCard.offsetWidth; // force reflow
      if (isDownbeat) {
        clickCard.classList.add('beat-flash-accent');
      } else {
        clickCard.classList.add('beat-flash-normal');
      }
    }

    // Update Metronome Click Card state
    if (lastState.metronome) {
      clickState.textContent = t('performance.clickOn');
      clickState.style.color = 'var(--success)';
    } else {
      clickState.textContent = t('performance.clickOff');
      clickState.style.color = 'var(--text-muted)';
    }

    // Update Loop Iteration display
    if (lastState.loopIteration) {
      perfLoopIter.textContent = `↻ LOOP: ${lastState.loopIteration.current}/${lastState.loopIteration.total}`;
      perfLoopIter.style.display = 'block';
    } else {
      perfLoopIter.style.display = 'none';
    }

    // Highlight active lyric line based on timecode in seconds
    if (currentLyrics.format === 'lrc' && currentLyrics.lines.length > 0) {
      const bpm = lastState.tempo || 120;
      const estimatedSeconds = convertBeatsToSeconds(songElapsedBeats, bpm);
      let activeIdx = findActiveLyricLine(currentLyrics, estimatedSeconds);
      if (activeIdx !== -1 && activeIdx !== lastActiveLyricIdx) {
        lastActiveLyricIdx = activeIdx;
        const lines = lyricsContainer.getElementsByClassName('lyric-line');
        for (let i = 0; i < lines.length; i++) {
          if (i === activeIdx) {
            lines[i].classList.add('active');
            const containerHeight = lyricsContainer.clientHeight;
            const elementTop = lines[i].offsetTop;
            const elementHeight = lines[i].clientHeight;
            lyricsContainer.scrollTop = elementTop - (containerHeight / 2) + (elementHeight / 2);
          } else {
            lines[i].classList.remove('active');
          }
        }
      }
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

i18n.subscribe(() => {
  if (lastState) updateUINonTimeSensitive(lastState);
  displayLyrics(currentLyrics.song, currentLyrics.lines, currentLyrics.format);
  if (document.getElementById('networkErrorOverlay').classList.contains('visible')) {
    showConnectionFailure();
  } else if (ws?.readyState === WebSocket.OPEN) {
    statusText.textContent = t('status.connectedUpper');
  }
});

globalThis.performanceStageRuntime = StageRuntime.mount({ i18n });
connect();
