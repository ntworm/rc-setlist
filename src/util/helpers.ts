import { networkInterfaces } from 'node:os';

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

export function isRfc1918(ip: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

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
