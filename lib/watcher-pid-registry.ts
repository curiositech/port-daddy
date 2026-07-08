/**
 * Watcher PID registry — closes the "external `pd watch --exec` children
 * survive a daemon crash" gap named in AGENTS.md:
 *
 *   "Daemon-owned YAML watchers must use in-process messaging subscriptions.
 *    A stable daemon spawning long-lived `pd watch ... --exec` children for
 *    its own watchers is a regression: those children can survive daemon
 *    restart, reconnect-storm SSE, and poison Bosun heartbeat truth."
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

export interface WatcherPidEntry {
  pid: number;
  startedAt: number;
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
  /** The registry with this project's entries cleared (killed or not — they're stale either way). */
  registry: WatcherPidRegistry;
  killed: Array<{ key: string; pid: number }>;
}

/**
 * Pure over its injected `isAlive`/`kill` collaborators so it is unit
 * testable without touching real PIDs.
 *
 * Kills any registry entry whose key belongs to `project` and is still
 * alive, then drops all of that project's entries from the returned
 * registry (fresh ones get written back in as `startWatcher` spawns new
 * children). Entries for OTHER projects are left untouched — several
 * projects' fleets can share one daemon process.
 *
 * ```ts
 * sweepStaleWatcherPids({ 'demo:notify': { pid: 123, startedAt: 1 } }, 'demo', () => true, () => {}).killed.length
 * // => 1
 * ```
 */
export function sweepStaleWatcherPids(
  registry: WatcherPidRegistry,
  project: string,
  isAlive: (pid: number) => boolean,
  kill: (pid: number) => void,
): SweepResult {
  const prefix = `${project}:`;
  const next: WatcherPidRegistry = {};
  const killed: Array<{ key: string; pid: number }> = [];
  for (const [key, entry] of Object.entries(registry)) {
    if (!key.startsWith(prefix)) {
      next[key] = entry;
      continue;
    }
    if (isAlive(entry.pid)) {
      kill(entry.pid);
      killed.push({ key, pid: entry.pid });
    }
  }
  return { registry: next, killed };
}

/** Real liveness check: `process.kill(pid, 0)` throws iff the PID is dead/foreign. */
export function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
