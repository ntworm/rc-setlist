/*
 * Peer link health bar, transport alert badge wiring, and R2-11 full-screen
 * alarm overlay shared by Stage Control (Edit and Show mode) and Performance.
 */
(function peerHealthUiModule(globalScope) {
  'use strict';

  const TONE_CLASSES = ['is-ok', 'is-warning', 'is-error'];

  /**
   * Resolves a localized string via the global i18n catalog.
   */
  function translate(key, params) {
    return globalScope.RcSetlistI18n?.t(key, params) || key;
  }

  /**
   * Maps a peerStatusView className to its semantic pill/bar tone class.
   */
  function toneClassForView(view) {
    if (view?.className === 'connected') return 'is-ok';
    if (view?.className === 'warning') return 'is-warning';
    return 'is-error';
  }

  /**
   * Updates semantic tone classes on an element while keeping layout classes intact.
   */
  function applyToneClass(element, nextTone) {
    if (!element?.classList) return;
    for (const cls of TONE_CLASSES) {
      element.classList.toggle(cls, cls === nextTone);
    }
  }

  /**
   * Computes a stable row key for last-seen age lookup and peer_health_ack routing.
   */
  function rowKeyFor(row) {
    if (typeof row?.key === 'string' && row.key.length > 0) return row.key;
    if (typeof row?.host === 'string' && row.host.length > 0) {
      const port = Number.isFinite(row.port) ? row.port : 4444;
      return `${row.host.toLowerCase()}:${port}`;
    }
    return '';
  }

  /**
   * Formats the host label for a peer health row, falling back to the generic peer label.
   */
  function rowHostLabel(row) {
    if (typeof row?.host === 'string' && row.host.length > 0) {
      return Number.isFinite(row.port) ? `${row.host}:${row.port}` : row.host;
    }
    return translate('peer.dotLabel');
  }

  /**
   * Builds a single summary row from peerStatus when peerStatuses is empty while paired.
   */
  function fallbackRowFromStatus(peerStatus) {
    return {
      key: '',
      host: '',
      port: null,
      connected: Boolean(peerStatus.connected),
      markersMatch: peerStatus.markersMatch !== false,
      fingerprintMismatch: Boolean(peerStatus.fingerprintMismatch),
      versionMismatch: Boolean(peerStatus.versionMismatch),
      health: peerStatus.health,
      reason: peerStatus.reason,
      canAcknowledge: Boolean(peerStatus.canAcknowledge),
      rttP95Ms: peerStatus.rttP95Ms ?? null,
      drops5m: peerStatus.drops5m ?? 0,
      lastDropAt: peerStatus.lastDropAt ?? null,
    };
  }

  /**
   * Selects the paired computer rows to render in `#peerHealthBar`.
   */
  function resolveRows(peerStatus, peerStatuses) {
    if (!peerStatus?.paired) return [];
    if (Array.isArray(peerStatuses) && peerStatuses.length > 0) return peerStatuses;
    return [fallbackRowFromStatus(peerStatus)];
  }

  /**
   * Formats peer row telemetry parts into a single separator-joined string.
   */
  function formatMetricsText(row, lastSeenByKey) {
    const formatMetrics = globalScope.RcPeerStatus?.formatRowMetrics;
    if (typeof formatMetrics !== 'function') return '';
    const key = rowKeyFor(row);
    const seenInfo = key ? lastSeenByKey.get(key) : undefined;
    return formatMetrics(row, Date.now(), translate, seenInfo).join(' \u00b7 ');
  }

  /**
   * Builds one peer health row DOM node and returns its updatable metrics span.
   */
  function buildRowElement(doc, row, assignAckId, allowAck, lastSeenByKey) {
    const view = globalScope.RcPeerStatus.peerStatusView({ ...row, paired: true });
    const tone = toneClassForView(view);
    const key = rowKeyFor(row);

    const rowEl = doc.createElement('div');
    rowEl.className = 'peer-health-row';
    if (key) rowEl.dataset.peerKey = key;

    const pill = doc.createElement('span');
    pill.className = `peer-health-pill ${tone}`;
    pill.textContent = translate(view.stateKey);

    const host = doc.createElement('span');
    host.className = 'peer-health-host';
    host.textContent = rowHostLabel(row);
    rowEl.append(pill, host);

    const reasonKey = view.reasonKey || (view.tier !== 'ok' ? view.textKey : '');
    if (reasonKey) {
      const reason = doc.createElement('span');
      reason.className = 'peer-health-reason';
      reason.textContent = translate(reasonKey);
      rowEl.appendChild(reason);
    }

    const metrics = doc.createElement('span');
    metrics.className = 'peer-health-metrics';
    metrics.textContent = formatMetricsText(row, lastSeenByKey);
    rowEl.appendChild(metrics);

    let addedAck = false;
    if (view.canAcknowledge && allowAck) {
      const ackBtn = doc.createElement('button');
      ackBtn.type = 'button';
      ackBtn.className = 'ui-button peer-ack-btn';
      if (assignAckId) ackBtn.id = 'btnPeerAck';
      ackBtn.dataset.peerAckKey = key;
      ackBtn.textContent = translate('peer.acknowledge');
      rowEl.appendChild(ackBtn);
      addedAck = true;
    }

    return { rowEl, metricsEl: metrics, row, addedAck };
  }

  /**
   * Updates the R2-11 full-screen alarm overlay visibility and localized reason.
   */
  function updateAlarmOverlay(ctx) {
    const overlay = ctx.doc?.getElementById?.('peerAlarmOverlay');
    if (!overlay || !ctx.alarm) return;
    const visible = ctx.alarm.isVisible();
    overlay.hidden = !visible;
    overlay.classList.toggle('visible', visible);
    if (!visible) return;
    const view = globalScope.RcPeerStatus.peerStatusView(ctx.peerStatus);
    const reasonEl = ctx.doc.getElementById('peerAlarmReason');
    if (reasonEl) {
      reasonEl.textContent = translate(view.reasonKey || 'peer.reason.link_down');
    }
  }

  /**
   * Computes a structural signature so steady playback ticks do not recreate buttons.
   */
  function buildBarSignature(peerStatus, rows, allowAck) {
    const locale = globalScope.RcSetlistI18n?.getLocale?.() || 'en';
    return JSON.stringify({ peerStatus, rows, allowAck, locale });
  }

  /**
   * Refreshes relative last-seen and last-drop age strings in-place inside `#peerHealthBar`.
   */
  function refreshRowMetrics(ctx) {
    for (const ref of ctx.rowRefs) {
      ref.metricsEl.textContent = formatMetricsText(ref.row, ctx.lastSeenByKey);
    }
  }

  /**
   * Stops the 1-second relative-age refresh interval when unpaired or disconnected.
   */
  function stopTicker(ctx) {
    if (ctx.tickTimer === null) return;
    clearInterval(ctx.tickTimer);
    ctx.tickTimer = null;
  }

  /**
   * Ensures the 1-second age refresh timer runs while paired.
   */
  function ensureTicker(ctx) {
    if (ctx.tickTimer !== null) return;
    ctx.tickTimer = setInterval(() => refreshRowMetrics(ctx), 1000);
    ctx.tickTimer.unref?.();
  }

  /**
   * Hides and clears `#peerHealthBar` when unpaired or disconnected.
   */
  function clearHealthBar(ctx) {
    stopTicker(ctx);
    ctx.barSignature = '';
    ctx.rowRefs = [];
    const bar = ctx.doc?.getElementById?.('peerHealthBar');
    if (!bar) return;
    bar.hidden = true;
    bar.replaceChildren?.();
    applyToneClass(bar, '');
  }

  /**
   * Renders `#peerHealthBar` rows and metrics from current peer state.
   */
  function renderHealthBar(ctx, force) {
    const rows = resolveRows(ctx.peerStatus, ctx.peerStatuses);
    if (rows.length === 0) {
      clearHealthBar(ctx);
      return;
    }
    ensureTicker(ctx);
    const bar = ctx.doc?.getElementById?.('peerHealthBar');
    if (!bar) return;
    const allowAck = ctx.canSendAck();
    const summaryView = globalScope.RcPeerStatus.peerStatusView(ctx.peerStatus);
    bar.hidden = false;
    applyToneClass(bar, toneClassForView(summaryView));

    const nextSignature = buildBarSignature(ctx.peerStatus, rows, allowAck);
    if (!force && nextSignature === ctx.barSignature) {
      refreshRowMetrics(ctx);
      return;
    }
    let ackIdAssigned = false;
    const built = rows.map((row) => {
      const entry = buildRowElement(ctx.doc, row, !ackIdAssigned, allowAck, ctx.lastSeenByKey);
      if (entry.addedAck) ackIdAssigned = true;
      return entry;
    });
    ctx.rowRefs = built;
    ctx.barSignature = nextSignature;
    bar.replaceChildren(...built.map((entry) => entry.rowEl));
  }

  /**
   * Wires click handlers for peer acknowledgement and alarm dismissal once per controller.
   */
  function bindControllerEvents(ctx) {
    const bar = ctx.doc?.getElementById?.('peerHealthBar');
    bar?.addEventListener?.('click', (event) => {
      const btn = event?.target?.closest?.('[data-peer-ack-key]');
      if (!btn || !ctx.canSendAck()) return;
      ctx.sendAcknowledge(btn.dataset.peerAckKey || undefined);
    });
    const dismissBtn = ctx.doc?.getElementById?.('btnPeerAlarmDismiss');
    dismissBtn?.addEventListener?.('click', () => {
      ctx.alarm?.dismiss();
      updateAlarmOverlay(ctx);
    });
  }

  /**
   * Creates the shared peer health UI controller for Stage Control and Performance Display.
   */
  function createPeerHealthController(options = {}) {
    const ctx = {
      doc: options.document || globalScope.document,
      alarm: globalScope.RcPeerStatus?.createPeerAlarmController?.(),
      lastSeenByKey: new Map(),
      peerStatus: null,
      peerStatuses: [],
      isPlaying: false,
      barSignature: '',
      rowRefs: [],
      tickTimer: null,
      canSendAck: () => options.canSendAck?.() !== false,
      sendAcknowledge: (peerKey) => options.sendAcknowledge?.(peerKey),
    };
    bindControllerEvents(ctx);

    return {
      observeState(state) {
        ctx.peerStatus = state?.peerStatus || null;
        ctx.peerStatuses = Array.isArray(state?.peerStatuses) ? state.peerStatuses : [];
        ctx.isPlaying = Boolean(state?.isPlaying);
        globalScope.RcPeerStatus?.applyPeerStatus(ctx.peerStatus, { document: ctx.doc });
        ctx.alarm?.update({
          paired: Boolean(ctx.peerStatus?.paired),
          health: ctx.peerStatus?.health,
          isPlaying: ctx.isPlaying,
        });
        renderHealthBar(ctx, false);
        updateAlarmOverlay(ctx);
      },
      observePeerHealthEvent(payload) {
        if (!payload || payload.type !== 'peer_health' || typeof payload.key !== 'string') return;
        ctx.lastSeenByKey.set(payload.key, {
          serverNow: payload.serverNow,
          lastSeenAt: payload.lastSeenAt,
          receivedAt: Date.now(),
        });
        refreshRowMetrics(ctx);
      },
      onLocaleChange() {
        globalScope.RcPeerStatus?.applyPeerStatus(ctx.peerStatus, { document: ctx.doc });
        renderHealthBar(ctx, true);
        updateAlarmOverlay(ctx);
      },
      reset() {
        ctx.peerStatus = null;
        ctx.peerStatuses = [];
        ctx.isPlaying = false;
        ctx.lastSeenByKey.clear();
        ctx.alarm?.reset();
        globalScope.RcPeerStatus?.applyPeerStatus(null, { document: ctx.doc });
        clearHealthBar(ctx);
        updateAlarmOverlay(ctx);
      },
    };
  }

  globalScope.RcPeerHealthUi = Object.freeze({
    createPeerHealthController,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
