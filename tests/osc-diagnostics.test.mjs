import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildOscDiagnosticModel } from '../src/ui/osc-diagnostics.js';

function snapshot(overrides = {}) {
  return {
    oscTargetHost: '127.0.0.1',
    oscTargetPort: 11000,
    oscListenPort: 11001,
    oscIsConnected: false,
    oscLastMessageTime: 0,
    oscTimeSinceLastMessageMs: null,
    oscRxCount: 0,
    oscTxCount: 0,
    ...overrides,
  };
}

test('OSC diagnostics: stopped server does not claim an OSC failure', () => {
  assert.deepEqual(
    buildOscDiagnosticModel({
      serverRunning: false,
      snapshot: null,
    }),
    {
      state: 'stopped',
      listenPort: null,
      rxCount: 0,
      txCount: 0,
      lastReplyAgeMs: null,
    },
  );
});

test('OSC diagnostics: sent queries with zero replies identify no-reply setup', () => {
  assert.deepEqual(
    buildOscDiagnosticModel({
      serverRunning: true,
      snapshot: snapshot({ oscTxCount: 8 }),
    }),
    {
      state: 'no-reply',
      listenPort: 11001,
      rxCount: 0,
      txCount: 8,
      lastReplyAgeMs: null,
    },
  );
});

test('OSC diagnostics: fallback listener without replies identifies a return-port conflict', () => {
  assert.deepEqual(
    buildOscDiagnosticModel({
      serverRunning: true,
      snapshot: snapshot({
        oscListenPort: 11101,
        oscTxCount: 55,
      }),
    }),
    {
      state: 'port-conflict',
      listenPort: 11101,
      rxCount: 0,
      txCount: 55,
      lastReplyAgeMs: null,
    },
  );
});

test('OSC diagnostics: recent received traffic reports responding', () => {
  assert.deepEqual(
    buildOscDiagnosticModel({
      serverRunning: true,
      snapshot: snapshot({
        oscIsConnected: true,
        oscRxCount: 14,
        oscTxCount: 20,
        oscLastMessageTime: 1_000,
        oscTimeSinceLastMessageMs: 180,
      }),
    }),
    {
      state: 'responding',
      listenPort: 11001,
      rxCount: 14,
      txCount: 20,
      lastReplyAgeMs: 180,
    },
  );
});

test('OSC diagnostics: prior traffic without a current connection reports stale', () => {
  assert.deepEqual(
    buildOscDiagnosticModel({
      serverRunning: true,
      snapshot: snapshot({
        oscRxCount: 14,
        oscTxCount: 35,
        oscLastMessageTime: 1_000,
        oscTimeSinceLastMessageMs: 4_500,
      }),
    }),
    {
      state: 'stale',
      listenPort: 11001,
      rxCount: 14,
      txCount: 35,
      lastReplyAgeMs: 4_500,
    },
  );
});
