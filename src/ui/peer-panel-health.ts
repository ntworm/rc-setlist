// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Health badges, translated reasons, row display models, and peer-ack parsing
// for the Live panel.

import type { UiLocale } from '../preferences.js';
import type { PeerCommandAlert, PeerHealthReason, PeerLinkStatus, PeerStatus } from '../types.js';

/** The states the panel can show for the second computer. */
export type PeerPanelState =
  | 'not_paired'
  | 'connected'
  | 'markers_differ'
  | 'unstable'
  | 'offline'
  | 'version_mismatch'
  | 'certificate_changed';

/** The semantic health badge states shown per row in the Live panel. */
export type PeerHealthBadgeState =
  'ok' | 'unstable' | 'down' | 'version_mismatch' | 'certificate_changed';

/** Parsed peer health acknowledgement action from the Live panel. */
export interface PeerAckAction {
  kind: 'ack';
  peerKey?: string;
}

/** Display model for a single peer row in the Live panel. */
export interface PeerRowDisplay {
  state: PeerHealthBadgeState;
  badgeText: string;
  reasonText: string;
  statusText: string;
  rttP95Ms: number | null;
  drops5m: number;
  lastDropAt: number | null;
  lastSeenAt: number | null;
  canAcknowledge: boolean;
}

const ACK_PREFIX = 'peer-ack:';
const PEER_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,260}$/;

const STATE_TEXT: Record<PeerPanelState, Record<UiLocale, string>> = {
  not_paired: {
    en: 'Not paired with a second computer',
    'pt-BR': 'Sem pareamento com um segundo computador',
  },
  connected: {
    en: 'Second computer connected',
    'pt-BR': 'Segundo computador conectado',
  },
  markers_differ: {
    en: 'Connected, but the markers are different',
    'pt-BR': 'Conectado, mas os marcadores s\u00e3o diferentes',
  },
  unstable: {
    en: 'Second computer link is unstable',
    'pt-BR': 'Link do segundo computador est\u00e1 inst\u00e1vel',
  },
  offline: {
    en: 'The second computer is not answering',
    'pt-BR': 'O segundo computador n\u00e3o responde',
  },
  version_mismatch: {
    en: 'Different versions \u2014 update both computers',
    'pt-BR': 'Vers\u00f5es diferentes \u2014 atualize os dois computadores',
  },
  certificate_changed: {
    en: 'The certificate changed \u2014 pair again',
    'pt-BR': 'O certificado mudou \u2014 pareie de novo',
  },
};

const BADGE_TEXT: Record<PeerHealthBadgeState, Record<UiLocale, string>> = {
  ok: { en: 'OK', 'pt-BR': 'OK' },
  unstable: { en: 'UNSTABLE', 'pt-BR': 'INST\u00c1VEL' },
  down: { en: 'DOWN', 'pt-BR': 'CA\u00cdDO' },
  version_mismatch: {
    en: 'DIFFERENT VERSIONS',
    'pt-BR': 'VERS\u00d5ES DIFERENTES',
  },
  certificate_changed: {
    en: 'CERTIFICATE CHANGED',
    'pt-BR': 'CERTIFICADO MUDOU',
  },
};

const REASON_TEXT: Record<PeerHealthReason, Record<UiLocale, string>> = {
  ok: { en: 'Link healthy', 'pt-BR': 'Link est\u00e1vel' },
  link_down: { en: 'Link down', 'pt-BR': 'Link ca\u00eddo' },
  remote_link_down: {
    en: 'Remote link down',
    'pt-BR': 'Link ca\u00eddo no outro computador',
  },
  local_osc_live_unready: {
    en: 'Local Live/OSC unavailable',
    'pt-BR': 'Live/OSC local indispon\u00edvel',
  },
  remote_osc_live_unready: {
    en: 'Remote Live/OSC unavailable',
    'pt-BR': 'Live/OSC remoto indispon\u00edvel',
  },
  link_oscillating: {
    en: 'Link oscillating (5 min hold)',
    'pt-BR': 'Link oscilando (trava 5 min)',
  },
  warming_up: { en: 'Warming up (20 s)', 'pt-BR': 'Aquecendo (20 s)' },
  recent_drop: { en: 'Recent drop', 'pt-BR': 'Queda recente' },
  heartbeat_lost: { en: 'Heartbeat lost', 'pt-BR': 'Heartbeat perdido' },
  high_rtt: { en: 'High latency (RTT)', 'pt-BR': 'Lat\u00eancia alta (RTT)' },
  remote_unstable: {
    en: 'Unstable on other computer',
    'pt-BR': 'Inst\u00e1vel no outro computador',
  },
  markers_differ: { en: 'Markers differ', 'pt-BR': 'Marcadores diferentes' },
  out_of_step: { en: 'Out of step', 'pt-BR': 'Fora de passo' },
};

function healthTierToPanelState(status: PeerStatus): PeerPanelState {
  if (status.health === 'down') return 'offline';
  if (status.health === 'unstable') {
    return status.reason === 'markers_differ' ? 'markers_differ' : 'unstable';
  }
  return 'connected';
}

/**
 * The state the link to the second computer is in.
 *
 * A certificate that changed outranks version mismatch and link health, and
 * when `health` is present it governs over raw `connected`.
 */
export function peerPanelState(status: PeerStatus): PeerPanelState {
  if (!status.paired) return 'not_paired';
  if (status.fingerprintMismatch) return 'certificate_changed';
  if (status.versionMismatch) return 'version_mismatch';
  if (status.health !== undefined) return healthTierToPanelState(status);
  if (!status.connected) return 'offline';
  if (!status.markersMatch) return 'markers_differ';
  return 'connected';
}

/**
 * The sentence the panel shows for a state.
 */
export function peerStateText(state: PeerPanelState, locale: UiLocale): string {
  return STATE_TEXT[state][locale];
}

/**
 * Maps a peer row health state to its localized badge label.
 */
export function peerHealthBadgeText(state: PeerHealthBadgeState, locale: UiLocale): string {
  return BADGE_TEXT[state][locale];
}

/**
 * Maps a backend peer health reason code to localized EN or pt-BR operator text.
 */
export function peerReasonText(reason: PeerHealthReason | undefined, locale: UiLocale): string {
  if (!reason) return '';
  return REASON_TEXT[reason]?.[locale] ?? '';
}

function rowBadgeState(row: PeerLinkStatus): PeerHealthBadgeState {
  if (row.fingerprintMismatch) return 'certificate_changed';
  if (row.versionMismatch) return 'version_mismatch';
  if (row.health !== undefined) return row.health;
  if (!row.connected) return 'down';
  return row.markersMatch ? 'ok' : 'unstable';
}

function rowReasonText(row: PeerLinkStatus, state: PeerHealthBadgeState, locale: UiLocale): string {
  if (state === 'certificate_changed' || state === 'version_mismatch') return '';
  if (row.reason !== undefined) return peerReasonText(row.reason, locale);
  if (state === 'down') return peerReasonText('link_down', locale);
  if (state === 'unstable') {
    return row.markersMatch ? '' : peerReasonText('markers_differ', locale);
  }
  return peerReasonText('ok', locale);
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Builds the localized Live panel display fields for a single paired computer row.
 */
export function peerRowDisplay(
  row: PeerLinkStatus,
  locale: UiLocale,
  lastSeenAt: number | null = null,
): PeerRowDisplay {
  const state = rowBadgeState(row);
  const panelState = peerPanelState({ paired: true, ...row });
  return {
    state,
    badgeText: peerHealthBadgeText(state, locale),
    reasonText: rowReasonText(row, state, locale),
    statusText: peerStateText(panelState, locale),
    rttP95Ms: finiteOrNull(row.rttP95Ms),
    drops5m: typeof row.drops5m === 'number' && Number.isFinite(row.drops5m) ? row.drops5m : 0,
    lastDropAt: finiteOrNull(row.lastDropAt),
    lastSeenAt: finiteOrNull(lastSeenAt),
    canAcknowledge: state === 'unstable' && row.canAcknowledge === true,
  };
}

/** Optional lookup source for per-peer last-seen wall-clock timestamps. */
export type PeerLastSeenSource =
  Map<string, number | null> | Readonly<Record<string, number | null>>;

/**
 * Parses a Live panel peer acknowledgement action (`peer-ack` or `peer-ack:<peerKey>`).
 */
export function parsePeerAckAction(action: string): PeerAckAction | null {
  if (action === 'peer-ack') return { kind: 'ack' };
  if (!action.startsWith(ACK_PREFIX)) return null;
  const peerKey = action.slice(ACK_PREFIX.length);
  if (!PEER_KEY_PATTERN.test(peerKey)) return null;
  return { kind: 'ack', peerKey };
}

function lookupLastSeen(key: string, source?: PeerLastSeenSource): number | null | undefined {
  if (!source) return undefined;
  if (source instanceof Map) return source.get(key);
  return source[key];
}

function resolveRowLastSeen(
  row: PeerLinkStatus,
  lastSeenByKey: PeerLastSeenSource | undefined,
  inboundLastSeenAt: number | null,
): number | null {
  const key = row.key ?? `${row.host.toLowerCase()}:${row.port}`;
  const found = lookupLastSeen(key, lastSeenByKey);
  if (found !== undefined) return found;
  if (key === 'inbound:master' || row.role === 'inbound') return inboundLastSeenAt;
  return null;
}

/**
 * Enriches peer status rows with localized badges, reasons, and last-seen ages.
 */
export function buildPeerPanelRows<TRow extends PeerLinkStatus>(
  rows: readonly TRow[],
  locale: UiLocale,
  lastSeenByKey?: PeerLastSeenSource,
  inboundLastSeenAt: number | null = null,
): Array<TRow & PeerRowDisplay> {
  return rows.map((row) => ({
    ...row,
    ...peerRowDisplay(row, locale, resolveRowLastSeen(row, lastSeenByKey, inboundLastSeenAt)),
  }));
}

/** Display model for an active peer command alert in the Live panel. */
export interface PeerPanelAlertDisplay {
  peerKey: string;
  commandId: string;
  commandType: string;
  status: string;
  text: string;
}

/**
 * Formats an active peer command alert into localized EN or pt-BR operator text.
 */
export function formatPeerAlertText(
  alert: Pick<PeerCommandAlert, 'commandType' | 'status'>,
  locale: UiLocale,
): string {
  const cmd = alert.commandType || 'command';
  if (alert.status === 'stop_unacked') {
    return locale === 'pt-BR' ? 'SLAVE AINDA N\u00c3O PAROU' : 'SLAVE STILL NOT STOPPED';
  }
  if (alert.status === 'late_confirmed') {
    return locale === 'pt-BR' ? `Executou atrasado: ${cmd}` : `Executed late: ${cmd}`;
  }
  return locale === 'pt-BR' ? `SLAVE N\u00c3O EXECUTOU: ${cmd}` : `SLAVE DID NOT EXECUTE: ${cmd}`;
}

/**
 * Builds localized Live panel alert records keyed by peer key.
 */
export function buildPeerPanelAlerts(
  alerts: Readonly<Record<string, PeerCommandAlert>> | undefined,
  locale: UiLocale,
): Record<string, PeerPanelAlertDisplay> {
  const out: Record<string, PeerPanelAlertDisplay> = {};
  if (!alerts) return out;
  for (const [peerKey, alert] of Object.entries(alerts)) {
    if (!alert) continue;
    out[peerKey] = {
      peerKey,
      commandId: alert.commandId,
      commandType: alert.commandType,
      status: alert.status,
      text: formatPeerAlertText(alert, locale),
    };
  }
  return out;
}
