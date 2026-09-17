// Locator editor: rename the cue point at a beat via MCP, or RC Bridge /
// AbletonOSC if MCP is absent. The rename is followed by a verification read
// because either transport's success is provisional — Live might silently drop
// the write, and the operator would then keep an old cue with a new name on
// their arrangement.
import { bridgeState } from '../../runtime/bridge-state.js';
import { OperatorError } from '../../core/operator-error.js';
import { parseLocator } from '../../core/locator-parser.js';
import { requestCueRefresh, isRecord, type ClientMessageOf } from './shared.js';
import { renameCuePoint } from './transport.js';

async function verifyLocator(
  time: number,
  name: string,
): Promise<'ok' | 'missing' | 'wrong-name' | 'unknown'> {
  // Fetch the cue list back from Live directly rather than reading the
  // manager's cached view: the poll runs every two seconds, so the rename
  // would look stale for up to two seconds otherwise, and the next save
  // would write the old name back.
  let cues: unknown;
  if (bridgeState.mcpClient) {
    try {
      cues = await bridgeState.mcpClient.call('get_locators', {});
    } catch {
      return 'unknown';
    }
  } else if (bridgeState.oscClient) {
    cues = await bridgeState.oscClient.readCuePoints();
  }
  if (!Array.isArray(cues)) return 'unknown';

  const here = (cues as unknown[]).filter((cue) => isRecord(cue) && cue.time === time);
  if (here.length === 0) return 'missing';
  return here.some((cue) => (cue as Record<string, unknown>).name === name) ? 'ok' : 'wrong-name';
}

/**
 * ExecuteEditLocatorCommand — implementation detail.
 */
export async function executeEditLocatorCommand(
  msg: ClientMessageOf<'edit_locator'>,
): Promise<void> {
  if (!bridgeState.manager) {
    throw new OperatorError('Setlist manager is not initialized.');
  }
  // A rename moves the playhead to the cue's position to act on it. With the
  // transport rolling, Live services that call wherever playback has advanced
  // to by then, so the write lands at the wrong beat. Blocked in every mode.
  if (bridgeState.manager.getState().isPlaying) {
    throw new OperatorError(
      'Cannot edit a locator while the transport is playing. Stop playback first.',
    );
  }

  const { time, name } = msg;

  const parsed = parseLocator(name);
  if (parsed.kind === 'hidden' && parsed.hiddenName === '_empty') {
    throw new OperatorError('Name cannot be empty.');
  }

  const rawCues = bridgeState.manager.getRawCues();
  const matches = rawCues.filter((c) => c.time === time);

  if (matches.length === 0) {
    throw new OperatorError(`No cue point found at time ${time}.`);
  }
  if (matches.length > 1) {
    throw new OperatorError(`Ambiguous cue point at time ${time}: ${matches.length} cues collide.`);
  }

  const existing = matches[0]!;
  if (existing.name === name) {
    // No-op: same name. Treat as success.
    return;
  }

  // One call, and the marker never stops existing. The MCP bridge renames by
  // beat; RC Bridge and AbletonOSC by the cue's index in Live's chronological
  // list — the index the manager keeps beside each raw cue.
  const renamed = await renameCuePoint(time, name, existing.cueIndex ?? rawCues.indexOf(existing));
  if (renamed.status !== 'confirmed') {
    throw new OperatorError(
      `Could not rename the cue point at ${time}: ${renamed.message ?? 'unknown error'}`,
    );
  }

  const verdict = await verifyLocator(time, name);
  if (verdict === 'missing') {
    bridgeState.wsServer?.broadcastLog(
      `The locator at ${time} is gone after the rename. Check the Arrangement.`,
      'error',
    );
    requestCueRefresh();
    throw new OperatorError(`Rename left no cue point at ${time}.`);
  }
  if (verdict === 'wrong-name') {
    bridgeState.wsServer?.broadcastLog(
      `Live did not accept the new name for the locator at ${time}.`,
      'error',
    );
    requestCueRefresh();
    throw new OperatorError(`Cue point at ${time} did not take the new name.`);
  }

  bridgeState.wsServer?.broadcastLog(`Locator edited at ${time}.`, 'info');
  requestCueRefresh();
}
