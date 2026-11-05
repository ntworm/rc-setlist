/**
 * The LAN address the panel announces and the duo pairing offers.
 *
 * A machine can hold several addresses at once, and the one the system lists
 * first is not always the one the phone can reach: a studio PC with a
 * lighting cable answers 192.168.0.10 before its Wi-Fi. The address the
 * system really routes through wins; the old private-address pick is the
 * fallback for a machine that will not say.
 */

import { networkInterfaces } from 'node:os';

import { buildSnapshot, type LanInterfaceMap } from './lan-candidates.js';
import { probeDefaultRoute, readRouteGateways, type RouteSignals } from './lan-probe.js';
import { pickLanIps } from '../util/helpers.js';

/** How long the machine gets to answer before the panel carries on. */
const DEFAULT_TIMEOUT_MS = 1500;

/** The address to announce, with the other addresses the machine holds. */
export async function resolveLanAddress(deps?: {
  interfaces?: LanInterfaceMap;
  probe?: () => Promise<string | null>;
  routes?: () => Promise<RouteSignals>;
  timeoutMs?: number;
}): Promise<{ primary: string; others: string[] }> {
  const interfaces: LanInterfaceMap = deps?.interfaces ?? networkInterfaces();
  const readProbe: () => Promise<string | null> = deps?.probe ?? probeDefaultRoute;
  const readRoutes: () => Promise<RouteSignals> = deps?.routes ?? readRouteGateways;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const [defaultRouteIp, routeSignals] = await Promise.all([
    raceSignal(readProbe, timeoutMs, null),
    raceSignal(readRoutes, timeoutMs, { gateways: [], routeChecked: false }),
  ]);

  const snapshot = buildSnapshot(interfaces, {
    defaultRouteIp,
    gateways: routeSignals.gateways,
    routeChecked: routeSignals.routeChecked,
  });
  if (snapshot.primaryIp) {
    return { primary: snapshot.primaryIp, others: [...snapshot.otherIps] };
  }
  return pickLanIps(nonInternalIpv4s(interfaces));
}

/** A reading that arrives late, fails or never comes is no reading at all. */
async function raceSignal<T>(work: () => Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    return await Promise.race([readOrFallback(work, fallback), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The reading, or the fallback when the machine throws instead of answering. */
function readOrFallback<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return work().catch(() => fallback);
  } catch {
    return Promise.resolve(fallback);
  }
}

/** The addresses the old pick worked on, for a machine that will not say. */
function nonInternalIpv4s(interfaces: LanInterfaceMap): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal === true) continue;
      if (entry.family !== undefined && entry.family !== 'IPv4') continue;
      addresses.push(entry.address);
    }
  }
  return addresses;
}
