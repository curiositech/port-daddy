/**
 * lib/dispatch/auto-merge.ts — the `merge_policy='auto'` sweep.
 *
 * A dispatch proposed with `--merge-policy auto` gets Port Daddy's own
 * authority to merge its own PR (via `gh pr merge`), instead of waiting on
 * `pd review --accept` + an operator merging by hand. This is a NARROWER,
 * separate mechanism from `lib/harbormaster.ts` (which gates on the operator
 * having run `pd review --accept`, i.e. `dispatch.state === 'accepted'`, and
 * requires a `merge_queue` row — a two-key, operator-approval flow). Auto
 * merge_policy dispatches never go through harbormaster; they never need an
 * `accepted` state at all, because the dispatch worker already settles a
 * produced dispatch straight to `settled` once the PR is open (see
 * lib/dispatch/spawn-adapter.ts) — `settled` here means "the autonomous run
 * finished and a PR exists," not "the PR is merged." This module is what
 * actually gets the PR merged for the `auto` policy.
 *
 * ─── Safety gate (ALL must hold before this module calls `gh pr merge`) ───
 *
 *   1. The PR is OPEN (not draft, not already closed/merged).
 *   2. Every required CI check is green (no FAILURE / ERROR / CANCELLED /
 *      TIMED_OUT / ACTION_REQUIRED conclusion, and nothing still PENDING /
 *      QUEUED / IN_PROGRESS).
 *   3. `gh`'s own `mergeable` field reports `MERGEABLE` (no conflicts).
 *   4. Zero unresolved review threads (GraphQL `reviewThreads.isResolved`).
 *
 * If ANY of those is false, the dispatch is left alone -- no merge, no
 * force-push, no `--admin`, no `--auto` (gh's built-in auto-merge polls and
 * merges the instant checks turn green, which races an in-flight reviewer
 * leaving a comment -- this module does its own point-in-time check of
 * checks + mergeability + threads together, then merges directly, matching
 * the house rule in `fleet/ships/steward.md`: "wait for the review pass +
 * zero unaddressed comments, THEN `gh pr merge --squash`").
 *
 * This module NEVER:
 *   - force-pushes
 *   - merges a draft PR
 *   - skips a failing or still-pending check
 *   - uses `gh pr merge --admin` or `--auto`
 *   - touches dispatches with merge_policy `review` or `never`
 *
 * On a successful merge it logs a durable `pd note` (which PR, which checks
 * passed, when), then best-effort reaps the dispatch's worktree (idempotent —
 * the dispatch worker's `runOne()` already reaps on `settled`, so by the time
 * this runs the worktree is usually already gone; we retry anyway in case the
 * dispatch was run some other way) and deletes the local branch ref if one
 * still exists in the main checkout.
 *
 * Local dev-build refresh: intentionally NOT wired to any GUI launch here.
 * `scripts/dev-triple.sh` opens FleetBar/pd-console windows and is meant for
 * an operator asking to "come look at a feature" -- firing it unattended from
 * a background merge sweep would violate the house rule against touching the
 * operator's physical machine (opening windows) without per-action consent.
 * TODO(follow-up, needs operator decision): if there is a *headless* refresh
 * target (e.g. rebuilding a named dev daemon binary without opening any GUI),
 * wire it here. Until then this is a clearly-marked gap, not a silent no-op.
 */

import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

import type { Dispatch, DispatchQueue } from './queue.js';

const execFileAsync = promisify(execFile);

/**
 * Reap a dispatch worktree. Deliberately NOT imported from
 * lib/dispatch/spawn-adapter.ts: that module does a module-load-time sanity
 * check against `runner.ts`'s `DISPATCH_WORKTREE_ROOT`, which couples this
 * module's import graph to the CLI-only spawn path (and to every test that
 * mocks `runner.js` without that export). This is the identical
 * remove-then-prune logic as spawn-adapter.ts's `reapWorktree` — best-effort,
 * a reap failure must never flip a successful merge into a reported failure.
 */
async function reapWorktree(worktreePath: string): Promise<void> {
  if (!existsSync(worktreePath)) return;
  try {
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath]);
  } catch {
    try {
      execFileSync('rm', ['-rf', worktreePath]);
    } catch { /* give up — surfaced via logs, not a merge failure */ }
  }
  try {
    await execFileAsync('git', ['worktree', 'prune']);
  } catch { /* housekeeping; non-fatal */ }
}

// ─── Command runner (injectable for tests) ─────────────────────────────────

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(cmd: string, args: string[], opts?: { cwd?: string }): Promise<RunResult>;
}

export function createDefaultCommandRunner(): CommandRunner {
  return {
    async run(cmd, args, opts) {
      try {
        const { stdout, stderr } = await execFileAsync(cmd, args, {
          cwd: opts?.cwd,
          maxBuffer: 16 * 1024 * 1024,
        });
        return { code: 0, stdout, stderr };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
        return {
          code: typeof e.code === 'number' ? e.code : 1,
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? e.message ?? String(err),
        };
      }
    },
  };
}

// ─── PR info + readiness ────────────────────────────────────────────────────

export type PrLifecycleState = 'OPEN' | 'MERGED' | 'CLOSED' | 'UNKNOWN';

interface StatusCheckEntry {
  __typename?: string;
  state?: string; // StatusContext (legacy commit status)
  status?: string; // CheckRun
  conclusion?: string | null; // CheckRun
  name?: string;
  context?: string;
}

interface PrViewJson {
  state?: string;
  isDraft?: boolean;
  mergeable?: string; // MERGEABLE | CONFLICTING | UNKNOWN
  mergeStateStatus?: string;
  statusCheckRollup?: StatusCheckEntry[];
  number?: number;
}

export interface PrInfo {
  state: PrLifecycleState;
  isDraft: boolean;
  mergeable: string;
  failingChecks: string[];
  pendingChecks: string[];
  unresolvedThreads: number;
  threadsUnknown: boolean;
  fetchError: string | null;
}

export interface Readiness {
  ready: boolean;
  reasons: string[];
}

const CHECK_SUCCESS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED', 'COMPLETED']);
const CHECK_PENDING = new Set(['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'STALE']);
// Anything not in either set above (FAILURE, ERROR, CANCELLED, TIMED_OUT,
// ACTION_REQUIRED, STARTUP_FAILURE, ...) is treated as failing.

/** Parse a `github.com/<owner>/<repo>/pull/<number>` URL. Returns null if it doesn't look like one. */
export function parseGithubPrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url.trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

export function looksLikeGithubPrUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && parseGithubPrUrl(url) !== null;
}

function checkOutcome(entry: StatusCheckEntry): 'success' | 'pending' | 'failing' {
  const raw = (entry.conclusion ?? entry.state ?? entry.status ?? '').toUpperCase();
  if (!raw) return 'pending';
  if (CHECK_SUCCESS.has(raw)) return 'success';
  if (CHECK_PENDING.has(raw)) return 'pending';
  return 'failing';
}

function checkLabel(entry: StatusCheckEntry): string {
  return entry.name || entry.context || 'unnamed check';
}

/**
 * Fetch the PR's current lifecycle state, mergeability, CI rollup, and
 * unresolved review-thread count. Two `gh` calls: `pr view --json ...` for
 * the REST-ish fields, plus one GraphQL query for reviewThreads (not exposed
 * by `gh pr view --json`).
 */
export async function fetchPrInfo(prUrl: string, runner: CommandRunner): Promise<PrInfo> {
  const parsed = parseGithubPrUrl(prUrl);
  if (!parsed) {
    return {
      state: 'UNKNOWN',
      isDraft: false,
      mergeable: 'UNKNOWN',
      failingChecks: [],
      pendingChecks: [],
      unresolvedThreads: 0,
      threadsUnknown: true,
      fetchError: `resultArtifact "${prUrl}" is not a github.com PR URL`,
    };
  }

  const viewRes = await runner.run('gh', [
    'pr', 'view', prUrl,
    '--json', 'state,isDraft,mergeable,mergeStateStatus,statusCheckRollup,number',
  ]);
  if (viewRes.code !== 0) {
    return {
      state: 'UNKNOWN',
      isDraft: false,
      mergeable: 'UNKNOWN',
      failingChecks: [],
      pendingChecks: [],
      unresolvedThreads: 0,
      threadsUnknown: true,
      fetchError: `gh pr view failed: ${trimErr(viewRes.stderr)}`,
    };
  }

  let parsedJson: PrViewJson;
  try {
    parsedJson = JSON.parse(viewRes.stdout) as PrViewJson;
  } catch {
    return {
      state: 'UNKNOWN',
      isDraft: false,
      mergeable: 'UNKNOWN',
      failingChecks: [],
      pendingChecks: [],
      unresolvedThreads: 0,
      threadsUnknown: true,
      fetchError: `gh pr view returned unparseable JSON`,
    };
  }

  const state: PrLifecycleState =
    parsedJson.state === 'OPEN' || parsedJson.state === 'MERGED' || parsedJson.state === 'CLOSED'
      ? parsedJson.state
      : 'UNKNOWN';
  const rollup = Array.isArray(parsedJson.statusCheckRollup) ? parsedJson.statusCheckRollup : [];
  const failingChecks: string[] = [];
  const pendingChecks: string[] = [];
  for (const entry of rollup) {
    const outcome = checkOutcome(entry);
    if (outcome === 'failing') failingChecks.push(checkLabel(entry));
    else if (outcome === 'pending') pendingChecks.push(checkLabel(entry));
  }

  const threads = await fetchUnresolvedThreadCount(parsed, runner);

  return {
    state,
    isDraft: !!parsedJson.isDraft,
    mergeable: parsedJson.mergeable ?? 'UNKNOWN',
    failingChecks,
    pendingChecks,
    unresolvedThreads: threads.count,
    threadsUnknown: threads.unknown,
    fetchError: null,
  };
}

interface ReviewThreadsResponse {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: Array<{ isResolved?: boolean }>;
          pageInfo?: { hasNextPage?: boolean };
        };
      };
    };
  };
}

/**
 * Count unresolved review threads via GraphQL. `gh pr view --json` has no
 * `reviewThreads` field. Pages up to 100 threads (ample for a dispatch-sized
 * PR); if a PR somehow has more, we err strict: report threadsUnknown=true so
 * the caller refuses to merge rather than assume the rest are resolved.
 */
export async function fetchUnresolvedThreadCount(
  parsed: { owner: string; repo: string; number: number },
  runner: CommandRunner,
): Promise<{ count: number; unknown: boolean }> {
  const query = `
    query($owner:String!,$repo:String!,$number:Int!) {
      repository(owner:$owner,name:$repo) {
        pullRequest(number:$number) {
          reviewThreads(first:100) {
            nodes { isResolved }
            pageInfo { hasNextPage }
          }
        }
      }
    }`;
  const res = await runner.run('gh', [
    'api', 'graphql',
    '-f', `query=${query}`,
    '-F', `owner=${parsed.owner}`,
    '-F', `repo=${parsed.repo}`,
    '-F', `number=${parsed.number}`,
  ]);
  if (res.code !== 0) {
    return { count: 0, unknown: true };
  }
  try {
    const json = JSON.parse(res.stdout) as ReviewThreadsResponse;
    const threads = json.data?.repository?.pullRequest?.reviewThreads;
    const nodes = threads?.nodes ?? [];
    if (threads?.pageInfo?.hasNextPage) {
      // More than 100 threads and we can't see them all — refuse to assert
      // zero-unresolved; the caller treats `unknown` as not-ready.
      return { count: nodes.filter((n) => !n.isResolved).length, unknown: true };
    }
    return { count: nodes.filter((n) => !n.isResolved).length, unknown: false };
  } catch {
    return { count: 0, unknown: true };
  }
}

/** Evaluate the safety gate against a fetched PrInfo. Pure — no I/O. */
export function evaluateReadiness(info: PrInfo): Readiness {
  const reasons: string[] = [];
  if (info.fetchError) reasons.push(info.fetchError);
  if (info.state !== 'OPEN') reasons.push(`PR state is ${info.state}, not OPEN`);
  if (info.isDraft) reasons.push('PR is a draft');
  if (info.mergeable !== 'MERGEABLE') reasons.push(`mergeable=${info.mergeable} (not MERGEABLE)`);
  if (info.failingChecks.length > 0) reasons.push(`failing checks: ${info.failingChecks.join(', ')}`);
  if (info.pendingChecks.length > 0) reasons.push(`pending checks: ${info.pendingChecks.join(', ')}`);
  if (info.threadsUnknown) reasons.push('could not confirm unresolved review-thread count (erring strict)');
  else if (info.unresolvedThreads > 0) reasons.push(`${info.unresolvedThreads} unresolved review thread(s)`);
  return { ready: reasons.length === 0, reasons };
}

// ─── Merge ──────────────────────────────────────────────────────────────────

export interface MergeOutcome {
  merged: boolean;
  mergeCommit: string | null;
  error: string | null;
}

/**
 * Merge a PR. Squash + delete-branch, matching the repo's own house
 * convention (harbormaster.ts's default merge style; fleet/ships/steward.md's
 * `gh pr merge <N> --squash`). Never `--admin`, never `--auto`: the caller has
 * already done its own point-in-time readiness check.
 */
export async function mergePr(prUrl: string, runner: CommandRunner): Promise<MergeOutcome> {
  const res = await runner.run('gh', ['pr', 'merge', prUrl, '--squash', '--delete-branch']);
  if (res.code !== 0) {
    return { merged: false, mergeCommit: null, error: trimErr(res.stderr) || 'gh pr merge failed' };
  }
  const sha = /\b([0-9a-f]{7,40})\b/.exec(res.stdout);
  return { merged: true, mergeCommit: sha ? sha[1] : null, error: null };
}

function trimErr(s: string): string {
  return s.split('\n').filter((l) => l.trim().length > 0).slice(-3).join(' | ');
}

// ─── Cleanup (worktree + local branch) ─────────────────────────────────────

export interface CleanupOptions {
  runner: CommandRunner;
  /** cwd for `git branch -D`; must be the main checkout, not the (likely already-gone) worktree. */
  repoRoot: string;
  reaper?: (worktreePath: string) => Promise<void>;
}

export interface CleanupResult {
  worktreeReaped: boolean;
  branchDeleted: boolean;
  notes: string[];
}

/**
 * Scrap the dispatch's worktree and local branch ref. Both steps are
 * best-effort and idempotent: the dispatch worker already reaps the worktree
 * when a dispatch settles (see lib/dispatch/worker.ts `runOne`), so by the
 * time a merge happens the worktree is usually already gone — that's fine,
 * `reapWorktree` no-ops on a missing path. `git branch -D` similarly no-ops
 * (non-zero exit, swallowed) if the local branch ref was never created here
 * (e.g. a dispatch worktree that was reaped without ever checking out a local
 * branch name still known to the main repo).
 */
export async function cleanupMergedDispatch(
  dispatch: Dispatch,
  opts: CleanupOptions,
): Promise<CleanupResult> {
  const reaper = opts.reaper ?? reapWorktree;
  const notes: string[] = [];
  let worktreeReaped = false;
  if (dispatch.worktreePath) {
    try {
      await reaper(dispatch.worktreePath);
      worktreeReaped = true;
    } catch (err) {
      notes.push(`worktree reap failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  let branchDeleted = false;
  if (dispatch.branch) {
    const res = await opts.runner.run('git', ['-C', opts.repoRoot, 'branch', '-D', dispatch.branch]);
    branchDeleted = res.code === 0;
    if (!branchDeleted && !/not found|not fully merged/i.test(res.stderr)) {
      notes.push(`local branch delete: ${trimErr(res.stderr)}`);
    }
  }
  return { worktreeReaped, branchDeleted, notes };
}

// ─── The sweep ──────────────────────────────────────────────────────────────

export interface AutoMergeLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
}

export interface AutoMergeOptions {
  runner?: CommandRunner;
  repoRoot?: string;
  reaper?: (worktreePath: string) => Promise<void>;
  postNote?: (text: string) => void | Promise<void>;
  logger?: AutoMergeLogger;
}

export interface AutoMergeSweepResult {
  checked: number;
  merged: Array<{ dispatchId: string; prUrl: string; mergeCommit: string | null }>;
  blocked: Array<{ dispatchId: string; prUrl: string; reasons: string[] }>;
  cleanedUp: Array<{ dispatchId: string; prUrl: string }>;
  errors: Array<{ dispatchId: string; error: string }>;
}

const noopLogger: AutoMergeLogger = { info: () => {}, warn: () => {} };

function defaultPostNote(runner: CommandRunner): (text: string) => Promise<void> {
  return async (text) => {
    try {
      await runner.run('pd', ['note', text]);
    } catch {
      /* pd not on PATH — degrade silently, the caller's logger still saw it */
    }
  };
}

/** States a dispatch can be in while it still plausibly has an open PR worth checking. */
const PR_LIVE_STATES = new Set(['produced', 'review_pending', 'accepted', 'settled']);

/**
 * Candidates for the auto-merge sweep: `merge_policy='auto'`, a github PR URL
 * in `resultArtifact`, and a dispatch state that isn't a hard-dead end
 * (`failed`/`salvage`/`rejected` dispatches never had a mergeable PR, or the
 * operator already explicitly rejected it).
 */
export function findAutoMergeCandidates(queue: DispatchQueue): Dispatch[] {
  return queue
    .list({ state: 'all' })
    .filter((d) => d.mergePolicy === 'auto')
    .filter((d) => PR_LIVE_STATES.has(d.state))
    .filter((d) => looksLikeGithubPrUrl(d.resultArtifact));
}

/**
 * Check one dispatch's PR and, if it's ready, merge it and run cleanup. Also
 * runs cleanup-only (no re-merge, no note) when the PR turns out to already
 * be MERGED — covers the case where a previous sweep tick merged it, or an
 * operator merged it by hand, and the worktree/branch still need scrapping.
 *
 * This is the single unit both `runAutoMergeSweep()` (the poller) and `pd
 * done` (the manual confirmation point) call, so the two surfaces can never
 * diverge in what "ready to merge" means.
 */
export async function checkAndCompleteDispatch(
  dispatch: Dispatch,
  opts: AutoMergeOptions = {},
): Promise<
  | { outcome: 'merged'; mergeCommit: string | null; cleanup: CleanupResult }
  | { outcome: 'already_merged'; cleanup: CleanupResult }
  | { outcome: 'not_ready'; reasons: string[] }
  | { outcome: 'not_applicable'; reason: string }
  | { outcome: 'error'; error: string }
> {
  const runner = opts.runner ?? createDefaultCommandRunner();
  const repoRoot = opts.repoRoot ?? process.cwd();
  const postNote = opts.postNote ?? defaultPostNote(runner);
  const logger = opts.logger ?? noopLogger;

  if (dispatch.mergePolicy !== 'auto') {
    return { outcome: 'not_applicable', reason: `merge_policy is '${dispatch.mergePolicy}', not 'auto'` };
  }
  if (!looksLikeGithubPrUrl(dispatch.resultArtifact)) {
    return { outcome: 'not_applicable', reason: 'no github PR URL on this dispatch yet' };
  }
  const prUrl = dispatch.resultArtifact;

  let info: PrInfo;
  try {
    info = await fetchPrInfo(prUrl, runner);
  } catch (err) {
    return { outcome: 'error', error: err instanceof Error ? err.message : String(err) };
  }

  if (info.state === 'MERGED') {
    const cleanup = await cleanupMergedDispatch(dispatch, { runner, repoRoot, reaper: opts.reaper });
    return { outcome: 'already_merged', cleanup };
  }
  if (info.state === 'CLOSED') {
    // Closed without merging — an operator's call, not ours to second-guess.
    return { outcome: 'not_applicable', reason: 'PR was closed without merging' };
  }

  const readiness = evaluateReadiness(info);
  if (!readiness.ready) {
    logger.info('dispatch_auto_merge_not_ready', {
      dispatchId: dispatch.id.slice(0, 8),
      prUrl,
      reasons: readiness.reasons,
    });
    return { outcome: 'not_ready', reasons: readiness.reasons };
  }

  const mergeResult = await mergePr(prUrl, runner);
  if (!mergeResult.merged) {
    const reason = `gh pr merge failed: ${mergeResult.error ?? 'unknown error'}`;
    logger.warn('dispatch_auto_merge_failed', { dispatchId: dispatch.id.slice(0, 8), prUrl, reason });
    await postNote(
      `pd dispatch auto-merge: BLOCKED PR ${prUrl} (dispatch ${dispatch.id.slice(0, 8)}) — ${reason}`,
    );
    return { outcome: 'error', error: reason };
  }

  logger.info('dispatch_auto_merged', {
    dispatchId: dispatch.id.slice(0, 8),
    prUrl,
    mergeCommit: mergeResult.mergeCommit,
  });
  await postNote(
    `pd dispatch auto-merge: merged ${prUrl} (dispatch ${dispatch.id.slice(0, 8)}) at ` +
    `${new Date().toISOString()} — CI green, mergeable, 0 unresolved review threads` +
    (mergeResult.mergeCommit ? `, commit ${mergeResult.mergeCommit}` : ''),
  );
  const cleanup = await cleanupMergedDispatch(dispatch, { runner, repoRoot, reaper: opts.reaper });
  return { outcome: 'merged', mergeCommit: mergeResult.mergeCommit, cleanup };
}

/**
 * Sweep every `merge_policy='auto'` dispatch with a live PR and merge the
 * ones that are ready. Called on a daemon-side interval (server.ts) and via
 * `pd dispatch merge-sweep` for a manual/foreground trigger.
 */
export async function runAutoMergeSweep(
  queue: DispatchQueue,
  opts: AutoMergeOptions = {},
): Promise<AutoMergeSweepResult> {
  const candidates = findAutoMergeCandidates(queue);
  const result: AutoMergeSweepResult = { checked: candidates.length, merged: [], blocked: [], cleanedUp: [], errors: [] };
  for (const dispatch of candidates) {
    const prUrl = dispatch.resultArtifact as string;
    try {
      const outcome = await checkAndCompleteDispatch(dispatch, opts);
      if (outcome.outcome === 'merged') {
        result.merged.push({ dispatchId: dispatch.id, prUrl, mergeCommit: outcome.mergeCommit });
      } else if (outcome.outcome === 'already_merged') {
        if (outcome.cleanup.worktreeReaped || outcome.cleanup.branchDeleted) {
          result.cleanedUp.push({ dispatchId: dispatch.id, prUrl });
        }
      } else if (outcome.outcome === 'not_ready') {
        result.blocked.push({ dispatchId: dispatch.id, prUrl, reasons: outcome.reasons });
      } else if (outcome.outcome === 'error') {
        result.errors.push({ dispatchId: dispatch.id, error: outcome.error });
      }
    } catch (err) {
      result.errors.push({ dispatchId: dispatch.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
