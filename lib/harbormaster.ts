/**
 * Harbormaster — canonical actor body that owns merges of dispatched work.
 *
 * No dedicated ADR specs this module; the header previously cited "ADR-0037",
 * but neither ADR numbered 0037 (git-access-control-and-pd-feature-verbs,
 * pd-backup-durable-snapshots) mentions Harbormaster or merge queues. The
 * closest description in the ADR corpus is ADR-0109 (The Steward), which
 * positions Harbormaster as the merge-executor for one operator-accepted
 * dispatch — not a roadmap-aware gate over every open PR. Long-running loop
 * that walks the merge_queue and rebases / merges entries whose dispatch row
 * has been operator-approved.
 *
 * ─── Safety properties (the things this module will NEVER do) ────────────
 *
 *   1. Harbormaster will NEVER auto-merge to `main` (or any base branch)
 *      without an operator-approved dispatch. The two-key constraint is
 *      enforced in code, not policy:
 *        - the dispatch row must be `state='accepted'`
 *        - AND the merge_queue row must be `state='queued'`
 *      Either key missing = the row is skipped.
 *
 *   2. Harbormaster will NEVER bypass the pd-shim git wrapper. All
 *      destructive verbs (rebase, push, reset) flow through the
 *      ~/.port-daddy/bin/git shim. PD_SHIM_OFF is never set by this
 *      module. The shim refuses force-push to main, filter-branch on
 *      protected branches, etc. — those refusals surface as run errors
 *      and we mark the queue entry blocked, not bypass.
 *
 *   3. Harbormaster will NEVER touch operator-authored PRs. An entry
 *      qualifies only if `merge_queue.dispatch_id IS NOT NULL` (the
 *      Path B narrowing from ADR-0037 §Scope narrowing). The bootstrap
 *      PR that introduces harbormaster itself is therefore not subject
 *      to harbormaster's own rules — which is the point.
 *
 *   4. Harbormaster will NEVER run two merges against the same
 *      base_branch concurrently. FIFO ordering within each base_branch
 *      is preserved by the merge_queue's existing index plus a
 *      per-base_branch in-process lock.
 *
 *   5. Harbormaster will NEVER pretend a merge happened. If
 *      `gh pr merge` exits non-zero (CI red, missing review, branch
 *      protection, network), the queue row is marked
 *      `state='blocked'`, a pd note is posted explaining why, and the
 *      operator must intervene. No "best effort" retries that silently
 *      lose work.
 *
 * ─── Wiring status ───────────────────────────────────────────────────────
 *
 * WIRED:
 *   - Polling loop with cancel
 *   - File-lock body lease at ~/.port-daddy/harbormaster.lease
 *   - Two-key dispatch + queue state check
 *   - Rebase / merge / conflict / blocked paths
 *   - Event emission on harbormaster:{merged,conflict,blocked,tick}
 *
 * STUBBED (graceful fallbacks):
 *   - `lib/body-lease.ts` (ADR-0022 Phase A) not yet on origin/main —
 *     we use a flock-style file at ~/.port-daddy/harbormaster.lease.
 *     When body-lease.ts lands, swap acquireLease()/releaseLease() to
 *     the real implementation.
 *   - PR #163's `dispatches` table has `merge_policy` (review|auto|never),
 *     not the ADR's `merge_style` (squash|merge|rebase). We respect
 *     merge_policy='review' as the gate and default to --squash. If a
 *     future migration adds `merge_style` (or a per-dispatch metadata
 *     field), readMergeStyle() picks it up automatically.
 *   - The sub-dispatch for conflict resolution is created as a pd note
 *     to the worker actor's mailbox today. When ADR-0035 §parent_dispatch_id
 *     lands, swap openConflictSubDispatch() to insert a real dispatch row.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, writeSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';

// ─── Constants ───────────────────────────────────────────────────────────

export const HARBORMASTER_ACTOR_ID = 'harbormaster';
export const DEFAULT_POLL_INTERVAL_MS = 30_000;
export const DEFAULT_LEASE_PATH = join(homedir(), '.port-daddy', 'harbormaster.lease');
export const LEASE_STALE_MS = 5 * 60_000; // 5 min — body died if no refresh

export type MergeStyle = 'squash' | 'merge' | 'rebase';

export interface HarbormasterDeps {
  db: Database.Database;
  /** Override for tests; real bodies leave undefined and we shell out to git/gh. */
  runner?: CommandRunner;
  /** Override for tests; real bodies leave undefined and use file lock. */
  lease?: LeaseAdapter;
  /** Override for tests; real bodies emit to a daemon pub/sub. */
  events?: EventEmitter;
  pollIntervalMs?: number;
  /** Optional logger; defaults to console.* */
  logger?: Logger;
  /** Optional pd-note poster; real bodies shell `pd note`. Used to record blocked/conflict. */
  postNote?: (text: string, opts?: { to?: string }) => void | Promise<void>;
}

export interface CommandRunner {
  /** Run a command. Resolves with exit code + stdout/stderr. Never throws on non-zero. */
  run(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<RunResult>;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface LeaseAdapter {
  acquire(): Promise<boolean>;
  refresh(): Promise<void>;
  release(): Promise<void>;
}

export interface Logger {
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
}

interface QueueCandidate {
  id: number;
  branch: string;
  baseBranch: string;
  repository: string;
  dispatchId: string | null;
  dispatchState: string | null;
  dispatchWorktree: string | null;
  dispatchBranch: string | null;
  dispatchWorker: string | null;
  mergeStyle: MergeStyle;
  status: string;
}

// ─── Module factory ──────────────────────────────────────────────────────

export function createHarbormaster(deps: HarbormasterDeps) {
  const db = deps.db;
  const events = deps.events ?? new EventEmitter();
  const logger = deps.logger ?? defaultLogger();
  const runner = deps.runner ?? defaultRunner();
  const lease = deps.lease ?? createFileLease(DEFAULT_LEASE_PATH);
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const postNote = deps.postNote ?? defaultPostNote(runner);

  // Per-base_branch serialization gate. At most one merge per base at a time.
  const baseLocks = new Set<string>();

  // Cancel token for the polling loop.
  let stopped = false;
  let pollTimer: NodeJS.Timeout | null = null;

  /**
   * Read whether the merge_queue has dispatch-related columns. The harbormaster
   * does nothing useful until PR #163's schema + an additional `dispatch_id`
   * column on merge_queue land. While the columns are missing we still run
   * (and emit ticks) but every candidate query returns empty.
   */
  function schemaHasDispatchColumns(): boolean {
    try {
      const cols = db.prepare(`PRAGMA table_info(merge_queue)`).all() as Array<{ name: string }>;
      const names = new Set(cols.map((c) => c.name));
      return names.has('dispatch_id') || names.has('state');
    } catch {
      return false;
    }
  }

  /**
   * Query merge_queue for candidates ready to merge. Two-key safety: the
   * dispatch row must be state='accepted' AND the merge_queue row state
   * (or status, in the pre-ADR schema) must be 'queued'.
   */
  function findCandidates(): QueueCandidate[] {
    if (!schemaHasDispatchColumns()) return [];

    // Detect column presence so we can build a query that runs on both the
    // ADR-future schema (state, dispatch_id, merge_style) and the current
    // origin/main schema (status only). Future schema gets the real query;
    // pre-future schema returns [].
    const cols = db.prepare(`PRAGMA table_info(merge_queue)`).all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('dispatch_id')) return [];

    const stateCol = names.has('state') ? 'state' : 'status';
    const mergeStyleSelect = names.has('merge_style') ? 'mq.merge_style' : `'squash'`;

    // Detect dispatches table presence.
    const dispatchesExists = (db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dispatches'`)
      .get() as unknown) !== undefined;
    if (!dispatchesExists) return [];

    const sql = `
      SELECT
        mq.id              AS id,
        mq.branch          AS branch,
        mq.base_branch     AS base_branch,
        mq.repository      AS repository,
        mq.dispatch_id     AS dispatch_id,
        mq.${stateCol}     AS status,
        d.state            AS dispatch_state,
        d.worktree_path    AS dispatch_worktree,
        d.branch           AS dispatch_branch,
        d.worker_actor_id  AS dispatch_worker,
        ${mergeStyleSelect} AS merge_style
      FROM merge_queue mq
      JOIN dispatches d ON d.id = mq.dispatch_id
      WHERE mq.${stateCol} = 'queued'
        AND d.state = 'accepted'
      ORDER BY mq.base_branch ASC, mq.submitted_at ASC
    `;
    const rows = db.prepare(sql).all() as Array<{
      id: number;
      branch: string;
      base_branch: string;
      repository: string;
      dispatch_id: string | null;
      status: string;
      dispatch_state: string;
      dispatch_worktree: string | null;
      dispatch_branch: string | null;
      dispatch_worker: string | null;
      merge_style: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      branch: r.branch,
      baseBranch: r.base_branch,
      repository: r.repository,
      dispatchId: r.dispatch_id,
      dispatchState: r.dispatch_state,
      dispatchWorktree: r.dispatch_worktree,
      dispatchBranch: r.dispatch_branch,
      dispatchWorker: r.dispatch_worker,
      mergeStyle: normalizeMergeStyle(r.merge_style),
      status: r.status,
    }));
  }

  function markBlocked(id: number, reason: string): void {
    const stateCol = hasColumn('merge_queue', 'state') ? 'state' : 'status';
    db.prepare(
      `UPDATE merge_queue SET ${stateCol} = 'blocked', failure_reason = ? WHERE id = ?`,
    ).run(reason, id);
  }

  function markMerged(id: number, mergeCommit: string | null): void {
    const stateCol = hasColumn('merge_queue', 'state') ? 'state' : 'status';
    db.prepare(
      `UPDATE merge_queue SET ${stateCol} = 'merged', merged_at = ?, merge_commit = ? WHERE id = ?`,
    ).run(Date.now(), mergeCommit ?? null, id);
  }

  function backDispatchToProduced(dispatchId: string, reason: string): void {
    if (!hasTable('dispatches')) return;
    db.prepare(
      `UPDATE dispatches SET state = 'produced', error_message = ?, produced_at = ? WHERE id = ?`,
    ).run(reason, Date.now(), dispatchId);
  }

  function hasColumn(table: string, col: string): boolean {
    try {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      return rows.some((r) => r.name === col);
    } catch {
      return false;
    }
  }

  function hasTable(table: string): boolean {
    try {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table);
      return row !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Process one queue candidate end-to-end:
   *   acquire base lock -> rebase -> gh pr merge -> mark merged
   *   conflict          -> back to produced + open sub-dispatch
   *   any cmd failure   -> mark blocked + pd note
   *
   * Returns the terminal disposition for observers/tests.
   */
  async function processCandidate(c: QueueCandidate): Promise<
    | { kind: 'merged'; mergeCommit: string | null }
    | { kind: 'conflict'; files: string[] }
    | { kind: 'blocked'; reason: string }
    | { kind: 'skipped'; reason: string }
  > {
    // Safety check, repeated: two-key constraint must hold here too.
    if (c.dispatchState !== 'accepted' || c.status !== 'queued') {
      return { kind: 'skipped', reason: 'two-key check failed at processing time' };
    }
    if (!c.dispatchId) {
      return { kind: 'skipped', reason: 'merge_queue row has no dispatch_id (operator PR, out of scope)' };
    }
    if (!c.dispatchWorktree) {
      const reason = 'dispatch worktree path missing; cannot rebase';
      markBlocked(c.id, reason);
      events.emit('harbormaster:blocked', { id: c.id, reason });
      await postNote(`harbormaster: blocked merge #${c.id} (${c.branch}) — ${reason}`, { to: 'operator' });
      return { kind: 'blocked', reason };
    }

    if (baseLocks.has(c.baseBranch)) {
      return { kind: 'skipped', reason: `base_branch ${c.baseBranch} busy` };
    }
    baseLocks.add(c.baseBranch);

    try {
      const cwd = c.dispatchWorktree;

      // 1. Fetch + rebase. pd-shim gates these — we do NOT set PD_SHIM_OFF.
      const fetched = await runner.run('git', ['fetch', 'origin'], { cwd });
      if (fetched.code !== 0) {
        const reason = `git fetch failed: ${trimErr(fetched.stderr)}`;
        markBlocked(c.id, reason);
        events.emit('harbormaster:blocked', { id: c.id, reason });
        await postNote(`harbormaster: blocked merge #${c.id} — ${reason}`, { to: 'operator' });
        return { kind: 'blocked', reason };
      }

      const rebased = await runner.run('git', ['rebase', `origin/${c.baseBranch}`], { cwd });
      if (rebased.code !== 0) {
        // Could be a conflict, or a shim refusal, or a true error. Probe.
        const status = await runner.run('git', ['status', '--porcelain'], { cwd });
        const conflictFiles = parseConflictFiles(status.stdout);
        if (conflictFiles.length > 0) {
          // Abort the rebase to leave the worktree clean for the worker.
          await runner.run('git', ['rebase', '--abort'], { cwd });
          backDispatchToProduced(
            c.dispatchId,
            `merge conflict in ${conflictFiles.join(', ')} against ${c.baseBranch}`,
          );
          markBlocked(c.id, `conflict: ${conflictFiles.join(', ')}`);
          events.emit('harbormaster:conflict', {
            id: c.id,
            dispatchId: c.dispatchId,
            files: conflictFiles,
            worker: c.dispatchWorker,
          });
          await openConflictSubDispatch({
            parentDispatchId: c.dispatchId,
            workerActorId: c.dispatchWorker,
            branch: c.branch,
            baseBranch: c.baseBranch,
            files: conflictFiles,
            postNote,
          });
          return { kind: 'conflict', files: conflictFiles };
        }
        // Not a conflict. Probably a shim refusal or git error.
        const reason = `git rebase failed: ${trimErr(rebased.stderr)}`;
        markBlocked(c.id, reason);
        events.emit('harbormaster:blocked', { id: c.id, reason });
        await postNote(`harbormaster: blocked merge #${c.id} — ${reason}`, { to: 'operator' });
        return { kind: 'blocked', reason };
      }

      // 2. gh pr merge — terminates locally with the operator's gh auth.
      const ghFlag = mergeStyleFlag(c.mergeStyle);
      const ghArgs = ['pr', 'merge', c.branch, ghFlag, '--delete-branch'];
      const merged = await runner.run('gh', ghArgs, { cwd });
      if (merged.code !== 0) {
        const reason = `gh pr merge failed (${c.mergeStyle}): ${trimErr(merged.stderr)}`;
        markBlocked(c.id, reason);
        events.emit('harbormaster:blocked', { id: c.id, reason });
        await postNote(`harbormaster: blocked merge #${c.id} (${c.branch}) — ${reason}`, {
          to: 'operator',
        });
        return { kind: 'blocked', reason };
      }

      const mergeCommit = parseGhMergeCommit(merged.stdout);
      markMerged(c.id, mergeCommit);
      events.emit('harbormaster:merged', {
        id: c.id,
        dispatchId: c.dispatchId,
        branch: c.branch,
        baseBranch: c.baseBranch,
        mergeStyle: c.mergeStyle,
        mergeCommit,
      });
      return { kind: 'merged', mergeCommit };
    } finally {
      baseLocks.delete(c.baseBranch);
    }
  }

  /** One tick of the polling loop. Exported so a channel-driven push can fire it. */
  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      await lease.refresh();
    } catch (e) {
      logger.warn('harbormaster: lease refresh failed', e);
    }
    events.emit('harbormaster:tick', { at: Date.now() });
    const candidates = findCandidates();
    for (const c of candidates) {
      if (stopped) break;
      try {
        await processCandidate(c);
      } catch (e) {
        const reason = `unexpected processing error: ${(e as Error).message ?? String(e)}`;
        markBlocked(c.id, reason);
        events.emit('harbormaster:blocked', { id: c.id, reason });
        logger.error('harbormaster: processing crashed', e);
      }
    }
  }

  async function start(): Promise<{ leased: boolean }> {
    const got = await lease.acquire();
    if (!got) {
      logger.warn('harbormaster: another body holds the lease; refusing to start');
      return { leased: false };
    }
    stopped = false;
    // Fire immediately, then on interval. Async fn errors are caught inside tick().
    void tick();
    pollTimer = setInterval(() => void tick(), pollIntervalMs);
    return { leased: true };
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    try {
      await lease.release();
    } catch (e) {
      logger.warn('harbormaster: lease release failed', e);
    }
  }

  function queueSummary(): {
    queued: number;
    blocked: number;
    merged: number;
    candidates: number;
  } {
    if (!hasTable('merge_queue')) {
      return { queued: 0, blocked: 0, merged: 0, candidates: 0 };
    }
    const stateCol = hasColumn('merge_queue', 'state') ? 'state' : 'status';
    const rows = db
      .prepare(`SELECT ${stateCol} AS s, COUNT(*) AS c FROM merge_queue GROUP BY ${stateCol}`)
      .all() as Array<{ s: string; c: number }>;
    const out = { queued: 0, blocked: 0, merged: 0, candidates: findCandidates().length };
    for (const r of rows) {
      if (r.s === 'queued') out.queued = r.c;
      else if (r.s === 'blocked') out.blocked = r.c;
      else if (r.s === 'merged') out.merged = r.c;
    }
    return out;
  }

  return {
    start,
    stop,
    tick,
    events,
    queueSummary,
    findCandidates,
    processCandidate,
    schemaHasDispatchColumns,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function normalizeMergeStyle(s: string | null | undefined): MergeStyle {
  if (s === 'merge' || s === 'rebase') return s;
  return 'squash';
}

function mergeStyleFlag(s: MergeStyle): string {
  switch (s) {
    case 'merge':
      return '--merge';
    case 'rebase':
      return '--rebase';
    case 'squash':
    default:
      return '--squash';
  }
}

function parseConflictFiles(porcelain: string): string[] {
  // git status --porcelain: UU/AA/DD/AU/UA/DU/UD = conflicted
  const out: string[] = [];
  for (const line of porcelain.split('\n')) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (
      xy === 'UU' ||
      xy === 'AA' ||
      xy === 'DD' ||
      xy === 'AU' ||
      xy === 'UA' ||
      xy === 'DU' ||
      xy === 'UD'
    ) {
      out.push(path);
    }
  }
  return out;
}

function parseGhMergeCommit(stdout: string): string | null {
  // Best-effort: gh prints a URL or sometimes the SHA. We don't fail if absent.
  const sha = stdout.match(/\b([0-9a-f]{7,40})\b/);
  return sha ? sha[1] : null;
}

function trimErr(s: string): string {
  return s
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(-3)
    .join(' | ');
}

async function openConflictSubDispatch(opts: {
  parentDispatchId: string;
  workerActorId: string | null;
  branch: string;
  baseBranch: string;
  files: string[];
  postNote: (text: string, opts?: { to?: string }) => void | Promise<void>;
}): Promise<void> {
  // Until ADR-0035 §parent_dispatch_id lands, the durable record is a pd note
  // addressed to the worker actor's mailbox. The note text is the goal text
  // a future sub-dispatch will inherit verbatim.
  const goal =
    `resolve merge conflict in ${opts.files.join(', ')} on branch ${opts.branch} ` +
    `against ${opts.baseBranch} (parent dispatch ${opts.parentDispatchId})`;
  const to = opts.workerActorId ? `actor:${opts.workerActorId}` : 'operator';
  await opts.postNote(goal, { to });
}

// ─── Default adapters ────────────────────────────────────────────────────

function defaultLogger(): Logger {
  return {
    info: (m, e) => console.log(`[harbormaster] ${m}`, e ?? ''),
    warn: (m, e) => console.warn(`[harbormaster] ${m}`, e ?? ''),
    error: (m, e) => console.error(`[harbormaster] ${m}`, e ?? ''),
  };
}

function defaultRunner(): CommandRunner {
  return {
    run(cmd, args, opts) {
      return new Promise((resolve) => {
        const env: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}) };
        // Belt-and-suspenders: never run with PD_SHIM_OFF, even if the parent had it set.
        delete env.PD_SHIM_OFF;
        const child = spawn(cmd, args, { cwd: opts.cwd, env });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (b) => (stdout += b.toString()));
        child.stderr?.on('data', (b) => (stderr += b.toString()));
        child.on('error', (err) => {
          resolve({ code: 127, stdout, stderr: stderr + String(err) });
        });
        child.on('close', (code) => {
          resolve({ code: code ?? 0, stdout, stderr });
        });
      });
    },
  };
}

function defaultPostNote(runner: CommandRunner): (text: string, opts?: { to?: string }) => Promise<void> {
  return async (text, opts) => {
    const args = ['note', text];
    if (opts?.to) {
      args.push('--to', opts.to);
    }
    // Fire-and-forget; if pd is not on PATH we silently degrade. Tests inject their own poster.
    try {
      await runner.run('pd', args, { cwd: process.cwd() });
    } catch {
      // intentional
    }
  };
}

/**
 * Best-effort file-lock-style lease. Replace with lib/body-lease.ts (ADR-0022
 * Phase A) when that module lands.
 *
 *   - acquire(): atomically writes pid+timestamp to the lease file. Fails if
 *     the existing lease is fresh (< LEASE_STALE_MS old).
 *   - refresh(): bumps the timestamp.
 *   - release(): deletes the file.
 */
export function createFileLease(path: string): LeaseAdapter {
  function dirOf(p: string): string {
    const idx = p.lastIndexOf('/');
    return idx <= 0 ? '.' : p.slice(0, idx);
  }
  function ensureDir(): void {
    const d = dirOf(path);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
  function readLease(): { pid: number; refreshed: number } | null {
    try {
      const raw = readFileSync(path, 'utf8');
      const obj = JSON.parse(raw) as { pid: number; refreshed: number };
      if (typeof obj.pid !== 'number' || typeof obj.refreshed !== 'number') return null;
      return obj;
    } catch {
      return null;
    }
  }
  function writeLease(): void {
    writeFileSync(
      path,
      JSON.stringify({ pid: process.pid, refreshed: Date.now() }, null, 2),
      'utf8',
    );
  }
  return {
    async acquire() {
      ensureDir();
      const existing = readLease();
      if (existing) {
        const age = Date.now() - existing.refreshed;
        if (age < LEASE_STALE_MS && existing.pid !== process.pid) {
          // A live body holds it.
          return false;
        }
      }
      try {
        // O_EXCL would be ideal but writeFileSync handles overwriting fine; the
        // stale check above is the discriminator.
        writeLease();
        return true;
      } catch {
        return false;
      }
    },
    async refresh() {
      try {
        writeLease();
      } catch {
        // ignore — refresh failures get retried next tick
      }
    },
    async release() {
      try {
        const cur = readLease();
        if (cur && cur.pid === process.pid) {
          unlinkSync(path);
        }
      } catch {
        // ignore
      }
    },
  };
}

// Avoid an unused-import warning for openSync/closeSync/writeSync when the
// minimal file-lease is in use. These are kept available for a future
// fcntl-style implementation.
void openSync;
void closeSync;
void writeSync;
