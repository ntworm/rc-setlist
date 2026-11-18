import * as fs from 'node:fs';
import * as path from 'node:path';
import { getExtensionContext } from './context.js';
import { atomicWriteFileSync } from './util/atomic-write.js';

const SETLIST_DIR = '.setlist';
const AUTO_START_FILE = 'auto-start';
const UI_LOCALE_FILE = 'ui-locale';
const WRITE_TEMPO_ON_JUMP_FILE = 'write-tempo-on-jump';
const PEER_CONFIG_FILE = 'peer.json';

/**
 * One computer this one is paired with.
 *
 * The fingerprint pins the certificate that was presented when the pairing
 * happened: the link refuses to talk to a computer whose certificate changed
 * since then.
 *
 * The key pin is the newer of the two. It pins the key the certificate
 * carries, so a certificate that was issued again for a new address — which
 * keeps the key — does not break the link. A pairing from before it holds
 * the fingerprint alone.
 */
export interface PeerConfig {
  host: string;
  port: number;
  peerToken: string;
  fingerprint: string;
  keyPin?: string;
}

function preferencePath(fileName: string): string | null {
  // 1. Try SDK storageDirectory first if context is available
  const context = getExtensionContext();
  if (context && context.environment.storageDirectory) {
    return path.join(context.environment.storageDirectory, fileName);
  }

  // 2. Fallback candidates (fixing the double-append bug by direct lookup)
  const candidates = [
    process.cwd(),
    process.env.HOME || null,
    process.env.USERPROFILE || null,
  ].filter((p): p is string => typeof p === 'string');

  for (const dir of candidates) {
    try {
      const probe = path.join(dir, SETLIST_DIR);
      if (fs.existsSync(probe)) {
        return path.join(probe, fileName);
      }
    } catch {
      // ignore — try next candidate
    }
  }
  return null;
}

function readPreference(fileName: string): string | null {
  const preferenceFile = preferencePath(fileName);
  if (!preferenceFile) return null;
  try {
    return fs.readFileSync(preferenceFile, 'utf8').trim();
  } catch {
    return null;
  }
}

// The peer config holds the pairing token, so only its owner may read it.
const SECRET_FILE_MODE = 0o600;

function writePreference(fileName: string, value: string): boolean {
  const options = fileName === PEER_CONFIG_FILE ? { mode: SECRET_FILE_MODE } : {};
  // 1. Try SDK storageDirectory first if context is available
  const context = getExtensionContext();
  if (context && context.environment.storageDirectory) {
    const dir = context.environment.storageDirectory;
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      atomicWriteFileSync(path.join(dir, fileName), value, options);
      return true;
    } catch (err) {
      console.error(
        `[rc-setlist] preference write failed at ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  // 2. Fallback candidates (fixing the double-append bug)
  const candidates = [
    process.cwd(),
    process.env.HOME || null,
    process.env.USERPROFILE || null,
  ].filter((p): p is string => typeof p === 'string');

  for (const dir of candidates) {
    const setlistDir = path.join(dir, SETLIST_DIR);
    try {
      if (!fs.existsSync(setlistDir)) continue;
      atomicWriteFileSync(path.join(setlistDir, fileName), value, options);
      return true;
    } catch (err) {
      console.error(
        `[rc-setlist] preference write failed at ${setlistDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
  console.error(`[rc-setlist] ${fileName}: no writable .setlist/ directory found`);
  return false;
}

/**
 * Returns the auto start.
 */
export function getAutoStart(): boolean {
  const raw = readPreference(AUTO_START_FILE)?.toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes';
}

/**
 * Sets the auto start.
 */
export function setAutoStart(on: boolean): boolean {
  return writePreference(AUTO_START_FILE, on ? 'true' : 'false');
}

export type UiLocale = 'en' | 'pt-BR';

/**
 * Whether an explicit jump may write the destination tempo into Live.
 *
 * Defaults to FALSE, and the default is the whole point. Writing `song.tempo`
 * overrides Live's tempo automation: the arrangement stops following its own
 * envelope until the user presses Re-Enable Automation. For anyone whose show
 * lives on tempo automation drawn inside Live, a single jump mid-set would
 * silently flatten the rest of the night.
 *
 * A `[bpm N]` tag means "measure the duration with this". It does not mean
 * "impose this on Live". Turn this on only if the setlist tags ARE the source
 * of truth for tempo and the arrangement has no tempo automation.
 */
export function getWriteTempoOnJump(): boolean {
  return readPreference(WRITE_TEMPO_ON_JUMP_FILE)?.toLowerCase() === 'true';
}

/**
 * Sets the write tempo on jump.
 */
export function setWriteTempoOnJump(on: boolean): boolean {
  return writePreference(WRITE_TEMPO_ON_JUMP_FILE, on ? 'true' : 'false');
}

/**
 * Returns the ui locale.
 */
export function getUiLocale(): UiLocale {
  return readPreference(UI_LOCALE_FILE) === 'pt-BR' ? 'pt-BR' : 'en';
}

/**
 * Sets the ui locale.
 */
export function setUiLocale(locale: string): boolean {
  if (locale !== 'en' && locale !== 'pt-BR') return false;
  return writePreference(UI_LOCALE_FILE, locale);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidPort(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535;
}

function isPeerConfig(value: unknown): value is PeerConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.host)) return false;
  if (!isNonEmptyString(record.peerToken)) return false;
  if (!isNonEmptyString(record.fingerprint)) return false;
  // The key pin is optional: a pairing from before it was written holds the
  // fingerprint alone, and that pairing still has to load.
  if (record.keyPin !== undefined && !isNonEmptyString(record.keyPin)) return false;
  return isValidPort(record.port);
}

// A pairing written before the file was created owner-only may still be
// readable by others; tighten it on read. Best effort: a filesystem without
// POSIX modes must not lose the pairing.
function restrictPeerConfigMode(): void {
  const peerFile = preferencePath(PEER_CONFIG_FILE);
  if (!peerFile) return;
  try {
    fs.chmodSync(peerFile, SECRET_FILE_MODE);
  } catch {
    // ignore: the pairing still loads
  }
}

/**
 * The key that tells one paired computer from another.
 *
 * The host is compared without its case, because the same address can be
 * typed in different cases.
 */
export function peerKey(config: { host: string; port: number }): string {
  return `${config.host.toLowerCase()}:${config.port}`;
}

/**
 * Keeps the entries of a list that look like a pairing.
 */
function peerConfigList(value: unknown): PeerConfig[] {
  if (!Array.isArray(value)) return [];
  const entries: unknown[] = value;
  return entries.filter((entry): entry is PeerConfig => isPeerConfig(entry));
}

/**
 * Tells whether the file holds the list of pairings.
 */
function isPeerConfigFile(value: unknown): value is { peers: unknown } {
  return value !== null && typeof value === 'object' && 'peers' in value;
}

/**
 * Reads every paired computer.
 *
 * The file holds a list, but a pairing written before the list existed is a
 * single object and still loads as a list of one. An entry that does not
 * look like a pairing is skipped, so one broken computer cannot hide the
 * others.
 */
export function readPeerConfigs(): PeerConfig[] {
  const raw = readPreference(PEER_CONFIG_FILE);
  if (!raw) return [];
  restrictPeerConfigMode();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPeerConfigFile(parsed)) return peerConfigList(parsed.peers);
    if (Array.isArray(parsed)) return peerConfigList(parsed);
    return isPeerConfig(parsed) ? [parsed] : [];
  } catch {
    return [];
  }
}

/**
 * Reads the paired computer, or null when there is none.
 */
export function readPeerConfig(): PeerConfig | null {
  return readPeerConfigs()[0] ?? null;
}

/**
 * Stores the list of paired computers.
 *
 * An empty list leaves no file behind, the same way forgetting every
 * pairing does.
 */
export function writePeerConfigs(configs: PeerConfig[]): boolean {
  if (configs.length === 0) return clearPeerConfig();
  return writePreference(PEER_CONFIG_FILE, JSON.stringify({ peers: configs }));
}

/**
 * Stores a paired computer.
 *
 * A computer already paired at the same address is paired again instead of
 * being stored twice, and the other computers stay.
 */
export function writePeerConfig(config: PeerConfig): boolean {
  const key = peerKey(config);
  const configs = readPeerConfigs();
  const index = configs.findIndex((stored) => peerKey(stored) === key);
  if (index === -1) return writePeerConfigs([...configs, config]);
  const next = [...configs];
  next[index] = config;
  return writePeerConfigs(next);
}

/**
 * Forgets one paired computer.
 *
 * Reports whether nothing of that computer is left on disk: a file that
 * could not be written is a pairing the next start of the server would
 * bring back.
 */
export function removePeerConfig(host: string, port: number): boolean {
  const key = peerKey({ host, port });
  const configs = readPeerConfigs();
  const remaining = configs.filter((stored) => peerKey(stored) !== key);
  if (remaining.length === configs.length) {
    // The computer was not paired, so nothing of it is on disk.
    return true;
  }
  return writePeerConfigs(remaining);
}

/**
 * Forgets every pairing.
 *
 * Reports whether no pairing is left on disk: with no place to store one
 * there is nothing to forget, and a file that could not be removed is a
 * pairing the next start of the server would bring back.
 */
export function clearPeerConfig(): boolean {
  const preferenceFile = preferencePath(PEER_CONFIG_FILE);
  if (!preferenceFile) return true;
  try {
    fs.rmSync(preferenceFile, { force: true });
    return true;
  } catch {
    return false;
  }
}
