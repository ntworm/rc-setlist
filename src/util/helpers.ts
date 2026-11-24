import { networkInterfaces } from 'node:os';

/**
 * Returns the lan addresses.
 */
export function getLanAddresses(): string[] {
  const interfaces = networkInterfaces();
  const out: string[] = [];
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        out.push(addr.address);
      }
    }
  }
  return out;
}

/**
 * Reports whether the rfc1918 matches the contract.
 */
export function isRfc1918(ip: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * PickLanIps — implementation detail.
 */
export function pickLanIps(ips: string[]): { primary: string; others: string[] } {
  const rfc = ips.filter(isRfc1918);
  if (rfc.length === 0) {
    return { primary: ips[0] ?? '127.0.0.1', others: [] };
  }
  const rank = (ip: string): number => {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    return 2;
  };
  const sorted = [...rfc].sort((a, b) => rank(a) - rank(b));
  const primary = sorted[0];
  if (!primary) return { primary: '127.0.0.1', others: [] };
  return { primary, others: sorted.slice(1) };
}

/** Reports whether the value is a strict unicast non-loopback IPv4 literal. */
export function isStrictNonLoopbackIpv4(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => (/^(?:0|[1-9]\d{0,2})$/.test(p) ? Number(p) : 256));
  if (nums.some((n) => n > 255)) return false;
  const a = nums[0]!;
  return a !== 0 && a !== 127 && a < 224;
}

/** Reports whether the value is a strict IPv4 link-local address (169.254.0.0/16). */
export function isLinkLocalIpv4(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => (/^(?:0|[1-9]\d{0,2})$/.test(p) ? Number(p) : 256));
  if (nums.some((n) => n > 255)) return false;
  return nums[0] === 169 && nums[1] === 254;
}

/** Reports whether the value is a non-empty printable ASCII non-space token. */
export function isValidScopedToken(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}
