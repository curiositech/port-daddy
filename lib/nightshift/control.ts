/**
 * Nightshift control surface -- enable/disable/halt/status.
 *
 * State lives in two places:
 *   1. `~/.pd/nightshift-disabled` -- a flag file. When present, the runner
 *      refuses to start ANY new spawn. Operator-controlled kill-switch.
 *   2. The nightshift_intents table -- queried for `running` intents to
 *      surface status and to find SIGTERM targets.
 *
 * Why a flag file and not a DB row: when the operator types
 * `pd nightshift disable` at 2am because something is on fire, that command
 * MUST work even if the daemon is wedged. A POSIX `touch` requires zero
 * infrastructure. The runner reads the flag at the start of each tick.
 *
 * Halt semantics: we SIGTERM (not SIGKILL). The spawn's own cleanup runs,
 * the queue row transitions to `aborted`, and the transcript is preserved.
 * If the operator wants nuclear, `pd nightshift halt --kill` sends SIGKILL.
 *
 * PID provenance: the runner is expected to write each spawn's child PID
 * into the queue row's `sessionId` field (re-purposing -- a v2 schema would
 * add a dedicated `child_pid` column). When sessionId is `pending-<id>` we
 * have nothing to halt; the spawn never got off the ground.
 */

import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { NightshiftIntent, NightshiftQueue } from './queue.js';

/**
 * State dir resolution.
 *
 * Resolved lazily so tests can swap `process.env.HOME` or `PD_STATE_DIR`
 * between tests without bouncing the module. Production callers see the
 * same paths because `homedir()` is stable across the process lifetime.
 *
 * Override priority:
 *   1. `process.env.PD_STATE_DIR` (test/integration override)
 *   2. `process.env.HOME` -> `<HOME>/.pd` (the production path)
 *   3. `homedir()` -> `<HOME>/.pd` (fallback if HOME is unset)
 */
export function pdStateDir(): string {
  if (process.env.PD_STATE_DIR) return process.env.PD_STATE_DIR;
  const home = process.env.HOME ?? homedir();
  return join(home, '.pd');
}

export function disabledFlagPath(): string {
  return join(pdStateDir(), 'nightshift-disabled');
}

export function pidFileDir(): string {
  return join(pdStateDir(), 'nightshift-pids');
}

// Back-compat constants (resolved at module load; production code paths)
export const PD_STATE_DIR = pdStateDir();
export const DISABLED_FLAG_PATH = disabledFlagPath();
export const PID_FILE_DIR = pidFileDir();

export interface DisableInfo {
  disabled: boolean;
  flagPath: string;
  /** ISO timestamp when the flag was written, or null if not disabled. */
  disabledAt: string | null;
  /** Operator-provided reason, or null. */
  reason: string | null;
}

export function ensureStateDir(): void {
  const dir = pdStateDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function readDisableState(): DisableInfo {
  const flagPath = disabledFlagPath();
  if (!existsSync(flagPath)) {
    return { disabled: false, flagPath, disabledAt: null, reason: null };
  }
  let disabledAt: string | null = null;
  let reason: string | null = null;
  try {
    const st = statSync(flagPath);
    disabledAt = new Date(st.mtimeMs).toISOString();
  } catch {
    /* ignore */
  }
  try {
    const body = readFileSync(flagPath, 'utf8').trim();
    if (body) reason = body;
  } catch {
    /* ignore */
  }
  return { disabled: true, flagPath, disabledAt, reason };
}

export function disableNightshift(reason?: string | null): DisableInfo {
  ensureStateDir();
  const body = reason ? reason + '\n' : `disabled by operator at ${new Date().toISOString()}\n`;
  writeFileSync(disabledFlagPath(), body, { mode: 0o644 });
  return readDisableState();
}

export function enableNightshift(): DisableInfo {
  const flagPath = disabledFlagPath();
  if (existsSync(flagPath)) {
    unlinkSync(flagPath);
  }
  return readDisableState();
}

export interface PidRecord {
  intentId: string;
  pid: number;
  startedAt: number;
}

/**
 * Record a spawn PID for halt-by-id lookup. The runner calls this once the
 * child process is up. We use a per-intent file so concurrent spawns don't
 * race on a shared registry.
 */
export function recordSpawnPid(intentId: string, pid: number, now: () => number = Date.now): void {
  ensureStateDir();
  const dir = pidFileDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const rec: PidRecord = { intentId, pid, startedAt: now() };
  writeFileSync(join(dir, `${intentId}.json`), JSON.stringify(rec), { mode: 0o644 });
}

export function clearSpawnPid(intentId: string): void {
  const p = join(pidFileDir(), `${intentId}.json`);
  if (existsSync(p)) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

export function readSpawnPid(intentId: string): PidRecord | null {
  const p = join(pidFileDir(), `${intentId}.json`);
  if (!existsSync(p)) return null;
  try {
    const body = readFileSync(p, 'utf8');
    const parsed = JSON.parse(body) as PidRecord;
    if (typeof parsed.pid !== 'number' || !Number.isFinite(parsed.pid)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface HaltResult {
  intentId: string;
  pid: number | null;
  signaled: boolean;
  signal: 'SIGTERM' | 'SIGKILL' | null;
  /** True if the process was already gone when we tried to signal. */
  alreadyGone: boolean;
  error: string | null;
}

export interface HaltOptions {
  /** Use SIGKILL instead of SIGTERM. Default false. */
  kill?: boolean;
  /** Override process.kill for testing. Receives (pid, signal) and may throw. */
  killFn?: (pid: number, signal: NodeJS.Signals) => void;
  /** Override the queue mark function (testing). */
  markAborted?: (intentId: string, reason: string) => void;
}

function defaultKillFn(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal);
}

/**
 * Halt a single intent. Returns a structured result so callers can render
 * a meaningful message and so tests can assert without parsing output.
 */
export function haltIntent(
  queue: NightshiftQueue,
  intentId: string,
  opts: HaltOptions = {},
): HaltResult {
  const killFn = opts.killFn ?? defaultKillFn;
  const signal: 'SIGTERM' | 'SIGKILL' = opts.kill ? 'SIGKILL' : 'SIGTERM';
  const pidRec = readSpawnPid(intentId);
  const intent = queue.get(intentId);
  if (!intent) {
    return {
      intentId,
      pid: null,
      signaled: false,
      signal: null,
      alreadyGone: false,
      error: `intent ${intentId} not found`,
    };
  }
  if (intent.status !== 'running') {
    return {
      intentId,
      pid: pidRec?.pid ?? null,
      signaled: false,
      signal: null,
      alreadyGone: true,
      error: `intent is not running (status=${intent.status})`,
    };
  }
  if (!pidRec) {
    // We have no PID -- best we can do is mark the queue row aborted so the
    // intent doesn't sit in `running` forever.
    if (opts.markAborted) {
      opts.markAborted(intentId, 'halted: no pid recorded');
    } else {
      queue.markComplete({
        id: intentId,
        status: 'aborted',
        errorMessage: 'halted by operator: no PID recorded',
      });
    }
    return {
      intentId,
      pid: null,
      signaled: false,
      signal: null,
      alreadyGone: true,
      error: 'no PID recorded; queue row marked aborted',
    };
  }
  try {
    killFn(pidRec.pid, signal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ESRCH/i.test(msg)) {
      // Already gone. Clean up the PID file and mark aborted.
      clearSpawnPid(intentId);
      if (opts.markAborted) {
        opts.markAborted(intentId, 'halted: process already gone');
      } else {
        queue.markComplete({
          id: intentId,
          status: 'aborted',
          errorMessage: 'halted by operator: process already exited',
        });
      }
      return {
        intentId,
        pid: pidRec.pid,
        signaled: false,
        signal: null,
        alreadyGone: true,
        error: null,
      };
    }
    return {
      intentId,
      pid: pidRec.pid,
      signaled: false,
      signal: null,
      alreadyGone: false,
      error: msg,
    };
  }
  // Signal delivered. We do NOT mark the queue row complete here -- the spawn
  // adapter's exit handler is responsible for that. Marking it here would
  // race with the adapter and clobber its result. If the adapter is gone
  // (i.e. we orphaned the spawn somehow), the next runner tick can sweep.
  return {
    intentId,
    pid: pidRec.pid,
    signaled: true,
    signal,
    alreadyGone: false,
    error: null,
  };
}

export interface HaltAllResult {
  total: number;
  results: HaltResult[];
}

export function haltAll(queue: NightshiftQueue, opts: HaltOptions = {}): HaltAllResult {
  const running = queue.list({ status: 'running' });
  const results: HaltResult[] = [];
  for (const intent of running) {
    results.push(haltIntent(queue, intent.id, opts));
  }
  return { total: running.length, results };
}

export interface NightshiftStatusEntry {
  intentId: string;
  slug: string;
  status: string;
  pid: number | null;
  startedAt: number | null;
  elapsedMs: number | null;
  budgetUsd: number | null;
  costSoFarUsd: number | null;
  timeRemainingMs: number | null;
  worktreePath: string | null;
  branchName: string | null;
}

export interface NightshiftStatusReport {
  disabled: DisableInfo;
  active: NightshiftStatusEntry[];
  recentTerminal: NightshiftStatusEntry[];
}

/**
 * Produce a status snapshot suitable for `pd nightshift status`. Returns the
 * disabled flag info, the currently running spawns (with PID + elapsed + budget
 * remaining when computable), and the most recent N terminal intents.
 */
export function getStatusReport(
  queue: NightshiftQueue,
  opts: { recentLimit?: number; now?: () => number } = {},
): NightshiftStatusReport {
  const now = opts.now ?? Date.now;
  const recentLimit = opts.recentLimit ?? 5;
  const running = queue.list({ status: 'running' });
  const active: NightshiftStatusEntry[] = running.map((i) => entryFor(i, now()));
  const terminal = queue.list({ status: 'terminal', limit: recentLimit });
  const recent: NightshiftStatusEntry[] = terminal.map((i) => entryFor(i, now()));
  return {
    disabled: readDisableState(),
    active,
    recentTerminal: recent,
  };
}

function entryFor(intent: NightshiftIntent, now: number): NightshiftStatusEntry {
  const pidRec = readSpawnPid(intent.id);
  const startedAt = intent.startedAt ?? null;
  const elapsedMs = startedAt != null ? now - startedAt : null;
  const timeoutMs = intent.timeoutMs ?? null;
  const timeRemainingMs = startedAt != null && timeoutMs != null
    ? Math.max(0, timeoutMs - (now - startedAt))
    : null;
  return {
    intentId: intent.id,
    slug: intent.slug,
    status: intent.status,
    pid: pidRec?.pid ?? null,
    startedAt,
    elapsedMs,
    budgetUsd: intent.budgetUsd,
    costSoFarUsd: intent.costUsd,
    timeRemainingMs,
    worktreePath: intent.worktreePath,
    branchName: intent.branchName,
  };
}
