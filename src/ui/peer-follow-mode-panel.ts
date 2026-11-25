// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Live panel helpers for slave follow mode actions, model lookup, and remote badges.

import {
  getPeerFollowMode,
  isPeerFollowMode,
  setPeerFollowMode,
  type UiLocale,
} from '../preferences.js';
import { bridgeState, broadcastState } from '../runtime/bridge-state.js';
import { resetPeerFollowRuntime } from '../runtime/peer-follow-runtime.js';
import { nudgeInboundHeartbeat } from '../runtime/peer-inbound.js';
import { publishPeerStatus } from '../runtime/peer-link.js';
import type { PeerFollowMode } from '../types.js';
import { log } from '../util/log.js';

/** Action prefix sent by the Live panel when selecting a slave follow mode. */
export const FOLLOW_MODE_ACTION_PREFIX = 'set-follow-mode:';

const INDEPENDENT_LABEL: Record<UiLocale, string> = {
  en: 'Independent',
  'pt-BR': 'Independente',
};

function parseFollowModeAction(action: string): PeerFollowMode | null {
  if (!action.startsWith(FOLLOW_MODE_ACTION_PREFIX)) return null;
  const raw = action.slice(FOLLOW_MODE_ACTION_PREFIX.length);
  return isPeerFollowMode(raw) ? raw : null;
}

/**
 * Applies a `set-follow-mode:<mode>` panel action, persisting the preference
 * and immediately synchronizing follower runtime, heartbeat, and Stage Control state.
 */
export function applyPanelFollowModeAction(action: string): boolean {
  const next = parseFollowModeAction(action);
  if (!next) return false;
  const writeOk = setPeerFollowMode(next);
  bridgeState.peerFollowMode = next;
  if (next === 'independent') {
    resetPeerFollowRuntime();
  }
  nudgeInboundHeartbeat();
  publishPeerStatus();
  broadcastState();
  log.info('panel', 'peer-follow-mode changed', { next, writeOk });
  return writeOk;
}

/**
 * Reads the persisted slave follow mode for the Live panel model.
 */
export function panelFollowMode(): PeerFollowMode {
  return getPeerFollowMode();
}

/**
 * Returns the localized Independent tag text for a peer row in independent mode,
 * or an empty string for any other mode.
 */
export function peerFollowModeTagText(
  mode: PeerFollowMode | null | undefined,
  locale: UiLocale,
): string {
  return mode === 'independent' ? INDEPENDENT_LABEL[locale] : '';
}
