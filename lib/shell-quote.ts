/**
 * Shell quoting helpers for values emitted into `eval`-able output.
 *
 * These are used exclusively by the `pd begin` PD_EMIT_EXPORTS path, where
 * daemon-returned IDs are printed as shell assignment statements and captured
 * via `eval $(pd begin ...)`. An unquoted injection here would let a hostile
 * daemon response escape the assignment and run arbitrary shell code.
 *
 * Agent/session IDs are restricted to safe identifier characters by
 * `assertSafeId`. The quoting functions are a belt-and-suspenders defence for
 * any value that bypasses the assertion (e.g. future callers, broader reuse).
 */

/** Characters that are safe in an unquoted shell assignment RHS (POSIX). */
const SAFE_ID_RE = /^[A-Za-z0-9_.:/-]{1,256}$/;

/**
 * Throw if the value contains characters that could escape a shell context.
 * IDs are semantic tokens (uuid, project:stack:context) — spaces and shell
 * metacharacters have no legitimate place in them.
 */
export function assertSafeId(value: string, field: string): void {
  if (!SAFE_ID_RE.test(value)) {
    throw new Error(
      `pd: ${field} contains characters that are not safe to export to the shell. ` +
        `Received: ${JSON.stringify(value.slice(0, 64))}`,
    );
  }
}

/**
 * POSIX single-quote a value for use in `export VAR='value'`.
 * Single-quoted strings have NO escape sequences in POSIX sh — the only
 * special sequence is the end-quote itself, which we encode as `'\''`.
 */
export function posixShellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Fish shell quote a value for use in `set -x VAR value`.
 * Fish single-quoted strings escape only `\` and `'`.
 */
export function fishShellQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
