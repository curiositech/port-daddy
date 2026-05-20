/**
 * Nightshift Runner -- picks a queued intent and prepares the autonomous spawn.
 *
 * First-cut policy: this module DOES NOT spawn an autonomous agent during
 * a Claude Code (operator) session. It plans the run -- creates the
 * worktree, derives the branch name, builds the spawn command -- and
 * either prints the plan (default `dryRun: true`) or invokes the spawner
 * adapter (only when `dryRun: false` AND the caller has supplied a real
 * spawner). Real autonomous execution is opt-in, operator-flipped.
 *
 * Why a separate runner module instead of inlining in cli/commands:
 *   - the worktree-creation + branch-name + bypass-flag logic is the part
 *     that needs careful review; it deserves its own file with its own
 *     focused tests.
 *   - the runner does not import the spawner directly; it accepts a
 *     `spawnAdapter` so tests can pass a mock and so the CLI can wire it
 *     to a real `pd sortie run` once that integration lands.
 *
 * Blast-radius bounds we enforce here (the rest live in the wrapper /
 * pre-receive hook described in the proposal):
 *   - cwd is a fresh git worktree under `~/coding/tmp/nightshift/<id>`
 *   - branch is always `night-shift/<slug>-<idShort>`; never `main`
 *   - bypass flag is explicitly chosen per backend
 *   - timeout default is 3h; max 6h (operator override only)
 *   - the spawn command is built but not handed to a shell -- we return
 *     an argv array so callers can spawnChild without going through /bin/sh
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type { NightshiftIntent, NightshiftQueue } from './queue.js';
import { deriveBranchName } from './queue.js';

export const DEFAULT_BUDGET_USD = 5;
export const DEFAULT_TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 hours
export const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours hard ceiling
export const MIN_TIMEOUT_MS = 60 * 1000; // 1 minute floor

export const NIGHTSHIFT_WORKTREE_ROOT = join(homedir(), 'coding', 'tmp', 'nightshift');

/**
 * Backends accepted by the runner. `cli:claude-code` and `cli:codex` are
 * the only autonomous-mode backends we have today; other spawner backends
 * (cloudflare, ollama, etc.) are not appropriate for nightshift because
 * they cannot make real edits + commits in a worktree.
 */
export type NightshiftBackend = 'cli:claude-code' | 'cli:codex';

export const DEFAULT_BACKEND: NightshiftBackend = 'cli:codex';

export interface RunnerPlan {
  intent: NightshiftIntent;
  backend: NightshiftBackend;
  worktreePath: string;
  branchName: string;
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
  /** Human-readable explanation for `pd nightshift run --dry-run`. */
  rationale: string[];
}

export interface RunnerOptions {
  /**
   * When false, the runner will actually invoke the spawn adapter. When
   * true (default), the runner returns the plan and does nothing else.
   * Production operator flips this via `pd nightshift run --really-run`.
   */
  dryRun?: boolean;
  /**
   * Backend override. Falls back to the intent's stored backend, then to
   * DEFAULT_BACKEND.
   */
  backend?: NightshiftBackend;
  /** Override the base ref the worktree branches from. Default: origin/main. */
  baseRef?: string;
  /**
   * Spawn adapter -- a thin wrapper around pd sortie / pd spawn. When
   * `dryRun` is false the runner calls this with the plan. The adapter is
   * responsible for: creating the worktree, kicking off the spawn,
   * watching it, calling `queue.markComplete` on terminal exit.
   *
   * The runner does NOT invoke `claude` or `codex` directly. That keeps
   * the runner deterministic and testable, and ensures the actual spawn
   * goes through the same `pd spawn` path that has bonding/telemetry/cost
   * enforcement built in.
   */
  spawnAdapter?: SpawnAdapter;
}

export interface SpawnAdapterInput {
  plan: RunnerPlan;
  queue: NightshiftQueue;
}

export interface SpawnAdapterResult {
  status: 'succeeded' | 'failed' | 'aborted' | 'timeout';
  costUsd?: number;
  prUrl?: string | null;
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
  return Math.min(requested, 25); // 25 USD hard ceiling per intent v1
}

/**
 * Build the argv used to launch the backend in autonomous mode. We never
 * concatenate the intent text into a shell string -- it is always an
 * explicit positional arg so injection is impossible at this layer.
 */
export function buildSpawnArgv(
  backend: NightshiftBackend,
  worktreePath: string,
  intent: string,
  model?: string,
): { command: string; args: string[] } {
  if (backend === 'cli:claude-code') {
    const args = ['--dangerously-skip-permissions', '-p', intent];
    if (model) args.push('--model', model);
    return { command: 'claude', args };
  }
  // cli:codex
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--full-auto',
    '--sandbox', 'workspace-write',
    '-C', worktreePath,
    '--json',
  ];
  if (model) args.push('--model', model);
  args.push(intent);
  return { command: 'codex', args };
}

export function deriveWorktreePath(id: string): string {
  return join(NIGHTSHIFT_WORKTREE_ROOT, id);
}

/**
 * Plan a run for a specific intent (without consuming the queue). Used by
 * `pd nightshift run <id> --dry-run` for operator preview. The plan is
 * pure and deterministic given the intent.
 */
export function planRunFor(intent: NightshiftIntent, opts: RunnerOptions = {}): RunnerPlan {
  const backend = opts.backend ?? (intent.backend as NightshiftBackend | null) ?? DEFAULT_BACKEND;
  if (backend !== 'cli:claude-code' && backend !== 'cli:codex') {
    throw new Error(`planRunFor: unsupported backend ${backend}`);
  }
  const baseRef = opts.baseRef ?? 'origin/main';
  const branchName = deriveBranchName(intent.slug, intent.id);
  const worktreePath = deriveWorktreePath(intent.id);
  const timeoutMs = clampTimeout(intent.timeoutMs);
  const budgetUsd = clampBudget(intent.budgetUsd);
  const { command, args } = buildSpawnArgv(backend, worktreePath, intent.intent);

  const rationale: string[] = [];
  rationale.push(`backend = ${backend}`);
  rationale.push(`worktree = ${worktreePath} (created from ${baseRef})`);
  rationale.push(`branch = ${branchName}`);
  rationale.push(`timeout = ${Math.round(timeoutMs / 60000)} min`);
  rationale.push(`budget = $${budgetUsd.toFixed(2)}`);
  if (backend === 'cli:claude-code') {
    rationale.push('claude bypass = --dangerously-skip-permissions');
    rationale.push('blast-radius = wrapper deny-list (NOT YET WIRED in first cut)');
  } else {
    rationale.push('codex bypass = --full-auto --sandbox workspace-write');
    rationale.push('blast-radius = codex sandbox enforces workspace-write');
  }

  return {
    intent,
    backend,
    worktreePath,
    branchName,
    baseRef,
    command,
    args,
    env: {
      PD_NIGHTSHIFT_ID: intent.id,
      PD_NIGHTSHIFT_SLUG: intent.slug,
      PD_NIGHTSHIFT_BRANCH: branchName,
    },
    timeoutMs,
    budgetUsd,
    rationale,
  };
}

/**
 * Pop the next queued intent (atomically) and produce a plan for it.
 * Returns null if the queue is empty.
 *
 * If `dryRun` is true (default), the queue transition has NOT happened --
 * the function only inspects what would run. If `dryRun` is false and a
 * spawnAdapter is provided, the queue is transitioned to `running` and
 * the adapter is invoked.
 *
 * This separation is important: tests for the runner stay deterministic
 * (no spawn side-effects), while production wiring can still hand off to
 * the real spawner.
 */
export async function runNext(
  queue: NightshiftQueue,
  opts: RunnerOptions = {},
): Promise<{ plan: RunnerPlan; result?: SpawnAdapterResult } | null> {
  const dryRun = opts.dryRun !== false; // default true
  if (dryRun) {
    // Peek without consuming. We read the open list and take the oldest
    // queued one. That keeps `runNext --dry-run` non-destructive.
    const candidates = queue.list({ status: 'queued', limit: 1 });
    if (candidates.length === 0) return null;
    // queue.list returns newest first; we want oldest queued. Re-sort.
    const intent = [...queue.list({ status: 'queued' })]
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!intent) return null;
    return { plan: planRunFor(intent, opts) };
  }
  if (!opts.spawnAdapter) {
    throw new Error('runNext: dryRun=false requires a spawnAdapter');
  }
  // Real path: ensure the worktree root exists, atomically claim, plan,
  // hand off to the adapter, record the result.
  if (!existsSync(NIGHTSHIFT_WORKTREE_ROOT)) {
    mkdirSync(NIGHTSHIFT_WORKTREE_ROOT, { recursive: true });
  }
  // We need the plan before next() so we can pass worktreePath/branchName
  // into the running-state record. Peek first.
  const peek = [...queue.list({ status: 'queued' })]
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!peek) return null;
  const plan = planRunFor(peek, opts);
  const claimed = queue.next({
    worktreePath: plan.worktreePath,
    branchName: plan.branchName,
    sessionId: `pending-${plan.intent.id}`, // adapter overwrites once it begins a real session
  });
  if (!claimed) {
    // Someone else picked it between peek and next(). That is fine -- just
    // return null and let the caller try again on the next cron tick.
    return null;
  }
  const planWithClaimed: RunnerPlan = { ...plan, intent: claimed };
  let result: SpawnAdapterResult;
  try {
    result = await opts.spawnAdapter({ plan: planWithClaimed, queue });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    queue.markComplete({
      id: claimed.id,
      status: 'failed',
      errorMessage,
    });
    return { plan: planWithClaimed, result: { status: 'failed', errorMessage } };
  }
  // If the adapter already called markComplete, this is a no-op for the
  // status row; if it did not, we close the lifecycle here.
  const current = queue.get(claimed.id);
  if (current && current.status === 'running') {
    queue.markComplete({
      id: claimed.id,
      status: result.status,
      prUrl: result.prUrl ?? null,
      costUsd: result.costUsd ?? null,
      errorMessage: result.errorMessage ?? null,
    });
  }
  return { plan: planWithClaimed, result };
}
