// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Tests for the centralised runtime logger at `src/util/log.ts`. The line
// format is part of the contract because `docs/TROUBLESHOOTING.md` quotes
// these lines verbatim and the ExtensionHost captures them as the user-facing
// log surface. Any change here must update both this file and the doc.

import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, test } from 'node:test';
import {
  formatLine,
  getLogLevel,
  log,
  redactFields,
  redactString,
  setLogLevel,
  shouldLog,
} from '../src/util/log.ts';

/**
 * Snapshots `console.{debug,info,warn,error}` so each test sees its own
 * captured lines. The originals are restored in {@link restoreConsole}.
 */
let captured = { debug: [], info: [], warn: [], error: [] };
const originalConsole = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

function captureConsole() {
  captured = { debug: [], info: [], warn: [], error: [] };
  console.debug = (...args) => captured.debug.push(args.join(' '));
  console.info = (...args) => captured.info.push(args.join(' '));
  console.warn = (...args) => captured.warn.push(args.join(' '));
  console.error = (...args) => captured.error.push(args.join(' '));
}

function restoreConsole() {
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}

/** Returns every line captured across all four channels. */
function allCaptured() {
  return [...captured.debug, ...captured.info, ...captured.warn, ...captured.error];
}

/** The default level installed in the module is `info`. */
const ORIGINAL_LEVEL = getLogLevel();

before(() => {
  // Force a deterministic level before any test runs so `RC_SETLIST_LOG_LEVEL`
  // set in the shell cannot mask behaviour we want to observe.
  setLogLevel('debug');
});

beforeEach(() => {
  captureConsole();
});

afterEach(() => {
  setLogLevel(ORIGINAL_LEVEL);
  restoreConsole();
});

describe('formatLine', () => {
  test('emits the documented prefix, level and scope', () => {
    const line = formatLine('info', 'osc', 'connected');
    assert.equal(line, '[RC Setlist] [INFO] [osc] connected');
  });

  test('omits the fields block when no fields are supplied', () => {
    const line = formatLine('warn', 'ws', 'client disconnected');
    assert.equal(line, '[RC Setlist] [WARN] [ws] client disconnected');
  });

  test('appends a JSON object when fields are supplied', () => {
    const line = formatLine('error', 'http', 'request failed', {
      method: 'GET',
      status: 500,
    });
    assert.equal(line, '[RC Setlist] [ERROR] [http] request failed {"method":"GET","status":500}');
  });

  test('uppercases the level tag', () => {
    assert.match(formatLine('debug', 'sdk', 'boot'), /\[DEBUG\]/);
    assert.match(formatLine('warn', 'sdk', 'late'), /\[WARN\]/);
    assert.match(formatLine('error', 'sdk', 'broken'), /\[ERROR\]/);
  });
});

describe('redactString', () => {
  test('redacts inline token= and password= pairs', () => {
    const out = redactString('connect token=abc123&user=worm');
    assert.equal(out, 'connect token=[REDACTED]&user=worm');
    assert.ok(!out.includes('abc123'));
  });

  test('redacts standalone password and key values inside strings', () => {
    const out = redactString('password=hunter2 from key=shh');
    assert.ok(!out.includes('hunter2'));
    assert.ok(!out.includes('shh'));
    assert.ok(out.includes('password=[REDACTED]'));
    assert.ok(out.includes('key=[REDACTED]'));
  });

  test('redacts Windows-style absolute paths and keeps the last two segments', () => {
    const input = 'reading C:\\Users\\Worm\\Documents\\RC Setlist\\state.json';
    const out = redactString(input);
    assert.ok(!out.includes('C:\\Users\\Worm'), out);
    assert.ok(out.includes('…/RC Setlist/state.json'), out);
  });

  test('redacts POSIX /Users/ and /home/ paths the same way', () => {
    const out = redactString('/Users/worm/Library/Application Support/Ableton/state.json');
    assert.ok(!out.includes('/Users/worm'));
    assert.ok(out.includes('…/Ableton/state.json'), out);
  });

  test('does not redact relative paths', () => {
    const out = redactString('loading relative/path/file.ts');
    assert.equal(out, 'loading relative/path/file.ts');
  });
});

describe('redactFields', () => {
  test('redacts secret-named fields regardless of value type', () => {
    const out = redactFields({ token: 'abc', userToken: 42, password: 'hunter2' });
    assert.equal(out.token, '[REDACTED]');
    assert.equal(out.userToken, '[REDACTED]');
    assert.equal(out.password, '[REDACTED]');
  });

  test('passes non-secret fields through', () => {
    const out = redactFields({ method: 'GET', port: 11020 });
    assert.deepEqual(out, { method: 'GET', port: 11020 });
  });

  test('runs redactString on string values of non-secret keys', () => {
    const out = redactFields({ path: 'C:\\Users\\Worm\\state.json', reason: 'token=leak' });
    assert.ok(!String(out.path).includes('C:\\Users\\Worm'));
    assert.equal(out.reason, 'token=[REDACTED]');
  });
});

describe('level gating', () => {
  test('default level is `info`', () => {
    setLogLevel('info');
    assert.equal(getLogLevel(), 'info');
    assert.equal(shouldLog('debug'), false);
    assert.equal(shouldLog('info'), true);
    assert.equal(shouldLog('warn'), true);
    assert.equal(shouldLog('error'), true);
  });

  test('debug level lets every channel through', () => {
    setLogLevel('debug');
    log.debug('osc', 'd');
    log.info('osc', 'i');
    log.warn('osc', 'w');
    log.error('osc', 'e');
    assert.equal(captured.debug.length, 1);
    assert.equal(captured.info.length, 1);
    assert.equal(captured.warn.length, 1);
    assert.equal(captured.error.length, 1);
  });

  test('warn level silences debug and info but keeps warn and error', () => {
    setLogLevel('warn');
    log.debug('osc', 'd');
    log.info('osc', 'i');
    log.warn('osc', 'w');
    log.error('osc', 'e');
    assert.equal(captured.debug.length, 0);
    assert.equal(captured.info.length, 0);
    assert.equal(captured.warn.length, 1);
    assert.equal(captured.error.length, 1);
  });

  test('error level keeps only error output', () => {
    setLogLevel('error');
    log.debug('osc', 'd');
    log.info('osc', 'i');
    log.warn('osc', 'w');
    log.error('osc', 'e');
    assert.equal(allCaptured().length, 1);
    assert.equal(captured.error.length, 1);
  });
});

describe('log routing', () => {
  test('routes each level to its matching console channel', () => {
    setLogLevel('debug');
    log.debug('osc', 'd-line');
    log.info('osc', 'i-line');
    log.warn('osc', 'w-line');
    log.error('osc', 'e-line');
    assert.equal(captured.debug[0].endsWith('d-line'), true);
    assert.equal(captured.info[0].endsWith('i-line'), true);
    assert.equal(captured.warn[0].endsWith('w-line'), true);
    assert.equal(captured.error[0].endsWith('e-line'), true);
  });

  test('emitted lines match formatLine exactly', () => {
    setLogLevel('debug');
    log.info('bridge', 'probe reply', { port: 11020 });
    const expected = formatLine('info', 'bridge', 'probe reply', { port: 11020 });
    assert.equal(captured.info[0], expected);
  });

  test('redacts inline secrets and paths on the emitted line', () => {
    setLogLevel('debug');
    log.warn('http', 'leak', { token: 'abc', path: 'C:\\Users\\Worm\\file.json' });
    const line = captured.warn[0];
    assert.ok(!line.includes('abc'));
    assert.ok(!line.includes('C:\\Users\\Worm'));
    assert.ok(line.includes('[REDACTED]'));
  });
});
