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
 * Retry semantics: on a thrown (recoverable) error we record the cause against
 * the run's transcript (delivery-failure.ts) and call `message.retry()`;
 * Cloudflare backs off and re-delivers, moving the message to the DLQ after
 * `max_retries`. On success we `message.ack()`. The orchestrator itself treats
 * a ship-level failure as a verdict (fail-closed), so a single bad ship does
 * not throw the whole job into retry — only genuine infrastructure failures
 * (token mint, GitHub API outage) do.
 */

import type { ExecutorEnv, FleetRunJob } from './env.js';
import { executeFleet } from './execute.js';
import { handleDlqJob } from './dlq.js';
import { recordDeliveryFailure } from './delivery-failure.js';

export type { ExecutorEnv, FleetRunJob } from './env.js';
export { executeFleet } from './execute.js';

/** The dead-letter queue name (must match `dead_letter_queue` in wrangler.toml). */
const DLQ_QUEUE_NAME = 'fleet-runs-dlq';

export default {
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
        // Persist WHY before retrying. A Worker console line does not survive
        // the run, so without this the only artifact a dead-lettered job leaves
        // is "was lost" with no cause — see delivery-failure.ts. Best-effort and
        // non-throwing by construction, so it can never eat the retry below.
        await recordDeliveryFailure(
          env,
          message.body,
          (message as unknown as { attempts?: number }).attempts ?? 0,
          err,
        );
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<ExecutorEnv, FleetRunJob>;

export { Sandbox } from '@cloudflare/sandbox';
