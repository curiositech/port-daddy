/**
 * Daemon-side mtime/hash watcher for claimed files.
 *
 * Reactive — but bulletproof. Periodically hashes every file currently
 * claimed by an active session. When the hash changes within the claim
 * window, the watcher:
 *
 *   1. Snapshots the *prior* content to ~/.port-daddy/snapshots/<sessionId>/<sha>/<path>
 *   2. DMs the claim-holder via the agent inbox with the snapshot path
 *   3. Records the violation as a notes-tier audit entry (best-effort)
 *
 * Doesn't prevent the loss; gives one-command rollback. Designed to be
 * cheap (sha256 over current file bytes, not a content diff) and
 * idempotent (re-hashing a file that hasn't changed is a no-op).
 *
 * Closes the second hole in
 * `.spark/feedback/2026-04-28-claims-steamrolled-by-git-reset-hard.md`:
 *
 *   > "Daemon-side mtime/hash watcher on claimed files. Reactive but
 *   >  cheap. When a claimed file's hash changes mid-claim, daemon
 *   >  snapshots the prior content to ~/.port-daddy/snapshots/<sessionId>/<path>
 *   >  and DMs the claim-holder. Doesn't prevent the loss; gives
 *   >  one-command rollback."
 */

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_INTERVAL_MS = 5_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface ClaimWatcherDeps {
  /** Returns the current set of active claims across all sessions. */
  listClaims: () => Array<{ filePath: string; sessionId: string; agentId?: string | null }>;
  /** Sends a message to an agent's inbox. Best-effort. */
  sendInbox?: (agentId: string, content: unknown, options?: { from?: string; type?: string }) => unknown;
  /** Adds a daemon note. Best-effort. */
  addNote?: (sessionId: string, note: { content: string; type?: string }) => unknown;
  /** Roots used to resolve relative claim paths. The first root that contains the file wins. */
  searchRoots?: string[];
  /** Override for the snapshot directory. Default: ~/.port-daddy/snapshots */
  snapshotDir?: string;
  /** Override for periodic interval. Default: 5000ms */
  intervalMs?: number;
  /** Logger. Default: console.error for warnings only. */
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface ClaimWatcherStatus {
  running: boolean;
  watchedCount: number;
  lastTickAt: number | null;
  changesDetected: number;
  snapshotsWritten: number;
}

interface FileFingerprint {
  filePath: string;
  absPath: string;
  sessionId: string;
  agentId: string | null;
  hash: string;
  size: number;
  content: Buffer | null;
  observedAt: number;
}

function safeFingerprint(absPath: string): { hash: string; size: number; content: Buffer | null } | null {
  try {
    const buf = readFileSync(absPath);
    if (buf.length > MAX_FILE_BYTES) return { hash: 'oversize', size: buf.length, content: null };
    return { hash: createHash('sha256').update(buf).digest('hex'), size: buf.length, content: Buffer.from(buf) };
  } catch {
    return null;
  }
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function defaultSnapshotDir(): string {
  return join(homedir(), '.port-daddy', 'snapshots');
}

function resolveAbs(filePath: string, roots: string[]): string | null {
  if (isAbsolute(filePath) && existsSync(filePath)) return filePath;
  for (const root of roots) {
    const candidate = resolve(root, filePath);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function snapshotKey(filePath: string): string {
  // Keep the original path but make it filesystem-safe by replacing path
  // separators with __. Reversible by inspection, no clobbering across sessions
  // because each session gets its own dir.
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\//g, '__');
}

/**
 * Build a fresh fingerprint snapshot of every claimed file. This is the
 * "before" picture against which the next tick is diffed.
 */
function snapshotClaims(deps: ClaimWatcherDeps, roots: string[]): Map<string, FileFingerprint> {
  const out = new Map<string, FileFingerprint>();
  const claims = deps.listClaims();
  for (const claim of claims) {
    if (!claim?.filePath || !claim?.sessionId) continue;
    const absPath = resolveAbs(claim.filePath, roots);
    if (!absPath) continue;
    const fp = safeFingerprint(absPath);
    if (!fp) continue;
    const key = `${claim.sessionId}\0${claim.filePath}`;
    out.set(key, {
      filePath: claim.filePath,
      absPath,
      sessionId: claim.sessionId,
      agentId: claim.agentId ?? null,
      hash: fp.hash,
      size: fp.size,
      content: fp.content,
      observedAt: Date.now(),
    });
  }
  return out;
}

function writeSnapshot(snapshotDir: string, prior: FileFingerprint, content: Buffer): string {
  const sessionDir = join(snapshotDir, prior.sessionId);
  ensureDir(sessionDir);
  const filename = `${Date.now()}-${prior.hash.slice(0, 12)}-${snapshotKey(prior.filePath)}`;
  const target = join(sessionDir, filename);
  writeFileSync(target, content);
  // Also drop a manifest line so a single grep recovers context.
  const manifestPath = join(sessionDir, 'manifest.jsonl');
  const line = JSON.stringify({
    sessionId: prior.sessionId,
    agentId: prior.agentId,
    filePath: prior.filePath,
    snapshotPath: target,
    priorHash: prior.hash,
    priorBytes: prior.size,
    snapshotAt: new Date().toISOString(),
  }) + '\n';
  try {
    appendFileSync(manifestPath, line);
  } catch {
    // best-effort
  }
  return target;
}

export function createClaimWatcher(deps: ClaimWatcherDeps) {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const snapshotDir = deps.snapshotDir ?? defaultSnapshotDir();
  const roots = (deps.searchRoots && deps.searchRoots.length > 0) ? deps.searchRoots : [process.cwd()];
  const log = deps.log ?? ((msg, meta) => console.error(`[claim-watcher] ${msg}`, meta || ''));

  let interval: ReturnType<typeof setInterval> | null = null;
  let lastSnapshot: Map<string, FileFingerprint> = new Map();
  const stats: ClaimWatcherStatus = {
    running: false,
    watchedCount: 0,
    lastTickAt: null,
    changesDetected: 0,
    snapshotsWritten: 0,
  };

  /** One pass: hash every active claim, diff vs last pass, snapshot+notify on change. */
  function tick(): void {
    stats.lastTickAt = Date.now();
    const next = snapshotClaims(deps, roots);
    stats.watchedCount = next.size;

    // For each entry that existed last tick AND this tick, compare hashes.
    for (const [key, current] of next) {
      const prior = lastSnapshot.get(key);
      if (!prior) continue;
      if (prior.hash === current.hash) continue;

      stats.changesDetected += 1;
      let snapshotPath: string | null = null;
      if (prior.content) {
        try {
          snapshotPath = writeSnapshot(snapshotDir, prior, prior.content);
          stats.snapshotsWritten += 1;
        } catch (err) {
          log(`failed to snapshot ${prior.absPath}`, { error: (err as Error).message });
        }
      } else {
        log(`skipping prior snapshot for oversize claim ${prior.absPath}`, { bytes: prior.size });
      }

      const message = `Your claim on ${current.filePath} (session ${current.sessionId.slice(0, 12)}) detected a content change.\n` +
        `prior hash: ${prior.hash.slice(0, 12)}, current hash: ${current.hash.slice(0, 12)}\n` +
        (snapshotPath ? `prior bytes snapshotted to: ${snapshotPath}\n` : '') +
        `If this was not you, another session may have edited or reset your file.`;

      if (current.agentId && deps.sendInbox) {
        try {
          deps.sendInbox(current.agentId, message, { from: 'claim-watcher', type: 'claim_violation' });
        } catch (err) {
          log('failed to DM claim-holder', { error: (err as Error).message });
        }
      }

      if (deps.addNote) {
        try {
          deps.addNote(current.sessionId, {
            content: `claim-watcher: ${current.filePath} content hash changed mid-claim`,
            type: 'warning',
          });
        } catch {
          // best-effort
        }
      }
    }

    lastSnapshot = next;
  }

  return {
    start(): void {
      if (interval) return;
      lastSnapshot = snapshotClaims(deps, roots);
      stats.watchedCount = lastSnapshot.size;
      interval = setInterval(tick, intervalMs);
      // Don't keep the daemon process alive on the watcher alone.
      if (typeof interval.unref === 'function') interval.unref();
      stats.running = true;
    },
    stop(): void {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
      stats.running = false;
    },
    /** Run one tick synchronously. Used by tests and `pd guard scan` callers. */
    tickOnce(): void {
      tick();
    },
    status(): ClaimWatcherStatus {
      return { ...stats };
    },
  };
}
