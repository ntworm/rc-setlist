/**
 * What the panel shows, put together in one place.
 *
 * The panel is a picture of the extension: the server, the transport, the
 * setlist of the project and the addresses of the machine. This module
 * reads all of it and hands it over as plain data, so the page only has to
 * paint it.
 *
 * The reading is careful: Live may hold no manager at all, and the panel
 * still has to open and say so honestly instead of failing.
 */

import type { UiLocale } from '../preferences.js';
import type { OscDiagnosticModel } from './osc-diagnostics.js';
import type { PeerPanelModel } from './peer-panel.js';
import type { PanelAccess, PanelTab } from './panel-session.js';
import {
  buildProjectPanelModel,
  type PanelDeletedProfileEntry,
  type PanelProfileEntry,
  type PanelProjectModel,
} from './panel-project.js';
import type { PanelNotice, PanelPackagesModel } from './panel-setlists.js';
import {
  readDeletedProfiles,
  readSongColors,
  readSongs,
  type PanelSongEntry,
} from './panel-songs.js';

/** The port the server of this extension serves on. */
export const PANEL_PORT = 4444;

/** The port the certificate of this computer is served on. */
export const PANEL_CA_PORT = PANEL_PORT + 1;

/** One address of the machine, as the network tab shows it. */
export interface PanelNetworkCandidate {
  id: string;
  ip: string;
  kind: string;
  interfaceName: string;
  subnet: string | null;
  gateway: string | null;
  defaultRoute: boolean;
  covered: boolean;
}

/** The addresses of the machine and the address the panel announces. */
export interface PanelNetworkModel {
  candidates: PanelNetworkCandidate[];
  primaryIp: string;
  selectedAddress: string;
  announcedIp: string;
  protocol: 'http' | 'https';
  port: number;
  caPort: number;
  caAvailable: boolean;
  certCoversSelected: boolean;
  tls: boolean;
}

/** What the transport is doing. */
export interface PanelPlaybackModel {
  isPlaying: boolean;
  songCount: number;
  durationSeconds: number | null;
  tempo: number | null;
  activeSongIndex: number;
  songs: PanelSongEntry[];
}

/** The state of the extension, read out of the bridge. */
export interface BridgeStateView {
  managerPresent: boolean;
  profileManagerPresent: boolean;
  isPlaying: boolean;
  songCount: number;
  durationSeconds: number | null;
  tempo: number | null;
  activeSongIndex: number;
  songs: PanelSongEntry[];
  durationConfidence: string;
  profiles: PanelProfileEntry[];
  deletedProfiles: PanelDeletedProfileEntry[];
  activeProfileId: string | null;
  projectName: string;
  scopeSwitching: boolean;
  canMutate: boolean;
}

/** Everything the panel shows. */
export interface PanelModel {
  running: boolean;
  port: number;
  tls: boolean;
  locale: UiLocale;
  autoStart: boolean;
  writeTempoOnJump: boolean;
  osc: OscDiagnosticModel;
  peer: PeerPanelModel;
  network: PanelNetworkModel;
  project: PanelProjectModel;
  playback: PanelPlaybackModel;
  durationConfidence: string;
  storageInitialized: boolean;
  token: string;
  tab: PanelTab;
  access: PanelAccess;
  packages: PanelPackagesModel;
  notice: PanelNotice | null;
}

/** What the model is built from. */
export interface PanelModelDeps {
  state?: unknown;
  profilePayload?: () => unknown;
  osc?: OscDiagnosticModel;
  peer?: PeerPanelModel;
  network?: PanelNetworkModel;
  running?: boolean;
  port?: number;
  tls?: boolean;
  locale?: UiLocale;
  autoStart?: boolean;
  writeTempoOnJump?: boolean;
  durationConfidence?: string;
  storageInitialized?: boolean;
  token?: string;
  tab?: PanelTab;
  access?: PanelAccess;
  packages?: PanelPackagesModel;
  notice?: PanelNotice | null;
}

/** The state of a server that is not running. */
const STOPPED_OSC: OscDiagnosticModel = {
  state: 'stopped',
  listenPort: null,
  rxCount: 0,
  txCount: 0,
  lastReplyAgeMs: null,
  bridge: null,
  bridgeVersion: null,
  targetPort: null,
};

/** The second computer, when there is none. */
const NO_PEER: PeerPanelModel = {
  state: 'not_paired',
  statusText: '',
  paired: false,
  host: '',
  port: PANEL_PORT,
  localIp: '127.0.0.1',
  serverRunning: false,
  tlsEnabled: false,
  codeActive: false,
  code: null,
  canGenerateCode: false,
  codeHint: '',
};

/** The addresses of the machine, when there are none. */
const NO_NETWORK: PanelNetworkModel = {
  candidates: [],
  primaryIp: '',
  selectedAddress: '',
  announcedIp: '',
  protocol: 'http',
  port: PANEL_PORT,
  caPort: PANEL_CA_PORT,
  caAvailable: false,
  certCoversSelected: false,
  tls: false,
};

/**
 * Reads a value as a plain record, or null when it is not one.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Reads a string, or null when the value is not one.
 */
function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Reads a list of setlists out of an unknown value.
 */
function readProfiles(value: unknown): PanelProfileEntry[] {
  if (!Array.isArray(value)) return [];
  const profiles: PanelProfileEntry[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const id = readString(record.id);
    const name = readString(record.name);
    if (!id || !name) continue;
    profiles.push({ id, name });
  }
  return profiles;
}

/**
 * Asks the manager what it is doing, without letting it stop the panel.
 */
function readManagerState(manager: Record<string, unknown>): Record<string, unknown> | null {
  const getState = manager.getState;
  if (typeof getState !== 'function') return null;
  try {
    return asRecord((getState as () => unknown).call(manager));
  } catch {
    return null;
  }
}

/**
 * Reads the list of setlists out of the profile manager.
 */
function readProfileList(profileManager: Record<string, unknown>): unknown {
  const list = profileManager.list;
  if (typeof list !== 'function') return null;
  try {
    return (list as () => unknown).call(profileManager);
  } catch {
    return null;
  }
}

/**
 * Reads the payload of the profile state, without letting it stop the panel.
 */
function readProfilePayload(profilePayload?: () => unknown): Record<string, unknown> | null {
  if (!profilePayload) return null;
  try {
    return asRecord(profilePayload());
  } catch {
    return null;
  }
}

/**
 * The playback of the transport, read out of the live state of the manager.
 */
function readLivePlayback(
  live: Record<string, unknown>,
  colors: Record<string, string>,
): Pick<
  BridgeStateView,
  | 'isPlaying'
  | 'songCount'
  | 'durationSeconds'
  | 'tempo'
  | 'activeSongIndex'
  | 'durationConfidence'
  | 'songs'
> {
  const songs = live.songs;
  const index = live.activeSongIndex;
  const duration = live.totalDurationSeconds;
  const confidence = live.durationConfidence;
  return {
    isPlaying: live.isPlaying === true,
    songCount: Array.isArray(songs) ? songs.length : 0,
    durationSeconds: typeof duration === 'number' ? duration : null,
    tempo: typeof live.tempo === 'number' ? live.tempo : null,
    activeSongIndex: typeof index === 'number' ? index : -1,
    durationConfidence: typeof confidence === 'string' ? confidence : 'estimated',
    songs: readSongs(songs, colors),
  };
}

/**
 * The setlists and the project, read out of the payload of the profile state.
 */
function readProfileState(payload: Record<string, unknown>): {
  profiles: PanelProfileEntry[];
  deletedProfiles: PanelDeletedProfileEntry[];
  activeProfileId: string | null;
  canMutate: boolean;
  projectName: string;
} {
  const active = payload.activeProfileId;
  const projectName = payload.projectName;
  return {
    profiles: readProfiles(payload.profiles),
    deletedProfiles: readDeletedProfiles(payload.deletedProfiles),
    activeProfileId: typeof active === 'string' && active ? active : null,
    canMutate: payload.canMutate !== false,
    projectName: typeof projectName === 'string' && projectName ? projectName : '',
  };
}

/**
 * The name of the project, when the payload does not carry one.
 */
function readProjectName(record: Record<string, unknown>): string {
  const identity = asRecord(record.projectIdentity);
  const displayName = identity ? readString(identity.displayName) : null;
  return displayName ?? '';
}

/**
 * Reads everything the panel needs out of the state of the extension.
 *
 * A machine that holds no manager at all is not an error: the panel opens
 * and says that there is nothing to show yet.
 */
export function readBridgeState(state: unknown, profilePayload?: () => unknown): BridgeStateView {
  const view: BridgeStateView = {
    managerPresent: false,
    profileManagerPresent: false,
    isPlaying: false,
    songCount: 0,
    durationSeconds: null,
    tempo: null,
    activeSongIndex: -1,
    songs: [],
    durationConfidence: 'estimated',
    profiles: [],
    deletedProfiles: [],
    activeProfileId: null,
    projectName: '',
    scopeSwitching: false,
    canMutate: true,
  };
  const record = asRecord(state);
  if (!record) return view;
  view.scopeSwitching = record.profileScopeSwitching === true;
  const manager = asRecord(record.manager);
  view.managerPresent = manager !== null;
  if (manager) {
    const live = readManagerState(manager);
    if (live) {
      const playback = readLivePlayback(live, readSongColors(record.songBook));
      view.isPlaying = playback.isPlaying;
      view.songCount = playback.songCount;
      view.durationSeconds = playback.durationSeconds;
      view.tempo = playback.tempo;
      view.activeSongIndex = playback.activeSongIndex;
      view.durationConfidence = playback.durationConfidence;
      view.songs = playback.songs;
    }
  }
  const profileManager = asRecord(record.profileManager);
  view.profileManagerPresent = profileManager !== null;
  const payload = readProfilePayload(profilePayload);
  if (payload) {
    const profileState = readProfileState(payload);
    view.profiles = profileState.profiles;
    view.deletedProfiles = profileState.deletedProfiles;
    view.activeProfileId = profileState.activeProfileId;
    view.canMutate = profileState.canMutate;
    view.projectName = profileState.projectName;
  }
  if (!view.profiles.length && profileManager) {
    view.profiles = readProfiles(readProfileList(profileManager));
  }
  if (!view.projectName) {
    view.projectName = readProjectName(record);
  }
  return view;
}

/**
 * Writes a value as the text a page can read.
 *
 * The name of a project is written by the operator: it may hold anything,
 * and the page must not be able to break out of the text it is written in.
 */
export function panelJson(value: unknown): string {
  const text = JSON.stringify(value);
  return (text === undefined ? 'null' : text).replace(/</g, '\\u003c');
}

/**
 * Builds the addresses of the machine as the network tab shows them.
 */
export function buildNetworkPanelModel(input: {
  candidates: PanelNetworkCandidate[];
  primaryIp: string;
  selectedAddress: string;
  protocol: 'http' | 'https';
  port: number;
  caPort: number;
  caAvailable: boolean;
  tls: boolean;
}): PanelNetworkModel {
  // The certificate is judged on the address the phones are given, which is
  // the automatic one when the operator picked none.
  const announcedIp = input.selectedAddress || input.primaryIp;
  const selected = input.candidates.find((candidate) => candidate.ip === announcedIp);
  return {
    candidates: input.candidates,
    primaryIp: input.primaryIp,
    selectedAddress: input.selectedAddress,
    announcedIp,
    protocol: input.protocol,
    port: input.port,
    caPort: input.caPort,
    caAvailable: input.caAvailable,
    certCoversSelected: selected ? selected.covered : false,
    tls: input.tls,
  };
}

/**
 * The server and the page, as the extension hands them over.
 */
function readServerModel(
  deps: PanelModelDeps,
): Pick<PanelModel, 'running' | 'port' | 'tls' | 'locale' | 'autoStart' | 'writeTempoOnJump'> {
  return {
    running: deps.running ?? false,
    port: deps.port ?? PANEL_PORT,
    tls: deps.tls ?? false,
    locale: deps.locale ?? 'en',
    autoStart: deps.autoStart ?? false,
    writeTempoOnJump: deps.writeTempoOnJump ?? false,
  };
}

/**
 * The parts of the model the extension already knows.
 */
function readKnownModel(
  deps: PanelModelDeps,
  view: BridgeStateView,
): Pick<
  PanelModel,
  | 'osc'
  | 'peer'
  | 'network'
  | 'durationConfidence'
  | 'storageInitialized'
  | 'token'
  | 'tab'
  | 'access'
> {
  return {
    osc: deps.osc ?? STOPPED_OSC,
    peer: deps.peer ?? NO_PEER,
    network: deps.network ?? NO_NETWORK,
    durationConfidence: deps.durationConfidence ?? view.durationConfidence,
    storageInitialized: deps.storageInitialized ?? false,
    token: deps.token ?? '',
    tab: deps.tab ?? 'main',
    access: deps.access ?? 'stage',
  };
}

/**
 * Builds everything the panel shows.
 */
export function buildPanelModel(deps: PanelModelDeps = {}): PanelModel {
  const view = readBridgeState(deps.state, deps.profilePayload);
  const project = buildProjectPanelModel({
    projectName: view.projectName,
    profiles: view.profiles,
    deletedProfiles: view.deletedProfiles,
    activeProfileId: view.activeProfileId,
    canMutate: view.canMutate,
    isPlaying: view.isPlaying,
    scopeSwitching: view.scopeSwitching,
    profileManagerPresent: view.profileManagerPresent,
  });
  const playback: PanelPlaybackModel = {
    isPlaying: view.isPlaying,
    songCount: view.songCount,
    durationSeconds: view.durationSeconds,
    tempo: view.tempo,
    activeSongIndex: view.activeSongIndex,
    songs: view.songs,
  };
  const server = readServerModel(deps);
  const known = readKnownModel(deps, view);
  return {
    ...server,
    osc: known.osc,
    peer: known.peer,
    network: known.network,
    project,
    playback,
    durationConfidence: known.durationConfidence,
    storageInitialized: known.storageInitialized,
    token: known.token,
    tab: known.tab,
    access: known.access,
    packages: deps.packages ?? { dir: '', files: [] },
    notice: deps.notice ?? null,
  };
}
