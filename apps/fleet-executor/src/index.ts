/**
 * Cloud fleet executor — Cloudflare Queues consumer entry point.
 *
 * Relay enqueues one {@link FleetRunJob} per GitHub delivery to the `fleet-runs`
 * queue. This Worker consumes batches, runs the orchestrator per message, and
 * acks/retries each message independently.
 *
 * FAIL-CLOSED / DLQ CONTRACT
 * --------------------------
 * The orchestrator creates the 'Port Daddy Fleet' check run in 'in_progress'
 * at the START of a run, BEFORE running any ship. That ordering is the whole
 * safety story: if a blocking ship's job is later lost — retries exhausted, the
 * message dead-lettered, the Worker evicted — GitHub still shows an unresolved
 * 'in_progress' (never green, never absent) gate. A separate DLQ handler
 * (configured via `dead_letter_queue = "fleet-runs-dlq"`) must then complete
 * that check run as 'failure' so a lost blocking job can never let a merge
 * through. We never ack a job whose check we could not even create.
 *
 * Retry semantics: on a thrown (recoverable) error we call `message.retry()`;
 * Cloudflare backs off and re-delivers, moving the message to the DLQ after
 * `max_retries`. On success we `message.ack()`. The orchestrator itself treats
 * a ship-level failure as a verdict (fail-closed), so a single bad ship does
 * not throw the whole job into retry — only genuine infrastructure failures
 * (token mint, GitHub API outage) do.
 */

import type { ExecutorEnv, FleetRunJob } from './env.js';
import { executeFleet } from './execute.js';
import { handleDlqJob } from './dlq.js';
import { runStewardSweep } from './steward.js';
import { StewardSweepTranscript } from './steward-transcript.js';

export type { ExecutorEnv, FleetRunJob } from './env.js';
export { executeFleet } from './execute.js';

/** The dead-letter queue name (must match `dead_letter_queue` in wrangler.toml). */
const DLQ_QUEUE_NAME = 'fleet-runs-dlq';

export default {
  /**
   * Cron entry point for the STEWARD (src/steward.ts) — the bounded
   * auto-landing pass over the fleet's OWN pull requests.
   *
   * WHY A CRON AND NOT THE WEBHOOK PATH: merging requires WAITING. At
   * `pull_request:opened` every check is pending, so a steward driven only by
   * webhooks could never satisfy its own "no pending checks" precondition — it
   * would be structurally incapable of ever merging anything. A periodic sweep
   * over a KV-registered candidate list is the smallest mechanism that lets the
   * gate be evaluated when the answer can actually be "yes".
   *
   * SAFETY: this handler grants no authority of its own. Every precondition —
   * tenant opt-in from the trusted default branch, kill switch, fleet
   * authorship via App identity, green checks, guardrail hard stop, rate
   * limits — is re-derived inside the sweep, and a failure here means PRs sit
   * unmerged, which is the harmless direction. Errors are swallowed so a broken
   * steward can never take the queue consumer down with it.
   *
   * @param _event The Cloudflare scheduled event (cron expression, scheduled time).
   * @param env Executor environment (bindings + secrets).
   * @param ctx Execution context; the sweep is awaited via `waitUntil` so
   *   Cloudflare does not cancel it mid-flight.
   * @returns Nothing — outcomes land in the D1 transcript, not the return value.
   */
  async scheduled(
    _event: ScheduledController,
    env: ExecutorEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    const sweep = (async () => {
      try {
        const transcript = new StewardSweepTranscript(env.DB);
        const results = await runStewardSweep(env, transcript);
        console.log(
          `[fleet-executor] steward sweep: inspected=${results.length} ` +
            `merged=${results.filter(r => r.merged).length} ` +
            `updated=${results.filter(r => r.branchUpdated).length}`,
        );
      } catch (err) {
        // A failed sweep leaves PRs unmerged — the harmless direction. It must
        // never surface as an unhandled rejection that affects queue delivery.
        console.error(`[fleet-executor] steward sweep failed: ${String(err)}`);
      }
    })();
    ctx.waitUntil(sweep);
    await sweep;
  },

  async queue(
    batch: MessageBatch<FleetRunJob>,
    env: ExecutorEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // DLQ path: a job that exhausted retries on the main queue lands here. Its
    // 'Port Daddy Fleet' check is stuck in_progress — complete it as failure so a
    // lost blocking job can never leave a green/absent gate. Always ack (the
    // message already exhausted retries; re-queuing it would loop).
    if (batch.queue === DLQ_QUEUE_NAME) {
      for (const message of batch.messages) {
        await handleDlqJob(message.body, env);
        message.ack();
      }
      return;
    }

    for (const message of batch.messages) {
      try {
        await executeFleet(message.body, env);
        message.ack();
      } catch (err) {
        // Recoverable infrastructure error — re-deliver. After max_retries the
        // platform routes this to fleet-runs-dlq, where the DLQ handler MUST
        // complete the (already-created) check run as 'failure'. Because the
        // check was created in_progress before any ship ran, a job lost here
        // never leaves a green or absent gate.
        console.error(
          `[fleet-executor] delivery=${message.body?.deliveryId} retry: ${String(err)}`,
        );
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<ExecutorEnv, FleetRunJob>;

export { Sandbox } from '@cloudflare/sandbox';
