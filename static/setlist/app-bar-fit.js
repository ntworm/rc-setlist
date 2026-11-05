/*
 * The Stage Control top bar keeps one row in every language.
 *
 * English and Portuguese do not say the same thing: "Manage setlists" is
 * "Gerenciar setlists", "Full screen" is "Tela cheia", and the longer words
 * used to push the buttons to a second row. The bar keeps its shape now and
 * shrinks its own text instead, so both languages read the same way.
 */
(function appBarFitModule(globalScope) {
  'use strict';

  const DESKTOP_QUERY = '(min-width: 1181px)';
  const DEFAULT_STEP = 0.02;
  const DEFAULT_MIN = 0.8;
  const MIN_SELECT_WIDTH = 104;
  const CLIPPED_SELECTOR = '.ui-button, .tools-menu > summary, .status-badge';

  /**
   * Two decimals, so the stylesheet never reads 0.8599999999999999.
   */
  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  /**
   * The first scale that fits, or the smallest scale allowed.
   *
   * Pure: the caller says whether a scale fits. The text never shrinks below
   * the floor, so a long word costs some size but never legibility.
   */
  function chooseScale(fits, options = {}) {
    const step = options.step > 0 ? options.step : DEFAULT_STEP;
    const floor = round2(Math.min(1, options.min ?? DEFAULT_MIN));
    const steps = Math.ceil((1 - floor) / step);
    for (let index = 0; index <= steps; index += 1) {
      const scale = round2(Math.max(floor, 1 - index * step));
      if (fits(scale)) return scale;
    }
    return floor;
  }

  /**
   * Tells whether a button in the bar hides part of its own text.
   */
  function hasClippedText(bar) {
    const buttons = bar.querySelectorAll(CLIPPED_SELECTOR);
    return Array.from(buttons).some((element) => element.scrollWidth > element.clientWidth + 1);
  }

  /**
   * Wires the bar to its own size.
   *
   * The bar is measured after every change that can move it: the language
   * changes, the window resizes, and the text inside the bar changes. The
   * layout is read right away: a hidden tab never runs an animation frame.
   */
  function install(bar, select, i18n, win) {
    if (!bar || !select || !win) return;
    const desktop = win.matchMedia?.(DESKTOP_QUERY);

    const fits = (scale) => {
      bar.style.setProperty('--app-bar-scale', String(scale));
      return (
        bar.scrollWidth <= bar.clientWidth + 1 &&
        select.getBoundingClientRect().width >= MIN_SELECT_WIDTH &&
        !hasClippedText(bar)
      );
    };

    const fit = () => {
      if (!desktop?.matches) {
        bar.style.removeProperty('--app-bar-scale');
        return;
      }
      bar.style.setProperty('--app-bar-scale', String(chooseScale(fits)));
    };

    fit();
    i18n?.subscribe?.(fit);
    win.addEventListener('resize', fit);
    const Observer = win.MutationObserver;
    if (typeof Observer === 'function') {
      new Observer(() => fit()).observe(bar, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  }

  const api = Object.freeze({ chooseScale, install });
  globalScope.RcAppBarFit = api;
  // A Node sandbox can hand over a module object; the browser never has one.
  if (globalScope.module?.exports) globalScope.module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
