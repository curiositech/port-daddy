/**
 * lib/dispatch/spawn-adapter.ts — the real SpawnAdapter for pd dispatch --really-run.
 *
 * Implements the SpawnAdapter interface from lib/dispatch/runner.ts by composing
 * three existing pieces:
 *
 *   1. git worktree add — create an isolated checkout under ~/coding/tmp so the
 *      dispatched agent never touches the operator's main checkout. Branch name
 *      is `dispatch/<slug>-<idShort>` (already derived by runner.ts).
 *
 *   2. cli-tube backend (spawnViaCliTube) — drive the operator's LOCAL
 *      `claude`/`codex` (unmetered Claude Max = $0 marginal), publish the
 *      exchange on a tube channel (`dispatch:<id>`) for live `pd tube`, and
 *      capture exact cost from the stream-json via the SAME extractor the
 *      sortie path uses. Blast-radius: isolated worktree + codex self-sandbox.
 *
 *   3. gh pr create --draft — once the agent exits, push the branch and open a
 *      draft PR. PR body carries the intent, the worktree path (transcript
 *      pointer), and a "dispatched by pd" attribution. The PR URL is stored as
 *      `resultArtifact` on the queue row.
 *
 * Lifecycle the adapter drives:
 *   claimed → start (in_progress) → produce (produced, PR url) → settle(settled)
 *              └── on error: settle(failed, errorMessage)
 *
 * HONESTY: backend availability is checked before spawning. If the required CLI
 * tool (`claude` or `codex`) is not on PATH, the adapter fails loudly with a
 * clear install message — it never silently no-ops.
 *
 * WORKTREE ROOT: must resolve under ~/coding/tmp (or ~/.port-daddy). The runner's
 * DISPATCH_WORKTREE_ROOT is already set to ~/coding/tmp, verified below at
 * construction time. Never /tmp — macOS purges /tmp on a timer.
 */

import { execFileSync, execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

import {
  type SpawnAdapter,
  type SpawnAdapterInput,
  type SpawnAdapterResult,
  type DispatchCostFn,
  type DispatchBackend,
  DISPATCH_WORKTREE_ROOT,
} from './runner.js';
import {
  spawnViaCliTube,
  type CliTubeTool,
  type TubeClientLike,
} from '../spawner/backends/cli-tube.js';
import { extractClaudeCodeUsage } from '../spawner/cli-claude-code-transcript.js';

const execFileAsync = promisify(execFile);

// ── Sanity-check the worktree root at module load ─────────────────────────────
// The operator global rule: NEVER write to /tmp. The root must live under
// ~/coding or ~/.port-daddy. We check here so a misconfigured env fails at
// import time, not mid-dispatch.
const _home = homedir();
const _allowedRoots = [
  join(_home, 'coding'),
  join(_home, '.port-daddy'),
];
const _resolvedRoot = resolve(DISPATCH_WORKTREE_ROOT);
if (!_allowedRoots.some((r) => _resolvedRoot.startsWith(r))) {
  throw new Error(
    `dispatch/spawn-adapter: DISPATCH_WORKTREE_ROOT (${DISPATCH_WORKTREE_ROOT}) ` +
    `resolves to ${_resolvedRoot} which is outside the allowed roots ` +
    `(${_allowedRoots.join(', ')}). ` +
    `Never write to /tmp — macOS purges it. Fix DISPATCH_WORKTREE_ROOT.`,
  );
}

// ── CLI availability check ─────────────────────────────────────────────────────

function whichSync(bin: string): string | null {
  try {
    const result = execFileSync('which', [bin], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return result.trim() || null;
  } catch {
    return null;
  }
}

export function requireCli(bin: string): string {
  const found = whichSync(bin);
  if (!found) {
    throw new Error(
      `dispatch spawn-adapter: '${bin}' is not on PATH. ` +
      (bin === 'claude'
        ? 'Install the Claude CLI: https://docs.anthropic.com/claude-code/cli'
        : bin === 'codex'
          ? 'Install Codex CLI: npm install -g @openai/codex'
          : `Install '${bin}' and ensure it is on PATH.`) +
      ' Then retry: pd dispatch run --really-run',
    );
  }
  return found;
}

// ── git helpers ────────────────────────────────────────────────────────────────

export async function gitWorktreeAdd(
  worktreePath: string,
  branch: string,
  baseRef: string,
): Promise<void> {
  if (existsSync(worktreePath)) {
    // Already exists — may be from a previous interrupted run. Re-use it.
    return;
  }
  // Freshness: a dispatch (especially the overnight `run --next` cron) must
  // branch from the CURRENT tip of the base ref, not whatever the local
  // remote-tracking ref happened to be at last fetch. `baseRef` is
  // `<remote>/<branch>` (e.g. origin/main); fetch that branch before carving
  // the worktree so the dispatched agent starts from up-to-date code. A fetch
  // failure (offline) is non-fatal — fall back to the local tracking ref.
  const slash = baseRef.indexOf('/');
  if (slash > 0) {
    const remote = baseRef.slice(0, slash);
    const branchName = baseRef.slice(slash + 1);
    try {
      await execFileAsync('git', ['fetch', remote, branchName]);
    } catch {
      /* offline or no remote — branch from the local tracking ref */
    }
  }
  // A previous run (e.g. one the daemon was mid-flight on when it was killed)
  // may have already CREATED the branch even though its worktree directory was
  // reaped. `git worktree add -b <branch>` fails hard in that case ("a branch
  // named '<branch>' already exists"), which would strand a recovered dispatch
  // on every retry. Detect the existing branch and, if present, attach the
  // worktree to it (no `-b`) so crash recovery is genuinely idempotent.
  let branchExists = false;
  try {
    await execFileAsync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    branchExists = true;
  } catch {
    branchExists = false;
  }
  if (branchExists) {
    // Re-attach the worktree to the existing branch and reset it to the fresh
    // base ref so the dispatched agent still starts from up-to-date code rather
    // than the abandoned mid-crash state.
    await execFileAsync('git', ['worktree', 'add', '--force', worktreePath, branch]);
    try {
      await execFileAsync('git', ['-C', worktreePath, 'reset', '--hard', baseRef]);
    } catch {
      /* base ref unreachable (offline) — keep the existing branch tip */
    }
    return;
  }
  // git worktree add <path> -b <branch> <baseRef>
  // Run from the repo root (process.cwd() when running as the pd CLI).
  await execFileAsync('git', [
    'worktree', 'add',
    worktreePath,
    '-b', branch,
    baseRef,
  ]);
}

/**
 * Disable the Coordination Guard inside the (isolated, disposable) dispatch
 * worktree. The guard's `requireSession`/`requireClaims` are designed to keep
 * MULTIPLE agents from clobbering each other on a SHARED checkout — but a
 * dispatch worktree is a fresh branch in its own directory with exactly one
 * occupant (the autonomous agent) and no operator shell to run `pd begin`.
 * Left enforcing, the pre-commit hook rejects the agent's commit ("No active
 * Port Daddy session…"), so the run produces a branch with zero commits and
 * `gh pr create` fails with "No commits between main and …". The guard config
 * is resolved per-cwd (`<cwd>/.portdaddy/coordination-guard.json`), so writing
 * `off` here scopes the bypass to THIS worktree only; the operator's main
 * checkout keeps its enforcing guard untouched.
 */
function disableGuardInWorktree(worktreePath: string): void {
  try {
    const dir = join(worktreePath, '.portdaddy');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'coordination-guard.json'),
      JSON.stringify(
        { enabled: false, mode: 'off', requireSession: false, requireClaims: false },
        null,
        2,
      ),
      'utf8',
    );
  } catch {
    /* best-effort; if it fails the commit may be blocked but we surface that downstream */
  }
}

async function gitPushBranch(worktreePath: string, branch: string): Promise<void> {
  await execFileAsync('git', ['-C', worktreePath, 'push', '-u', 'origin', branch]);
}

/**
 * Reap a dispatch worktree once the run reaches a terminal state. The branch is
 * already pushed (or the run failed with nothing to keep), so the on-disk
 * worktree is disposable. `git worktree remove --force` detaches it from the
 * repo's worktree list AND deletes the directory; a follow-up `git worktree
 * prune` cleans any dangling administrative entry. Best-effort: a reap failure
 * must never flip a settled dispatch back to failed, so callers swallow errors.
 *
 * Honest scoping: we reap from the MAIN repo (process.cwd at daemon start),
 * because `git worktree remove` must run from a checkout that knows about the
 * worktree, not from inside the worktree being removed.
 */
export async function reapWorktree(worktreePath: string): Promise<void> {
  if (!existsSync(worktreePath)) return;
  try {
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath]);
  } catch {
    // The worktree may have uncommitted state git refuses to remove, or it was
    // created outside the current repo. Fall back to a raw rm + prune so the
    // disk doesn't accumulate stranded dispatch dirs overnight.
    try {
      execFileSync('rm', ['-rf', worktreePath]);
    } catch { /* give up — surfaced via logs, not a dispatch failure */ }
  }
  try {
    await execFileAsync('git', ['worktree', 'prune']);
  } catch { /* prune is housekeeping; non-fatal */ }
}

// ── gh pr create (draft) ─────────────────────────────────────────────────────

export async function openDraftPr(params: {
  branch: string;
  baseBranch: string;
  goal: string;
  dispatchId: string;
  worktreePath: string;
}): Promise<string> {
  const title = `[dispatch] ${params.goal.slice(0, 60)}${params.goal.length > 60 ? '...' : ''}`;
  const body = [
    `## Dispatched intent`,
    '',
    params.goal,
    '',
    `## Provenance`,
    '',
    `- Dispatch ID: \`${params.dispatchId}\``,
    `- Worktree: \`${params.worktreePath}\``,
    `- Dispatched by: pd dispatch --really-run`,
    '',
    `> This PR was opened automatically by \`pd dispatch run --really-run\`. ` +
    `Review the diff, then run \`pd review --accept ${params.dispatchId}\` or ` +
    `\`pd review --reject ${params.dispatchId} --reason "..."\`.`,
  ].join('\n');

  const { stdout } = await execFileAsync('gh', [
    'pr', 'create',
    '--draft',
    '--title', title,
    '--body', body,
    '--head', params.branch,
    '--base', params.baseBranch,
  ], { cwd: params.worktreePath });

  // gh pr create outputs the PR URL as the last non-empty line of stdout.
  const lines = stdout.trim().split('\n').filter(Boolean);
  const prUrl = lines[lines.length - 1]?.trim() ?? '';
  if (!prUrl.startsWith('https://')) {
    throw new Error(`gh pr create returned unexpected output: ${stdout.slice(0, 200)}`);
  }
  return prUrl;
}

// ── cli-tube agent runner ──────────────────────────────────────────────────────
//
// Dispatch now drives the operator's LOCAL `claude` / `codex` through the
// shared cli-tube backend (`spawnViaCliTube`) — the SAME path `pd sortie` uses.
// Why this matters:
//   (a) Claude Max ($200/mo flat) → routing through the local `claude` CLI is
//       $0 marginal per dispatch. That unmetered-local-CLI economics IS the
//       product's pitch; spawning `claude` raw here bypassed it.
//   (b) cli-tube PUBLISHES the exchange on a tube channel, so the operator can
//       watch the dispatch live with `pd tube dispatch:<id>`.
//   (c) Cost comes from the cli-tube stream-json `rawStdout` via the SAME
//       `extractClaudeCodeUsage` the sortie path uses — no parallel parser.
//
// Blast-radius: codex self-sandboxes (`--sandbox workspace-write`, which
// cli-tube's buildArgs already passes) and the dispatch runs inside an isolated
// git worktree under ~/coding/tmp, so the agent never touches the operator's
// main checkout. (The previous Coast Guard seatbelt double-wrap is dropped: it
// nested two sandbox-exec profiles around codex and silently blocked all file
// writes; cli-tube does not re-wrap, matching the sortie backend.)

export interface CliTubeRunResult {
  /** Final answer (claude) / last message (codex). */
  output: string;
  /** The unmodified stream-json / JSONL — what cost extraction parses. */
  rawStdout: string;
  exitCode: number;
  error: string | null;
  /** Channel the exchange was published on (null when no tube client). */
  tube: string | null;
}

export async function runAgentViaCliTube(params: {
  cli: CliTubeTool;
  goal: string;
  worktreePath: string;
  model?: string;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  tube: string;
  tubeClient?: TubeClientLike;
  tubeSender: string;
}): Promise<CliTubeRunResult> {
  const result = await spawnViaCliTube({
    cli: params.cli,
    prompt: params.goal,
    cwd: params.worktreePath,
    model: params.model,
    timeoutMs: params.timeoutMs,
    env: params.env,
    // Dispatch is unattended-autonomous by design: the agent must edit + commit
    // without an interactive prompt. The isolated worktree is the blast-radius
    // bound (codex also self-sandboxes). This restores the autonomy the legacy
    // raw spawn had via `--dangerously-skip-permissions`.
    autonomous: true,
    tube: params.tube,
    // Publishing is best-effort inside spawnViaCliTube (it swallows publish
    // errors), so a dead/absent tube never fails a dispatch. When tubeClient is
    // undefined, the wrapper simply doesn't publish.
    tubeClient: params.tubeClient,
    tubeSender: params.tubeSender,
  });
  return {
    output: result.output,
    rawStdout: result.rawStdout,
    exitCode: result.exitCode,
    error: result.error,
    tube: result.tube,
  };
}

/**
 * Price a dispatch run from its captured cli-tube output. For claude-code we
 * pull EXACT token usage out of the stream-json (`extractClaudeCodeUsage`) — the
 * same extraction the sortie path uses — and hand it to the injected `costFn`
 * (built on the daemon's shared rate table). Returns undefined when usage is
 * absent or no costFn is wired (caller records null), never a fabricated number.
 */
export function computeDispatchCostUsd(params: {
  backend: DispatchBackend;
  model?: string;
  rawStdout: string;
  costFn?: DispatchCostFn;
}): number | undefined {
  if (!params.costFn) return undefined;
  if (params.backend === 'cli:claude-code') {
    const usage = extractClaudeCodeUsage(params.rawStdout);
    if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
      return undefined;
    }
    return params.costFn({
      backend: params.backend,
      model: params.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
    });
  }
  // codex: exact-usage parsing (parseCodexUsage) lives in the monolithic
  // lib/spawner.ts and isn't cleanly importable here without dragging the whole
  // module. Record null for codex until that parser is extracted — honest over
  // a fabricated estimate. (claude-code is dispatch's primary, $0-marginal path.)
  return undefined;
}

// ── The adapter factory ───────────────────────────────────────────────────────

export interface SpawnAdapterOptions {
  /**
   * Injectable spawn function for unit tests. When provided, no real subprocess
   * (and no real cli-tube spawn) is started; the function receives the resolved
   * cli-tube invocation the real adapter would run and returns a CliTubeRunResult
   * (output + rawStdout for cost extraction + tube channel + exit/error). Tests
   * use it to drive cost/tube/PR paths without spawning `claude`/`codex`.
   */
  spawnFn?: (params: {
    cli: CliTubeTool;
    goal: string;
    worktreePath: string;
    model?: string;
    env: Record<string, string | undefined>;
    timeoutMs: number;
    tube: string;
    tubeClient?: TubeClientLike;
    tubeSender: string;
  }) => Promise<CliTubeRunResult>;

  /**
   * Injectable git-worktree creation function for unit tests.
   * When provided, no real git subprocess is spawned.
   */
  worktreeAddFn?: (worktreePath: string, branch: string, baseRef: string) => Promise<void>;

  /**
   * Injectable gh-pr-create function for unit tests.
   * When provided, no real `gh` subprocess is spawned.
   */
  openPrFn?: (params: {
    branch: string;
    baseBranch: string;
    goal: string;
    dispatchId: string;
    worktreePath: string;
  }) => Promise<string>;
}

/**
 * Build a SpawnAdapter. Compose worktree isolation, a cli-tube spawn of the
 * operator's local claude/codex (with tube publishing + exact-usage cost), and
 * draft PR creation so `pd dispatch run --really-run` actually builds the intent
 * and opens a draft PR.
 *
 * All three injectable functions default to the real implementations but can
 * be replaced in unit tests to avoid network/filesystem/subprocess side effects.
 */
export function createSpawnAdapter(opts: SpawnAdapterOptions = {}): SpawnAdapter {
  const _worktreeAdd = opts.worktreeAddFn ?? gitWorktreeAdd;
  const _openPr = opts.openPrFn ?? openDraftPr;
  const _spawn = opts.spawnFn ?? runAgentViaCliTube;

  return async function spawnAdapterImpl(
    input: SpawnAdapterInput,
  ): Promise<SpawnAdapterResult> {
    const { plan, queue, tubeClient, costFn } = input;
    const dispatch = plan.dispatch;

    // ── 0. Verify CLI binaries are on PATH (loud-fail, not silent no-op) ──────
    if (!opts.spawnFn) {
      const cliBin = plan.backend === 'cli:claude-code' ? 'claude' : 'codex';
      requireCli(cliBin);
      requireCli('git');
      requireCli('gh');
    }

    // ── 1. Create the isolated git worktree ─────────────────────────────────
    try {
      await _worktreeAdd(plan.worktreePath, plan.branch, plan.baseRef);
    } catch (err) {
      const msg = `Failed to create worktree at ${plan.worktreePath} (branch ${plan.branch} from ${plan.baseRef}): ${(err as Error).message}`;
      queue.settle({ id: dispatch.id, state: 'failed', errorMessage: msg });
      return { state: 'failed', errorMessage: msg };
    }

    // Scope-disable the Coordination Guard inside the isolated worktree so the
    // autonomous agent can commit without an interactive `pd begin` session.
    disableGuardInWorktree(plan.worktreePath);

    // ── 2. Transition: claimed → in_progress ────────────────────────────────
    try {
      queue.start(dispatch.id);
    } catch (err) {
      // The dispatch may have been cancelled by the operator between claim and
      // start. Report honestly rather than proceeding blindly.
      const msg = `Failed to transition dispatch ${dispatch.id} to in_progress: ${(err as Error).message}`;
      return { state: 'failed', errorMessage: msg };
    }

    // ── 3. Spawn the agent in the worktree via cli-tube ──────────────────────
    // Drives the operator's LOCAL `claude`/`codex` (unmetered Claude Max = $0
    // marginal) AND publishes the exchange on a tube channel for live `pd tube`.
    const agentEnv: Record<string, string | undefined> = {
      ...process.env,
      ...plan.env,
      PD_DISPATCH_WORKTREE: plan.worktreePath,
    };
    const cli: CliTubeTool = plan.backend === 'cli:claude-code' ? 'claude-code' : 'codex';
    // Stable, operator-discoverable channel: `dispatch:<id>` — the operator
    // already knows the dispatch id, so they can `pd tube dispatch:<id>` without
    // hunting for a random cli:<tool>:<uuid> channel.
    const tubeChannel = `dispatch:${dispatch.id}`;

    let agentError: string | null = null;
    let agentOutput = '';
    let agentRawStdout = '';
    let publishedTube: string | null = null;
    const spawnStart = Date.now();

    try {
      const result = await _spawn({
        cli,
        goal: dispatch.goal,
        worktreePath: plan.worktreePath,
        model: plan.model,
        env: agentEnv,
        timeoutMs: plan.timeoutMs,
        tube: tubeChannel,
        tubeClient,
        tubeSender: `dispatch:${dispatch.id}`,
      });
      agentError = result.error;
      agentOutput = result.output;
      agentRawStdout = result.rawStdout;
      publishedTube = result.tube;
    } catch (err) {
      agentError = (err as Error).message;
    }

    const durationMs = Date.now() - spawnStart;
    void publishedTube;
    // Real cost capture: pull EXACT token usage from the cli-tube stream-json
    // (`extractClaudeCodeUsage`) — the SAME path the sortie spawner uses — and
    // price it through the daemon's shared rate table (`costFn`). Null when the
    // run reported no usage or no costFn is wired (CLI foreground). No parallel
    // parser, no fabricated number.
    const costUsd = computeDispatchCostUsd({
      backend: plan.backend,
      model: plan.model,
      rawStdout: agentRawStdout,
      costFn,
    });
    void durationMs;

    // ── 4. Push branch and open draft PR ─────────────────────────────────────
    // We attempt even if the agent returned an error, since partial commits
    // may still be reviewable. Push failure (nothing committed) is handled below.
    let prUrl: string | null = null;
    let prError: string | null = null;

    if (!opts.spawnFn) {
      // Real path: push then open PR.
      try {
        await gitPushBranch(plan.worktreePath, plan.branch);
      } catch (err) {
        prError = `git push failed: ${(err as Error).message}`;
      }
    }

    if (!prError) {
      try {
        prUrl = await _openPr({
          branch: plan.branch,
          baseBranch: dispatch.baseBranch,
          goal: dispatch.goal,
          dispatchId: dispatch.id,
          worktreePath: plan.worktreePath,
        });
      } catch (err) {
        prError = `gh pr create failed: ${(err as Error).message}`;
      }
    }

    // ── 5. Settle the queue ───────────────────────────────────────────────────
    const combinedError = [agentError, prError].filter(Boolean).join('; ') || null;

    if (prUrl) {
      // PR opened. Walk the lifecycle fully through to review_pending, then
      // settle to 'settled' so runNext()'s outer cleanup guard sees a terminal
      // state and does not double-settle. The PR url is in resultArtifact —
      // the operator does their review on the actual GitHub PR; `pd review` is
      // still wired if the operator wants to close the dispatch loop explicitly.
      try {
        queue.produce({ id: dispatch.id, resultArtifact: prUrl });
      } catch { /* race */ }
      try {
        queue.requestReview(dispatch.id);
      } catch { /* race */ }
      // Settle to 'settled' — terminal state. runNext() will see the row is
      // already terminal and skip its own settle call.
      queue.settle({
        id: dispatch.id,
        state: 'settled',
        resultArtifact: prUrl,
        costUsd: costUsd ?? null,
        errorMessage: combinedError,
      });
      return {
        state: 'settled',
        resultArtifact: prUrl,
        costUsd,
        errorMessage: combinedError,
      };
    }

    // No PR: agent produced nothing committable, or push/open failed. The agent
    // still ran and spent money, so record whatever cost it reported.
    const finalError =
      combinedError ??
      `Agent ran but produced no committable output and no PR was opened.`;

    queue.settle({ id: dispatch.id, state: 'failed', costUsd: costUsd ?? null, errorMessage: finalError });
    return {
      state: 'failed',
      errorMessage: finalError,
      costUsd,
      resultArtifact: null,
    };
  };
}

/**
 * The default adapter — uses real filesystem, git, and gh.
 * Import and pass to runNext() on the --really-run path in cli/commands/dispatch.ts.
 */
export const defaultSpawnAdapter: SpawnAdapter = createSpawnAdapter();
