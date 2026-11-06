/**
 * The main tab: the project Live has open, in four numbers, and the songs of
 * the setlist that is active.
 *
 * Everything here is a reading the extension took when it opened the panel.
 * Nothing on this tab changes anything: the songs are read, not pressed.
 */
(function () {
  'use strict';

  const Panel = window.RcPanel;
  const shell = Panel.shell;
  const el = shell.el;

  /**
   * A duration, as the operator reads it.
   */
  function formatDuration(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds) || seconds <= 0) return '—';
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    const pad = (value) => String(value).padStart(2, '0');
    if (hours > 0) return `${hours}:${pad(minutes)}:${pad(rest)}`;
    return `${minutes}:${pad(rest)}`;
  }

  /**
   * The project and its setlists, as the extension reported them.
   */
  function project() {
    return window.INITIAL_PROJECT || { projectName: '', profiles: [], activeProfileId: null };
  }

  /**
   * The transport and the songs, as the extension reported them.
   */
  function playback() {
    return window.INITIAL_PLAYBACK || { songs: [], songCount: 0, activeSongIndex: -1 };
  }

  /**
   * Writes a text into an element of the page.
   */
  function setText(id, value) {
    const element = el(id);
    if (element) element.textContent = value;
  }

  /**
   * The setlist that is active, its project, and the numbers of the setlist.
   */
  function renderStrip() {
    const model = project();
    const profiles = model.profiles || [];
    const active = profiles.find((profile) => profile.id === model.activeProfileId);
    const state = playback();
    setText('mainActiveProfile', active ? active.name : shell.text('main.noSetlist'));
    setText('mainProjectName', model.projectName || shell.text('main.noProject'));
    setText('mainSongCount', String(state.songCount || 0));
    setText('mainDuration', formatDuration(state.durationSeconds));
    setText('mainSetlistCount', String(profiles.length));
    setText('tabSetlistCount', String(profiles.length));
  }

  /**
   * The state of the transport, beside the list of the songs.
   */
  function renderTransport() {
    const state = playback();
    const words = [shell.text(state.isPlaying ? 'main.playing' : 'main.stopped')];
    if (typeof state.tempo === 'number' && isFinite(state.tempo)) {
      words.push(`${state.tempo.toFixed(1)} BPM`);
    }
    setText('mainTransport', words.join(' · '));
  }

  /**
   * One song of the setlist, as a row.
   */
  function songRow(song, index, isNow) {
    const row = document.createElement('li');
    row.className = 'song-row';
    if (isNow) row.classList.add('is-now');
    const stripe = document.createElement('span');
    stripe.className = 'song-stripe';
    if (song.color) stripe.style.background = song.color;
    const number = document.createElement('span');
    number.className = 'song-index';
    number.textContent = String(index + 1);
    const title = document.createElement('span');
    title.className = 'song-title';
    title.textContent = song.title;
    if (isNow) {
      const now = document.createElement('span');
      now.className = 'song-now';
      now.textContent = shell.text('main.now');
      title.appendChild(now);
    }
    const sections = document.createElement('span');
    sections.className = 'song-sections';
    sections.textContent = shell.text('main.sections', { count: String(song.sectionCount || 0) });
    const time = document.createElement('span');
    time.className = 'song-time';
    time.textContent = formatDuration(song.durationSeconds);
    row.append(stripe, number, title, sections, time);
    return row;
  }

  /**
   * The songs of the setlist that is active.
   */
  function renderSongs() {
    const list = el('mainSongs');
    if (!list) return;
    list.textContent = '';
    const state = playback();
    const songs = Array.isArray(state.songs) ? state.songs : [];
    if (!songs.length) {
      const empty = document.createElement('li');
      empty.className = 'song-empty';
      empty.textContent = shell.text('main.noSongs');
      list.appendChild(empty);
      return;
    }
    songs.forEach((song, index) => {
      list.appendChild(songRow(song, index, index === state.activeSongIndex));
    });
  }

  /**
   * Paints the whole tab.
   */
  function render() {
    renderStrip();
    renderTransport();
    renderSongs();
  }

  Panel.main = { render: render, formatDuration: formatDuration };
})();
