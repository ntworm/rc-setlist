/*
 * Folding the sections of a song, and the button that folds them all.
 *
 * A setlist card carries four jobs and one place for each of them:
 *
 *   the name           jumps to the song
 *   the three dots     fold and unfold the sections of that song
 *   the grip           drags the song to another place in the setlist
 *   the bar button     folds or unfolds every song at once
 *
 * This file owns the folding half of that: which songs are folded, where that
 * is remembered, and what the DOM looks like when it is. The folding is kept
 * per setlist, because two setlists are two different evenings and one of them
 * folded is not the other one folded.
 *
 * The state is a list of song titles, stored under the setlist the panel is
 * showing. A title is the identity a person reads on the card, and it survives
 * a song moving up or down the list. Anything unreadable in storage means
 * nothing is folded: a broken preference must never hide a song's sections.
 */
(function songFoldModule(globalScope) {
  'use strict';

  const STORAGE_PREFIX = 'rcsetlist:folded:';
  const FOLDED_CLASS = 'sections-folded';
  const FOLD_ALL_KEY = 'setlist.foldAll';
  const UNFOLD_ALL_KEY = 'setlist.unfoldAll';

  /**
   * Where the folded songs of one setlist are remembered.
   *
   * Pure: the same setlist always gives the same key, and a panel without a
   * setlist yet still has a place to write to.
   */
  function storageKey(profileId) {
    return `${STORAGE_PREFIX}${profileId || 'default'}`;
  }

  /**
   * Reads a stored list of folded titles.
   *
   * Pure: anything that is not a list of strings is treated as an empty list,
   * because a preference that cannot be read must not hide anything.
   */
  function parseFoldedTitles(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((title) => typeof title === 'string' && title !== '');
    } catch {
      return [];
    }
  }

  /**
   * Writes a list of folded titles as the storage keeps it.
   *
   * Pure: the same titles always give the same text.
   */
  function serializeFoldedTitles(titles) {
    const list = Array.isArray(titles) ? titles.filter((title) => typeof title === 'string') : [];
    return JSON.stringify(list);
  }

  /**
   * Reads the folded songs of one setlist from storage.
   *
   * Storage that refuses to answer is storage that says nothing: the list
   * comes back empty and every song shows its sections.
   */
  function readFoldedTitles(storage, profileId) {
    try {
      return parseFoldedTitles(storage?.getItem(storageKey(profileId)));
    } catch {
      return [];
    }
  }

  /**
   * Writes the folded songs of one setlist to storage.
   *
   * Reports whether the write landed, so the caller can say so when it did not.
   */
  function writeFoldedTitles(storage, profileId, titles) {
    try {
      storage?.setItem(storageKey(profileId), serializeFoldedTitles(titles));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Whether a song is folded.
   *
   * Pure: the same list and title always give the same answer.
   */
  function isFolded(foldedTitles, title) {
    return Array.isArray(foldedTitles) && foldedTitles.includes(title);
  }

  /**
   * Folds a song, or unfolds it when it was already folded.
   *
   * Pure: the same list and title always give the same list.
   */
  function toggleTitle(foldedTitles, title) {
    const titles = new Set(Array.isArray(foldedTitles) ? foldedTitles : []);
    if (typeof title !== 'string' || title === '') return [...titles];
    if (titles.has(title)) titles.delete(title);
    else titles.add(title);
    return [...titles];
  }

  /**
   * The songs that have sections to fold at all.
   *
   * Pure: a song without sections is never folded, because there is nothing
   * behind the dots to show or hide.
   */
  function songsWithSections(songs) {
    const list = Array.isArray(songs) ? songs : [];
    return list.filter((song) => Array.isArray(song?.sections) && song.sections.length > 0);
  }

  /**
   * The label the bar button carries right now.
   *
   * The button folds every song while any song with sections is still open,
   * and unfolds them all once they are closed. The label says what the next
   * click will do.
   *
   * Pure: the same folded list and setlist always give the same label.
   */
  function foldAllLabelKey(foldedTitles, songs) {
    const folded = new Set(Array.isArray(foldedTitles) ? foldedTitles : []);
    const anyOpen = songsWithSections(songs).some((song) => !folded.has(song.title));
    return anyOpen ? FOLD_ALL_KEY : UNFOLD_ALL_KEY;
  }

  /**
   * Folds or unfolds one song card.
   *
   * The card carries the class that hides its sections, and the dots carry
   * the state a screen reader reads out.
   */
  function applyItemFoldState(item, folded) {
    if (!item) return;
    item.classList.toggle(FOLDED_CLASS, folded);
    const dots = item.querySelector('.song-reorder-handle');
    if (dots) dots.setAttribute('aria-expanded', String(!folded));
  }

  /**
   * Folds or unfolds every song card of the list.
   *
   * The songs are read from the state, because the card only knows its place
   * in the list and the title is what the folding is remembered by.
   */
  function applyFoldState(container, songs, foldedTitles) {
    const list = Array.isArray(songs) ? songs : [];
    const folded = new Set(Array.isArray(foldedTitles) ? foldedTitles : []);
    const items = [...(container?.children || [])].filter((element) =>
      element.classList.contains('song-item'),
    );
    for (const item of items) {
      const song = list[Number(item.dataset.song)];
      applyItemFoldState(item, Boolean(song && folded.has(song.title)));
    }
  }

  /**
   * The folding of one setlist, and the page it is painted on.
   *
   * The controller keeps the folded songs, remembers them per setlist, and
   * paints the cards. The caller only says which song was folded, which setlist
   * is on screen, and how a label is spelled.
   */
  function createFoldState(options) {
    const container = options.container;
    const storage = options.storage;
    const getProfileId = options.getProfileId || (() => '');
    const getSongs = options.getSongs || (() => []);
    const translate = options.translate || ((key) => key);
    const onChange = options.onChange || (() => {});
    let foldedTitles = [];

    function apply() {
      applyFoldState(container, getSongs(), foldedTitles);
    }

    function persist() {
      writeFoldedTitles(storage, getProfileId(), foldedTitles);
    }

    function titleFor(songIndex) {
      const song = getSongs()?.[songIndex];
      return typeof song?.title === 'string' ? song.title : '';
    }

    function load() {
      foldedTitles = readFoldedTitles(storage, getProfileId());
      apply();
      onChange();
    }

    function toggleSong(songIndex) {
      const title = titleFor(songIndex);
      if (!title) return;
      foldedTitles = toggleTitle(foldedTitles, title);
      persist();
      apply();
      onChange();
    }

    function toggleAll() {
      const songs = getSongs();
      foldedTitles =
        foldAllLabelKey(foldedTitles, songs) === FOLD_ALL_KEY
          ? songsWithSections(songs).map((song) => song.title)
          : [];
      persist();
      apply();
      onChange();
    }

    return {
      apply,
      getTitles: () => [...foldedTitles],
      label: () => translate(foldAllLabelKey(foldedTitles, getSongs())),
      load,
      toggleAll,
      toggleSong,
    };
  }

  globalScope.RcSongFold = Object.freeze({
    applyFoldState,
    applyItemFoldState,
    createFoldState,
    foldAllLabelKey,
    isFolded,
    parseFoldedTitles,
    readFoldedTitles,
    serializeFoldedTitles,
    songsWithSections,
    storageKey,
    toggleTitle,
    writeFoldedTitles,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
