/**
 * Git Origin Check — Precondition gate for pd done.
 *
 * This module verifies, before pd done is allowed to mark a session
 * complete, that:
 *   1. The session's branch is not ahead of its upstream on origin
 *      (i.e. all local commits have been pushed).
 *   2. The result note ("Result: ...") includes one of three sentinels
 *      describing where the work lands:
 *        - A PR URL (https://github.com/.../pull/<n>)
 *        - "no-pr-yet: <reason>"
 *        - "not-applicable: <reason>"
 *
 * The 2026-05-20 incident that motivated this rule: 9 worktree branches
 * were orphaned because agents wrote pd done without ever pushing. No
 * one audited until the operator did it himself. This precondition is
 * the substrate fix.
 *
 * Implementation note: we use execFileSync (no shell) with hard-coded
 * argv arrays so no user input is interpolated into a shell command.
 * This mirrors the convention in lib/worktree.ts.
 */

import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';

export interface OriginCheckResult {
  ok: boolean;
  /** A short machine-readable code when ok=false */
  code?:
    | 'NO_REPO'
    | 'NO_UPSTREAM'
    | 'BRANCH_AHEAD'
    | 'GIT_ERROR';
  /** Human-readable explanation when ok=false */
  error?: string;
  /** Remediation hint, ready to print to operator */
  hint?: string;
  /** Current branch name, when detectable */
  branch?: string | null;
  /** Upstream ref (e.g. "origin/feat/foo"), when detectable */
  upstream?: string | null;
  /** Number of commits ahead of upstream (0 means clean) */
  ahead?: number;
}

export interface GitOriginChecker {
  /** Returns ok=true only when the branch is fully pushed to its upstream. */
  checkBranchOnOrigin(cwd?: string): OriginCheckResult;
  /**
   * Returns ok=true only for a ledger-only worktree: no tracked/untracked
   * changes and no commits absent from every remote ref. This is the narrow
   * `pd done --no-pr` path for a session that produced durable notes but no
   * repository artifact.
   */
  checkLedgerOnly?(cwd?: string): LedgerOnlyCheckResult;
}

export interface LedgerOnlyCheckResult {
  ok: boolean;
  code?: 'NO_REPO' | 'DIRTY_WORKTREE' | 'UNPUBLISHED_COMMITS' | 'GIT_ERROR';
  error?: string;
  hint?: string;
  unpublishedCommits?: number;
  dirtyEntries?: number;
}

function gitExecOptions(cwd?: string): ExecFileSyncOptionsWithStringEncoding {
  return {
    ...(cwd ? { cwd } : {}),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  };
}

function tryGit(args: string[], opts: ExecFileSyncOptionsWithStringEncoding): { ok: true; out: string } | { ok: false; err: string } {
  try {
    const out = execFileSync('git', args, opts).toString().trim();
    return { ok: true, out };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, err: message };
  }
}

/**
 * Production implementation — runs real git commands.
 */
export function createGitOriginChecker(): GitOriginChecker {
  return {
    checkBranchOnOrigin(cwd?: string): OriginCheckResult {
      const opts = gitExecOptions(cwd);

      // 1) Are we even in a git repo?
      const rootRes = tryGit(['rev-parse', '--show-toplevel'], opts);
      if (!rootRes.ok) {
        return {
          ok: false,
          code: 'NO_REPO',
          error: 'Not inside a Git repository (or git is unavailable).',
          hint: 'pd done cannot prove delivery outside a Git repo. Run it from the linked repository worktree, or abandon the session.',
        };
      }

      // 2) Current branch (skip detached HEAD)
      const branchRes = tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], opts);
      if (!branchRes.ok) {
        return {
          ok: false,
          code: 'GIT_ERROR',
          error: `Could not resolve current branch: ${branchRes.err}`,
          hint: 'Check the worktree state and publish the branch before completing, or abandon the session.',
        };
      }
      const branch = branchRes.out === 'HEAD' ? null : branchRes.out;
      if (!branch) {
        return {
          ok: false,
          code: 'GIT_ERROR',
          error: 'Detached HEAD: cannot verify origin push.',
          hint: 'Check out and publish a branch before completing, or abandon the session.',
          branch: null,
        };
      }

      // 3) Upstream
      const upstreamRes = tryGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], opts);
      if (!upstreamRes.ok) {
        return {
          ok: false,
          code: 'NO_UPSTREAM',
          error: `Branch "${branch}" has no upstream — nothing has been pushed.`,
          hint: `Push the branch and set its upstream:\n    git push -u origin ${branch}\n  Then re-run pd done.`,
          branch,
          upstream: null,
        };
      }
      const upstream = upstreamRes.out;

      // 4) Ahead-of-upstream count
      const aheadRes = tryGit(['rev-list', '@{u}..HEAD', '--count'], opts);
      if (!aheadRes.ok) {
        return {
          ok: false,
          code: 'GIT_ERROR',
          error: `Could not compute ahead-of-upstream count: ${aheadRes.err}`,
          hint: 'Check the worktree state and publish the branch before completing, or abandon the session.',
          branch,
          upstream,
        };
      }
      const ahead = Number.parseInt(aheadRes.out, 10);
      if (!Number.isFinite(ahead) || ahead < 0) {
        return {
          ok: false,
          code: 'GIT_ERROR',
          error: `Unexpected ahead count: "${aheadRes.out}"`,
          hint: 'Check the worktree state and publish the branch before completing, or abandon the session.',
          branch,
          upstream,
        };
      }
      if (ahead > 0) {
        return {
          ok: false,
          code: 'BRANCH_AHEAD',
          error: `Branch "${branch}" is ahead of ${upstream} by ${ahead} commit${ahead === 1 ? '' : 's'}.`,
          hint: `Push the branch first:\n    git push -u origin ${branch}\n  Then re-run pd done.`,
          branch,
          upstream,
          ahead,
        };
      }

      return { ok: true, branch, upstream, ahead: 0 };
    },

    /**
     * Prove there is no repository artifact for a `--no-pr` session. The
     * design checks both worktree state and commits absent from every remote
     * ref so a convenience flag cannot silently orphan unpublished work.
     *
     * @param cwd - Worktree whose local and remote-reachability state is inspected.
     * @returns Structured success or the exact failed ledger-only invariant.
     */
    checkLedgerOnly(cwd?: string): LedgerOnlyCheckResult {
      const opts = gitExecOptions(cwd);
      const rootRes = tryGit(['rev-parse', '--show-toplevel'], opts);
      if (!rootRes.ok) {
        return {
          ok: false,
          code: 'NO_REPO',
          error: 'Not inside a Git repository (or git is unavailable).',
          hint: 'A --no-pr close still requires a verifiably clean repository worktree.',
        };
      }

      const statusRes = tryGit(['status', '--porcelain=v1', '--untracked-files=all'], opts);
      if (!statusRes.ok) {
        return {
          ok: false,
          code: 'GIT_ERROR',
          error: `Could not inspect worktree cleanliness: ${statusRes.err}`,
          hint: 'Inspect the worktree and preserve or revert every local change before closing --no-pr.',
        };
      }
      const dirtyEntries = statusRes.out ? statusRes.out.split('\n').filter(Boolean).length : 0;
      if (dirtyEntries > 0) {
        return {
          ok: false,
          code: 'DIRTY_WORKTREE',
          error: `Worktree has ${dirtyEntries} uncommitted or untracked entr${dirtyEntries === 1 ? 'y' : 'ies'}.`,
          hint: 'Commit and publish the work, or remove only verified session-owned residue before closing --no-pr.',
          dirtyEntries,
        };
      }

      const unpublishedRes = tryGit(['rev-list', '--count', 'HEAD', '--not', '--remotes'], opts);
      if (!unpublishedRes.ok) {
        return {
          ok: false,
          code: 'GIT_ERROR',
          error: `Could not inspect unpublished commits: ${unpublishedRes.err}`,
          hint: 'Fetch the canonical remote and verify the branch has no unpublished commits.',
        };
      }
      const unpublishedCommits = Number.parseInt(unpublishedRes.out, 10);
      if (!Number.isFinite(unpublishedCommits) || unpublishedCommits < 0) {
        return {
          ok: false,
          code: 'GIT_ERROR',
          error: `Unexpected unpublished commit count: "${unpublishedRes.out}"`,
          hint: 'Fetch the canonical remote and verify the branch has no unpublished commits.',
        };
      }
      if (unpublishedCommits > 0) {
        return {
          ok: false,
          code: 'UNPUBLISHED_COMMITS',
          error: `Branch contains ${unpublishedCommits} commit${unpublishedCommits === 1 ? '' : 's'} absent from every remote ref.`,
          hint: 'Push the branch and open a PR; --no-pr is only for sessions with no repository artifact.',
          unpublishedCommits,
        };
      }

      return { ok: true, dirtyEntries: 0, unpublishedCommits: 0 };
    },
  };
}

// =============================================================================
// Result-note sentinel detection
// =============================================================================

/**
 * Matches GitHub-style PR URLs. We accept https://github.com/<owner>/<repo>/pull/<n>.
 * (GitLab and other forges can be added if/when needed; sentinels are also accepted
 * for those cases via no-pr-yet / not-applicable.)
 */
const PR_URL_RE = /https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/i;
const NO_PR_YET_RE = /\bno-pr-yet\s*:/i;
const NOT_APPLICABLE_RE = /\bnot-applicable\s*:/i;

export type NoteSentinelKind = 'pr-url' | 'no-pr-yet' | 'not-applicable';

export interface NoteSentinelResult {
  ok: boolean;
  kind?: NoteSentinelKind;
  match?: string;
}

/**
 * Returns ok=true if the note contains one of the three accepted sentinels.
 * Returns ok=false (with no kind/match) when the note is missing or lacks any sentinel.
 */
export function checkResultNoteSentinel(note: string | null | undefined): NoteSentinelResult {
  if (typeof note !== 'string' || !note.trim()) {
    return { ok: false };
  }
  const m1 = note.match(PR_URL_RE);
  if (m1) return { ok: true, kind: 'pr-url', match: m1[0] };
  if (NO_PR_YET_RE.test(note)) return { ok: true, kind: 'no-pr-yet' };
  if (NOT_APPLICABLE_RE.test(note)) return { ok: true, kind: 'not-applicable' };
  return { ok: false };
}

export function noteSentinelErrorMessage(): string {
  return [
    'Result note must include one of:',
    '  - A PR URL                 (e.g., "Result: ... PR opened: https://github.com/owner/repo/pull/143")',
    '  - no-pr-yet: <reason>      (e.g., "Result: ... no-pr-yet: blocked on operator approval")',
    '  - not-applicable: <reason> (e.g., "Result: ... not-applicable: docs-only sync")',
  ].join('\n');
}
