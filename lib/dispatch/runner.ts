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

import type { Dispatch, DispatchQueue, DispatchBackend } from './queue.js';
import { deriveBranchName } from './queue.js';
import type { TubeClientLike } from '../spawner/backends/cli-tube.js';

// Re-export the canonical DispatchBackend (defined in ./queue.js to avoid an
// import cycle) so existing importers of `runner.js` keep working unchanged.
export type { DispatchBackend } from './queue.js';

/**
 * Compute a run's USD cost from the exact token usage the backend reported.
 * Injected from the daemon (built on the cost tracker's rate table) so dispatch
 * uses the SAME pricing path as every other spawn — no parallel parser. When no
 * cost function is wired (e.g. the CLI foreground path with no daemon), the
 * adapter records `costUsd: null` rather than inventing a number.
 */
export type DispatchCostFn = (params: {
  backend: DispatchBackend;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}) => number | undefined;

export const DEFAULT_BUDGET_USD = 5;
export const DEFAULT_TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 hours
export const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours hard ceiling
export const MIN_TIMEOUT_MS = 60 * 1000; // 1 minute floor

export const DISPATCH_WORKTREE_ROOT = join(homedir(), 'coding', 'tmp');

export function deriveWorktreePath(id: string): string {
  const shortId = id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'noid';
  return join(DISPATCH_WORKTREE_ROOT, `port-daddy-dispatch-${shortId}`);
}

// `DispatchBackend` is the full cli-tube backend set (ADR-0060 fold-in widened
// it from the original claude-code/codex pair). It is defined canonically in
// ./queue.js and re-exported above; the runtime allow-list below mirrors it.
const SUPPORTED_BACKENDS: ReadonlySet<DispatchBackend> = new Set<DispatchBackend>([
  'cli:claude-code',
  'cli:codex',
  'cli:agy',
  'cli:gemini',
  'cli:groq',
  'cli:grok',
]);

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
  /**
   * Optional model override forwarded to the cli-tube spawn (`--model`). Absent
   * → the CLI uses its authenticated account's default (claude-code → `sonnet`
   * via cli-tube buildArgs). Set by RunnerOptions.model (e.g. a cheap
   * `claude-haiku-4-5` for trivial dispatches).
   */
  model?: string;
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
  /**
   * Model override forwarded to the cli-tube spawn (`--model`). Absent → the CLI
   * default. Use to pin a cheap model (e.g. `claude-haiku-4-5`) for trivial work.
   */
  model?: string;
  /** Override the remote whose base-branch the worktree branches from. Default: 'origin'. */
  remote?: string;
  /** Spawn adapter used by dispatch to launch delegated work through pd spawn. */
  spawnAdapter?: SpawnAdapter;
  /**
   * Optional tube client. When provided, the dispatch's claude/codex exchange
   * is published on a tube channel so the operator can watch it live with
   * `pd tube dispatch:<id>`. Best-effort: a publish failure never fails the
   * dispatch. Absent on the CLI foreground path (no daemon) — the run still
   * happens, just without tube transparency.
   */
  tubeClient?: TubeClientLike;
  /**
   * Optional cost function. Converts the backend's exact token usage into USD
   * via the daemon's shared rate table (cost tracker). Absent → costUsd null.
   */
  costFn?: DispatchCostFn;
}

export interface SpawnAdapterInput {
  plan: RunnerPlan;
  queue: DispatchQueue;
  /** Forwarded from RunnerOptions so the adapter can publish on a tube. */
  tubeClient?: TubeClientLike;
  /** Forwarded from RunnerOptions so the adapter prices the run. */
  costFn?: DispatchCostFn;
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
  if (backend === 'cli:codex') {
    // `codex exec` is non-interactive by construction. We pass `--sandbox
    // workspace-write` for blast-radius (writes confined to the worktree) and
    // NOT the legacy `--full-auto` flag, which recent codex deprecates in favor
    // of `--sandbox` ("warning: `--full-auto` is deprecated; use `--sandbox
    // workspace-write` instead"). The deprecation warning was polluting the
    // captured transcript and the redundant flag bought nothing.
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--sandbox', 'workspace-write',
      '-C', worktreePath,
      '--json',
    ];
    if (model) args.push('--model', model);
    args.push(goal);
    return { command: 'codex', args };
  }
  // gemini / groq / grok — all three share the claude-code-style headless
  // surface: `-p <prompt>` runs one non-interactive turn, `--model` overrides
  // the model (mirrors cli-tube.ts buildArgs). NOTE: this argv is only used for
  // the dry-run rationale display; the real spawn goes through the Conductor's
  // cli-tube spawner (which builds its own stream/tube-aware argv). The command
  // name is the CLI binary (gemini/groq/grok), stripped of the `cli:` prefix.
  const cliName = backend.slice('cli:'.length);
  const args = ['-p'];
  if (model) args.push('--model', model);
  args.push(goal);
  return { command: cliName, args };
}

/**
 * Plan a run for a specific dispatch without consuming the queue. Pure and
 * deterministic given the dispatch.
 */
export function planRunFor(dispatch: Dispatch, opts: RunnerOptions = {}): RunnerPlan {
  const backend = opts.backend ?? (dispatch.backend as DispatchBackend | null) ?? DEFAULT_BACKEND;
  if (!SUPPORTED_BACKENDS.has(backend)) {
    throw new Error(`planRunFor: unsupported backend ${backend}`);
  }
  const remote = opts.remote ?? 'origin';
  const baseRef = `${remote}/${dispatch.baseBranch}`;
  const branch = deriveBranchName(dispatch.slug, dispatch.id);
  const worktreePath = deriveWorktreePath(dispatch.id);
  const timeoutMs = clampTimeout(dispatch.timeoutMs);
  const budgetUsd = clampBudget(dispatch.budgetUsd);
  const model = opts.model;
  const { command, args } = buildSpawnArgv(backend, worktreePath, dispatch.goal, model);

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
  } else if (backend === 'cli:codex') {
    rationale.push('codex sandbox = --sandbox workspace-write (self-confining; not double-wrapped)');
    rationale.push('blast-radius = codex sandbox enforces workspace-write');
  } else {
    // gemini / groq / grok have no built-in OS sandbox; the isolated worktree
    // under ~/coding/tmp is the blast-radius boundary (same as claude-code).
    rationale.push(`${backend.slice('cli:'.length)} headless = -p <goal> (one non-interactive turn)`);
    rationale.push('blast-radius = isolated worktree (no built-in CLI sandbox)');
  }
  if (model) {
    rationale.push(`model = ${model}`);
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
    model,
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
  return runClaimedDispatch(queue, claimed, opts);
}

/**
 * Run a dispatch that has ALREADY been claimed (state === 'claimed'), invoking
 * the spawn adapter and closing the lifecycle. Pure-ish: deterministic given
 * the dispatch + adapter.
 *
 * This is the seam the daemon-side worker uses: the worker claims work
 * atomically via `queue.nextProposed(...)` (so two workers never grab the same
 * row), then hands the claimed dispatch here to actually run it. `runNext`
 * delegates to this after its own claim so both paths share one code path.
 *
 * Requires `opts.spawnAdapter`. Settles the dispatch to the adapter's terminal
 * state (or `failed` on adapter exception) if the adapter did not already.
 */
export async function runClaimedDispatch(
  queue: DispatchQueue,
  claimed: Dispatch,
  opts: RunnerOptions = {},
): Promise<{ plan: RunnerPlan; result: SpawnAdapterResult }> {
  if (!opts.spawnAdapter) {
    throw new Error('runClaimedDispatch: requires a spawnAdapter');
  }
  if (claimed.state !== 'claimed') {
    throw new Error(
      `runClaimedDispatch: dispatch ${claimed.id} must be 'claimed', got '${claimed.state}'`,
    );
  }
  const plan = planRunFor(claimed, opts);
  const planWithClaimed: RunnerPlan = { ...plan, dispatch: claimed };
  let result: SpawnAdapterResult;
  try {
    result = await opts.spawnAdapter({
      plan: planWithClaimed,
      queue,
      tubeClient: opts.tubeClient,
      costFn: opts.costFn,
    });
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
