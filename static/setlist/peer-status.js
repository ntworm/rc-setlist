/*
 * The second computer, as the Stage Control page sees it.
 *
 * The show can run on two computers: the main one, where Live lives, and a
 * second one that follows it. The page shows a second dot beside the
 * connection dot, and the dot says what the link is doing:
 *
 *   green — connected, and both computers read the same markers
 *   amber — connected, but the markers are not the same
 *   red   — the second computer is not answering, or its certificate changed
 *   gone  — there is no second computer
 *
 * The dot is never the only carrier of the state: it carries a title and an
 * accessible name that say the same thing in words, and the colour follows
 * the same rule as the connection dot beside it.
 */
(function peerStatusModule(globalScope) {
  'use strict';

  /**
   * What the peer dot shows for a peer status.
   *
   * Pure: the same status always gives the same view, and nothing here
   * touches the page. A certificate that changed outranks everything else —
   * the link stopped on purpose, so "not answering" would be a lie about
   * why.
   */
  function peerStatusView(peerStatus) {
    const status = peerStatus || {};
    if (!status.paired) {
      return { hidden: true, className: '', textKey: 'peer.notPaired' };
    }
    if (status.fingerprintMismatch) {
      return { hidden: false, className: 'error', textKey: 'peer.certificateChanged' };
    }
    if (!status.connected) {
      return { hidden: false, className: 'error', textKey: 'peer.offline' };
    }
    if (!status.markersMatch) {
      return { hidden: false, className: 'warning', textKey: 'peer.markersDiffer' };
    }
    return { hidden: false, className: 'connected', textKey: 'peer.connected' };
  }

  /**
   * Paints the peer dot on the page.
   *
   * The dot is hidden while there is no second computer: a show on one
   * machine shows one dot, not two.
   */
  function applyPeerStatus(peerStatus) {
    const dot = globalScope.document?.getElementById('peerStatusDot');
    if (!dot) return;
    const view = peerStatusView(peerStatus);
    dot.hidden = view.hidden;
    dot.className = view.hidden ? 'status-dot' : `status-dot ${view.className}`;
    const label = globalScope.RcSetlistI18n?.t(view.textKey) || view.textKey;
    dot.title = label;
    dot.setAttribute('aria-label', label);
  }

  globalScope.RcPeerStatus = Object.freeze({
    peerStatusView,
    applyPeerStatus,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
