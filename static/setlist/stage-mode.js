/*
 * Edit mode and Show mode for the Stage Control panel.
 *
 * Edit mode keeps the full setup surface on screen. Show mode strips setup
 * controls away, keeps only the active song's sections open, and pins the
 * active song to the top of the song list as playback moves through the set.
 */
(function stageModeModule(globalScope) {
  'use strict';

  const STORAGE_KEY = 'rcsetlist:stageMode';
  const SHOW_MODE = 'show';
  const EDIT_MODE = 'edit';
  const SHOW_CLASS = 'show-mode';

  /**
   * Normalizes a stored or requested stage mode.
   *
   * Pure: only the exact string "show" enters Show mode; anything else stays
   * in Edit mode so an unreadable value never hides setup controls.
   */
  function parseMode(raw) {
    return raw === SHOW_MODE ? SHOW_MODE : EDIT_MODE;
  }

  /**
   * Reads the remembered stage mode from storage.
   *
   * Unreadable or missing storage falls back to Edit mode.
   */
  function readMode(storage) {
    try {
      return parseMode(storage?.getItem(STORAGE_KEY));
    } catch {
      return EDIT_MODE;
    }
  }

  /**
   * Writes the chosen stage mode to storage when storage accepts writes.
   */
  function writeMode(storage, mode) {
    const normalized = parseMode(mode);
    try {
      storage?.setItem(STORAGE_KEY, normalized);
    } catch {
      // Ignore storage write failures and keep the in-memory mode active.
    }
  }

  /**
   * Applies the stage mode to the document body and mode switch buttons.
   */
  function applyMode(body, mode) {
    if (!body) return;
    const activeMode = parseMode(mode);
    body.classList?.toggle(SHOW_CLASS, activeMode === SHOW_MODE);
    const buttons = body.querySelectorAll?.('[data-stage-mode]') || [];
    for (const button of buttons) {
      const pressed = button?.dataset?.stageMode === activeMode;
      button?.setAttribute?.('aria-pressed', String(pressed));
    }
  }

  /**
   * Scrolls the song list container so the requested song meets its top edge.
   */
  function scrollSongToTop(container, songIndex) {
    if (!container || !Number.isInteger(songIndex) || songIndex < 0) return;
    const item = container.querySelector?.(`.song-item[data-song="${songIndex}"]`);
    if (!item) return;
    const containerTop = container.getBoundingClientRect().top;
    const itemTop = item.getBoundingClientRect().top;
    container.scrollTop += itemTop - containerTop;
  }

  /**
   * Creates a follower that pins the active song to the top in Show mode.
   */
  function createFollower(options = {}) {
    const container = options.container;
    const getMode = options.getMode || (() => EDIT_MODE);
    let lastFollowedIndex = -1;

    function follow(songIndex, force = false) {
      if (getMode() !== SHOW_MODE) return;
      if (!Number.isInteger(songIndex) || songIndex < 0) return;
      if (!force && songIndex === lastFollowedIndex) return;
      lastFollowedIndex = songIndex;
      scrollSongToTop(container, songIndex);
    }

    return { follow };
  }

  globalScope.RcStageMode = Object.freeze({
    STORAGE_KEY,
    applyMode,
    createFollower,
    parseMode,
    readMode,
    scrollSongToTop,
    writeMode,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
