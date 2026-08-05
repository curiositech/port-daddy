/**
 * Watcher PID registry — closes the "external `pd watch --exec` children
 * survive a daemon crash" gap named in AGENTS.md:
 *
 *   "Daemon-owned YAML watchers must use in-process messaging subscriptions.
 *    A stable daemon spawning long-lived `pd watch ... --exec` children for
 *    its own watchers is a regression: those children can survive daemon
 *    restart, reconnect-storm SSE, and poison daemon heartbeat truth."
 *
 * lib/fleet-engine.ts's `startWatcher()` falls back to spawning a detached,
 * unref'd `pd watch <channel> --exec <cmd>` child when the in-process
 * messaging subscription is unavailable (e.g. the daemon has hit its
 * subscriber/channel caps — see lib/messaging.ts MAX_CHANNELS /
 * MAX_SUBSCRIBERS_PER_CHANNEL). On a graceful shutdown, `stopRunningRecord()`
 * kills that child's whole process group. On an UNgraceful exit — a native
 * segfault being the concrete case investigated 2026-07-08 (issue #676) —
 * nothing runs, and the detached child (its own session/process group)
 * survives, still holding its own SSE connection open and reconnecting to
 * whatever daemon instance answers next.
 *
 * Across a crash-loop, each cycle that hits the external-spawn fallback can
 * leave one more of these orphans behind, so the accumulated connection/FD
 * count creeps up with every crash — the opposite of what you want right
 * before a load-triggered native crash. This module is the boot-time fix for
 * the "survive daemon restart" half of the regression: persist each spawned
 * child's PID to a small JSON file, and on the next boot, sweep + kill
 * anything still alive under the current project before starting fresh
 * watchers. It cannot prevent the crash itself, but it stops orphans from
 * silently piling up across repeated crashes.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Bound the stored exec fragment so a pathological watcher.exec config can't
 * bloat the registry file indefinitely. Long enough that truncation almost
 * never affects the identity check in practice.
 */
const MAX_EXEC_SNIPPET_LEN = 500;

export interface WatcherPidEntry {
  pid: number;
  startedAt: number;
  /**
   * A fragment of the spawned command line (the watcher's `exec` string),
   * used to confirm the live process at `pid` is actually still the watcher
   * child before killing it — see sweepStaleWatcherPids. Optional only for
   * backward compatibility with a registry file written before this field
   * existed; an entry without it is treated as unconfirmable (never killed).
   */
  execSnippet?: string;
}

/** Truncates to MAX_EXEC_SNIPPET_LEN so the registry can't grow unbounded. */
export function toExecSnippet(exec: string): string {
  return exec.length > MAX_EXEC_SNIPPET_LEN ? exec.slice(0, MAX_EXEC_SNIPPET_LEN) : exec;
}

export type WatcherPidRegistry = Record<string, WatcherPidEntry>;

/** Stable registry key for one project's named watcher. */
export function watcherPidKey(project: string, watcherName: string): string {
  return `${project}:${watcherName}`;
}

/**
 * Loads the registry from disk. Missing, corrupt, or partially-written
 * (e.g. truncated by a segfault mid-write) files degrade to an empty
 * registry rather than throwing — a bad sidecar file must never block fleet
 * boot.
 */
export function loadWatcherPidRegistry(path: string): WatcherPidRegistry {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as WatcherPidRegistry;
    }
  } catch {
    // Corrupt/partial write — treat as empty. A stale registry we can't
    // trust is not worth crashing boot over.
  }
  return {};
}

/** Best-effort persistence — never throws, never blocks fleet boot. */
export function saveWatcherPidRegistry(path: string, registry: WatcherPidRegistry): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(registry, null, 2));
  } catch {
    // Best-effort only. Worst case: the next boot's sweep misses an entry.
  }
}

export interface SweepResult {
  /** The registry with this project's entries cleared (killed, unconfirmed, or already dead — they're stale either way). */
  registry: WatcherPidRegistry;
  killed: Array<{ key: string; pid: number }>;
  /**
   * Entries whose PID was alive but whose live command line did NOT match
   * the stored exec snippet (or had none to compare, e.g. an old-format
   * registry entry) — almost certainly the OS recycled this PID onto an
   * unrelated process since the watcher child died. NOT killed. Report
   * these so the caller can warn instead of silently doing nothing.
   */
  unconfirmed: Array<{ key: string; pid: number }>;
}

/**
 * Matches `--exec` as a whole flag token — preceded by start-of-string or
 * whitespace, followed by end-of-string or whitespace — so it cannot match
 * a PREFIX like `--execute` or `--exec-path` (2nd Copilot review round,
 * PR #879: `indexOf('--exec')` matched those too, silently weakening the
 * "must have --exec as a real flag" guarantee this function exists to add).
 */
const EXEC_FLAG_TOKEN_RE = /(^|\s)--exec(\s|$)/;

/**
 * Confirms a live command line is actually a `pd watch <channel> --exec
 * <execSnippet>` invocation, not just any process that happens to contain
 * the exec fragment as a substring.
 *
 * A bare `cmdline.includes(execSnippet)` check (the original implementation)
 * is too loose for short or generic exec strings — e.g. an execSnippet of
 * `"say hi"` could false-positive-match some unrelated process whose own
 * arguments happen to contain that text, especially after PID reuse (Copilot
 * review on PR #879). Requiring the invocation shape too (`watch` as a
 * token, `--exec` as an EXACT flag token — not a prefix like `--execute` —
 * AND the snippet appearing after `--exec`) makes a coincidental substring
 * match far less likely without needing to know the exact `pd`/`port-daddy`
 * binary path (which varies: dev checkout, Homebrew keg, `bun build
 * --compile` output, etc).
 */
export function looksLikeWatchExecInvocation(cmdline: string, execSnippet: string): boolean {
  const execFlagMatch = EXEC_FLAG_TOKEN_RE.exec(cmdline);
  if (!execFlagMatch) return false;
  // match.index is where the captured leading char (or start-of-string)
  // begins; skip past it to land exactly at the start of "--exec" itself.
  const execFlagStart = execFlagMatch.index + execFlagMatch[1].length;
  // The snippet must appear AFTER the --exec flag (it's that flag's own
  // argument), not merely somewhere earlier in the command line.
  const afterExecFlag = cmdline.slice(execFlagStart + '--exec'.length);
  if (!afterExecFlag.includes(execSnippet)) return false;
  // `watch` must appear as a whole token before --exec (the subcommand),
  // not as a substring of some other word.
  const beforeExecFlag = cmdline.slice(0, execFlagStart);
  return /(^|\s)watch(\s|$)/.test(beforeExecFlag);
}

/**
 * Pure over its injected `getCommandLine`/`kill` collaborators so it is unit
 * testable without touching real PIDs or shelling out to `ps`.
 *
 * Kills a registry entry only when BOTH: (1) its key belongs to `project`,
 * and (2) `getCommandLine(pid)` returns a live command line that actually
 * looks like the `pd watch --exec <execSnippet>` invocation recorded at
 * spawn time (see looksLikeWatchExecInvocation) — confirming the PID still
 * refers to the same watcher child, not some unrelated process the OS
 * recycled that PID onto since the original child died. `getCommandLine`
 * returning `null` means the PID is already dead (nothing to kill); a
 * non-matching command line means the identity could not be confirmed, so
 * the entry is reported as `unconfirmed` and left alone rather than risking
 * `process.kill(-pid, ...)` on a stranger's process group. An entry with no
 * stored `execSnippet` at all (pre-dates this field) can never be confirmed
 * and is always treated as unconfirmed when alive.
 *
 * All of this project's entries are dropped from the returned registry
 * either way — fresh ones get written back in as `startWatcher` spawns new
 * children. Entries for OTHER projects are left untouched — several
 * projects' fleets can share one daemon process.
 *
 * ```ts
 * const reg = { 'demo:notify': { pid: 123, startedAt: 1, execSnippet: 'say hi' } };
 * sweepStaleWatcherPids(reg, 'demo', () => 'pd watch x --exec "say hi"', () => {}).killed.length
 * // => 1
 * sweepStaleWatcherPids(reg, 'demo', () => 'some-unrelated-process --flag', () => {}).unconfirmed.length
 * // => 1
 * ```
 */
export function sweepStaleWatcherPids(
  registry: WatcherPidRegistry,
  project: string,
  getCommandLine: (pid: number) => string | null,
  kill: (pid: number) => void,
): SweepResult {
  const prefix = `${project}:`;
  const next: WatcherPidRegistry = {};
  const killed: Array<{ key: string; pid: number }> = [];
  const unconfirmed: Array<{ key: string; pid: number }> = [];
  for (const [key, entry] of Object.entries(registry)) {
    if (!key.startsWith(prefix)) {
      next[key] = entry;
      continue;
    }
    const cmdline = getCommandLine(entry.pid);
    if (cmdline === null) {
      // Already dead — nothing to kill, nothing to warn about.
      continue;
    }
    if (entry.execSnippet && looksLikeWatchExecInvocation(cmdline, entry.execSnippet)) {
      kill(entry.pid);
      killed.push({ key, pid: entry.pid });
    } else {
      unconfirmed.push({ key, pid: entry.pid });
    }
  }
  return { registry: next, killed, unconfirmed };
}

/**
 * Real command-line lookup via `ps`. Returns `null` when the PID has no
 * running process (already dead) or `ps` itself fails; returns the process's
 * command line string when it's alive, for sweepStaleWatcherPids to compare
 * against a stored exec snippet before killing it.
 */
export function getCommandLineForPid(pid: number): string | null {
  try {
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 3000,
    });
    if (result.status !== 0) return null;
    const out = (result.stdout || '').trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
