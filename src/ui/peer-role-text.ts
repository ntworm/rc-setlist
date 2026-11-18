// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The sentence the panel shows for the role of this computer.

import { bridgeState, type PeerRole } from '../runtime/bridge-state.js';
import type { UiLocale } from '../preferences.js';

/** The sentence the panel shows for the role of this computer. */
export function roleText(
  role: PeerRole,
  locale: UiLocale,
  peers: readonly { connected: boolean }[],
): string {
  if (role === 'none') return '';
  const up = peers.filter((peer) => peer.connected).length;
  if (role === 'master') {
    const master: Record<UiLocale, string> = {
      en: `Master \xB7 ${up} of ${peers.length} slaves connected`,
      'pt-BR': `Master \xB7 ${up} de ${peers.length} slaves conectados`,
    };
    return master[locale];
  }
  const masterConnected = (bridgeState.wsServer?.peerConnectionCount() ?? 0) > 0;
  const slave: Record<UiLocale, string> = {
    en: masterConnected ? 'Slave \xB7 connected to the master' : 'Slave \xB7 master not connected',
    'pt-BR': masterConnected ? 'Slave \xB7 conectado ao master' : 'Slave \xB7 master desconectado',
  };
  return slave[locale];
}
