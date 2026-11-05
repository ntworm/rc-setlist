/**
 * Reading what the machine is really using to reach the outside world.
 *
 * Two signals, both best-effort: the route table, which names the gateways
 * the system would send traffic through, and a UDP connect, which tells
 * which local address the kernel would pick for it. Neither sends a packet.
 */

import { createSocket, type Socket } from 'node:dgram';

export type CommandRunner = (
  file: string,
  args: string[],
  options: {
    timeout: number;
    windowsHide: boolean;
    encoding: 'latin1' | 'utf8';
    env?: Record<string, string | undefined>;
  },
) => Promise<string>;

export interface RouteSignals {
  gateways: string[];
  routeChecked: boolean;
}

const ROUTE_TIMEOUT_MS = 2000;
const PROBE_TIMEOUT_MS = 1000;
const PROBE_PORT = 53;
const PROBE_TARGETS = ['8.8.8.8', '1.1.1.1'];

/** The gateway column of the Windows route table, once per gateway. */
export function parseWindowsRoutes(text: string): string[] {
  return gatewaysOf(text, (fields) => fields[0] === '0.0.0.0' && fields[1] === '0.0.0.0', 2);
}

/** The gateway of every default route on macOS, once per gateway. */
export function parseMacRoutes(text: string): string[] {
  return gatewaysOf(text, (fields) => fields[0] === 'default', 1);
}

function gatewaysOf(
  text: string,
  isDefault: (fields: string[]) => boolean,
  column: number,
): string[] {
  const gateways: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    const gateway = fields[column];
    if (!gateway || !isDefault(fields)) continue;
    if (!isDottedIpv4(gateway)) continue;
    if (!gateways.includes(gateway)) gateways.push(gateway);
  }
  return gateways;
}

/** The command runner, or null when this build cannot run a command. */
export async function loadCommandRunner(): Promise<CommandRunner | null> {
  const childProcess = await loadChildProcess();
  if (!childProcess) return null;
  const execFile = childProcess.execFile;
  if (typeof execFile !== 'function') return null;
  return (file, args, options) =>
    new Promise<string>((resolve, reject) => {
      execFile(file, args, { ...options, shell: false }, (error: Error | null, stdout) => {
        if (error) reject(error);
        else resolve(String(stdout));
      });
    });
}

/** The gateways of the default routes, or none when they cannot be read. */
export async function readRouteGateways(
  options: { platform?: string; run?: CommandRunner | null } = {},
): Promise<RouteSignals> {
  const platform = options.platform ?? process.platform;
  const runner = options.run === undefined ? await loadCommandRunner() : options.run;
  if (!runner) return { gateways: [], routeChecked: false };
  try {
    if (platform === 'win32') {
      const text = await runner('route', ['print', '-4'], routeOptions());
      return { gateways: parseWindowsRoutes(text), routeChecked: true };
    }
    if (platform === 'darwin') {
      const text = await runner('netstat', ['-rn', '-f', 'inet'], routeOptions());
      return { gateways: parseMacRoutes(text), routeChecked: true };
    }
  } catch {
    // A machine that will not talk about its routes has no routes to report.
  }
  return { gateways: [], routeChecked: false };
}

/** The address the kernel would send to the outside through. A UDP connect
 *  sends nothing, it only asks the routing table which local address wins. */
export async function probeDefaultRoute(): Promise<string | null> {
  for (const target of PROBE_TARGETS) {
    const address = await probeTarget(target);
    if (address) return address;
  }
  return null;
}

function routeOptions(): { timeout: number; windowsHide: boolean; encoding: 'latin1' } {
  return { timeout: ROUTE_TIMEOUT_MS, windowsHide: true, encoding: 'latin1' };
}

function isDottedIpv4(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return false;
  return match.slice(1).every((part) => Number(part) <= 255);
}

/** The child process module, loaded where it is used. A build that cannot
 *  carry it simply has no way to run a command, and says so. */
async function loadChildProcess(): Promise<typeof import('node:child_process') | null> {
  if (typeof require === 'function') {
    try {
      const load = require;
      return load('node:child_process') as typeof import('node:child_process');
    } catch {
      return null;
    }
  }
  try {
    return await import('node:child_process');
  } catch {
    return null;
  }
}

function probeTarget(target: string): Promise<string | null> {
  return new Promise((resolve) => {
    let socket: Socket | null = null;
    let timer: NodeJS.Timeout | null = null;
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (socket !== null) {
        try {
          socket.close();
        } catch {
          // Already closed.
        }
      }
      resolve(value);
    };
    timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    try {
      socket = createSocket('udp4');
      socket.on('error', () => finish(null));
      socket.connect(PROBE_PORT, target, () => finish(localAddress(socket)));
    } catch {
      finish(null);
    }
  });
}

function localAddress(socket: Socket | null): string | null {
  try {
    return socket?.address().address ?? null;
  } catch {
    return null;
  }
}
