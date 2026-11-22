/**
 * Peer health rendering for the Live panel's Second computer card and footer role.
 *
 * Uses server-computed `health` tiers (ok / unstable / down) and mismatch flags
 * rather than raw `connected` whenever health fields are present.
 */
(function () {
  'use strict';

  const Panel = (window.RcPanel = window.RcPanel || {});
  const shell = Panel.shell;

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
   * Resolves a localized string via the panel dictionary and shared i18n catalog.
   */
  function translate(key, params) {
    if (shell && typeof shell.text === 'function') return shell.text(key, params);
    return key;
  }

  /**
   * Returns true when a peer row carries health or mismatch fields from the runtime.
   */
  function hasHealthMetadata(row) {
    return Boolean(
      row && (row.fingerprintMismatch || row.versionMismatch || row.health !== undefined),
    );
  }

  /**
   * Maps a backend reason code to its i18n key when recognized.
   */
  function reasonKeyFor(reason) {
    if (typeof reason !== 'string' || !KNOWN_REASONS.has(reason)) return '';
    return `peer.reason.${reason}`;
  }

  /**
   * Classifies ok, unstable, or down health tiers for a peer row.
   */
  function classifyHealthTier(row) {
    if (row.health === 'ok') {
      return {
        tier: 'ok',
        statusClass: 'active',
        stateKey: 'peer.state.ok',
        reasonKey: reasonKeyFor(row.reason) || 'peer.reason.ok',
        canAcknowledge: false,
      };
    }
    if (row.health === 'unstable') {
      const fallback = row.markersMatch === false ? 'peer.reason.markers_differ' : '';
      const nonOkReason = row.reason !== 'ok' ? reasonKeyFor(row.reason) : '';
      return {
        tier: 'unstable',
        statusClass: 'warning',
        stateKey: 'peer.state.unstable',
        reasonKey: nonOkReason || fallback,
        canAcknowledge: row.canAcknowledge === true,
      };
    }
    const downReason = row.reason !== 'ok' ? reasonKeyFor(row.reason) : '';
    return {
      tier: 'down',
      statusClass: 'error',
      stateKey: 'peer.state.down',
      reasonKey: downReason || 'peer.reason.link_down',
      canAcknowledge: false,
    };
  }

  /**
   * Classifies a peer row using certificate, version, and health-tier precedence.
   */
  function classifyHealthRow(row) {
    if (row.fingerprintMismatch) {
      return {
        tier: 'certificate_changed',
        statusClass: 'error',
        stateKey: 'peer.state.certificateChanged',
        reasonKey: 'peer.certificateChanged',
        canAcknowledge: false,
      };
    }
    if (row.versionMismatch) {
      return {
        tier: 'version_mismatch',
        statusClass: 'error',
        stateKey: 'peer.state.versionMismatch',
        reasonKey: 'peer.versionMismatch',
        canAcknowledge: false,
      };
    }
    return classifyHealthTier(row);
  }

  /**
   * Classifies a legacy peer row that carries no health tier or mismatch flags.
   */
  function classifyLegacyRow(row) {
    const good = Boolean(row.connected) && Boolean(row.markersMatch);
    return {
      tier: 'legacy',
      statusClass: good ? 'active' : 'warning',
      stateKey: '',
      reasonKey: '',
      canAcknowledge: false,
    };
  }

  /**
   * Resolves status tier, CSS tone class, i18n keys, and acknowledge eligibility.
   */
  function classifyPeerRow(row) {
    return hasHealthMetadata(row) ? classifyHealthRow(row) : classifyLegacyRow(row);
  }

  /**
   * Formats a non-negative duration in milliseconds into a compact age string.
   */
  function formatAgo(deltaMs) {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) return '\u2014';
    if (deltaMs < 60000) return `${Math.floor(deltaMs / 1000)}s`;
    if (deltaMs < 3600000) {
      const minutes = Math.floor(deltaMs / 60000);
      const seconds = Math.floor((deltaMs % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    }
    const hours = Math.floor(deltaMs / 3600000);
    const minutes = Math.floor((deltaMs % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }

  /**
   * Formats RTT, drops5m, lastDropAgo, and lastSeenAgo parts for a peer row.
   */
  function formatRowMetrics(row, nowMs) {
    const parts = [];
    if (typeof row.rttP95Ms === 'number' && Number.isFinite(row.rttP95Ms)) {
      parts.push(translate('peer.metric.rtt', { ms: Math.round(row.rttP95Ms) }));
    }
    if (typeof row.drops5m === 'number' && Number.isFinite(row.drops5m) && row.drops5m >= 0) {
      parts.push(translate('peer.metric.drops5m', { count: row.drops5m }));
    }
    if (typeof row.lastDropAt === 'number' && Number.isFinite(row.lastDropAt)) {
      const ago = formatAgo(Math.max(0, nowMs - row.lastDropAt));
      parts.push(translate('peer.metric.lastDropAgo', { ago }));
    }
    if (typeof row.lastSeenAt === 'number' && Number.isFinite(row.lastSeenAt)) {
      const ago = formatAgo(Math.max(0, nowMs - row.lastSeenAt));
      parts.push(translate('peer.metric.lastSeenAgo', { ago }));
    }
    return parts;
  }

  /**
   * Builds the combined reason and telemetry line for a peer row.
   */
  function buildMetaText(row, view, nowMs) {
    const parts = [];
    const reason = view.reasonKey ? translate(view.reasonKey) : row.reasonText || '';
    if (reason) parts.push(reason);
    parts.push(...formatRowMetrics(row, nowMs));
    return parts.join(' \u00b7 ');
  }

  /**
   * Resolves the stable key identifying a peer row for acknowledge envelopes.
   */
  function resolveRowKey(row) {
    if (typeof row.key === 'string' && row.key.length > 0) return row.key;
    if (row.role === 'inbound') return 'inbound:master';
    return `${row.host}:${row.port}`;
  }

  /**
   * Builds the Acknowledge (when gated open) and Unpair buttons for a peer row.
   */
  function buildRowActions(row, view) {
    const actions = document.createElement('span');
    actions.className = 'peer-list-actions';
    if (view.canAcknowledge) {
      const ack = document.createElement('button');
      ack.className = 'btn small peer-ack-btn';
      ack.type = 'button';
      ack.textContent = translate('peer.acknowledge');
      const key = resolveRowKey(row);
      ack.addEventListener('click', () => {
        shell.sendAction(`peer-ack:${key}`);
      });
      actions.appendChild(ack);
    }
    const unpair = document.createElement('button');
    unpair.className = 'btn small';
    unpair.type = 'button';
    unpair.textContent = translate('panel.peerUnpair');
    const unpairAction =
      row.role === 'inbound' ? 'peer-unpair' : `peer-unpair:${row.host}:${row.port}`;
    unpair.addEventListener('click', () => {
      shell.sendAction(unpairAction);
    });
    actions.appendChild(unpair);
    return actions;
  }

  /**
   * Builds one `<li>` element for `#peerList`.
   */
  function buildPeerListItem(row, nowMs) {
    const view = classifyPeerRow(row);
    const item = document.createElement('li');
    const address = document.createElement('span');
    address.className = 'peer-list-address';
    address.textContent = Number.isFinite(row.port) ? `${row.host}:${row.port}` : String(row.host);

    const status = document.createElement('span');
    status.className = `peer-list-status ${view.statusClass}`;
    status.textContent = view.stateKey
      ? translate(view.stateKey)
      : row.badgeText || row.statusText || '';
    item.append(address, status);

    const metaText = buildMetaText(row, view, nowMs);
    if (metaText) {
      const meta = document.createElement('span');
      meta.className = 'peer-list-meta';
      meta.textContent = metaText;
      item.appendChild(meta);
    }

    item.appendChild(buildRowActions(row, view));
    return item;
  }

  /**
   * Renders all paired computer rows into `#peerList`.
   */
  function renderPeerList(peer) {
    const list = shell.el('peerList');
    if (!list) return;
    const peers = peer?.peers || [];
    list.textContent = '';
    list.hidden = peers.length === 0;
    const nowMs = typeof peer?.serverNow === 'number' ? peer.serverNow : Date.now();
    for (const row of peers) {
      list.appendChild(buildPeerListItem(row, nowMs));
    }
  }

  /**
   * Resolves the CSS tone class (`active`, `warning`, or `error`) for `#peerRoleText`.
   */
  function masterRoleClass(peers) {
    if (peers.length === 0) return 'warning';
    if (!peers.some(hasHealthMetadata)) {
      return peers.every((row) => Boolean(row.connected)) ? 'active' : 'warning';
    }
    const classes = peers.map((row) => classifyPeerRow(row).statusClass);
    if (classes.includes('error')) return 'error';
    if (classes.includes('warning')) return 'warning';
    return 'active';
  }

  /**
   * Resolves the CSS tone class (`active`, `warning`, or `error`) for a slave role footer.
   */
  function slaveRoleClass(peer) {
    const peers = peer.peers || [];
    if (peers.length > 0 && hasHealthMetadata(peers[0])) {
      return classifyPeerRow(peers[0]).statusClass;
    }
    if (
      peer.state === 'certificate_changed' ||
      peer.state === 'version_mismatch' ||
      peer.state === 'offline'
    ) {
      return 'error';
    }
    if (peer.state === 'unstable' || peer.state === 'markers_differ') return 'warning';
    return peer.slaveConnected === true ? 'active' : 'warning';
  }

  /**
   * Resolves the CSS tone class (`active`, `warning`, or `error`) for `#peerRoleText`.
   */
  function peerRoleClass(peer) {
    if (!peer) return 'warning';
    if (peer.role === 'master') return masterRoleClass(peer.peers || []);
    if (peer.role === 'slave') return slaveRoleClass(peer);
    return 'warning';
  }

  Panel.peerHealth = {
    renderPeerList: renderPeerList,
    peerRoleClass: peerRoleClass,
  };
})();
