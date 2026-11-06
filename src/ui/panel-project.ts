/**
 * The setlist, as the panel shows it.
 *
 * Live holds one project at a time and that project holds the setlists.
 * The panel lists them, with the deleted ones that can come back, and lets
 * the operator manage them while nothing is playing.
 *
 * Every change is a request, not a command. The extension checks the same
 * things again when it carries the request out, because a button that is
 * disabled in the page is a promise, not a lock.
 */

/** Why the setlist cannot be changed right now. */
export type ProjectLockReason = 'playing' | 'switching' | 'missing' | 'no-project';

/** One setlist of the project. */
export interface PanelProfileEntry {
  id: string;
  name: string;
}

/** One deleted setlist of the project, which can come back. */
export interface PanelDeletedProfileEntry {
  id: string;
  name: string;
  deletedAt: string;
}

/** Everything the panel shows about the project and its setlists. */
export interface PanelProjectModel {
  projectName: string;
  profiles: PanelProfileEntry[];
  deletedProfiles: PanelDeletedProfileEntry[];
  activeProfileId: string | null;
  canMutate: boolean;
  locked: boolean;
  lockReason: ProjectLockReason | null;
}

/** What the panel model read out of the extension. */
export interface ProjectPanelInput {
  projectName: string;
  profiles: PanelProfileEntry[];
  deletedProfiles?: PanelDeletedProfileEntry[];
  activeProfileId: string | null;
  canMutate: boolean;
  isPlaying: boolean;
  scopeSwitching: boolean;
  profileManagerPresent: boolean;
}

/**
 * Builds what the panel shows about the project and its setlists.
 */
export function buildProjectPanelModel(input: ProjectPanelInput): PanelProjectModel {
  const lockReason = lockReasonFor(input);
  return {
    projectName: input.projectName,
    profiles: input.profiles,
    deletedProfiles: input.deletedProfiles ?? [],
    activeProfileId: input.activeProfileId,
    canMutate: input.canMutate,
    locked: lockReason !== null,
    lockReason,
  };
}

/**
 * Why the setlist cannot be changed, or null when it can.
 *
 * A setlist that changes while the show runs moves the songs under the
 * performer's feet, so the transport locks the choice too.
 */
function lockReasonFor(input: ProjectPanelInput): ProjectLockReason | null {
  if (!input.profileManagerPresent) return 'missing';
  // The same order the extension checks a request in, so the page and the
  // answer of the extension never give two different reasons.
  if (input.scopeSwitching) return 'switching';
  if (input.isPlaying) return 'playing';
  if (!input.canMutate) return 'missing';
  if (!input.projectName) return 'no-project';
  return null;
}
