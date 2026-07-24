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
 *   2. lib/spawner.ts runConfinedChild path — spawn the configured backend
 *      (cli:claude-code or cli:codex) via the existing Coast Guard wrapper
 *      (wrapWithSandbox + scrubRawSecretsFromEnv + EgressMeter) so every
 *      dispatch is blast-radius-bounded by default.
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
 *
 * TODO(ADR-0060 — Conductor fold-in, DEFERRED): this adapter is the FOURTH spawn
 * surface and is NOT yet routed through `conductor.launch`. Unlike the sortie POST
 * and the reactive orchestrator (both rerouted), dispatch does not call
 * `spawner.spawn` — it drives a raw Coast-Guard-wrapped `execFile` (below) plus a
 * worktree-mint + draft-PR lifecycle. Folding it in requires the Conductor to grow
 * the `worktree:'create'` branch (mint the off-main branch, open the draft PR,
 * carry the PR URL as resultArtifact) so the dispatch lifecycle becomes the
 * Conductor's `worktree:'create', mergePolicy:'review'` intent. That is a larger
 * change than the sortie/orchestrator reroute and is intentionally deferred to a
 * follow-up PR. Until then, dispatch remains a separate launcher and the
 * "Conductor is the ONLY caller of spawner.spawn" property holds for the sortie +
 * orchestrator surfaces only. This is called out honestly in the Conductor PR.
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
  DISPATCH_WORKTREE_ROOT,
} from './runner.js';
import { wrapWithSandbox, defaultCrownJewels, scrubRawSecretsFromEnv } from '../coast-guard.js';

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
  options: {
    execFileFn?: (file: string, args: string[]) => Promise<unknown>;
    existsFn?: (path: string) => boolean;
    sleepFn?: (delayMs: number) => Promise<void>;
    randomFn?: () => number;
    maxAttempts?: number;
  } = {},
): Promise<void> {
  const run = options.execFileFn ?? ((file: string, args: string[]) => execFileAsync(file, args));
  const pathExists = options.existsFn ?? existsSync;
  const sleep = options.sleepFn ?? ((delayMs: number) => new Promise<void>((resolveSleep) => {
    setTimeout(resolveSleep, delayMs);
  }));
  const random = options.randomFn ?? Math.random;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);

  if (pathExists(worktreePath)) {
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
      await run('git', ['fetch', remote, branchName]);
    } catch {
      /* offline or no remote — branch from the local tracking ref */
    }
  }
  // git worktree add <path> -b <branch> <baseRef>
  // Run from the repo root (process.cwd() when running as the pd CLI).
  let reuseCreatedBranch = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await run('git', reuseCreatedBranch
        ? ['worktree', 'add', worktreePath, branch]
        : [
            'worktree', 'add',
            '--no-track',
            worktreePath,
            '-b', branch,
            baseRef,
          ]);
      return;
    } catch (error) {
      // Concurrent worktree creation briefly contends on the repository-wide
      // .git/config.lock while Git writes branch tracking metadata. The
      // checkout may already be complete even when that metadata write loses
      // the race, so accept a materialized path before considering a retry.
      if (pathExists(worktreePath)) return;

      const details = error instanceof Error
        ? `${error.message}\n${String((error as Error & { stdout?: unknown }).stdout ?? '')}\n${String((error as Error & { stderr?: unknown }).stderr ?? '')}`
        : String(error);
      const transientConfigLock = /could not lock config file[\s\S]*\.git\/config[\s\S]*File exists|unable to write upstream branch configuration|\.git\/config\.lock/i.test(details);
      if (!transientConfigLock || attempt === maxAttempts) throw error;

      // Git creates the local branch before attempting to persist upstream
      // metadata. If that config write loses a race, retry by attaching the
      // worktree to the branch that now exists instead of asking `-b` to create
      // the same branch again.
      reuseCreatedBranch = true;
      const ceilingMs = Math.min(800, 100 * (2 ** (attempt - 1)));
      const delayMs = Math.max(25, Math.round(random() * ceilingMs));
      await sleep(delayMs);
    }
  }
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
export function disableGuardInWorktree(worktreePath: string): void {
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

/**
 * Default exec-level ceiling for the publish subprocesses (`git push`, `gh pr
 * create`). The Conductor wraps the whole publish in its own `publishTimeoutMs`
 * belt (default 120s) to free the dispatch's in-flight slot, but that only
 * unblocks the daemon — it does NOT kill a hung child. We set the per-exec
 * timeout slightly UNDER that belt so a stuck `git push` (DNS/ssh hang) or
 * `gh pr create` (API retry storm) is SIGKILLed at the source before the
 * Conductor gives up, rather than orphaning a process that lingers overnight.
 */
export const PUBLISH_EXEC_TIMEOUT_MS = 110_000;

export async function gitPushBranch(
  worktreePath: string,
  branch: string,
  timeoutMs: number = PUBLISH_EXEC_TIMEOUT_MS,
): Promise<void> {
  // The branch is always explicit in the publish receipt/PR request, so no
  // upstream config is required. Avoid `-u`: concurrent completions would all
  // contend on the repository-wide .git/config.lock merely to record tracking
  // metadata that this lifecycle never reads.
  await execFileAsync('git', ['-C', worktreePath, 'push', 'origin', branch], {
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });
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
  /** Exec-level kill ceiling; see PUBLISH_EXEC_TIMEOUT_MS. */
  timeoutMs?: number;
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
  ], {
    cwd: params.worktreePath,
    timeout: params.timeoutMs ?? PUBLISH_EXEC_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });

  // gh pr create outputs the PR URL as the last non-empty line of stdout.
  const lines = stdout.trim().split('\n').filter(Boolean);
  const prUrl = lines[lines.length - 1]?.trim() ?? '';
  if (!prUrl.startsWith('https://')) {
    throw new Error(`gh pr create returned unexpected output: ${stdout.slice(0, 200)}`);
  }
  return prUrl;
}

// ── Confined agent runner ─────────────────────────────────────────────────────
//
// Wraps the backend CLI (claude or codex) with the Coast Guard sandbox
// (wrapWithSandbox + scrubRawSecretsFromEnv). We don't start the full
// EgressMeter here — that lives inside lib/spawner.ts's runConfinedChild path.
// For dispatch, the primary blast-radius protections are:
//   (a) filesystem isolation (worktree, not main checkout)
//   (b) Seatbelt/Landlock confinement (crown jewels denied)
//   (c) raw secret scrub from the child env
// The per-agent egress cap is a Phase 2 concern for dispatch (the CLI tools
// manage their own auth and billing on the operator's subscription).

async function runAgentInWorktree(params: {
  worktreePath: string;
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
  timeoutMs: number;
}): Promise<{ output: string; error: string | null }> {
  // Backend-aware confinement. `codex` self-sandboxes via `--sandbox
  // workspace-write` (which on macOS is itself a `sandbox-exec` profile);
  // wrapping it a SECOND time in the Coast Guard seatbelt nests two
  // sandbox-exec profiles and silently prevents codex from performing ANY
  // file writes — the dispatched agent runs, exits 0, but produces nothing to
  // commit. The runner's own rationale already states codex relies on its own
  // sandbox for blast-radius. So: confine only backends that DON'T self-sandbox
  // (claude, which has no built-in OS confinement). Worktree isolation + secret
  // scrub still bound codex either way.
  const selfSandboxing = params.command === 'codex';
  const jewels = defaultCrownJewels();
  const wrap = selfSandboxing
    ? { cmd: params.command, args: params.args, confined: false, mechanism: 'codex-sandbox' as const, cleanup: [] as string[] }
    : wrapWithSandbox(params.command, params.args, jewels, params.worktreePath);
  const broker = scrubRawSecretsFromEnv(params.env);

  return new Promise((res) => {
    let settled = false;
    let timedOut = false;

    const child = execFile(
      wrap.cmd,
      wrap.args,
      {
        cwd: params.worktreePath,
        env: broker.env as NodeJS.ProcessEnv,
        // codex --json can emit a large transcript; the 1 MB execFile default
        // would abort a long run with ERR_CHILD_PROCESS_STDIO_MAXBUFFER.
        maxBuffer: 64 * 1024 * 1024,
        // No timeout in execFile opts — we manage it explicitly below for
        // cleaner error messages and SIGKILL escalation.
      },
    );

    // Close the child's stdin immediately. The backends run non-interactively
    // (`codex exec <goal>` / `claude -p <goal>` take the prompt as an argv), but
    // both inspect stdin and BLOCK reading from it when it is an open pipe —
    // codex prints "Reading additional input from stdin..." and waits forever,
    // which manifested as the dispatch timing out after the full budget with
    // zero output. An EOF on stdin lets them proceed on the argv prompt alone.
    child.stdin?.end();

    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout?.on('data', (d: Buffer) => stdout.push(d.toString()));
    child.stderr?.on('data', (d: Buffer) => stderr.push(d.toString()));

    const timeoutId = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* already gone */ }
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      const forceKill = setTimeout(() => {
        try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
        try { child.kill('SIGKILL'); } catch {}
      }, 5_000);
      forceKill.unref?.();
    }, params.timeoutMs);
    timeoutId.unref?.();

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      // Clean up Coast Guard temp files (e.g. seatbelt profile).
      for (const f of wrap.cleanup) {
        try { execFileSync('rm', ['-rf', f]); } catch {}
      }
      const out = stdout.join('');
      const err = stderr.join('');
      if (timedOut) {
        res({ output: out, error: `Agent timed out after ${Math.round(params.timeoutMs / 60000)} min${err ? `: ${err.slice(0, 200)}` : ''}` });
      } else if (code !== 0) {
        res({ output: out, error: err || `${params.command} exited with code ${code}` });
      } else {
        res({ output: out + (err ? `\nstderr: ${err}` : ''), error: null });
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      res({ output: '', error: `Failed to start ${params.command}: ${err.message}` });
    });
  });
}

// ── The adapter factory ───────────────────────────────────────────────────────

export interface SpawnAdapterOptions {
  /**
   * Injectable spawn function for unit tests. When provided, no real subprocess
   * is started; the function receives the same (command, args, cwd, env, timeoutMs)
   * the real adapter would use.
   */
  spawnFn?: (params: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string | undefined>;
    timeoutMs: number;
  }) => Promise<{ output: string; error: string | null }>;

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
 * Build a SpawnAdapter. Compose worktree isolation, Coast Guard confinement,
 * and draft PR creation so `pd dispatch run --really-run` actually builds the
 * intent and opens a draft PR.
 *
 * All three injectable functions default to the real implementations but can
 * be replaced in unit tests to avoid network/filesystem/subprocess side effects.
 */
export function createSpawnAdapter(opts: SpawnAdapterOptions = {}): SpawnAdapter {
  const _worktreeAdd = opts.worktreeAddFn ?? gitWorktreeAdd;
  const _openPr = opts.openPrFn ?? openDraftPr;
  const _spawn = opts.spawnFn ?? (
    (params) => runAgentInWorktree({
      worktreePath: params.cwd,
      command: params.command,
      args: params.args,
      env: params.env,
      timeoutMs: params.timeoutMs,
    })
  );

  return async function spawnAdapterImpl(
    input: SpawnAdapterInput,
  ): Promise<SpawnAdapterResult> {
    const { plan, queue } = input;
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

    // ── 3. Spawn the agent in the worktree (Coast Guard-wrapped) ─────────────
    const agentEnv: Record<string, string | undefined> = {
      ...process.env,
      ...plan.env,
      PD_DISPATCH_WORKTREE: plan.worktreePath,
    };

    let agentError: string | null = null;
    const spawnStart = Date.now();

    try {
      const result = await _spawn({
        command: plan.command,
        args: plan.args,
        cwd: plan.worktreePath,
        env: agentEnv,
        timeoutMs: plan.timeoutMs,
      });
      agentError = result.error;
    } catch (err) {
      agentError = (err as Error).message;
    }

    const durationMs = Date.now() - spawnStart;
    void durationMs; // available for future cost tracking

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
        errorMessage: combinedError,
      });
      return {
        state: 'settled',
        resultArtifact: prUrl,
        errorMessage: combinedError,
      };
    }

    // No PR: agent produced nothing committable, or push/open failed.
    const finalError =
      combinedError ??
      `Agent ran but produced no committable output and no PR was opened.`;

    queue.settle({ id: dispatch.id, state: 'failed', errorMessage: finalError });
    return {
      state: 'failed',
      errorMessage: finalError,
      resultArtifact: null,
    };
  };
}

/**
 * The default adapter — uses real filesystem, git, and gh.
 * Import and pass to runNext() on the --really-run path in cli/commands/dispatch.ts.
 *
 * LEGACY / SUPERSEDED (ADR-0060 Conductor fold-in): the PRODUCTION dispatch path
 * no longer uses this inline adapter. The daemon injects
 * `createConductorSpawnAdapter(conductor)` (lib/dispatch/conductor-adapter.ts)
 * into the DispatchWorker, so dispatch now spawns through the ONE Conductor
 * primitive (`conductor.launch`) — bond-gated, ceiling-gated, depth-capped,
 * halt-able, capability-scoped, and refused on a main checkout — and the
 * Conductor owns worktree mint + cost pricing + draft-PR publish via its
 * `mintWorktree`/`readCost`/`publishArtifact` hooks. This Coast-Guard-wrapped
 * inline path is retained only for the standalone CLI foreground flow and as a
 * fallback; its separate cost parser and worktree/PR orchestration are
 * redundant with the Conductor and are not on the daemon's spawn path.
 */
export const defaultSpawnAdapter: SpawnAdapter = createSpawnAdapter();
