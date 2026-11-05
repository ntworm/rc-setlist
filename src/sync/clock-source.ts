// Says which source drives the playhead. The playhead follows the
// AbletonMCPServer Remote Script (TCP 9888) while it answers and falls back to
// RC Bridge over OSC otherwise; the two paths behave differently under load,
// and nothing in the log used to tell which one a computer was on.
import { bridgeState } from '../runtime/bridge-state.js';
import { REPEAT_LINE_INTERVAL_MS } from '../runtime/event-loop-watch.js';
import { log } from '../util/log.js';

let lastLineAt = Number.NEGATIVE_INFINITY;
let lineOwed = false;
let switchesSinceLastLine = 0;

/**
 * Records that the latest playhead sample came from `source`, and logs the
 * source when it changes. A Remote Script answering slower than the fallback
 * window flips the source on every sample, so lines are spaced by
 * REPEAT_LINE_INTERVAL_MS: a switch made inside that spacing is logged by the
 * next sample after it, with how many switches it covers. Both sources
 * sample every 100 ms, so the current one is always logged within the spacing.
 *
 * `lastMcpAnswerMsAgo` is how long ago the Remote Script last answered, or
 * `null` when it never has; it is only reported when OSC drives the playhead.
 */
export function noteTransportClockSource(
  source: 'mcp' | 'osc',
  lastMcpAnswerMsAgo: number | null = null,
  now: number = performance.now(),
): void {
  if (bridgeState.transportClockSource !== source) {
    switchesSinceLastLine++;
    bridgeState.transportClockSource = source;
    lineOwed = true;
  }
  if (!lineOwed || now - lastLineAt < REPEAT_LINE_INTERVAL_MS) return;

  const repeats = switchesSinceLastLine > 1 ? { switchesSinceLastLine } : {};
  if (source === 'mcp') {
    log.info('sync', 'Transport clock: MCP Remote Script on 127.0.0.1:9888', repeats);
  } else {
    log.info(
      'sync',
      'Transport clock: OSC (RC Bridge); MCP Remote Script on 127.0.0.1:9888 is not answering',
      {
        lastMcpAnswer:
          lastMcpAnswerMsAgo === null ? 'never' : `${Math.round(lastMcpAnswerMsAgo)} ms ago`,
        ...repeats,
      },
    );
  }
  lastLineAt = now;
  lineOwed = false;
  switchesSinceLastLine = 0;
}
