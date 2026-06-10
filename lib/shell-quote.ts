/**
 * shell-quote.ts — Safe shell quoting for eval-emitted export lines
 *
 * SECURITY-SENSITIVE: this module is used to produce shell code that callers
 * eval in their shell (e.g. `eval "$(pd begin ...)"` or `eval $(pd begin ...)`).
 * Any unquoted metacharacter in an emitted value becomes a shell injection.
 *
 * Usage contract:
 *   - posixShellQuote: use for sh/bash/zsh export lines
 *   - fishShellQuote:  use for fish `set -x` lines
 *   - assertSafeId:    call before quoting daemon-supplied IDs as defense-in-depth
 *
 * Do not add additional helpers here without updating both callers
 * (cli/commands/sugar.ts and cli/commands/daemon.ts) and the unit tests.
 */

/**
 * Wrap `value` in POSIX single quotes, escaping any embedded single-quote
 * characters using the sequence  '\''  (close-quote, escaped-quote, re-open-quote).
 *
 * This is the universal POSIX shell quoting strategy — safe in sh, bash, zsh,
 * and every POSIX-compliant shell.  Behavior is byte-identical to the local
 * `shellQuote` that previously lived in cli/commands/daemon.ts.
 *
 * Examples:
 *   posixShellQuote("hello")      → 'hello'
 *   posixShellQuote("it's alive") → 'it'\''s alive'
 *   posixShellQuote("x;rm -rf ~") → 'x;rm -rf ~'
 */
export function posixShellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Wrap `value` in fish single quotes.
 *
 * Inside fish single-quoted strings only two characters are special:
 *   \  (backslash) — must be doubled
 *   '  (single-quote) — must be backslash-escaped as \'
 *
 * All other characters (including ; $ ( ) & | < > ` space) are literal,
 * so the two replacements below are sufficient and complete.
 *
 * Examples:
 *   fishShellQuote("hello")       → 'hello'
 *   fishShellQuote("it's alive")  → 'it\'s alive'
 *   fishShellQuote("a\\b")        → 'a\\\\b'
 */
export function fishShellQuote(value: string): string {
  // Order matters: escape backslashes first, then single-quotes.
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

/**
 * Assert that `value` contains no control characters (U+0000–U+001F or U+007F).
 *
 * This is a defense-in-depth check for daemon-supplied IDs.  Shell quoting
 * neutralises all shell metacharacters, but a value containing a literal
 * newline, NUL, or other control character could still confuse downstream
 * consumers even when properly quoted.  Rejecting such values early is the
 * safest policy.
 *
 * @throws {Error} with a descriptive message if the value is unsafe.
 */
export function assertSafeId(value: string, fieldName: string): void {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(value)) {
    throw new Error(
      `${fieldName} contains a control character (codepoint 0x00–0x1F or 0x7F) and cannot be safely emitted as a shell export. ` +
      `Refusing to emit to prevent injection in eval consumers.`
    );
  }
}
