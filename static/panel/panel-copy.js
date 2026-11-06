/**
 * Copying a link to the clipboard.
 *
 * The clipboard of the browser is not always there: the modal of Live may
 * run without it, and a browser may refuse the permission. The panel then
 * shows the address in a field the operator can select and copy by hand,
 * instead of pretending that it copied anything.
 */
(function () {
  'use strict';

  const Panel = window.RcPanel;

  /**
   * Copies a text to the clipboard.
   *
   * Returns whether the text made it there.
   */
  async function copyText(value) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  Panel.copy = { copyText: copyText };
})();
