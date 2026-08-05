/**
 * lib/dispatch/conductor-adapter.ts — the Conductor-backed SpawnAdapter (ADR-0060).
 *
 * This is the seam that folds the FOURTH spawn surface (dispatch) into the ONE
 * Conductor primitive. The DispatchWorker / runner abstract spawning behind the
 * `SpawnAdapter` interface (`{plan, queue, tubeClient?, costFn?} => SpawnAdapterResult`).
 * Instead of the legacy inline adapter (worktree + raw spawn + cost parse + PR,
 * all done itself), the production worker injects THIS adapter, which maps a
 * `RunnerPlan` to a `LaunchIntent` and calls `conductor.launch(intent)` — so a
 * dispatch is now bond-gated, ceiling-gated, depth-capped, halt-able, and
 * capability-scoped exactly like every other launch, and the Conductor owns the
 * worktree mint, cost pricing, and draft-PR publish via its hooks.
 *
 * The two interfaces map 1:1, which is the whole reason the fold-in is an
 * injection rather than a rewrite:
 *   RunnerPlan ─→ LaunchIntent (worktree:'create', mergePolicy:'review', bond=budget)
 *   LaunchResult ─→ SpawnAdapterResult (settled / failed / salvage)
 */

import type {
  RunnerPlan,
  SpawnAdapter,
  SpawnAdapterInput,
  SpawnAdapterResult,
} from './runner.js';
import type { LaunchIntent, LaunchResult } from '../fleet/conductor.js';

/** The slice of the Conductor this adapter needs — just `launch`. */
export interface ConductorLike {
  launch: (intent: LaunchIntent) => Promise<LaunchResult>;
}

/**
 * Translate a dispatch's `RunnerPlan` into a Conductor `LaunchIntent`.
 *
 * Exported for direct testing: the LaunchIntent built here carries the worktree
 * mint request, the env, and the tube channel the Conductor will forward; its
 * bond and lineage ceiling are BOTH the dispatch budget (see below).
 */
export function planToLaunchIntent(plan: RunnerPlan): LaunchIntent {
  const d = plan.dispatch;
  return {
    goal: d.goal,
    backend: plan.backend,
    source: 'dispatch',
    model: plan.model,

    // A dispatch always runs in a FRESH off-main worktree — this is what
    // satisfies I2 (NO_SPAWN_ON_MAIN): the Conductor mints the branch the plan
    // names, so the run never touches the operator's main checkout.
    worktree: 'create',
    worktreePath: plan.worktreePath,
    worktreeBranch: plan.branch,
    worktreeBaseRef: plan.baseRef,
    env: plan.env,
    tubeChannel: `dispatch:${d.id}`,

    // A dispatch always wants a REVIEWABLE PR artifact, so it maps to the
    // Conductor's `review` merge policy regardless of the dispatch's own
    // mergePolicy: 'auto' and 'review' both want a draft PR the operator can
    // inspect (auto-merge is harbormaster's job, not the spawn's), and there is
    // no dispatch mode that wants NO PR. We deliberately never pass 'never' —
    // that would suppress the PR artifact a dispatch exists to produce.
    mergePolicy: 'review',

    // Bond = the dispatch budget: the breaker RESERVES this against the lineage
    // ceiling before admission. Ceiling = the SAME budget because a dispatch is
    // its OWN lineage root (source:'dispatch' is a root-minting source), so the
    // whole subtree it heads is bounded by exactly the budget the operator set.
    budgetUsd: plan.budgetUsd,
    bondUsd: plan.budgetUsd,
    lineageCeilingUsd: plan.budgetUsd,
    deadlineMs: plan.timeoutMs,
  };
}

/**
 * Build a SpawnAdapter backed by the Conductor. Inject this into the
 * DispatchWorker (server.ts) so the production dispatch path spawns through
 * `conductor.launch`.
 *
 * The `tubeClient`/`costFn` on the SpawnAdapterInput are intentionally unused
 * here: the Conductor owns tube publishing (via the forwarded `tubeChannel` on
 * the spawn spec) and cost pricing (via its own `readCost`), so the dispatch
 * layer no longer needs to thread them through. They remain on the interface
 * for the legacy inline adapter and CLI foreground path.
 */
export function createConductorSpawnAdapter(conductor: ConductorLike): SpawnAdapter {
  return async function conductorSpawnAdapter(
    input: SpawnAdapterInput,
  ): Promise<SpawnAdapterResult> {
    // Transition the dispatch row `claimed → in_progress` BEFORE launching, so
    // `started_at` is stamped (duration is computed at settle) and the row is
    // observably `in_progress` for `pd dispatch list --state in_progress` for the
    // whole run. Without this the row stays `claimed` for the entire launch:
    // `in_progress` is never visited, `started_at`/`duration_ms` stay null, and
    // `recoverStranded` re-queues claimed rows too aggressively → a crash between
    // launch() returning and settle() yields a DUPLICATE run. The runner has
    // already claimed the row (`nextProposed`) before this adapter runs, so the
    // row is in `claimed` here. Mirrors the legacy spawn-adapter (queue.start at
    // the claimed→in_progress step): a start that throws (e.g. the operator
    // cancelled the dispatch between claim and start) is reported as a failure
    // WITHOUT launching — we never spawn a body for a dispatch we can't start.
    try {
      input.queue.start(input.plan.dispatch.id);
    } catch (err) {
      return {
        state: 'failed',
        errorMessage: `Failed to transition dispatch ${input.plan.dispatch.id} to in_progress: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const intent = planToLaunchIntent(input.plan);
    const r = await conductor.launch(intent);

    // Refused at admission (bond/ceiling/depth/breaker/main-checkout/capability):
    // the launch never spawned. Surface the refusal reason as a failure.
    if (!r.admitted) {
      return { state: 'failed', errorMessage: r.refusedReason ?? 'refused' };
    }

    // Map the launch's terminal-ish state onto the dispatch lifecycle. The
    // mapping is exhaustive over the states the Conductor can return from
    // `launch()`; an unrecognized state is treated as a failure rather than
    // silently swallowed (defensive: a future LaunchState must be mapped here).
    const launchState = r.launch.state;
    switch (launchState) {
      case 'halted':
        // Operator halt landed on this launch → preserve the worktree/transcript
        // for the operator to salvage rather than discarding it as a failure.
        return { state: 'salvage', errorMessage: r.launch.errorMessage ?? 'halted' };

      case 'failed':
        return {
          state: 'failed',
          costUsd: r.launch.costUsd ?? undefined,
          errorMessage: r.launch.errorMessage,
        };

      case 'produced':
      case 'settled':
        // A review launch is only disposable once the Conductor proves a
        // durable artifact exists. Agents can finish with dirty files but no
        // commit; in that case push/PR publication returns null. Calling that
        // settled lets DispatchWorker reap the only copy of the work. Route it
        // to salvage so the worktree and transcript remain recoverable.
        if (!r.launch.resultArtifact) {
          return {
            state: 'salvage',
            costUsd: r.launch.costUsd ?? undefined,
            errorMessage:
              r.launch.errorMessage
              ?? 'run completed without a reviewable artifact; worktree preserved for recovery',
          };
        }
        return {
          state: 'settled',
          costUsd: r.launch.costUsd ?? undefined,
          resultArtifact: r.launch.resultArtifact,
        };

      default:
        return {
          state: 'failed',
          errorMessage: `unexpected launch state: ${launchState}`,
        };
    }
  };
}
