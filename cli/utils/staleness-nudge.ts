/**
 * Startup staleness nudge (ADR-0054 Phase 2)
 *
 * Hooked into the CLI pre-dispatch preamble so EVERY `pd` invocation can, at
 * most once a day, tell the operator their binary is behind the latest release.
 * This is the cross-platform complement to `pd self-update` (ADR-0062), which
 * ACTIVELY auto-upgrades but only on macOS + Homebrew. On an auto-upgraded
 * machine the binary is never behind, so this stays silent; on npm/Linux (or with
 * the freshness LaunchAgent disabled) it's the only signal you're stale.
 *
 * The check is fail-soft, throttled, TTY-gated, and writes only to stderr so it
 * can never corrupt a command's stdout (JSON, completions, pipelines).
 */

import { evaluateStaleness, OPT_OUT_ENV } from '../../lib/version-staleness.js';

/**
 * Commands where a nudge is noise or unsafe:
 *   - self-update / upgrade: the upgrade commands themselves — nudging is redundant.
 *   - version: redundant with the explicit version output.
 *   - completion(s): output is shell-eval'd — a stray line would break the shell.
 *   - mcp / __daemon: protocol / long-running processes.
 *   - help / splash / learn / tutorial: meta or orientation surfaces whose
 *     command contract excludes freshness cache writes and release probes.
 * Everything else (claim, begin, note, status, …) is fair game — the nudge goes
 * to stderr, so even those commands' stdout stays clean.
 */
const NUDGE_SKIP_COMMANDS = new Set([
  'version',
  'self-update',
  'upgrade',
  'completion',
  'completions',
  'mcp',
  '__daemon',
  'splash',
  'help',
  'learn',
  'tutorial',
]);

export function shouldNudgeStaleness(command: string | undefined, isQuiet: boolean): boolean {
  if (process.env[OPT_OUT_ENV]) return false;
  if (isQuiet) return false;
  // Only nudge an interactive human; never pollute scripted/CI/agent output.
  if (!process.stderr.isTTY) return false;
  const normalized = (command || '').trim();
  if (!normalized) return false;
  if (normalized.startsWith('-')) return false; // --version, --help, -V, etc.
  return !NUDGE_SKIP_COMMANDS.has(normalized);
}

/**
 * Print the once/day staleness nudge to stderr if the running `pd` is behind.
 * Never throws, never blocks beyond the staleness check's own tight timeout.
 */
export async function maybeNudgeStaleness(opts: {
  command: string | undefined;
  currentVersion: string;
  isQuiet: boolean;
}): Promise<void> {
  try {
    if (!shouldNudgeStaleness(opts.command, opts.isQuiet)) return;
    const result = await evaluateStaleness({ current: opts.currentVersion });
    if (result.behind && result.nudge) {
      process.stderr.write(`${result.nudge}\n`);
    }
  } catch {
    // A staleness nudge must never break a real command.
  }
}
