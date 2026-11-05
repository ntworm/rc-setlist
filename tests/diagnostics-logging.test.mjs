import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import {
  EVENT_LOOP_CHECK_INTERVAL_MS,
  EVENT_LOOP_STALL_THRESHOLD_MS,
  REPEAT_LINE_INTERVAL_MS,
  createRepeatGate,
  createStallDetector,
  warnIfSlow,
} from '../src/runtime/event-loop-watch.ts';
import { noteTransportClockSource } from '../src/sync/clock-source.ts';
import { OSCClient } from '../src/integration/osc-client.ts';
import { getLogLevel, setLogLevel } from '../src/util/log.ts';

function captureConsole(t) {
  const lines = [];
  for (const method of ['debug', 'info', 'warn', 'error']) {
    t.mock.method(console, method, (line) => lines.push([method, String(line)]));
  }
  return lines;
}

test('the stall detector reports only lateness beyond the interval and the threshold', () => {
  let clock = 1_000;
  const detect = createStallDetector(() => clock);

  clock += EVENT_LOOP_CHECK_INTERVAL_MS + 20;
  assert.equal(detect(), null, 'ordinary scheduling jitter is not a stall');

  clock += EVENT_LOOP_CHECK_INTERVAL_MS + EVENT_LOOP_STALL_THRESHOLD_MS - 1;
  assert.equal(detect(), null, 'just under the threshold is not reported');

  clock += EVENT_LOOP_CHECK_INTERVAL_MS + 19_600;
  assert.equal(detect(), 19_600, 'a long stall is reported with its length');

  clock += EVENT_LOOP_CHECK_INTERVAL_MS;
  assert.equal(detect(), null, 'the next on-time check starts from the stall end');
});

test('the repeat gate lets one line per key through each interval and counts the rest', () => {
  let clock = 0;
  const gate = createRepeatGate(() => clock);
  assert.equal(gate('sdk'), 0);
  clock += 100;
  assert.equal(gate('sdk'), null);
  assert.equal(gate('ws'), 0, 'keys are independent');
  clock += 100;
  assert.equal(gate('sdk'), null);
  clock += REPEAT_LINE_INTERVAL_MS;
  assert.equal(gate('sdk'), 2, 'the next line reports the two held back');
});

test('the transport clock source is logged per change, spaced when it flips', (t) => {
  const saved = bridgeState.transportClockSource;
  bridgeState.transportClockSource = null;
  const lines = captureConsole(t);
  // Far from any line other tests may have written through the same module.
  let now = 10_000_000;
  const clockLines = () => lines.filter(([, line]) => line.includes('Transport clock'));
  try {
    noteTransportClockSource('osc', null, now);
    noteTransportClockSource('osc', null, (now += 100));
    assert.equal(clockLines().length, 1, 'a steady source is logged once');
    assert.match(clockLines()[0][1], /Transport clock: OSC \(RC Bridge\).*never/);

    now += REPEAT_LINE_INTERVAL_MS;
    noteTransportClockSource('mcp', null, now);
    assert.equal(clockLines().length, 2);
    assert.match(clockLines()[1][1], /Transport clock: MCP Remote Script on 127\.0\.0\.1:9888/);

    // A Remote Script slower than the fallback window flips the source on
    // every sample; the lines stay spaced and the next one counts the flips.
    noteTransportClockSource('osc', 600, (now += 100));
    noteTransportClockSource('mcp', null, (now += 100));
    noteTransportClockSource('osc', 600, (now += 100));
    assert.equal(clockLines().length, 2, 'flips inside the spacing are held');

    now += REPEAT_LINE_INTERVAL_MS;
    noteTransportClockSource('osc', 812.4, now);
    assert.equal(clockLines().length, 3, 'the held switch is logged by the next sample');
    assert.match(clockLines()[2][1], /812 ms ago/);
    assert.match(clockLines()[2][1], /"switchesSinceLastLine":3/);
    assert.ok(clockLines().every(([method]) => method === 'info'));
  } finally {
    bridgeState.transportClockSource = saved;
  }
});

test('polled OSC replies are logged at DEBUG, not INFO', (t) => {
  const savedLevel = getLogLevel();
  const lines = captureConsole(t);
  const client = new OSCClient();
  const replies = [
    { oscType: 'message', address: '/live/song/get/tempo', args: [{ value: 120 }] },
    { oscType: 'message', address: '/live/song/get/metronome', args: [{ value: 1 }] },
    {
      oscType: 'message',
      address: '/live/song/get/cue_points',
      args: [{ value: 'Song A' }, { value: 0 }],
    },
  ];
  try {
    setLogLevel('info');
    for (const reply of replies) client['handleIncoming'](reply);
    assert.equal(
      lines.some(([, line]) => / reply/.test(line)),
      false,
      'nothing is written at the default level',
    );

    setLogLevel('debug');
    for (const reply of replies) client['handleIncoming'](reply);
    const replyLines = lines.filter(([, line]) => / reply/.test(line));
    assert.equal(replyLines.length, 3);
    assert.ok(replyLines.every(([method]) => method === 'debug'));
  } finally {
    setLogLevel(savedLevel);
    client.stop?.();
  }
});

test('a step that stays slow on every tick writes one line per interval', (t) => {
  const lines = captureConsole(t);
  for (let tick = 0; tick < 10; tick++) {
    warnIfSlow('sdk', 'test-only step', performance.now() - 250);
  }
  const slowLines = lines.filter(([, line]) => line.includes('test-only step'));
  assert.equal(slowLines.length, 1);
  assert.equal(slowLines[0][0], 'warn');
  assert.match(slowLines[0][1], /Slow step/);
});
