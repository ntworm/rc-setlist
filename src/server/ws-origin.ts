import type { IncomingMessage } from 'node:http';
import { URL as NodeURL } from 'node:url';
import type { ConnectionRole } from '../types.js';
import { isLinkLocalIpv4, isRfc1918 } from '../util/helpers.js';

export interface WsTokens {
  authToken: string;
  peerToken?: string;
  directToken?: string;
}

export type UpgradeDecision =
  'allow' | 'allow_direct' | 'allow_check_rate' | 'forbid' | 'forbid_check_rate';

export interface UpgradeClassification {
  decision: UpgradeDecision;
  role: ConnectionRole | 'none';
  isController: boolean;
  isPeer: boolean;
  isDirect: boolean;
  hasToken: boolean;
  urlInvalid: boolean;
}

/** Reports whether an Origin header matches the request Host. */
export function isValidOrigin(origin: string, reqHost: string): boolean {
  const expected = reqHost.toLowerCase();
  try {
    if (new NodeURL(origin).host.toLowerCase() === expected) return true;
  } catch {
    // fallback below
  }
  const m = origin.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
  return Boolean(m && m[1]!.toLowerCase() === expected);
}

function isLocalHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (isRfc1918(host) || isLinkLocalIpv4(host)) return true;
  return (
    host.endsWith('.local') && host.length > 6 && !host.startsWith('.') && !host.includes('..')
  );
}

/** Reports whether an Origin header names a local or LAN HTTP(S) host. */
export function isLocalOrigin(origin: string): boolean {
  if (!/^https?:\/\/[^\s/?#@\\]+(?<!:)$/i.test(origin)) return false;
  try {
    return isLocalHost(new NodeURL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase());
  } catch {
    return false;
  }
}

const NONE = { isController: false, isPeer: false, isDirect: false, role: 'none' as const };

function resolveRoleFlags(token: string | null, tokens: WsTokens) {
  const a = Boolean(tokens.authToken) && token === tokens.authToken;
  const p = Boolean(tokens.peerToken) && token === tokens.peerToken;
  const d = Boolean(tokens.directToken) && token === tokens.directToken;
  if (Number(a) + Number(p) + Number(d) !== 1) return NONE;
  const role: ConnectionRole = a ? 'browser' : p ? 'peer' : 'direct';
  return { isController: a, isPeer: p, isDirect: d, role };
}

function decideUpgrade(
  origin: string | undefined,
  reqHost: string | undefined,
  hasToken: boolean,
  role: ConnectionRole | 'none',
): UpgradeDecision {
  if (origin) {
    if (!reqHost) return 'forbid';
    if (!isValidOrigin(origin, reqHost)) {
      if (!isLocalOrigin(origin)) return 'forbid';
      return role === 'direct' ? 'allow_direct' : hasToken ? 'forbid_check_rate' : 'forbid';
    }
  }
  return role === 'direct'
    ? 'allow_direct'
    : hasToken && role === 'none'
      ? 'allow_check_rate'
      : 'allow';
}

/** Classifies an incoming WebSocket upgrade request by origin and token role. */
export function classifyUpgradeRequest(
  req: IncomingMessage,
  tokens: WsTokens,
): UpgradeClassification {
  let token: string | null = null;
  let urlInvalid = false;
  try {
    token = new NodeURL(req.url ?? '', 'http://localhost').searchParams.get('token');
  } catch {
    urlInvalid = true;
  }
  const hasToken = token !== null && token !== '';
  const flags = resolveRoleFlags(token, tokens);
  const decision = decideUpgrade(req.headers.origin, req.headers.host, hasToken, flags.role);
  if (decision === 'forbid' || decision === 'forbid_check_rate') {
    return { decision, ...NONE, hasToken, urlInvalid };
  }
  const role: ConnectionRole = flags.role === 'none' ? 'browser' : flags.role;
  return { decision, ...flags, role, hasToken, urlInvalid };
}
