// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The sentence the panel shows for the role of this computer.

import { bridgeState, type PeerRole } from '../runtime/bridge-state.js';
import type { UiLocale } from '../preferences.js';
import type { PeerHealthTier } from '../types.js';

/** Minimal peer fields needed to phrase the computer's role summary. */
export interface PeerRolePeer {
  connected: boolean;
  health?: PeerHealthTier;
  fingerprintMismatch?: boolean;
  versionMismatch?: boolean;
}

function isPeerHealthy(peer: PeerRolePeer): boolean {
  if (peer.fingerprintMismatch || peer.versionMismatch) return false;
  if (peer.health !== undefined) return peer.health === 'ok';
  return peer.connected;
}

function masterRoleText(locale: UiLocale, peers: readonly PeerRolePeer[]): string {
  const hasHealth = peers.some(
    (peer) =>
      peer.health !== undefined ||
      peer.fingerprintMismatch === true ||
      peer.versionMismatch === true,
  );
  const up = peers.filter(isPeerHealthy).length;
  if (hasHealth) {
    const healthPhrases: Record<UiLocale, string> = {
      en: `Master \xB7 ${up} of ${peers.length} slaves healthy`,
      'pt-BR': `Master \xB7 ${up} de ${peers.length} slaves est\u00e1veis`,
    };
    return healthPhrases[locale];
  }
  const master: Record<UiLocale, string> = {
    en: `Master \xB7 ${up} of ${peers.length} slaves connected`,
    'pt-BR': `Master \xB7 ${up} de ${peers.length} slaves conectados`,
  };
  return master[locale];
}

function slaveHealthRow(peers: readonly PeerRolePeer[]): PeerRolePeer | null {
  const first = peers[0];
  if (first && (first.health !== undefined || first.fingerprintMismatch || first.versionMismatch)) {
    return first;
  }
  if (bridgeState.peerStatus.paired && bridgeState.peerStatus.health !== undefined) {
    return bridgeState.peerStatus;
  }
  return null;
}

const SLAVE_TEXT = {
  certificateChanged: {
    en: 'Slave \xB7 certificate changed',
    'pt-BR': 'Slave \xB7 certificado mudou',
  },
  versionMismatch: {
    en: 'Slave \xB7 different versions',
    'pt-BR': 'Slave \xB7 vers\u00f5es diferentes',
  },
  down: { en: 'Slave \xB7 master not connected', 'pt-BR': 'Slave \xB7 master desconectado' },
  unstable: { en: 'Slave \xB7 link unstable', 'pt-BR': 'Slave \xB7 link inst\u00e1vel' },
  ok: { en: 'Slave \xB7 connected to the master', 'pt-BR': 'Slave \xB7 conectado ao master' },
} as const;

function slaveHealthText(locale: UiLocale, peer: PeerRolePeer): string {
  if (peer.fingerprintMismatch) return SLAVE_TEXT.certificateChanged[locale];
  if (peer.versionMismatch) return SLAVE_TEXT.versionMismatch[locale];
  if (peer.health === 'down') return SLAVE_TEXT.down[locale];
  if (peer.health === 'unstable') return SLAVE_TEXT.unstable[locale];
  return SLAVE_TEXT.ok[locale];
}

/** The sentence the panel shows for the role of this computer. */
export function roleText(role: PeerRole, locale: UiLocale, peers: readonly PeerRolePeer[]): string {
  if (role === 'none') return '';
  if (role === 'master') return masterRoleText(locale, peers);
  const healthRow = slaveHealthRow(peers);
  if (healthRow) return slaveHealthText(locale, healthRow);
  const masterConnected = (bridgeState.wsServer?.peerConnectionCount() ?? 0) > 0;
  const slave: Record<UiLocale, string> = {
    en: masterConnected ? 'Slave \xB7 connected to the master' : 'Slave \xB7 master not connected',
    'pt-BR': masterConnected ? 'Slave \xB7 conectado ao master' : 'Slave \xB7 master desconectado',
  };
  return slave[locale];
}
