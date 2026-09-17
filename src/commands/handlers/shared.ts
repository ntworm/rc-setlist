// Helpers shared by every per-family handler module. Lives here so the family
// modules can use them without depending on `./index.js`, which would
// re-introduce the dependency cycles the module split was meant to remove.
import * as path from 'node:path';
import type { ClientMessage } from '../../types.js';
import { bridgeState } from '../../runtime/bridge-state.js';
import { OperatorError } from '../../core/operator-error.js';
import type { ProfilePaths } from '../../core/profile-manager.js';

export type ClientMessageOf<TType extends ClientMessage['type']> = Extract<
  ClientMessage,
  { type: TType }
>;

/**
 * Reports whether the record matches the contract.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface PersistenceScopeSnapshot {
  profileManager: NonNullable<typeof bridgeState.profileManager>;
  manager: NonNullable<typeof bridgeState.manager>;
  activeProfileId: string;
  paths: ProfilePaths;
  projectIdentityKey: string | null;
  projectSessionId: string;
}

/**
 * NormalizedProfilePaths — implementation detail.
 */
export function normalizedProfilePaths(paths: ProfilePaths): ProfilePaths {
  return {
    root: path.resolve(paths.root),
    metadata: path.resolve(paths.metadata),
    lyrics: path.resolve(paths.lyrics),
    customOrder: path.resolve(paths.customOrder),
    songBook: path.resolve(paths.songBook),
    exports: path.resolve(paths.exports),
    audio: path.resolve(paths.audio),
  };
}

/**
 * CapturePersistenceScope — implementation detail.
 */
export function capturePersistenceScope(): PersistenceScopeSnapshot {
  if (bridgeState.profileScopeSwitching) {
    throw new OperatorError('Profile scope is changing. Try the command again.');
  }
  const profileManager = bridgeState.profileManager;
  const manager = bridgeState.manager;
  if (!profileManager || !manager) {
    throw new OperatorError('Profile scope is not initialized.');
  }
  return {
    profileManager,
    manager,
    activeProfileId: profileManager.getActive().id,
    paths: normalizedProfilePaths(profileManager.getActivePaths()),
    projectIdentityKey: bridgeState.projectIdentity?.key ?? null,
    projectSessionId: bridgeState.projectSessionId,
  };
}

/**
 * AssertPersistenceScopeCurrent — implementation detail.
 */
export function assertPersistenceScopeCurrent(snapshot: PersistenceScopeSnapshot): void {
  const profileManager = bridgeState.profileManager;
  if (
    bridgeState.profileScopeSwitching ||
    profileManager !== snapshot.profileManager ||
    bridgeState.manager !== snapshot.manager ||
    (bridgeState.projectIdentity?.key ?? null) !== snapshot.projectIdentityKey ||
    bridgeState.projectSessionId !== snapshot.projectSessionId
  ) {
    throw new OperatorError('Profile scope changed while the command was in progress.');
  }

  const activeProfileId = profileManager.getActive().id;
  const currentPaths = normalizedProfilePaths(profileManager.getActivePaths());
  if (
    activeProfileId !== snapshot.activeProfileId ||
    currentPaths.root !== snapshot.paths.root ||
    currentPaths.metadata !== snapshot.paths.metadata ||
    currentPaths.lyrics !== snapshot.paths.lyrics ||
    currentPaths.customOrder !== snapshot.paths.customOrder ||
    currentPaths.exports !== snapshot.paths.exports ||
    currentPaths.audio !== snapshot.paths.audio
  ) {
    throw new OperatorError('Profile scope changed while the command was in progress.');
  }
}

/**
 * Resolves the cue at time.
 */
export function resolveCueAtTime(
  time: number,
): { name: string; time: number; cueIndex: number } | null {
  const rawCues = bridgeState.manager?.getRawCues() ?? [];
  const idx = rawCues.findIndex((c) => c.time === time);
  if (idx === -1) return null;
  const cue = rawCues[idx]!;
  return { name: cue.name, time: cue.time, cueIndex: cue.cueIndex ?? idx };
}

/**
 * RequestCueRefresh — implementation detail.
 */
export function requestCueRefresh(): void {
  if (!bridgeState.oscClient) return;
  bridgeState.oscClient.getCuePoints();
}
