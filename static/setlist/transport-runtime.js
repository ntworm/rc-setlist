(function setlistTransportRuntimeModule(globalScope) {
  'use strict';

  const HOLD_MS = 500;

  function preRollBarBeats(signatureNumerator, signatureDenominator) {
    if (!Number.isFinite(signatureNumerator) || signatureNumerator <= 0) return null;
    const denominator = Number.isFinite(signatureDenominator) && signatureDenominator > 0
      ? signatureDenominator
      : 4;
    return signatureNumerator * 4 / denominator;
  }

  function isKnownDuration(value) {
    return Number.isFinite(value) && value >= 0;
  }

  function usableTempo(value) {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  /**
   * Converts an Arrangement beat count into seconds on the same tempo basis the
   * song durations use: the song's declared BPM, and only then the live tempo.
   * Reading Live's current tempo here would rescale time already elapsed every
   * time the tempo changes, including the BPM written before each jump.
   */
  function songElapsedSecondsFromBeats(elapsedBeats, activeSong, fallbackTempo) {
    if (!Number.isFinite(elapsedBeats)) return null;
    const declaredTempo = isValidSong(activeSong) ? usableTempo(activeSong.bpm) : null;
    const tempo = declaredTempo ?? usableTempo(fallbackTempo);
    if (tempo === null) return null;
    return Math.max(0, elapsedBeats) * 60 / tempo;
  }

  function calculateSetlistProgress({
    songs,
    activeSongIndex,
    totalDurationSeconds,
    songElapsedSeconds,
  } = {}) {
    const showTotalSeconds = isKnownDuration(totalDurationSeconds) ? totalDurationSeconds : null;
    const unknown = {
      showElapsedSeconds: null,
      showTotalSeconds,
      songElapsedSeconds: null,
      songDurationSeconds: null,
    };
    if (!Array.isArray(songs) || !Number.isInteger(activeSongIndex)
      || activeSongIndex < 0 || activeSongIndex >= songs.length || !isValidSong(songs[activeSongIndex])) {
      return unknown;
    }

    const activeSong = songs[activeSongIndex];
    const songDurationSeconds = isKnownDuration(activeSong.durationSeconds)
      ? activeSong.durationSeconds
      : null;
    const songElapsed = Number.isFinite(songElapsedSeconds)
      ? Math.max(0, songElapsedSeconds)
      : null;
    const clampedSongElapsed = songElapsed === null
      ? null
      : songDurationSeconds === null ? songElapsed : Math.min(songElapsed, songDurationSeconds);
    let priorDurationSeconds = 0;
    for (let index = 0; index < activeSongIndex; index += 1) {
      const durationSeconds = songs[index]?.durationSeconds;
      if (!isKnownDuration(durationSeconds)) {
        return { ...unknown, showTotalSeconds, songElapsedSeconds: clampedSongElapsed, songDurationSeconds };
      }
      priorDurationSeconds += durationSeconds;
    }
    const showElapsedSeconds = clampedSongElapsed === null
      ? null
      : showTotalSeconds === null
        ? priorDurationSeconds + clampedSongElapsed
        : Math.min(priorDurationSeconds + clampedSongElapsed, showTotalSeconds);

    return { showElapsedSeconds, showTotalSeconds, songElapsedSeconds: clampedSongElapsed, songDurationSeconds };
  }

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

  function songStartTarget(songs, songIndex) {
    if (!isValidSong(songs[songIndex])) return null;
    return { songIndex, sectionIndex: null };
  }

  function resolveNavigationTarget(state, direction, level) {
    const resolvedLevel = level === 'song' ? 'song' : 'section';
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
      if (resolvedLevel === 'song') {
        return songStartTarget(state.songs, songIndex + 1);
      }
      if (sectionIndex < 0 && sections.length > 0) return { songIndex, sectionIndex: 0 };
      if (sectionIndex >= 0 && sectionIndex + 1 < sections.length) {
        return { songIndex, sectionIndex: sectionIndex + 1 };
      }
      return targetForSong(state.songs, songIndex + 1, 'first');
    }

    if (resolvedLevel === 'song') {
      return songStartTarget(state.songs, songIndex - 1);
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
    const level = options.level === 'song' ? 'song' : 'section';
    let timer = null;
    let inputKind = null;
    let activePointerId = null;

    function resolveAllowedTarget(level) {
      if (!canNavigate()) return null;
      return resolveNavigationTarget(getState(), direction, level);
    }

    function clearTimers() {
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
    }

    function removeHoldingClasses() {
      button.classList.remove('is-holding-section-ready');
      button.classList.remove('is-holding-song');
      button.classList.remove('is-holding');
    }

    function reset() {
      clearTimers();
      inputKind = null;
      activePointerId = null;
      removeHoldingClasses();
    }

    function complete() {
      if (!inputKind) return;
      clearTimers();
      const target = resolveAllowedTarget(level);
      if (level === 'song') {
        button.classList.remove('is-holding-section-ready');
        button.classList.add('is-holding-song');
      } else if (level === 'section') {
        button.classList.add('is-holding-section-ready');
      }
      if (!target) {
        // Authorization gate closed mid-hold: refresh disabled state.
        update();
        return;
      }
      onNavigate({ ...target, level });
    }

    function start(kind, event) {
      if (inputKind || !resolveAllowedTarget(level)) {
        update();
        return;
      }
      event.preventDefault?.();
      inputKind = kind;
      activePointerId = kind === 'pointer' && event.pointerId !== undefined ? event.pointerId : null;
      button.classList.add('is-holding');
      timer = setTimeoutFn(complete, HOLD_MS);
    }

    function update() {
      const enabled = Boolean(resolveAllowedTarget(level));
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
      if (inputKind === 'keyboard' && (event.key === 'Enter' || event.key === ' ')) {
        reset();
      }
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

  function mountDirectTargetHold(options) {
    const container = options.container;
    const resolveTarget = options.resolveTarget;
    const canActivate = options.canActivate;
    const onActivate = options.onActivate;
    const canReorder = options.canReorder || (() => false);
    const onReorderStart = options.onReorderStart || (() => {});
    const onReorderMove = options.onReorderMove || (() => {});
    const onReorderCommit = options.onReorderCommit || (() => {});
    const onReorderCancel = options.onReorderCancel || (() => {});
    const onDirectGestureStart = options.onDirectGestureStart || (() => {});
    const onDirectGestureEnd = options.onDirectGestureEnd || (() => {});
    const targetKey = options.targetKey || ((target) => target?.element || null);
    const documentRef = options.documentRef || globalScope.document;
    const windowRef = options.windowRef || globalScope;
    const setTimeoutFn = options.setTimeoutFn || globalScope.setTimeout.bind(globalScope);
    const clearTimeoutFn = options.clearTimeoutFn || globalScope.clearTimeout.bind(globalScope);
    const holdMs = Number.isFinite(options.holdMs) ? options.holdMs : HOLD_MS;
    const moveTolerance = Number.isFinite(options.moveTolerance) ? options.moveTolerance : 12;
    let holding = null;
    let suppressedElement = null;
    let suppressedKey = null;
    let suppressedPointerId = null;
    let suppressionTimer = null;
    let directTarget = null;
    let directInput = null;
    let directTouchId = null;

    function clearSuppression() {
      if (suppressionTimer !== null) clearTimeoutFn(suppressionTimer);
      suppressionTimer = null;
      suppressedElement = null;
      suppressedKey = null;
      suppressedPointerId = null;
    }

    function cancelHold(notifyReorder = false) {
      const cancelled = holding;
      if (cancelled && cancelled.timer !== null) clearTimeoutFn(cancelled.timer);
      cancelled?.element.classList.remove('is-touch-holding', 'is-touch-reordering');
      holding = null;
      if (notifyReorder && cancelled && cancelled.phase !== 'holding') {
        onReorderCancel(cancelled.target);
      }
    }

    function finishDirectGesture() {
      if (directTarget) onDirectGestureEnd(directTarget);
      directTarget = null;
      directInput = null;
      directTouchId = null;
    }

    function reset() {
      cancelHold(true);
      finishDirectGesture();
      clearSuppression();
    }

    function cancelForRender() {
      cancelHold(true);
      finishDirectGesture();
      if (suppressedKey !== null) scheduleSuppressionClear();
    }

    function scheduleSuppressionClear() {
      if (suppressionTimer !== null) clearTimeoutFn(suppressionTimer);
      suppressionTimer = setTimeoutFn(clearSuppression, 800);
    }

    function startDirectGesture(target, input, touchId = null) {
      directTarget = target;
      directInput = input;
      directTouchId = touchId;
      onDirectGestureStart(target);
    }

    function startHolding(target, input, contact) {
      if (!canActivate(target)) return;
      holding = {
        element: target.element,
        pointerId: input === 'pointer' ? contact.pointerId ?? null : null,
        touchId: input === 'touch' ? contact.identifier : null,
        input,
        startX: Number(contact.clientX) || 0,
        startY: Number(contact.clientY) || 0,
        target,
        timer: null,
        phase: 'holding',
      };
      holding.element.classList.add('is-touch-holding');
      holding.timer = setTimeoutFn(() => {
        if (!holding || !canActivate(holding.target)) {
          cancelHold();
          return;
        }
        holding.timer = null;
        holding.phase = 'armed';
        holding.element.classList.remove('is-touch-holding');
      }, holdMs);
    }

    function handlePointerDown(event) {
      reset();
      const isDirectPointer = event.pointerType === 'touch' || event.pointerType === 'pen';
      if (!isDirectPointer) return;
      if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
      const target = resolveTarget(event.target);
      if (!target?.element) return;

      suppressedElement = target.element;
      suppressedKey = targetKey(target);
      suppressedPointerId = event.pointerId ?? null;
      startDirectGesture(target, 'pointer');
      startHolding(target, 'pointer', event);
    }

    function matchesPointer(event) {
      if (holding?.input === 'touch' || directInput === 'touch') return false;
      return suppressedPointerId === null
        || event.pointerId === undefined
        || event.pointerId === suppressedPointerId;
    }

    function findTouch(event) {
      const touches = [...(event.changedTouches || event.touches || [])];
      return touches.find((touch) => directTouchId === null || touch.identifier === directTouchId) || null;
    }

    function handleTouchStart(event) {
      const touch = event.changedTouches?.[0] || event.touches?.[0];
      if (!touch) return;
      const target = resolveTarget(event.target);
      if (!target?.element) return;
      if (directTarget?.element === target.element && directInput === 'pointer') {
        directInput = 'touch';
        directTouchId = touch.identifier;
        if (holding) {
          holding.input = 'touch';
          holding.touchId = touch.identifier;
          holding.pointerId = null;
        }
        return;
      }
      reset();
      suppressedElement = target.element;
      suppressedKey = targetKey(target);
      suppressedPointerId = null;
      startDirectGesture(target, 'touch', touch.identifier);
      startHolding(target, 'touch', touch);
    }

    function handleDirectMove(contact, event) {
      if (!holding) return;
      const dx = (Number(contact.clientX) || 0) - holding.startX;
      const dy = (Number(contact.clientY) || 0) - holding.startY;
      if (Math.hypot(dx, dy) <= moveTolerance) return;
      if (holding.phase === 'holding') {
        cancelHold();
        return;
      }
      if (holding.phase === 'armed') {
        if (!canReorder(holding.target)) {
          cancelHold(true);
          return;
        }
        holding.phase = 'reordering';
        holding.element.classList.add('is-touch-reordering');
        onReorderStart(holding.target, event);
      }
      if (holding?.phase === 'reordering') onReorderMove(holding.target, event);
    }

    function handlePointerMove(event) {
      if (!holding || !matchesPointer(event)) return;
      handleDirectMove(event, event);
    }

    function handleTouchMove(event) {
      if (!holding || holding.input !== 'touch') return;
      const touch = findTouch(event);
      if (!touch) return;
      if (holding.phase !== 'holding') event.preventDefault?.();
      handleDirectMove(touch, touch);
    }

    function handlePointerUp(event) {
      if (!matchesPointer(event)) return;
      const completed = holding;
      if (completed) {
        if (completed.phase === 'armed') {
          cancelHold();
          if (canActivate(completed.target)) onActivate(completed.target);
        } else if (completed.phase === 'reordering') {
          cancelHold();
          onReorderCommit(completed.target, event);
        } else {
          cancelHold();
        }
      }
      finishDirectGesture();
      if (suppressedElement) scheduleSuppressionClear();
    }

    function handleTouchEnd(event) {
      if (directInput !== 'touch' || !findTouch(event)) return;
      const completed = holding;
      if (completed?.input === 'touch') {
        if (completed.phase === 'armed') {
          cancelHold();
          if (canActivate(completed.target)) onActivate(completed.target);
        } else if (completed.phase === 'reordering') {
          cancelHold();
          onReorderCommit(completed.target, event);
        } else {
          cancelHold();
        }
      }
      finishDirectGesture();
      if (suppressedElement) scheduleSuppressionClear();
    }

    function handlePointerCancellation(event) {
      if (!matchesPointer(event)) return;
      if (suppressionTimer !== null) {
        cancelHold(true);
        return;
      }
      cancelHold(true);
      finishDirectGesture();
      if (suppressedElement) scheduleSuppressionClear();
    }

    function handleTouchCancellation(event) {
      if (directInput !== 'touch' || !findTouch(event)) return;
      cancelHold(true);
      finishDirectGesture();
      if (suppressedElement) scheduleSuppressionClear();
    }

    function handleClick(event) {
      const target = resolveTarget(event.target);
      if (!target) return;
      const isKeyboardClick = event.detail === 0;
      if (!isKeyboardClick && suppressedKey !== null && suppressedKey === targetKey(target)) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        clearSuppression();
        return;
      }
      onActivate(target);
    }

    function handleContextMenu(event) {
      const target = resolveTarget(event.target);
      if (target && suppressedKey !== null && suppressedKey === targetKey(target)) event.preventDefault?.();
    }

    function handleVisibility() {
      if (documentRef.visibilityState === 'hidden') reset();
    }

    function update() {
      if (!holding) return;
      if (!canActivate(holding.target) || (holding.phase === 'reordering' && !canReorder(holding.target))) {
        cancelHold(true);
      }
    }

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchCancellation);
    container.addEventListener('click', handleClick);
    container.addEventListener('contextmenu', handleContextMenu);
    windowRef.addEventListener('pointermove', handlePointerMove);
    windowRef.addEventListener('pointerup', handlePointerUp);
    for (const type of ['pointercancel', 'pointerleave', 'lostpointercapture']) {
      windowRef.addEventListener(type, handlePointerCancellation);
    }
    documentRef.addEventListener('visibilitychange', handleVisibility);
    windowRef.addEventListener('blur', reset);

    function destroy() {
      reset();
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchCancellation);
      container.removeEventListener('click', handleClick);
      container.removeEventListener('contextmenu', handleContextMenu);
      windowRef.removeEventListener('pointermove', handlePointerMove);
      windowRef.removeEventListener('pointerup', handlePointerUp);
      for (const type of ['pointercancel', 'pointerleave', 'lostpointercapture']) {
        windowRef.removeEventListener(type, handlePointerCancellation);
      }
      documentRef.removeEventListener('visibilitychange', handleVisibility);
      windowRef.removeEventListener('blur', reset);
    }

    return { cancelForRender, destroy, reset, update };
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
      // Force-clear when transport is paused: no quantization schedule can
      // still be pending, so the visual cue should not linger. This addresses
      // the "blue bar stuck while paused" bug where MCP updates lag the
      // OSC immediate jump and the active index is briefly stale.
      const transportIdle = state.isPlaying === false;
      if (matches || transportIdle) clear();
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
    calculateSetlistProgress,
    createBarDisplayStabilizer,
    createJumpConfirmation,
    createQuantizationConfirmation,
    mountDirectTargetHold,
    mountHoldButton,
    preRollBarBeats,
    resolveNavigationTarget,
    songElapsedSecondsFromBeats,
  };
})(globalThis);
