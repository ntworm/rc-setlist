// Reports when this process stops running JavaScript. Live's ExtensionHost
// runs every extension in one Node process, so a stall here freezes the
// server, its timers and the other extensions together; until now that could
// only be inferred from gaps in the logs.
import { log } from '../util/log.js';

/** How often the watch expects to run. */
export const EVENT_LOOP_CHECK_INTERVAL_MS = 100;
/** Lateness worth a line: shorter delays are ordinary scheduling noise. */
export const EVENT_LOOP_STALL_THRESHOLD_MS = 500;
/** A single step of our own that takes longer than this is reported. */
export const SLOW_STEP_THRESHOLD_MS = 100;

/**
 * Returns a check that, called once per interval, gives how long the event
 * loop was blocked beyond the interval, or `null` when it was not late enough
 * to report. The line can only be written once the stall is over.
 */
export function createStallDetector(
  now: () => number = () => performance.now(),
): () => number | null {
  let last = now();
  return () => {
    const current = now();
    const stalledMs = current - last - EVENT_LOOP_CHECK_INTERVAL_MS;
    last = current;
    return stalledMs >= EVENT_LOOP_STALL_THRESHOLD_MS ? Math.round(stalledMs) : null;
  };
}

/**
 * Starts the watch and returns its timer; the caller clears it on shutdown.
 */
export function startEventLoopWatch(): NodeJS.Timeout {
  const detectStall = createStallDetector();
  return setInterval(() => {
    const stalledMs = detectStall();
    if (stalledMs !== null) log.warn('runtime', 'Event loop stalled', { stalledMs });
  }, EVENT_LOOP_CHECK_INTERVAL_MS);
}

/**
 * Minimum spacing between two lines about the same thing. A step that runs on
 * a 100 ms timer and stays slow under load would otherwise write ten lines a
 * second, the flood these diagnostics exist to rule out.
 */
export const REPEAT_LINE_INTERVAL_MS = 5_000;

/**
 * Lets one line per key through every REPEAT_LINE_INTERVAL_MS. Returns how
 * many lines were held back for that key since the last one, or `null` when
 * this line is held back too.
 */
export function createRepeatGate(
  now: () => number = () => performance.now(),
): (key: string) => number | null {
  const lines = new Map<string, { at: number; held: number }>();
  return (key) => {
    const current = now();
    const previous = lines.get(key);
    if (previous && current - previous.at < REPEAT_LINE_INTERVAL_MS) {
      previous.held++;
      return null;
    }
    lines.set(key, { at: current, held: 0 });
    return previous?.held ?? 0;
  };
}

const slowStepGate = createRepeatGate();

/**
 * Reports a step that started at `startedAt` (from `performance.now()`) and
 * took longer than SLOW_STEP_THRESHOLD_MS, so a stall can be traced to it.
 */
export function warnIfSlow(scope: string, step: string, startedAt: number): void {
  const durationMs = performance.now() - startedAt;
  if (durationMs <= SLOW_STEP_THRESHOLD_MS) return;
  const held = slowStepGate(step);
  if (held === null) return;
  log.warn(scope, 'Slow step', {
    step,
    durationMs: Math.round(durationMs),
    ...(held > 0 ? { slowRepeatsNotLogged: held } : {}),
  });
}
