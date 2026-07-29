(function setlistTransportRuntimeModule(globalScope) {
  'use strict';

  const HOLD_MS = 500;

  function isValidSong(song) {
    return song !== null && typeof song === 'object' && !Array.isArray(song);
  }

  function targetForSong(songs, songIndex, edge) {
    const song = songs[songIndex];
    if (!isValidSong(song)) return null;
    const sections = Array.isArray(song.sections) ? song.sections : [];
    if (edge === 'first') {
      return { songIndex, sectionIndex: sections.length > 0 ? 0 : null };
    }
    return { songIndex, sectionIndex: sections.length > 0 ? sections.length - 1 : null };
  }

  function resolveNavigationTarget(state, direction) {
    if (direction !== 'previous' && direction !== 'next') {
      throw new TypeError(`Unknown navigation direction: ${direction}`);
    }
    if (!state || !Array.isArray(state.songs)) return null;
    const songIndex = state.activeSongIndex;
    if (!Number.isInteger(songIndex) || songIndex < 0 || songIndex >= state.songs.length) return null;

    const song = state.songs[songIndex];
    if (!isValidSong(song)) return null;
    const sections = Array.isArray(song.sections) ? song.sections : [];
    const sectionIndex = state.activeSectionIndex;
    if (!Number.isInteger(sectionIndex) || sectionIndex < -1 || sectionIndex >= sections.length) return null;

    if (direction === 'next') {
      if (sectionIndex < 0 && sections.length > 0) return { songIndex, sectionIndex: 0 };
      if (sectionIndex >= 0 && sectionIndex + 1 < sections.length) {
        return { songIndex, sectionIndex: sectionIndex + 1 };
      }
      return targetForSong(state.songs, songIndex + 1, 'first');
    }

    if (sectionIndex > 0) return { songIndex, sectionIndex: sectionIndex - 1 };
    if (sectionIndex === 0) return { songIndex, sectionIndex: null };
    return targetForSong(state.songs, songIndex - 1, 'last');
  }

  function mountHoldButton(options) {
    const button = options.button;
    const direction = options.direction;
    const getState = options.getState;
    const canNavigate = options.canNavigate;
    const onNavigate = options.onNavigate;
    const documentRef = options.documentRef || globalScope.document;
    const windowRef = options.windowRef || globalScope;
    const setTimeoutFn = options.setTimeoutFn || globalScope.setTimeout.bind(globalScope);
    const clearTimeoutFn = options.clearTimeoutFn || globalScope.clearTimeout.bind(globalScope);
    let timer = null;
    let inputKind = null;
    let activePointerId = null;
    let fired = false;

    function resolveAllowedTarget() {
      if (!canNavigate()) return null;
      return resolveNavigationTarget(getState(), direction);
    }

    function reset() {
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
      inputKind = null;
      activePointerId = null;
      fired = false;
      button.classList.remove('is-holding');
    }

    function complete() {
      timer = null;
      if (!inputKind || fired) return;
      const target = resolveAllowedTarget();
      if (!target) {
        reset();
        update();
        return;
      }
      fired = true;
      button.classList.remove('is-holding');
      onNavigate(target);
    }

    function start(kind, event) {
      if (inputKind || !resolveAllowedTarget()) {
        update();
        return;
      }
      event.preventDefault?.();
      inputKind = kind;
      activePointerId = kind === 'pointer' && event.pointerId !== undefined ? event.pointerId : null;
      fired = false;
      button.classList.add('is-holding');
      timer = setTimeoutFn(complete, HOLD_MS);
    }

    function update() {
      const enabled = Boolean(resolveAllowedTarget());
      button.disabled = !enabled;
      button.setAttribute('aria-disabled', String(!enabled));
      if (!enabled) reset();
    }

    function handlePointerDown(event) {
      if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
      start('pointer', event);
    }

    function handlePointerEnd(event) {
      if (inputKind !== 'pointer') return;
      if (activePointerId !== null && event.pointerId !== undefined && event.pointerId !== activePointerId) return;
      reset();
    }

    function handleKeyDown(event) {
      if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat) return;
      start('keyboard', event);
    }

    function handleKeyUp(event) {
      if (inputKind === 'keyboard' && (event.key === 'Enter' || event.key === ' ')) reset();
    }

    function handleVisibility() {
      if (documentRef.visibilityState === 'hidden') reset();
    }

    function preventClick(event) {
      event.preventDefault?.();
    }

    button.addEventListener('pointerdown', handlePointerDown);
    button.addEventListener('pointerup', handlePointerEnd);
    button.addEventListener('pointerleave', handlePointerEnd);
    button.addEventListener('pointercancel', handlePointerEnd);
    button.addEventListener('lostpointercapture', handlePointerEnd);
    button.addEventListener('keydown', handleKeyDown);
    button.addEventListener('keyup', handleKeyUp);
    button.addEventListener('click', preventClick);
    button.addEventListener('contextmenu', preventClick);
    documentRef.addEventListener('visibilitychange', handleVisibility);
    windowRef.addEventListener('blur', reset);
    update();

    function destroy() {
      reset();
      button.removeEventListener('pointerdown', handlePointerDown);
      button.removeEventListener('pointerup', handlePointerEnd);
      button.removeEventListener('pointerleave', handlePointerEnd);
      button.removeEventListener('pointercancel', handlePointerEnd);
      button.removeEventListener('lostpointercapture', handlePointerEnd);
      button.removeEventListener('keydown', handleKeyDown);
      button.removeEventListener('keyup', handleKeyUp);
      button.removeEventListener('click', preventClick);
      button.removeEventListener('contextmenu', preventClick);
      documentRef.removeEventListener('visibilitychange', handleVisibility);
      windowRef.removeEventListener('blur', reset);
    }

    return { destroy, reset, update };
  }

  function createJumpConfirmation(options) {
    const onChange = options.onChange;
    const onTimeout = options.onTimeout;
    const setTimeoutFn = options.setTimeoutFn || globalScope.setTimeout.bind(globalScope);
    const clearTimeoutFn = options.clearTimeoutFn || globalScope.clearTimeout.bind(globalScope);
    const confirmMs = options.confirmMs || 3000;
    let target = null;
    let phase = 'idle';
    let timer = null;

    function snapshot() {
      return { phase, target: target ? { ...target } : null };
    }

    function publish() {
      onChange(snapshot());
    }

    function clear() {
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
      target = null;
      phase = 'idle';
      publish();
    }

    function normalize(payload) {
      return { songIndex: payload.songIndex, sectionIndex: payload.sectionIndex ?? null };
    }

    function pending(payload) {
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
      target = normalize(payload);
      phase = 'pending';
      publish();
    }

    function executed(payload) {
      if (timer !== null) clearTimeoutFn(timer);
      target = normalize(payload);
      phase = 'confirming';
      publish();
      timer = setTimeoutFn(() => {
        const timedOutTarget = target ? { ...target } : null;
        clear();
        if (timedOutTarget) onTimeout(timedOutTarget);
      }, confirmMs);
    }

    function observeState(state) {
      if (phase !== 'confirming' || !target || !state) return false;
      const matches = state.activeSongIndex === target.songIndex
        && state.activeSectionIndex === (target.sectionIndex ?? -1);
      if (matches) clear();
      return matches;
    }

    return { clear, executed, observeState, pending, snapshot };
  }

  function createQuantizationConfirmation(options = {}) {
    const onChange = options.onChange || function noop() {};
    const onFailure = options.onFailure || function noop() {};
    const setTimeoutFn = options.setTimeoutFn || globalScope.setTimeout.bind(globalScope);
    const clearTimeoutFn = options.clearTimeoutFn || globalScope.clearTimeout.bind(globalScope);
    const timeoutMs = options.timeoutMs || 4000;
    let confirmedValue = null;
    let pending = null;
    let timer = null;

    function snapshot() {
      return {
        confirmedValue,
        displayValue: pending ? pending.value : confirmedValue,
        pending: pending ? { ...pending } : null,
      };
    }

    function publish() {
      onChange(snapshot());
    }

    function cancelTimer() {
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
    }

    function fail(status) {
      if (!pending) return false;
      const failure = { ...pending, status };
      cancelTimer();
      pending = null;
      publish();
      onFailure(failure);
      return true;
    }

    function begin(request) {
      if (!Number.isInteger(request?.value) || typeof request.commandId !== 'string' || !request.commandId) {
        return false;
      }
      cancelTimer();
      pending = { value: request.value, commandId: request.commandId };
      timer = setTimeoutFn(() => fail('expired'), timeoutMs);
      publish();
      return true;
    }

    function observe(value) {
      if (!Number.isInteger(value)) return false;
      confirmedValue = value;
      const matched = Boolean(pending && pending.value === value);
      if (matched) {
        cancelTimer();
        pending = null;
      }
      publish();
      return matched;
    }

    function settle(status) {
      if (!pending || status?.commandId !== pending.commandId) return false;
      if (!['failed', 'expired', 'cancelled'].includes(status.status)) return false;
      return fail(status.status);
    }

    function reset() {
      cancelTimer();
      pending = null;
      publish();
    }

    return { begin, observe, reset, settle, snapshot };
  }

  function createBarDisplayStabilizer(options = {}) {
    const jitterToleranceBeats = Number.isFinite(options.jitterToleranceBeats)
      ? Math.max(0, options.jitterToleranceBeats)
      : 0.5;
    let lastVisualBeats = null;
    let wasPlaying = false;

    function update(estimatedBeats, isPlaying) {
      if (!Number.isFinite(estimatedBeats)) return lastVisualBeats ?? 0;
      const playing = Boolean(isPlaying);
      if (lastVisualBeats === null || !playing || !wasPlaying) {
        lastVisualBeats = estimatedBeats;
        wasPlaying = playing;
        return lastVisualBeats;
      }
      if (
        estimatedBeats < lastVisualBeats
        && lastVisualBeats - estimatedBeats < jitterToleranceBeats
      ) {
        return lastVisualBeats;
      }
      lastVisualBeats = estimatedBeats;
      wasPlaying = playing;
      return lastVisualBeats;
    }

    function reset() {
      lastVisualBeats = null;
      wasPlaying = false;
    }

    function observeState(previousState, nextState) {
      const discontinuity = !previousState
        || !nextState
        || previousState.activeSongIndex !== nextState.activeSongIndex
        || previousState.activeSectionIndex !== nextState.activeSectionIndex
        || previousState.currentLoopIteration !== nextState.currentLoopIteration
        || previousState.isPlaying !== nextState.isPlaying;
      if (discontinuity) reset();
      return discontinuity;
    }

    return { observeState, reset, update };
  }

  globalScope.SetlistTransportRuntime = {
    createBarDisplayStabilizer,
    createJumpConfirmation,
    createQuantizationConfirmation,
    mountHoldButton,
    resolveNavigationTarget,
  };
})(globalThis);
