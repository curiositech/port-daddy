/**
 * Dispatch Runner -- picks a proposed dispatch and prepares the autonomous spawn.
 *
 * Renamed from `lib/nightshift/runner.ts`. Same blast-radius posture (default
 * dry-run; explicit opt-in to actually invoke the agent), same backend list,
 * same worktree-under-~/coding/tmp policy. The only behavioral change is that
 * the worktree root moved from `~/coding/tmp/nightshift/<id>` to
 * `~/coding/tmp/port-daddy-dispatch-<idShort>` (ADR-0035's chosen naming).
 *
 * First-cut policy: this module DOES NOT spawn an autonomous agent during
 * an operator session. It plans the run -- creates the worktree, derives the
 * branch name, builds the spawn command -- and either prints the plan
 * (default `dryRun: true`) or invokes the spawner adapter (only when
 * `dryRun: false` AND the caller has supplied a real spawner).
 *
 * Blast-radius bounds we enforce here (the rest live in the wrapper /
 * pre-receive hook described in docs/proposals/pd-nightshift.md):
 *   - cwd is a fresh git worktree under `~/coding/tmp/port-daddy-dispatch-<id>`
 *   - branch is always `dispatch/<slug>-<idShort>`; never `main`
 *   - base_branch defaults to 'main' (per dispatch.baseBranch column)
 *   - bypass flag is explicitly chosen per backend
 *   - timeout default is 3h; max 6h (operator override only)
 *   - the spawn command is built but not handed to a shell -- we return
 *     an argv array so callers can spawn the child process without shell.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type { Dispatch, DispatchQueue } from './queue.js';
import { deriveBranchName } from './queue.js';

export const DEFAULT_BUDGET_USD = 5;
export const DEFAULT_TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 hours
export const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours hard ceiling
export const MIN_TIMEOUT_MS = 60 * 1000; // 1 minute floor

export const DISPATCH_WORKTREE_ROOT = join(homedir(), 'coding', 'tmp');

export function deriveWorktreePath(id: string): string {
  const shortId = id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'noid';
  return join(DISPATCH_WORKTREE_ROOT, `port-daddy-dispatch-${shortId}`);
}

export type DispatchBackend = 'cli:claude-code' | 'cli:codex';

export const DEFAULT_BACKEND: DispatchBackend = 'cli:codex';

export interface RunnerPlan {
  dispatch: Dispatch;
  backend: DispatchBackend;
  worktreePath: string;
  branch: string;
  /** `<remote>/<base_branch>` -- the ref the worktree branches from. */
  baseRef: string;
  /** Command + args. Pass to spawnChild WITHOUT a shell. */
  command: string;
  args: string[];
  /** Environment overrides for the spawn. */
  env: Record<string, string>;
  /** Effective timeout for the spawn. */
  timeoutMs: number;
  /** Effective budget for the spawn. */
  budgetUsd: number;
  /** Human-readable explanation for `pd dispatch run --dry-run`. */
  rationale: string[];
}

export interface RunnerOptions {
  /**
   * When false, the runner will actually invoke the spawn adapter. When
   * true (default), the runner returns the plan and does nothing else.
   * Production operator flips this via `pd dispatch run --really-run`.
   */
  dryRun?: boolean;
  /** Backend override. Falls back to the dispatch's stored backend, then to DEFAULT_BACKEND. */
  backend?: DispatchBackend;
  /** Override the remote whose base-branch the worktree branches from. Default: 'origin'. */
  remote?: string;
  /** Spawn adapter -- a thin wrapper around pd sortie / pd spawn. */
  spawnAdapter?: SpawnAdapter;
}

export interface SpawnAdapterInput {
  plan: RunnerPlan;
  queue: DispatchQueue;
}

export interface SpawnAdapterResult {
  state: 'settled' | 'failed' | 'salvage';
  costUsd?: number;
  resultArtifact?: string | null;
  errorMessage?: string | null;
}

export type SpawnAdapter = (input: SpawnAdapterInput) => Promise<SpawnAdapterResult>;

function clampTimeout(requested: number | null | undefined): number {
  if (requested == null || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (requested < MIN_TIMEOUT_MS) return MIN_TIMEOUT_MS;
  if (requested > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;
  return Math.trunc(requested);
}

function clampBudget(requested: number | null | undefined): number {
  if (requested == null || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_BUDGET_USD;
  }
  return Math.min(requested, 25); // 25 USD hard ceiling per dispatch v1
}

/**
 * Build the argv used to launch the backend in autonomous mode. The goal
 * text is always an explicit positional arg so injection is impossible at
 * this layer (no shell interpolation).
 */
export function buildSpawnArgv(
  backend: DispatchBackend,
  worktreePath: string,
  goal: string,
  model?: string,
): { command: string; args: string[] } {
  if (backend === 'cli:claude-code') {
    const args = ['--dangerously-skip-permissions', '-p', goal];
    if (model) args.push('--model', model);
    return { command: 'claude', args };
  }
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--full-auto',
    '--sandbox', 'workspace-write',
    '-C', worktreePath,
    '--json',
  ];
  if (model) args.push('--model', model);
  args.push(goal);
  return { command: 'codex', args };
}

/**
 * Plan a run for a specific dispatch without consuming the queue. Pure and
 * deterministic given the dispatch.
 */
export function planRunFor(dispatch: Dispatch, opts: RunnerOptions = {}): RunnerPlan {
  const backend = opts.backend ?? (dispatch.backend as DispatchBackend | null) ?? DEFAULT_BACKEND;
  if (backend !== 'cli:claude-code' && backend !== 'cli:codex') {
    throw new Error(`planRunFor: unsupported backend ${backend}`);
  }
  const remote = opts.remote ?? 'origin';
  const baseRef = `${remote}/${dispatch.baseBranch}`;
  const branch = deriveBranchName(dispatch.slug, dispatch.id);
  const worktreePath = deriveWorktreePath(dispatch.id);
  const timeoutMs = clampTimeout(dispatch.timeoutMs);
  const budgetUsd = clampBudget(dispatch.budgetUsd);
  const { command, args } = buildSpawnArgv(backend, worktreePath, dispatch.goal);

  const rationale: string[] = [];
  rationale.push(`backend = ${backend}`);
  rationale.push(`worktree = ${worktreePath} (created from ${baseRef})`);
  rationale.push(`branch = ${branch}`);
  rationale.push(`base_branch = ${dispatch.baseBranch}`);
  rationale.push(`merge_policy = ${dispatch.mergePolicy}`);
  rationale.push(`timeout = ${Math.round(timeoutMs / 60000)} min`);
  rationale.push(`budget = $${budgetUsd.toFixed(2)}`);
  if (backend === 'cli:claude-code') {
    rationale.push('claude bypass = --dangerously-skip-permissions');
    rationale.push('blast-radius = wrapper deny-list (PR #161 destructive-op shim is the floor)');
  } else {
    rationale.push('codex bypass = --full-auto --sandbox workspace-write');
    rationale.push('blast-radius = codex sandbox enforces workspace-write');
  }
  if (dispatch.mergePolicy === 'auto') {
    rationale.push('WARNING: merge_policy=auto requires harbormaster (PR #141) -- not yet wired');
  }

  return {
    dispatch,
    backend,
    worktreePath,
    branch,
    baseRef,
    command,
    args,
    env: {
      PD_DISPATCH_ID: dispatch.id,
      PD_DISPATCH_SLUG: dispatch.slug,
      PD_DISPATCH_BRANCH: branch,
      PD_DISPATCH_BASE_BRANCH: dispatch.baseBranch,
    },
    timeoutMs,
    budgetUsd,
    rationale,
  };
}

/**
 * Pop the next proposed dispatch (atomically) and produce a plan for it.
 * Returns null if the queue is empty.
 *
 * If `dryRun` is true (default), the queue transition has NOT happened --
 * the function only inspects what would run. If `dryRun` is false and a
 * spawnAdapter is provided, the queue is transitioned to `claimed` and the
 * adapter is invoked.
 */
export async function runNext(
  queue: DispatchQueue,
  opts: RunnerOptions = {},
): Promise<{ plan: RunnerPlan; result?: SpawnAdapterResult } | null> {
  const dryRun = opts.dryRun !== false; // default true
  if (dryRun) {
    const peeked = [...queue.list({ state: 'proposed' })]
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!peeked) return null;
    return { plan: planRunFor(peeked, opts) };
  }
  if (!opts.spawnAdapter) {
    throw new Error('runNext: dryRun=false requires a spawnAdapter');
  }
  if (!existsSync(DISPATCH_WORKTREE_ROOT)) {
    mkdirSync(DISPATCH_WORKTREE_ROOT, { recursive: true });
  }
  const peeked = [...queue.list({ state: 'proposed' })]
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!peeked) return null;
  const plan = planRunFor(peeked, opts);
  const claimed = queue.nextProposed({
    worktreePath: plan.worktreePath,
    branch: plan.branch,
    sessionId: `pending-${plan.dispatch.id}`,
  });
  if (!claimed) {
    return null;
  }
  const planWithClaimed: RunnerPlan = { ...plan, dispatch: claimed };
  let result: SpawnAdapterResult;
  try {
    result = await opts.spawnAdapter({ plan: planWithClaimed, queue });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    queue.settle({ id: claimed.id, state: 'failed', errorMessage });
    return { plan: planWithClaimed, result: { state: 'failed', errorMessage } };
  }
  // If the adapter didn't already settle, close the lifecycle here.
  const current = queue.get(claimed.id);
  if (current && !['settled', 'failed', 'salvage'].includes(current.state)) {
    queue.settle({
      id: claimed.id,
      state: result.state,
      resultArtifact: result.resultArtifact ?? null,
      costUsd: result.costUsd ?? null,
      errorMessage: result.errorMessage ?? null,
    });
  }
  return { plan: planWithClaimed, result };
}
