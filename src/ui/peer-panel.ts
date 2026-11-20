// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The second computer, as the Live panel sees it.
//
// Two computers can run the show. The main one holds Live and the panel; the
// second one follows it, transport and all. The two are paired by hand: the
// second one prints a six-digit code and the operator types it, together with
// the second computer's address, into the panel of the main one. The main one
// may hold several second computers at once, and each of them is forgotten on
// its own. A code read over a table of gear is the only credential an
// operator can carry from one machine to the other.
//
// Nothing here opens a socket on its own. With no pair configured the panel
// says so, the stage page shows no dot, and the extension talks to nobody.

import {
  clearPeerConfig,
  getUiLocale,
  readPeerConfigs,
  removePeerConfig,
  type UiLocale,
} from '../preferences.js';
import { getServer, isServerRunning, isServerTls } from '../index.js';
import {
  currentPairingCode,
  DEFAULT_PEER_PORT,
  generatePairingCode,
  pair,
} from '../runtime/pairing.js';
import { startPeerLink, startPeerLinks } from '../runtime/peer-link.js';
import { listDiscoveredPeerEntries, type DiscoveredPeer } from '../runtime/peer-discovery.js';
import { bridgeState, readPeerRole, type PeerRole } from '../runtime/bridge-state.js';
import { getLanAddresses, pickLanIps } from '../util/helpers.js';
import { roleText } from './peer-role-text.js';
import type { PeerLinkStatus, PeerStatus } from '../types.js';

/** The prefix every peer action carries. */
const PAIR_PREFIX = 'peer-pair:';

/** The prefix of the action that unpairs one computer of the list. */
const UNPAIR_PREFIX = 'peer-unpair:';

/** The states the panel can show for the second computer. */
export type PeerPanelState =
  'not_paired' | 'connected' | 'markers_differ' | 'offline' | 'certificate_changed';

/** What the panel asks the extension to do about the second computer. */
export type PeerAction =
  | { kind: 'pair'; host: string; code: string }
  | { kind: 'unpair' }
  | { kind: 'unpair-one'; host: string; port: number }
  | { kind: 'code' };

/** One paired computer, as the panel shows it. */
export type PeerPanelPeer = PeerLinkStatus & { statusText: string };

/** The outcome of a peer action. */
export interface PeerActionResult {
  /** Whether the action did what it was asked to do. */
  ok: boolean;
  /** A sentence for the operator, already written in their language. */
  message?: string;
}

/** Everything the panel shows about the second computer. */
export interface PeerPanelModel {
  /** The state of the link to the second computer. */
  state: PeerPanelState;
  /** The sentence the panel shows under the row title. */
  statusText: string;
  /** Whether a second computer is paired at all. */
  paired: boolean;
  /** The address of the paired computer. */
  host: string;
  /** The port this computer serves on. */
  port: number;
  /** The address other computers can reach this one at. */
  localIp: string;
  /** Whether the server is running. */
  serverRunning: boolean;
  /** Whether the running server came up over TLS. */
  tlsEnabled: boolean;
  /** Whether a pairing code is alive right now. */
  codeActive: boolean;
  /** The live pairing code, when there is one. */
  code: string | null;
  /** Whether the operator may ask for a new pairing code. */
  canGenerateCode: boolean;
  /** Why the pairing code may or may not be asked for. */
  codeHint: string;
  /** The computers this one is paired with, one row each. */
  peers?: PeerPanelPeer[];
  /** The computers that answered on the network and are not paired yet. */
  discovered?: DiscoveredPeer[];
  /** The role this computer plays in the pair, and the sentence for it. */
  role?: PeerRole;
  roleText?: string;
  /** The address of the main computer, when this computer is the second one. */
  masterAddress?: string;
  /** Whether the main computer is talking to this one right now. */
  slaveConnected?: boolean;
}

/** The sentence each state shows, in the two languages the panel speaks. */
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
    'pt-BR': 'Conectado, mas os marcadores são diferentes',
  },
  offline: {
    en: 'The second computer is not answering',
    'pt-BR': 'O segundo computador não responde',
  },
  certificate_changed: {
    en: 'The certificate changed — pair again',
    'pt-BR': 'O certificado mudou — pareie de novo',
  },
};

/** Why a pairing was refused, in the two languages the panel speaks. */
const FAILURE_TEXT: Record<string, Record<UiLocale, string>> = {
  self: {
    en: 'that address is this computer: type the IP of the second computer',
    'pt-BR': 'esse endereço é deste computador: digite o IP do segundo computador',
  },
  no_code: {
    en: 'that computer has no active code: press Generate code ON THE SECOND computer and type that code here',
    'pt-BR':
      'aquele computador não tem código ativo: toque Gerar código NO SEGUNDO computador e digite esse código aqui',
  },
  refused: {
    en: 'the computer refused the pairing code',
    'pt-BR': 'o computador recusou o código de pareamento',
  },
  timeout: {
    en: 'the request timed out',
    'pt-BR': 'a requisição expirou',
  },
  not_json: {
    en: 'the answer was not a pairing answer',
    'pt-BR': 'a resposta não foi uma resposta de pareamento',
  },
  no_token: {
    en: 'the answer carried no credential',
    'pt-BR': 'a resposta não trouxe a credencial',
  },
  no_certificate: {
    en: 'the computer presented no certificate',
    'pt-BR': 'o computador não apresentou certificado',
  },
  not_stored: {
    en: 'the pairing could not be stored',
    'pt-BR': 'o pareamento não pôde ser salvo',
  },
};

/** How a failure reported by the pairing exchange is recognised. */
const FAILURE_HINTS: ReadonlyArray<readonly [string, string]> = [
  ['is this computer', 'self'],
  ['no active code', 'no_code'],
  ['refused', 'refused'],
  ['timed out', 'timeout'],
  ['not JSON', 'not_json'],
  ['no peer token', 'no_token'],
  ['no certificate', 'no_certificate'],
  ['could not be stored', 'not_stored'],
];

/**
 * The state the link to the second computer is in.
 *
 * A certificate that changed outranks everything else: the link stopped on
 * purpose, so "not answering" would be a lie about why.
 */
export function peerPanelState(status: PeerStatus): PeerPanelState {
  if (!status.paired) return 'not_paired';
  if (status.fingerprintMismatch) return 'certificate_changed';
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
 * Whether an address may be paired with.
 *
 * Only a plain IPv4 address or a plain host name: letters, digits, dots and
 * hyphens, with no port, no path and no shell punctuation. The address is
 * about to be handed to the network stack, and a name is all it needs to be.
 */
export function isValidPeerHost(host: string): boolean {
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return false;
  if (host.length === 0 || host.length > 253) return false;
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return false;
  if (!hasValidLabels(host)) return false;
  // An address made only of digits and dots claims to be an IPv4 address, so
  // it has to be one: 192.168.1.256 is not a name, it is a wrong address.
  if (/^[0-9.]+$/.test(host)) return isIpv4(host);
  return true;
}

/**
 * Whether every label of a host name is a label a name may have.
 */
function hasValidLabels(host: string): boolean {
  for (const label of host.split('.')) {
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)) return false;
  }
  return true;
}

/**
 * Whether a string is an IPv4 address.
 */
function isIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
}

/**
 * Strips parameters from a panel action for safe logging and dialogs.
 */
export function sanitizePanelAction(action: string): string {
  if (action.startsWith(PAIR_PREFIX)) return 'peer-pair';
  if (action.startsWith(UNPAIR_PREFIX)) return 'peer-unpair';
  return action;
}

/**
 * Reads a peer action out of the string the panel sends.
 *
 * Returns null for anything that is not one of the actions: an unknown
 * action, an address that is not a plain address, a code that is not six
 * digits, and a port that is not a port.
 */
export function parsePeerAction(action: string): PeerAction | null {
  if (action === 'peer-unpair') return { kind: 'unpair' };
  if (action === 'peer-code') return { kind: 'code' };
  if (action.startsWith(UNPAIR_PREFIX)) {
    const read = readUnpairInput(action.slice(UNPAIR_PREFIX.length));
    if (!read) return null;
    return { kind: 'unpair-one', host: read.host, port: read.port };
  }
  if (!action.startsWith(PAIR_PREFIX)) return null;
  const read = readPairInput(action.slice(PAIR_PREFIX.length));
  if (!read) return null;
  const { host, code } = read;
  if (!isValidPeerHost(host)) return null;
  if (!/^[0-9]{6}$/.test(code)) return null;
  return { kind: 'pair', host, code };
}

/**
 * The address and the code as the operator meant them.
 *
 * The card shows the address of the second computer with its port, and people
 * type what they read: a link with its scheme, the port, spaces in the code or digits
 * from another keyboard layout. All of these name the same computer and code.
 */
export function readPairInput(rest: string): { host: string; code: string } | null {
  const separator = rest.lastIndexOf(':');
  if (separator <= 0) return null;
  const code = rest
    .slice(separator + 1)
    .normalize('NFKC')
    .replace(/[\s.-]/g, '');
  let host = rest
    .slice(0, separator)
    .normalize('NFKC')
    .replace(/^ +| +$/g, '')
    .toLowerCase();
  host = host
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .replace(/:[0-9]{1,5}$/, '');
  return { host, code };
}

/** The address and the port of the computer to unpair. */
function readUnpairInput(rest: string): { host: string; port: number } | null {
  const separator = rest.lastIndexOf(':');
  if (separator <= 0) return null;
  const host = rest.slice(0, separator).trim().toLowerCase();
  const portText = rest.slice(separator + 1).trim();
  if (!/^[0-9]{1,5}$/.test(portText)) return null;
  const port = Number(portText);
  if (port < 1 || port > 65535 || !isValidPeerHost(host)) return null;
  return { host, port };
}

/**
 * The sentence shown when a pairing was refused.
 */
function pairFailureText(host: string, detail: string, locale: UiLocale): string {
  const hint = FAILURE_HINTS.find(([needle]) => detail.includes(needle));
  const entry = hint ? FAILURE_TEXT[hint[1]] : undefined;
  const reason = entry ? entry[locale] : detail;
  const templates: Record<UiLocale, string> = {
    en: `Could not pair with ${host}: ${reason}.`,
    'pt-BR': `Não foi possível parear com ${host}: ${reason}.`,
  };
  return templates[locale];
}

/**
 * The sentence shown when the address or the code was not accepted.
 */
function invalidInputText(action: string, locale: UiLocale): string {
  const read = readPairInput(action.slice(PAIR_PREFIX.length));
  const host = read ? read.host.slice(0, 64) : '';
  const digits = read ? read.code.replace(/[^0-9]/g, '').length : 0;
  const others = read ? read.code.length - digits : 0;
  const templates: Record<UiLocale, string> = {
    en: `That address or code was not accepted. The address is a plain IP or host name, and the code is six digits. Read: address "${host}", code with ${digits} digits${others ? ` and ${others} other characters` : ''}.`,
    'pt-BR': `Esse endereço ou código não foi aceito. O endereço é um IP ou nome de host simples, e o código tem seis dígitos. Lido: endereço "${host}", código com ${digits} dígitos${others ? ` e ${others} outros caracteres` : ''}.`,
  };
  return templates[locale];
}

/**
 * The sentence shown when the stored pairing could not be removed.
 */
function unpairFailureText(locale: UiLocale): string {
  const templates: Record<UiLocale, string> = {
    en: 'Could not undo the pairing: the stored pairing could not be removed, so the second computer is still paired.',
    'pt-BR':
      'Não foi possível desfazer o pareamento: o pareamento salvo não pôde ser apagado, então o segundo computador continua pareado.',
  };
  return templates[locale];
}

/**
 * Pairs with the second computer and opens the link to it.
 */
async function pairAndLink(
  host: string,
  code: string,
  port: number,
  locale: UiLocale,
): Promise<PeerActionResult> {
  const result = await pair(host, code, port);
  if (!result.ok || !result.config) {
    return { ok: false, message: pairFailureText(host, result.error ?? '', locale) };
  }
  // Every computer this one is paired with gets a link, not only the new one.
  startPeerLinks(readPeerConfigs());
  return { ok: true };
}

/**
 * Runs a peer action.
 *
 * Pairing stores the credential the second computer handed out and opens the
 * link to it; unpairing forgets the credential and closes the link; unpairing
 * one computer forgets that one alone and leaves the others paired; asking
 * for a code prints the one the main computer will be given.
 *
 * The panel always pairs on the default port. The port is a parameter so a
 * test can pair with a server on a port of its own instead of 4444, which a
 * running Live holds.
 */
export async function runPeerAction(
  action: string,
  locale: UiLocale = getUiLocale(),
  port: number = DEFAULT_PEER_PORT,
): Promise<PeerActionResult> {
  const parsed = parsePeerAction(action);
  if (!parsed) {
    return action.startsWith(PAIR_PREFIX)
      ? { ok: false, message: invalidInputText(action, locale) }
      : { ok: false };
  }
  if (parsed.kind === 'code') {
    generatePairingCode();
    return { ok: true };
  }
  if (parsed.kind === 'unpair') {
    // A pairing still on disk comes back on the next start of the server, so
    // the link stays as it is and the operator is told rather than shown a
    // "not paired" that would not last.
    if (!clearPeerConfig()) return { ok: false, message: unpairFailureText(locale) };
    startPeerLink(null);
    return { ok: true };
  }
  if (parsed.kind === 'unpair-one') {
    // Only the computer that was named is forgotten: the others stay paired.
    if (!removePeerConfig(parsed.host, parsed.port)) {
      return { ok: false, message: unpairFailureText(locale) };
    }
    startPeerLinks(readPeerConfigs());
    return { ok: true };
  }
  return pairAndLink(parsed.host, parsed.code, port, locale);
}

/**
 * Why the pairing code may not be asked for.
 *
 * An empty sentence when there is nothing to complain about: the row is one
 * line tall, and a reason nobody needs is noise.
 */
function codeHint(serverRunning: boolean, tlsEnabled: boolean, locale: UiLocale): string {
  if (!serverRunning) {
    const templates: Record<UiLocale, string> = {
      en: 'Start the server to hand out a pairing code.',
      'pt-BR': 'Inicie o servidor para gerar um código de pareamento.',
    };
    return templates[locale];
  }
  if (!tlsEnabled) {
    const templates: Record<UiLocale, string> = {
      en: 'The server has to run over HTTPS to hand out a pairing code.',
      'pt-BR': 'O servidor precisa rodar em HTTPS para gerar um código de pareamento.',
    };
    return templates[locale];
  }
  return '';
}

/**
 * The port this computer serves on: the one the server listens on while it
 * runs, and the default one otherwise.
 */
function servingPort(): number {
  const address = getServer()?.address();
  return address && typeof address === 'object' ? address.port : DEFAULT_PEER_PORT;
}

/** The options the panel model is built with. */
export interface PeerPanelOptions {
  /** The language the sentences are written in. */
  locale?: UiLocale;
  /** The address other computers reach this one at. */
  localIp?: string;
}

/**
 * Builds everything the panel shows about the second computer.
 */
export function peerPanelModel(options: PeerPanelOptions = {}): PeerPanelModel {
  const locale = options.locale ?? getUiLocale();
  const state = peerPanelState(bridgeState.peerStatus);
  const configs = readPeerConfigs();
  const serverRunning = isServerRunning();
  const tlsEnabled = isServerTls();
  const code = currentPairingCode();
  const { role, masterAddress } = readPeerRole();
  // A computer that is paired already is not to be paired again.
  // Any address the computer listed counts: it may have been paired at
  // another one than the address that answers now.
  const discovered = listDiscoveredPeerEntries()
    .filter((peer) => !configs.some((config) => peer.addresses.includes(config.host)))
    .map(({ host, name, port }) => ({ host, name, port }));
  const peers = bridgeState.peerStatuses.map((row) => ({
    ...row,
    statusText: peerStateText(peerPanelState({ paired: true, ...row }), locale),
  }));
  return {
    state,
    statusText: peerStateText(state, locale),
    paired: bridgeState.peerStatus.paired,
    host: configs[0]?.host ?? '',
    port: servingPort(),
    localIp: options.localIp ?? pickLanIps(getLanAddresses()).primary,
    serverRunning,
    tlsEnabled,
    codeActive: code !== null,
    code,
    canGenerateCode: serverRunning && tlsEnabled,
    codeHint: codeHint(serverRunning, tlsEnabled, locale),
    peers,
    discovered,
    role,
    roleText: roleText(role, locale, peers),
    masterAddress,
    slaveConnected: role === 'slave' && (bridgeState.wsServer?.peerConnectionCount() ?? 0) > 0,
  };
}
