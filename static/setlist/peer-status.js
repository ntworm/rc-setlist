/*
 * The second computer, as the Stage Control page sees it.
 *
 * The show can run on two computers: the main one, where Live lives, and a
 * second one that follows it. The page presents link health derived from
 * server-side health tiers rather than raw socket state:
 *
 *   ok                  - green dot, transport badge hidden
 *   unstable            - amber dot and LINK UNSTABLE badge
 *   down                - red dot and LINK DOWN badge
 *   version_mismatch    - red dot and DIFFERENT VERSIONS badge
 *   certificate_changed - red dot and CERT MISMATCH badge
 *   none (unpaired)     - dot and badge hidden
 *
 * Precedence: fingerprintMismatch > versionMismatch > down > unstable > ok.
 */
(function peerStatusModule(globalScope) {
  'use strict';

  const KNOWN_REASONS = new Set([
    'ok',
    'link_down',
    'remote_link_down',
    'local_osc_live_unready',
    'remote_osc_live_unready',
    'link_oscillating',
    'warming_up',
    'recent_drop',
    'heartbeat_lost',
    'high_rtt',
    'remote_unstable',
    'markers_differ',
    'out_of_step',
  ]);

  /**
   * Maps a backend health reason code to its i18n key, or empty string if unknown.
   */
  function reasonKeyFor(reason) {
    if (typeof reason !== 'string' || !KNOWN_REASONS.has(reason)) return '';
    return `peer.reason.${reason}`;
  }

  /**
   * Computes the paired peer status view for ok, unstable, or down health tiers.
   */
  function healthTierView(status) {
    if (status.health === 'ok') {
      return {
        hidden: false,
        className: 'connected',
        tier: 'ok',
        stateKey: 'peer.state.ok',
        textKey: 'peer.connected',
        reasonKey: 'peer.reason.ok',
        badgeKey: '',
        canAcknowledge: false,
      };
    }
    if (status.health === 'unstable') {
      return {
        hidden: false,
        className: 'warning',
        tier: 'unstable',
        stateKey: 'peer.state.unstable',
        textKey: status.reason === 'markers_differ' ? 'peer.markersDiffer' : 'peer.state.unstable',
        reasonKey: reasonKeyFor(status.reason),
        badgeKey: 'peer.transportBadge.unstable',
        canAcknowledge: status.canAcknowledge === true,
      };
    }
    return {
      hidden: false,
      className: 'error',
      tier: 'down',
      stateKey: 'peer.state.down',
      textKey: 'peer.offline',
      reasonKey: reasonKeyFor(status.reason || 'link_down'),
      badgeKey: 'peer.transportBadge.down',
      canAcknowledge: false,
    };
  }

  /**
   * What the peer dot and badge show for a peer status.
   *
   * Pure: the same status always gives the same view. Precedence is
   * fingerprintMismatch > versionMismatch > down > unstable > ok, and
   * colour never depends on the raw socket connected flag.
   */
  function peerStatusView(peerStatus) {
    const status = peerStatus || {};
    if (!status.paired) {
      return {
        hidden: true,
        className: '',
        tier: 'none',
        stateKey: 'peer.notPaired',
        textKey: 'peer.notPaired',
        reasonKey: '',
        badgeKey: '',
        canAcknowledge: false,
      };
    }
    if (status.fingerprintMismatch) {
      return {
        hidden: false,
        className: 'error',
        tier: 'certificate_changed',
        stateKey: 'peer.state.certificateChanged',
        textKey: 'peer.certificateChanged',
        reasonKey: '',
        badgeKey: 'peer.transportBadge.certificateChanged',
        canAcknowledge: false,
      };
    }
    if (status.versionMismatch) {
      return {
        hidden: false,
        className: 'error',
        tier: 'version_mismatch',
        stateKey: 'peer.state.versionMismatch',
        textKey: 'peer.versionMismatch',
        reasonKey: '',
        badgeKey: 'peer.transportBadge.versionMismatch',
        canAcknowledge: false,
      };
    }
    return healthTierView(status);
  }

  /**
   * Formats a non-negative duration in milliseconds into a compact age string.
   */
  function formatAgo(deltaMs) {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) return '\u2014';
    if (deltaMs < 60_000) return `${Math.floor(deltaMs / 1000)}s`;
    if (deltaMs < 3_600_000) {
      const minutes = Math.floor(deltaMs / 60_000);
      const seconds = Math.floor((deltaMs % 60_000) / 1000);
      return `${minutes}m ${seconds}s`;
    }
    const hours = Math.floor(deltaMs / 3_600_000);
    const minutes = Math.floor((deltaMs % 3_600_000) / 60_000);
    return `${hours}h ${minutes}m`;
  }

  /**
   * Translates a key using the global i18n catalog when available.
   */
  function defaultTranslate(key, params) {
    return globalScope.RcSetlistI18n?.t(key, params) || key;
  }

  /**
   * Computes elapsed age for a server timestamp without relying on matching clocks.
   */
  function computeServerAgeMs(eventWallMs, nowMs, lastSeenInfo) {
    if (!Number.isFinite(eventWallMs) || !Number.isFinite(nowMs)) return null;
    const info = lastSeenInfo || {};
    if (Number.isFinite(info.serverNow) && Number.isFinite(info.receivedAt)) {
      const baseAgeMs = info.serverNow - eventWallMs;
      const clientElapsedMs = nowMs - info.receivedAt;
      return Math.max(0, baseAgeMs + clientElapsedMs);
    }
    return Math.max(0, nowMs - eventWallMs);
  }

  /**
   * Appends a formatted age metric part when the timestamp yields a valid age.
   */
  function appendAgeMetric(parts, key, timestamp, now, lastSeenInfo, t) {
    const ageMs = computeServerAgeMs(timestamp, now, lastSeenInfo);
    if (ageMs !== null) {
      parts.push(t(key, { ago: formatAgo(ageMs) }));
    }
  }

  /**
   * Formats peer row telemetry (RTT, drops5m, lastDropAgo, lastSeenAgo) into display parts.
   */
  function formatRowMetrics(row, nowMs, translate, lastSeenInfo) {
    const data = row || {};
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const t = typeof translate === 'function' ? translate : defaultTranslate;
    const parts = [];
    if (Number.isFinite(data.rttP95Ms)) {
      parts.push(t('peer.metric.rtt', { ms: Math.round(data.rttP95Ms) }));
    }
    if (Number.isFinite(data.drops5m) && data.drops5m >= 0) {
      parts.push(t('peer.metric.drops5m', { count: data.drops5m }));
    }
    appendAgeMetric(parts, 'peer.metric.lastDropAgo', data.lastDropAt, now, lastSeenInfo, t);
    const seenAt = lastSeenInfo ? lastSeenInfo.lastSeenAt : data.lastSeenAt;
    appendAgeMetric(parts, 'peer.metric.lastSeenAgo', seenAt, now, lastSeenInfo, t);
    return parts;
  }

  /**
   * Advances the R2-11 alarm flags for a single peer status transition.
   */
  function stepPeerAlarm(flags, isDown, playing) {
    if (!flags.initialized) {
      flags.initialized = true;
      flags.wasDown = isDown;
      flags.visible = isDown && playing;
      flags.dismissed = false;
      return { visible: flags.visible };
    }
    if (!isDown) {
      flags.visible = false;
      flags.dismissed = false;
      flags.wasDown = false;
      return { visible: false };
    }
    if (!flags.wasDown) {
      flags.visible = true;
      flags.dismissed = false;
      flags.wasDown = true;
      return { visible: true };
    }
    if (flags.dismissed) flags.visible = false;
    else if (playing) flags.visible = true;
    return { visible: flags.visible };
  }

  /**
   * Creates the R2-11 alarm controller for paired peer link-down alerts.
   */
  function createPeerAlarmController() {
    const flags = { initialized: false, wasDown: false, visible: false, dismissed: false };
    return {
      update(state) {
        const input = state || {};
        const isDown = Boolean(input.paired) && input.health === 'down';
        return stepPeerAlarm(flags, isDown, Boolean(input.isPlaying));
      },
      dismiss() {
        flags.dismissed = true;
        flags.visible = false;
        return { visible: false };
      },
      reset() {
        flags.initialized = false;
        flags.wasDown = false;
        flags.visible = false;
        flags.dismissed = false;
      },
      isVisible() {
        return flags.visible;
      },
    };
  }

  /**
   * Resolves the translation callback from options or the global i18n module.
   */
  function resolveTranslate(options) {
    if (typeof options?.translate === 'function') return options.translate;
    return defaultTranslate;
  }

  /**
   * Updates the warning or error tone class on the transport badge element.
   */
  function setBadgeToneClass(badge, toneClass) {
    if (badge.classList?.toggle) {
      badge.classList.toggle('is-warning', toneClass === 'is-warning');
      badge.classList.toggle('is-error', toneClass === 'is-error');
      return;
    }
    const base = String(badge.className || '')
      .split(/\s+/)
      .filter((cls) => cls && cls !== 'is-warning' && cls !== 'is-error');
    if (toneClass) base.push(toneClass);
    badge.className = base.join(' ');
  }

  /**
   * Updates `#peerTransportBadge` when present in the document.
   */
  function applyTransportBadge(doc, view, translate) {
    const badge = doc?.getElementById?.('peerTransportBadge');
    if (!badge) return;
    if (view.hidden || view.tier === 'ok') {
      badge.hidden = true;
      badge.textContent = '';
      setBadgeToneClass(badge, '');
      return;
    }
    badge.hidden = false;
    badge.textContent = translate(view.badgeKey);
    setBadgeToneClass(badge, view.className === 'warning' ? 'is-warning' : 'is-error');
  }

  /**
   * Paints `#peerStatusDot` and `#peerTransportBadge` from a peer status payload.
   */
  function applyPeerStatus(peerStatus, options = {}) {
    const doc = options?.document || globalScope.document;
    if (!doc?.getElementById) return;
    const translate = resolveTranslate(options);
    const view = peerStatusView(peerStatus);
    const dot = doc.getElementById('peerStatusDot');
    if (dot) {
      dot.hidden = view.hidden;
      dot.className = view.hidden ? 'status-dot' : `status-dot ${view.className}`;
      const label = translate(view.textKey);
      dot.title = label;
      dot.setAttribute?.('aria-label', label);
    }
    applyTransportBadge(doc, view, translate);
  }

  globalScope.RcPeerStatus = Object.freeze({
    peerStatusView,
    applyPeerStatus,
    formatAgo,
    formatRowMetrics,
    createPeerAlarmController,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
