// Typed wrappers around `JSON.parse` and `JSON.stringify`.
//
// `JSON.parse` returns `any`; without a local helper every callsite
// propagates the `any` into member-access, assignment, and argument
// positions, which `@typescript-eslint/no-unsafe-*` flags ~40 times
// across `src/`. `parseJson<T>(text, validator)` narrows the result to
// `T` (or `null` when the validator rejects) so consumers see a typed
// value at the boundary.
//
// The validators are tiny type guards. Centralising them here keeps the
// shape checks next to the type definitions, and makes it trivial to add
// runtime checks at a future point (e.g. via `zod`).

/** Decode `text` and narrow it to `T` via a user-supplied type guard.
 *  Returns `null` when the JSON does not parse or the guard rejects; the
 *  caller decides whether `null` means "ignore this packet" or "fall
 *  back to defaults". */
/** Permissive "is an object" guard for the common "JSON.parse returns a
 *  record" pattern. Narrows `any` to `Record<string, unknown>`, after
 *  which each property access returns `unknown` (no `no-unsafe-*` warnings).
 *  Use with `parseJson(text, isPlainObject)` then narrow each field
 *  via `typeof`. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Safely parses JSON text through a type guard. Returns `null` when parsing fails
 * or when the validator rejects the parsed value.
 */
export function parseJson<T>(text: string, validator: (value: unknown) => value is T): T | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return validator(value) ? value : null;
}

/** Validator for `custom-order.json`. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}
