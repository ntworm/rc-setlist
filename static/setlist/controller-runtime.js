(function controllerRuntimeModule(globalScope) {
  'use strict';

  const TERMINAL_STATUSES = new Set(['confirmed', 'failed', 'expired', 'cancelled']);

  function validMidiMapping(value) {
    return Boolean(
      value
      && typeof value === 'object'
      && (value.type === 'note' || value.type === 'cc')
      && Number.isInteger(value.channel)
      && value.channel >= 1
      && value.channel <= 16
      && Number.isInteger(value.number)
      && value.number >= 0
      && value.number <= 127
    );
  }

  function readMidiMappings(storageRef, key, defaults) {
    const result = { ...defaults };
    let parsed;
    try {
      const raw = storageRef?.getItem?.(key);
      if (!raw) return result;
      parsed = JSON.parse(raw);
    } catch {
      return result;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;

    for (const action of Object.keys(defaults)) {
      const mapping = parsed[action];
      if (mapping === null || validMidiMapping(mapping)) result[action] = mapping;
    }
    return result;
  }

  function consumeControllerToken(options = {}) {
    const locationRef = options.locationRef || globalScope.location;
    const historyRef = options.historyRef || globalScope.history;
    const storageRef = options.storageRef || globalScope.localStorage;
    const storageKey = options.storageKey || 'setlist_token';
    let storedToken = '';
    try {
      storedToken = storageRef?.getItem?.(storageKey) || '';
    } catch {
      storedToken = '';
    }

    let url;
    try {
      url = new URL(locationRef.href);
    } catch {
      return storedToken;
    }

    const hadTokenParameter = url.searchParams.has('token');
    const candidate = url.searchParams.get('token');
    const validCandidate = typeof candidate === 'string'
      && candidate.length > 0
      && candidate !== 'null'
      && candidate !== 'undefined';
    if (validCandidate) {
      storedToken = candidate;
      try {
        storageRef?.setItem?.(storageKey, candidate);
      } catch {
        // Storage failures must not prevent the connection attempt.
      }
    }

    if (hadTokenParameter) {
      url.searchParams.delete('token');
      const visibleUrl = `${url.pathname}${url.search}${url.hash}`;
      try {
        historyRef?.replaceState?.(null, '', visibleUrl);
      } catch {
        // Removing credentials from the address bar is best-effort.
      }
    }
    return storedToken;
  }

  function createPendingCommandTracker(options = {}) {
    const timeoutMs = options.timeoutMs || 8_000;
    const setTimeoutFn = options.setTimeoutFn || globalScope.setTimeout;
    const clearTimeoutFn = options.clearTimeoutFn || globalScope.clearTimeout;
    const onSettled = typeof options.onSettled === 'function' ? options.onSettled : () => undefined;
    const entries = new Map();

    function finish(commandId, status) {
      const entry = entries.get(commandId);
      if (!entry) return false;
      entries.delete(commandId);
      clearTimeoutFn(entry.timer);
      onSettled(entry, status);
      return true;
    }

    function begin(entry) {
      if (!entry || typeof entry.commandId !== 'string' || !entry.commandId || entries.has(entry.commandId)) {
        return false;
      }
      if ([...entries.values()].some((pending) => pending.kind === entry.kind)) return false;
      const stored = { ...entry, timer: null };
      stored.timer = setTimeoutFn(() => finish(stored.commandId, 'expired'), timeoutMs);
      entries.set(stored.commandId, stored);
      return true;
    }

    function settle(message) {
      if (!message || typeof message.commandId !== 'string' || !TERMINAL_STATUSES.has(message.status)) {
        return false;
      }
      return finish(message.commandId, message.status);
    }

    function failAll(status = 'failed') {
      for (const commandId of [...entries.keys()]) finish(commandId, status);
    }

    return {
      begin,
      failAll,
      hasKind: (kind) => [...entries.values()].some((entry) => entry.kind === kind),
      settle,
      size: () => entries.size,
    };
  }

  function createEditRevisionGuard() {
    let song = '';
    let revision = 0;

    return {
      changed() {
        revision++;
      },
      matches(snapshot) {
        return Boolean(snapshot && snapshot.song === song && snapshot.revision === revision);
      },
      selectSong(nextSong) {
        song = typeof nextSong === 'string' ? nextSong : '';
        revision++;
      },
      snapshot() {
        return { song, revision };
      },
    };
  }

  function createActiveClassController(root) {
    let songIndex = -1;
    let sectionIndex = -1;
    let songElement = null;
    let sectionElement = null;

    function clearElements() {
      songElement?.classList?.remove('active');
      sectionElement?.classList?.remove('active');
      songElement = null;
      sectionElement = null;
    }

    function reset() {
      clearElements();
      songIndex = -1;
      sectionIndex = -1;
    }

    function update(nextSongIndex, nextSectionIndex) {
      const normalizedSong = Number.isInteger(nextSongIndex) ? nextSongIndex : -1;
      const normalizedSection = Number.isInteger(nextSectionIndex) ? nextSectionIndex : -1;
      if (normalizedSong === songIndex && normalizedSection === sectionIndex) return;

      clearElements();
      songIndex = normalizedSong;
      sectionIndex = normalizedSection;
      if (songIndex < 0) return;

      songElement = root?.querySelector?.(`.song-item[data-song="${songIndex}"]`) || null;
      songElement?.classList?.add('active');
      if (sectionIndex >= 0) {
        sectionElement = root?.querySelector?.(
          `.section-btn[data-song="${songIndex}"][data-section="${sectionIndex}"]`,
        ) || null;
        sectionElement?.classList?.add('active');
      }
    }

    return { reset, update };
  }

  globalScope.RcSetlistControllerRuntime = Object.freeze({
    consumeControllerToken,
    createActiveClassController,
    createEditRevisionGuard,
    createPendingCommandTracker,
    readMidiMappings,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
