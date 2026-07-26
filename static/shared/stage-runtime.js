(function stageRuntimeModule(globalScope) {
  'use strict';

  function isEditingTarget(target) {
    if (!target) return false;
    const tagName = String(target.tagName || '').toUpperCase();
    return target.isContentEditable === true || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
  }

  function mount(options = {}) {
    const documentRef = options.documentRef || globalScope.document;
    const navigatorRef = options.navigatorRef || globalScope.navigator || {};
    const button = options.button || documentRef?.getElementById?.('fullscreenButton');
    const notice = options.notice || documentRef?.getElementById?.('stageNotice');
    const i18n = options.i18n || globalScope.RcSetlistI18n;
    const t = (key, fallback) => i18n?.t?.(key) || fallback;
    let wakeLock = null;
    let wakeLockRequest = null;
    let noticeTimer = null;
    let destroyed = false;

    function showNotice(message) {
      if (!notice) return;
      notice.textContent = message;
      notice.hidden = false;
      if (noticeTimer) clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        notice.hidden = true;
      }, 4000);
    }

    function updateButton() {
      if (!button) return;
      const fullscreen = Boolean(documentRef.fullscreenElement);
      button.setAttribute('aria-pressed', fullscreen ? 'true' : 'false');
      button.setAttribute('aria-label', fullscreen
        ? t('fullscreen.exit', 'Exit full screen')
        : t('fullscreen.enterAria', 'Enter full screen'));
      button.setAttribute('title', fullscreen
        ? t('fullscreen.exitTitle', 'Exit full screen (F)')
        : t('fullscreen.enterTitle', 'Enter full screen (F)'));
      button.textContent = fullscreen
        ? t('fullscreen.exit', 'Exit full screen')
        : t('fullscreen.enter', 'Full screen');
    }

    async function acquireWakeLock() {
      if (destroyed || wakeLock || wakeLockRequest || !documentRef.fullscreenElement || documentRef.visibilityState === 'hidden') {
        return wakeLock;
      }
      if (!navigatorRef.wakeLock?.request) {
        showNotice(t('fullscreen.wakeUnsupported', 'Full screen is active, but this browser does not support Screen Wake Lock.'));
        return null;
      }

      wakeLockRequest = navigatorRef.wakeLock.request('screen')
        .then((lock) => {
          wakeLock = lock;
          lock.addEventListener?.('release', () => {
            if (wakeLock === lock) wakeLock = null;
          });
          return lock;
        })
        .catch(() => {
          showNotice(t('fullscreen.wakeDenied', 'Full screen is active, but the browser did not allow the screen to stay awake.'));
          return null;
        })
        .finally(() => {
          wakeLockRequest = null;
        });

      return wakeLockRequest;
    }

    async function releaseWakeLock() {
      if (wakeLockRequest) await wakeLockRequest;
      const lock = wakeLock;
      wakeLock = null;
      if (lock && !lock.released) {
        try {
          await lock.release();
        } catch {
          // A browser may release the sentinel before this cleanup runs.
        }
      }
    }

    async function sync() {
      updateButton();
      if (documentRef.fullscreenElement) {
        await acquireWakeLock();
      } else {
        await releaseWakeLock();
      }
    }

    async function toggleFullscreen() {
      try {
        if (documentRef.fullscreenElement) {
          if (typeof documentRef.exitFullscreen === 'function') await documentRef.exitFullscreen();
        } else if (typeof documentRef.documentElement?.requestFullscreen === 'function') {
          await documentRef.documentElement.requestFullscreen();
        } else {
          showNotice(t('fullscreen.unavailable', 'Full screen is not available in this browser.'));
        }
      } catch {
        showNotice(t('fullscreen.failed', 'Could not enter full screen. The page remains available in normal mode.'));
      }
      await sync();
    }

    async function handleKeydown(event) {
      if (destroyed || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditingTarget(event.target)) {
        return false;
      }
      if (String(event.key || '').toLowerCase() !== 'f') return false;
      event.preventDefault?.();
      await toggleFullscreen();
      return true;
    }

    function handleFullscreenChange() {
      void sync();
    }

    function handleVisibilityChange() {
      if (documentRef.visibilityState === 'visible' && documentRef.fullscreenElement) void sync();
    }

    function handleButtonClick() {
      void toggleFullscreen();
    }

    documentRef.addEventListener?.('fullscreenchange', handleFullscreenChange);
    documentRef.addEventListener?.('visibilitychange', handleVisibilityChange);
    documentRef.addEventListener?.('keydown', handleKeydown);
    button?.addEventListener?.('click', handleButtonClick);
    const unsubscribeLocale = i18n?.subscribe?.(updateButton) || (() => {});
    updateButton();

    async function destroy() {
      destroyed = true;
      documentRef.removeEventListener?.('fullscreenchange', handleFullscreenChange);
      documentRef.removeEventListener?.('visibilitychange', handleVisibilityChange);
      documentRef.removeEventListener?.('keydown', handleKeydown);
      button?.removeEventListener?.('click', handleButtonClick);
      unsubscribeLocale();
      if (noticeTimer) clearTimeout(noticeTimer);
      await releaseWakeLock();
    }

    return { destroy, handleKeydown, sync, toggleFullscreen };
  }

  globalScope.StageRuntime = { isEditingTarget, mount };
})(globalThis);
