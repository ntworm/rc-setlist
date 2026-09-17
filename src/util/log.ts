// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Centralized runtime logger for RC Setlist. Replaces ad-hoc
// console.* calls in src/ with a single, stable, redacted surface that the
// ExtensionHost captures. The on-disk stage log continues to live in
// src/core/event-log.ts; both share the same redaction vocabulary so that
// secrets and absolute paths never leak to either surface.
//
// `docs/TROUBLESHOOTING.md` quotes lines produced here verbatim; the format
// below is therefore part of the contract tested by tests/log.test.mjs.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Documented scopes for {@link log}: `osc`, `ws`, `http`, `profiles`, `sdk`,
 * `panel`, `lifecycle`, `bridge`, `sync`, `core`, `commands`, `integration`.
 * Free-form strings are accepted at runtime for forward-compatibility, but
 * tests in `tests/log.test.mjs` keep call sites honest about spelling.
 */

export interface LogFields {
  readonly [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Matches `token=…`, `secret=…`, `password=…`, `key=…` inside free-form strings.
 * Stops at whitespace, `&`, `"`, `'` so URLs and HTML attributes don't get
 * truncated past their actual value.
 */
const REDACT_PAIR_RE = /\b(token|secret|password|key)=([^\s&"'<>]+)/gi;

/**
 * Matches Windows (`C:\…`), UNC (`\\…`), macOS (`/Users/…`) and Linux
 * (`/home/…`) absolute paths. The character class deliberately allows
 * whitespace, `_`, `-`, `.`, `/` and `\` so paths like
 * `/Users/worm/Library/Application Support/Ableton/state.json` are captured
 * in full; stops only at quotes and angle brackets, which never appear
 * inside a path string.
 */
const PATH_RE = /((?:[A-Za-z]:\\|\\\\|\/Users\/|\/home\/)[A-Za-z0-9 _.\-/\\]+)/g;

/**
 * Matches object keys whose name signals a secret regardless of value type.
 * Unanchored so `authToken`, `passwordHash`, `userToken` and `token` all
 * match. The over-redaction of borderline names like `keynote` or
 * `tokenize` is intentional — false positives are cheaper than leaks.
 */
const SECRET_KEY_RE = /(?:token|secret|password|key|auth|authorization|cred|credential)/i;

/**
 * Replaces inline `key=value` pairs and absolute paths with placeholders.
 * Stable order: redact pairs first (they may include `=` and look like paths),
 * then paths.
 */
export function redactString(input: string): string {
  return input
    .replace(REDACT_PAIR_RE, (_m, key: string) => `${key}=[REDACTED]`)
    .replace(PATH_RE, (match) => {
      const trimmed = match.replace(/[\\/]+$/, '');
      const parts = trimmed.split(/[\\/]/);
      if (parts.length <= 2) return '[PATH]';
      return `…/${parts.slice(-2).join('/')}`;
    });
}

/**
 * Walks an object and redacts secret-named fields and string values.
 * Non-string leaves pass through unchanged.
 */
export function redactFields(fields: LogFields): LogFields {
  if (!fields) return fields;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEY_RE.test(key)) {
      out[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      out[key] = redactString(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Builds the canonical log line. Visible to tests and used internally by
 * {@link emit}. The shape is:
 *
 *   `[RC Setlist] [LEVEL] [scope] message {fields-json}`
 *
 * The fields block is omitted entirely when no fields are supplied so that
 * the simple call form produces a single, predictable line.
 */
export function formatLine(
  level: LogLevel,
  scope: string,
  message: string,
  fields?: LogFields,
): string {
  const prefix = `[RC Setlist] [${level.toUpperCase()}] [${scope}]`;
  const safeMessage = redactString(message);
  if (!fields || Object.keys(fields).length === 0) {
    return `${prefix} ${safeMessage}`;
  }
  const safeFields = redactFields(fields);
  return `${prefix} ${safeMessage} ${JSON.stringify(safeFields)}`;
}

let currentLevel: LogLevel = 'info';
let levelInitialized = false;

/**
 * Reads `RC_SETLIST_LOG_LEVEL` from the process environment on first use.
 * Values outside the four canonical levels fall back to `info` so a typo in
 * the environment does not silence all output.
 */
function initLevelFromEnv(): void {
  if (levelInitialized) return;
  levelInitialized = true;
  const env = (typeof process !== 'undefined' && process.env) || {};
  const raw = (env.RC_SETLIST_LOG_LEVEL ?? '').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    currentLevel = raw;
  }
}

/**
 * Overrides the active level. Tests use this to exercise the gating logic.
 * Environment-based initialisation still runs first so the override is
 * applied on top of `RC_SETLIST_LOG_LEVEL`.
 */
export function setLogLevel(level: LogLevel): void {
  initLevelFromEnv();
  currentLevel = level;
}

/**
 * Returns the active level after applying the environment override once.
 */
export function getLogLevel(): LogLevel {
  initLevelFromEnv();
  return currentLevel;
}

/**
 * Returns `true` when a record at `level` should be emitted given the
 * currently configured minimum.
 */
export function shouldLog(level: LogLevel): boolean {
  initLevelFromEnv();
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function emit(level: LogLevel, scope: string, message: string, fields?: LogFields): void {
  if (!shouldLog(level)) return;
  const line = formatLine(level, scope, message, fields);
  switch (level) {
    case 'debug':
      console.debug(line);
      break;
    case 'info':
      console.info(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'error':
      console.error(line);
      break;
  }
}

/**
 * Public logger entry point. Callers pass a documented scope so the line can
 * be routed in `docs/TROUBLESHOOTING.md` and filtered in production logs.
 */
export const log = {
  debug(scope: string, message: string, fields?: LogFields): void {
    emit('debug', scope, message, fields);
  },
  info(scope: string, message: string, fields?: LogFields): void {
    emit('info', scope, message, fields);
  },
  warn(scope: string, message: string, fields?: LogFields): void {
    emit('warn', scope, message, fields);
  },
  error(scope: string, message: string, fields?: LogFields): void {
    emit('error', scope, message, fields);
  },
};
