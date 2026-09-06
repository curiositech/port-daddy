/**
 * lib/dispatch/worker.ts — the daemon-side dispatch worker.
 *
 * THE PROBLEM THIS FIXES: before this module, `runNext`/`defaultSpawnAdapter`
 * (the code that spawns claude/codex in a worktree) was called ONLY from
 * `cli/commands/dispatch.ts`. Execution was synchronous, bound to the foreground
 * CLI process for up to 6 hours, and NOTHING server-side drained the queue.
 * Interrupt the CLI and the dispatch was stranded `in_progress` forever. The
 * headline product — "queue goals, walk away overnight, the fleet runs them" —
 * therefore did not exist.
 *
 * THE FIX (mirrors the sortie model, where POST /sorties runs server-side via
 * the daemon): a background poll loop INSIDE the daemon process. It finds
 * claimable (`proposed`) dispatches, claims them atomically, and runs them via
 * `runClaimedDispatch(queue, dispatch, { spawnAdapter: defaultSpawnAdapter })`
 * — fully detached from any CLI. Bounded concurrency so it can drain a queue
 * overnight without overrunning the box. On completion it reaps the worktree.
 *
 * Lifecycle (per dispatch), driven entirely server-side:
 *   proposed → (worker claims) claimed → (adapter) in_progress → produced →
 *              review_pending → settled    (or → failed on error)
 *
 * Concurrency model: a simple in-process slot counter. The DB claim
 * (`queue.nextProposed`, an atomic UPDATE…WHERE state='proposed') is the real
 * mutual-exclusion gate — even if two workers raced, only one wins the row.
 * The slot counter just bounds how many we run at once in THIS daemon.
 */

import {
  runClaimedDispatch,
  deriveWorktreePath,
  DEFAULT_BACKEND,
  type RunnerOptions,
  type SpawnAdapter,
  type DispatchCostFn,
  type FailoverOptions,
  type SuccessorRequest,
} from './runner.js';
import { defaultSpawnAdapter, reapWorktree } from './spawn-adapter.js';
import type { TubeClientLike } from '../spawner/backends/cli-tube.js';
import type { DispatchQueue, Dispatch } from './queue.js';
import type { WorkIntentService } from '../agent-harbor/work-intent-service.js';

export interface DispatchWorkerLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface DispatchWorkerOptions {
  queue: DispatchQueue;
  logger?: DispatchWorkerLogger;
  /** Max dispatches running concurrently in THIS daemon. Default 2. */
  maxConcurrency?: number;
  /** Poll cadence in ms. Default 5000. */
  pollIntervalMs?: number;
  /**
   * The spawn adapter that actually runs the backend in a worktree. Defaults to
   * the real `defaultSpawnAdapter`. Injectable for tests so no real subprocess
   * is started.
   */
  spawnAdapter?: SpawnAdapter;
  /**
   * Worktree reaper, run after each dispatch reaches a terminal state. Defaults
   * to the real `reapWorktree`. Injectable for tests.
   */
  reaper?: (worktreePath: string) => Promise<void>;
  /**
   * Daemon-wide DEFAULT backend, used only when a dispatch does not name one.
   *
   * PRECEDENCE CORRECTED (2026-08-23): this used to be applied as an OVERRIDE —
   * `this.backend ?? claimed.backend` — so a daemon-wide setting silently
   * shadowed the per-dispatch column. That was already wrong (a dispatch
   * proposed for a specific backend ran on another), and it is load-bearing now
   * that failover mints a successor whose whole identity is "the same work, on
   * the NEXT backend": under the old order every successor would have been
   * dragged back onto the backend that had just failed.
   */
  backend?: RunnerOptions['backend'];
  /**
   * Cross-backend failover (ADR-0131). Default OFF.
   *
   * The daemon worker is the caller that should have it — it runs unattended,
   * which is exactly the situation where a backend outage otherwise means the
   * work simply stops — but it stays opt-in because failover spends money with
   * no operator in the loop.
   */
  failover?: {
    enabled: boolean;
    /** Preference order for a first failure. Falls back to the catalog default. */
    preferredChain?: readonly string[];
    /** Backends the caller knows are unusable now (tripped breaker, disabled). */
    isUnavailable?: (backend: string) => boolean;
    /** Builds the ADR-0118 sanitized capsule. Absent → cold successors. */
    buildHandoff?: FailoverOptions['buildHandoff'];
  };
  /** Remote override forwarded to the runner. Default 'origin'. */
  remote?: string;
  /**
   * Model override forwarded to the runner (cli-tube `--model`). Absent → CLI
   * default. The daemon can pin a cheap model for routine dispatch work.
   */
  model?: string;
  /**
   * Tube client built from the daemon's messaging layer. When provided, every
   * dispatch publishes its claude/codex exchange on `dispatch:<id>` so the
   * operator can watch it live with `pd tube dispatch:<id>`. Best-effort —
   * publish failures never fail a dispatch.
   */
  tubeClient?: TubeClientLike;
  /**
   * Cost function built on the daemon's shared rate table (cost tracker). Prices
   * each dispatch from the cli-tube stream-json's exact token usage — the SAME
   * path the sortie spawner uses.
   */
  costFn?: DispatchCostFn;
  /** WorkIntent ledger gate. Proposed rows are imported/refused before claim/spawn. */
  workIntentService?: WorkIntentService;
}

export interface DispatchWorkerStatus {
  running: boolean;
  inFlight: number;
  maxConcurrency: number;
  pollIntervalMs: number;
  startedAt: number | null;
  totalClaimed: number;
  totalSettled: number;
  totalFailed: number;
}

const noopLogger: DispatchWorkerLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export class DispatchWorker {
  private readonly queue: DispatchQueue;
  private readonly logger: DispatchWorkerLogger;
  private readonly maxConcurrency: number;
  private readonly pollIntervalMs: number;
  private readonly spawnAdapter: SpawnAdapter;
  private readonly reaper: (worktreePath: string) => Promise<void>;
  private readonly backend: RunnerOptions['backend'];
  private readonly remote: string;
  private readonly model: string | undefined;
  private readonly tubeClient: TubeClientLike | undefined;
  private readonly costFn: DispatchCostFn | undefined;
  private readonly workIntentService: WorkIntentService | undefined;
  private readonly failoverOpts: DispatchWorkerOptions['failover'];

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private startedAt: number | null = null;
  /** Dispatch IDs currently being run by THIS worker (in-process guard). */
  private readonly inFlight = new Set<string>();
  private totalClaimed = 0;
  private totalSettled = 0;
  private totalFailed = 0;
  /** Guards against overlapping poll ticks (each tick is async). */
  private polling = false;

  constructor(opts: DispatchWorkerOptions) {
    this.queue = opts.queue;
    this.logger = opts.logger ?? noopLogger;
    this.maxConcurrency = Math.max(1, opts.maxConcurrency ?? 2);
    this.pollIntervalMs = Math.max(500, opts.pollIntervalMs ?? 5000);
    this.spawnAdapter = opts.spawnAdapter ?? defaultSpawnAdapter;
    this.reaper = opts.reaper ?? reapWorktree;
    this.backend = opts.backend;
    this.remote = opts.remote ?? 'origin';
    this.model = opts.model;
    this.tubeClient = opts.tubeClient;
    this.costFn = opts.costFn;
    this.failoverOpts = opts.failover;
    this.workIntentService = opts.workIntentService;
  }

  /**
   * Recover dispatches stranded by a previous daemon (or a killed foreground
   * run), then start polling. Call once on daemon start.
   *
   * Recovery runs BEFORE the first poll so re-queued dispatches are drained by
   * this fresh worker. `olderThanMs: 0` is correct on a cold start — no worker
   * can be alive yet, so every claimed/in_progress row is genuinely stranded.
   */
  start(): void {
    if (this.running) return;

    try {
      const { requeued, salvaged } = this.queue.recoverStranded({ olderThanMs: 0 });
      if (requeued.length > 0 || salvaged.length > 0) {
        this.logger.warn('dispatch_worker_recovery', {
          requeued: requeued.length,
          salvaged: salvaged.length,
          requeuedIds: requeued.map((d) => d.id.slice(0, 8)),
          salvagedIds: salvaged.map((d) => d.id.slice(0, 8)),
        });
      }
    } catch (err) {
      this.logger.error('dispatch_worker_recovery_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.running = true;
    this.startedAt = Date.now();
    this.timer = setInterval(() => { void this.poll(); }, this.pollIntervalMs);
    this.timer.unref?.();
    this.logger.info('dispatch_worker_started', {
      maxConcurrency: this.maxConcurrency,
      pollIntervalMs: this.pollIntervalMs,
    });
    // Kick an immediate poll so a dispatch proposed just before start doesn't
    // wait a full interval.
    void this.poll();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.running = false;
    this.logger.info('dispatch_worker_stopped', { inFlight: this.inFlight.size });
  }

  getStatus(): DispatchWorkerStatus {
    return {
      running: this.running,
      inFlight: this.inFlight.size,
      maxConcurrency: this.maxConcurrency,
      pollIntervalMs: this.pollIntervalMs,
      startedAt: this.startedAt,
      totalClaimed: this.totalClaimed,
      totalSettled: this.totalSettled,
      totalFailed: this.totalFailed,
    };
  }

  /**
   * One poll tick: while there is free concurrency AND claimable work, claim and
   * launch dispatches (fire-and-forget — each runs to completion on its own
   * promise). Returns the number of dispatches launched this tick (useful for
   * tests that want to drive the loop deterministically).
   */
  async poll(): Promise<number> {
    // Note: poll() does NOT gate on `this.running`. The interval timer only
    // fires while started, but poll() is also invoked directly — by the HTTP
    // `/dispatches/:id/run` nudge and by tests — and must work in those cases.
    if (this.polling) return 0; // a previous tick is still claiming
    this.polling = true;
    let launched = 0;
    try {
      while (this.inFlight.size < this.maxConcurrency) {
        const claimed = this.claimOne();
        if (!claimed) break; // queue empty or claim raced
        this.inFlight.add(claimed.id);
        this.totalClaimed += 1;
        launched += 1;
        // Fire-and-forget; do NOT await here or we'd serialize concurrency.
        void this.runOne(claimed);
      }
    } finally {
      this.polling = false;
    }
    return launched;
  }

  /**
   * Atomically claim the oldest proposed dispatch. The claim's worktree/branch
   * are pre-derived so the row reflects where the run will happen even before
   * the adapter starts. Returns null if nothing is claimable.
   */
  private claimOne(): Dispatch | null {
    // Use the queue's canonical oldest-row selector, then atomically claim that
    // exact id. Deriving paths from list() and calling nextProposed() could pair
    // metadata from one row with another row when their ordering differed.
    const peeked = this.queue.peekNextProposed();
    if (!peeked) return null;
    if (!this.workIntentService) {
      this.logger.error('dispatch_worker_missing_work_intent_service', { dispatchId: peeked.id });
      return null;
    }
    try {
      this.workIntentService.ensureDispatchIntent(peeked);
    } catch (err) {
      this.logger.error('dispatch_worker_work_intent_import_failed', {
        dispatchId: peeked.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    const worktreePath = deriveWorktreePath(peeked.id);
    // deriveBranchName is what planRunFor uses; mirror it here for the claim row.
    const branch = `dispatch/${peeked.slug}-${peeked.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'noid'}`;
    try {
      const claimed = this.queue.claimProposed({
        id: peeked.id,
        worktreePath,
        branch,
        sessionId: `dispatch-worker-${peeked.id}`,
        workerActorId: 'daemon:dispatch-worker',
      });
      if (!claimed) {
        this.logger.info('dispatch_worker_claim_raced', {
          dispatchId: peeked.id,
          error: `claim: failed to claim dispatch ${peeked.id}`,
        });
      }
      return claimed;
    } catch (err) {
      // Another worker may win between peek and claim. Claiming by id ensures
      // we never consume a different row with the losing row's metadata.
      this.logger.info('dispatch_worker_claim_raced', {
        dispatchId: peeked.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Run a single claimed dispatch to a terminal state, then reap its worktree
   * and release the in-flight slot. All errors are contained here — a single
   * bad dispatch must never crash the worker or strand a slot.
   */
  /**
   * Assemble the runner's failover policy, or undefined when it is off.
   *
   * The successor minter lives here rather than in the runner because a
   * successor MUST be a governed launch: `captureDispatch` writes the WorkIntent
   * and materializes the dispatch row from it in one step, so the row can never
   * exist without the intent the worker's own claim gate demands. A successor
   * written straight to the queue would be claimed and then refused at exactly
   * the moment recovery mattered.
   *
   * @returns The policy the runner should apply, or undefined when failover is off.
   */
  private buildFailoverOptions(): FailoverOptions | undefined {
    const cfg = this.failoverOpts;
    if (!cfg?.enabled) return undefined;
    const workIntentService = this.workIntentService;
    if (!workIntentService) return undefined;

    return {
      enabled: true,
      ...(cfg.preferredChain ? { preferredChain: cfg.preferredChain } : {}),
      ...(cfg.isUnavailable ? { isUnavailable: cfg.isUnavailable } : {}),
      ...(cfg.buildHandoff ? { buildHandoff: cfg.buildHandoff } : {}),
      mintSuccessor: async (req: SuccessorRequest) => {
        try {
          const captured = workIntentService.captureDispatch(
            {
              goal: req.goal,
              backend: req.backend,
              baseBranch: req.predecessor.baseBranch,
              projectDir: req.predecessor.projectDir ?? undefined,
              mergePolicy: req.predecessor.mergePolicy,
              requestedBy: req.predecessor.requestedBy,
              tags: [...req.predecessor.tags, `failover:${req.failoverFromBackend}`],
              ...(req.budgetUsd != null ? { budgetUsd: req.budgetUsd } : {}),
              ...(req.predecessor.timeoutMs != null
                ? { timeoutMs: req.predecessor.timeoutMs }
                : {}),
              predecessorDispatchId: req.predecessor.id,
              failoverAttempt: req.failoverAttempt,
              failoverFromBackend: req.failoverFromBackend,
              handoffEpisodeId: req.handoffEpisodeId,
              failoverChain: req.failoverChain,
              // Deterministic: a retried tick must not mint a second successor
              // for the same hop of the same chain.
              idempotencyKey: `failover:${req.predecessor.id}:${req.failoverAttempt}`,
            },
            this.queue,
          );
          return captured.dispatch;
        } catch (err) {
          this.logger.error('dispatch_failover_mint_failed', {
            dispatchId: req.predecessor.id,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        }
      },
      onReceipt: (receipt) => {
        this.logger.info('dispatch_failover', {
          id: receipt.dispatchId.slice(0, 8),
          successor: receipt.successorId ? receipt.successorId.slice(0, 8) : null,
          from: receipt.fromBackend,
          to: receipt.toBackend,
          attempt: receipt.attempt,
          reason: receipt.reason,
        });
      },
    };
  }

  private async runOne(claimed: Dispatch): Promise<void> {
    const idShort = claimed.id.slice(0, 8);
    const worktreePath = deriveWorktreePath(claimed.id);
    // Terminal outcome of this dispatch. Hoisted so the `finally` reap guard can
    // see it. A `salvage` outcome means an operator halted mid-flight and the
    // Conductor PRESERVED the worktree + transcript on purpose — reaping it would
    // destroy the very thing the operator is meant to salvage (ADR-0060).
    let outcomeState: 'settled' | 'failed' | 'salvage' | null = null;
    try {
      this.logger.info('dispatch_worker_run_start', { id: idShort, goal: claimed.goal.slice(0, 80) });
      const { result } = await runClaimedDispatch(this.queue, claimed, {
        spawnAdapter: this.spawnAdapter,
        ...(this.buildFailoverOptions() ? { failover: this.buildFailoverOptions()! } : {}),
        // Per-dispatch choice wins; the worker's setting is a DEFAULT, not an
        // override (see the `backend` option doc).
        backend: (claimed.backend as RunnerOptions['backend']) ?? this.backend ?? DEFAULT_BACKEND,
        remote: this.remote,
        model: this.model,
        tubeClient: this.tubeClient,
        costFn: this.costFn,
      });
      outcomeState = result.state;
      if (result.state === 'settled') {
        this.totalSettled += 1;
      } else {
        this.totalFailed += 1;
      }
      this.logger.info('dispatch_worker_run_done', {
        id: idShort,
        state: result.state,
        cost: result.costUsd ?? null,
        artifact: result.resultArtifact ?? null,
        error: result.errorMessage ?? null,
      });
    } catch (err) {
      // runClaimedDispatch already settles on adapter exceptions, but if the
      // claim somehow desynced (e.g. cancelled mid-run) we may land here. Settle
      // defensively so the row never strands in claimed/in_progress.
      this.totalFailed += 1;
      outcomeState = 'failed';
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error('dispatch_worker_run_error', { id: idShort, error: errorMessage });
      try {
        const current = this.queue.get(claimed.id);
        if (current && !['settled', 'failed', 'salvage'].includes(current.state)) {
          this.queue.settle({ id: claimed.id, state: 'failed', errorMessage });
        }
      } catch { /* terminal already, or row gone */ }
    } finally {
      this.inFlight.delete(claimed.id);
      // Reap on `settled` (PR pushed — worktree disposable) and `failed` (nothing
      // recoverable per existing policy). PRESERVE on `salvage` so the operator can
      // recover the halted dispatch's worktree + transcript (ADR-0060). Re-read the
      // row state defensively in case the dispatch landed in `salvage` without the
      // returned result reflecting it (belt-and-suspenders for the halt path).
      let rowState: string | null = null;
      try {
        rowState = this.queue.get(claimed.id)?.state ?? null;
      } catch { /* row gone — treat as reapable */ }
      const isSalvage = outcomeState === 'salvage' || rowState === 'salvage';
      if (isSalvage) {
        this.logger.info('dispatch_worker_reap_skipped_salvage', { id: idShort, worktreePath });
      } else {
        // Best-effort; never throws out.
        try {
          await this.reaper(worktreePath);
        } catch (err) {
          this.logger.warn('dispatch_worker_reap_failed', {
            id: idShort,
            worktreePath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }
}

export function createDispatchWorker(opts: DispatchWorkerOptions): DispatchWorker {
  return new DispatchWorker(opts);
}
