/**
 * The panel session and the envelope the panel sends with every action.
 *
 * The panel is a modal: every action the operator takes closes the window,
 * and the extension opens it again with fresh state. The session carries the
 * operator's place from one opening to the next: the tab they are on, the
 * access page they picked and the address they chose.
 *
 * Nothing here talks to the network, to the disk or to the extension. The
 * module only decides whether what arrived is something the panel may say.
 * A malformed answer is discarded without a word of it reaching a log.
 */

/** The sections of the panel. */
export type PanelTab = 'main' | 'setlist' | 'network';

/** The two pages a phone can open. */
export type PanelAccess = 'stage' | 'performance';

/** What the panel asks the extension to do, and where it wants to stay. */
export interface PanelEnvelope {
  action: string;
  tab?: PanelTab;
  access?: PanelAccess;
  address?: string;
  profileId?: string;
  name?: string;
  packageFile?: string;
}

/** Where the operator is, and what they picked. */
export interface PanelSession {
  tab: PanelTab;
  access: PanelAccess;
  address: string;
  /** What the last action said, shown once when the panel opens again. */
  notice: { tone: 'ok' | 'error'; key: string; params: Record<string, string> } | null;
}

/** The longest answer the panel may send. */
const MAX_ACTION_LENGTH = 512;

/** The actions the extension understands, without an argument of their own. */
const PLAIN_ACTIONS: ReadonlySet<string> = new Set([
  'close',
  'start',
  'stop',
  'restart',
  'diagnose-osc',
  'toggle-auto-start',
  'toggle-write-tempo',
  'refresh',
  'select-address',
  'select-profile',
  'create-profile',
  'rename-profile',
  'delete-profile',
  'restore-profile',
  'export-package',
  'import-package',
  'peer-code',
  'peer-unpair',
]);

/** The actions that carry their argument in the action itself. */
const LOCALE_ACTIONS: ReadonlySet<string> = new Set(['set-language:en', 'set-language:pt-BR']);

/** The prefix of the action that pairs a second computer. */
const PAIR_PREFIX = 'peer-pair:';

/** What a profile id may look like: a uuid, or something close to one. */
const PROFILE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The longest name of a setlist the panel may send. */
const MAX_NAME_LENGTH = 80;

/** What a package file may be called. */
// eslint-disable-next-line no-control-regex -- a file name holds no control character.
const PACKAGE_FILE = /^[^\\/:*?"<>|\u0000-\u001f]{1,200}\.rcsetlist$/i;

/** An IPv4 address, written the way the network stack writes it. */
const IPV4 = /^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$/;

/**
 * Whether a value names one of the three sections of the panel.
 */
function isPanelTab(value: unknown): value is PanelTab {
  return value === 'main' || value === 'setlist' || value === 'network';
}

/**
 * Whether a value names one of the two pages a phone can open.
 */
function isPanelAccess(value: unknown): value is PanelAccess {
  return value === 'stage' || value === 'performance';
}

/**
 * Whether a string is an IPv4 address.
 */
export function isIpv4Address(value: string): boolean {
  const match = IPV4.exec(value);
  if (!match) return false;
  return match.slice(1).every((part) => Number(part) <= 255);
}

/**
 * The session a freshly opened panel starts with.
 */
export function createPanelSession(): PanelSession {
  return { tab: 'main', access: 'stage', address: '', notice: null };
}

/**
 * Whether an action is one the panel may send.
 *
 * The pairing action carries an address and a code in the action itself: it
 * is the one action the panel has always sent as a plain string, and the
 * extension still has to understand it.
 */
export function isKnownAction(action: string): boolean {
  if (PLAIN_ACTIONS.has(action)) return true;
  if (LOCALE_ACTIONS.has(action)) return true;
  if (action.startsWith(PAIR_PREFIX)) return action.length <= MAX_ACTION_LENGTH;
  return false;
}

/**
 * Reads the envelope out of what the panel sent.
 *
 * Returns null for anything that is not an envelope the extension may act
 * on. The raw answer never reaches the caller: an answer that cannot be
 * read is discarded, not reported.
 */
export function decodePanelEnvelope(raw: unknown): PanelEnvelope | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text.length === 0 || text.length > MAX_ACTION_LENGTH) return null;
  if (text.startsWith('{')) return decodeJsonEnvelope(text);
  if (!isKnownAction(text)) return null;
  return { action: text };
}

/**
 * Reads what arrived as a record, or null when it is not one.
 */
function asEnvelopeRecord(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * Carries the section of the panel into the envelope.
 */
function applyTab(envelope: PanelEnvelope, record: Record<string, unknown>): boolean {
  if (record.tab === undefined) return true;
  if (!isPanelTab(record.tab)) return false;
  envelope.tab = record.tab;
  return true;
}

/**
 * Carries the page a phone opens into the envelope.
 */
function applyAccess(envelope: PanelEnvelope, record: Record<string, unknown>): boolean {
  if (record.access === undefined) return true;
  if (!isPanelAccess(record.access)) return false;
  envelope.access = record.access;
  return true;
}

/**
 * Carries the address into the envelope.
 */
function applyAddress(envelope: PanelEnvelope, record: Record<string, unknown>): boolean {
  if (record.address === undefined) return true;
  const address = record.address;
  if (typeof address !== 'string') return false;
  if (address !== '' && !isIpv4Address(address)) return false;
  envelope.address = address;
  return true;
}

/**
 * Carries the setlist into the envelope.
 */
function applyProfileId(envelope: PanelEnvelope, record: Record<string, unknown>): boolean {
  if (record.profileId === undefined) return true;
  const profileId = record.profileId;
  if (typeof profileId !== 'string' || !PROFILE_ID.test(profileId)) return false;
  envelope.profileId = profileId;
  return true;
}

/**
 * Carries the name of a setlist into the envelope.
 */
function applyName(envelope: PanelEnvelope, record: Record<string, unknown>): boolean {
  if (record.name === undefined) return true;
  const name = record.name;
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  // eslint-disable-next-line no-control-regex -- a name of a setlist holds no control character.
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return false;
  }
  envelope.name = trimmed;
  return true;
}

/**
 * Carries the package file into the envelope.
 */
function applyPackageFile(envelope: PanelEnvelope, record: Record<string, unknown>): boolean {
  if (record.packageFile === undefined) return true;
  const file = record.packageFile;
  if (typeof file !== 'string' || !PACKAGE_FILE.test(file)) return false;
  envelope.packageFile = file;
  return true;
}

/**
 * Carries every part of the answer into the envelope.
 */
function applyEnvelopeParts(envelope: PanelEnvelope, record: Record<string, unknown>): boolean {
  if (!applyTab(envelope, record)) return false;
  if (!applyAccess(envelope, record)) return false;
  if (!applyAddress(envelope, record)) return false;
  if (!applyProfileId(envelope, record)) return false;
  if (!applyName(envelope, record)) return false;
  if (!applyPackageFile(envelope, record)) return false;
  return true;
}

/**
 * Reads an envelope written as JSON.
 */
function decodeJsonEnvelope(text: string): PanelEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const record = asEnvelopeRecord(parsed);
  if (!record) return null;
  const action = record.action;
  if (typeof action !== 'string' || !isKnownAction(action)) return null;
  const envelope: PanelEnvelope = { action };
  if (!applyEnvelopeParts(envelope, record)) return null;
  return envelope;
}

/**
 * Carries what the panel said into the session.
 */
export function applyEnvelopeToSession(session: PanelSession, envelope: PanelEnvelope): void {
  if (envelope.tab) session.tab = envelope.tab;
  if (envelope.access) session.access = envelope.access;
  if (envelope.address !== undefined) session.address = envelope.address;
}

/**
 * The address the panel announced, when it is one of the addresses the
 * machine really holds.
 *
 * A chosen address that is gone - the adapter was unplugged, the network
 * changed - is not an address any more: the panel falls back to the
 * automatic choice instead of announcing something that does not exist.
 */
export function resolveSessionAddress(
  session: PanelSession,
  candidates: readonly string[],
): string {
  if (!session.address) return '';
  return candidates.includes(session.address) ? session.address : '';
}
