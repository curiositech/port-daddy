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
import { recordDeliveryAttemptStart, recordDeliveryFailure } from './delivery-failure.js';
import { flushSquidEvents } from './squid-events.js';
import {
  beginFleetIntentAttempt,
  finishFleetIntentFromRun,
  markFleetIntentRetrying,
  markFleetIntentTerminal,
} from './run-intent.js';

export type { ExecutorEnv, FleetRunJob } from './env.js';
export { executeFleet } from './execute.js';

/** The dead-letter queue name (must match `dead_letter_queue` in wrangler.toml). */
const DLQ_QUEUE_NAME = 'fleet-runs-dlq';

export default {
  async queue(
    batch: MessageBatch<FleetRunJob>,
    env: ExecutorEnv,
    ctx: ExecutionContext,
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
      const attempt = (message as unknown as { attempts?: number }).attempts ?? 0;
      try {
        const intentDecision = await beginFleetIntentAttempt(env, message.body, attempt);
        if (intentDecision === 'skip') {
          // A newer PR generation owns the required check.  The queue cannot
          // delete this stale message, so acknowledge it here before GitHub or
          // model work.  The superseded intent remains visible to operators.
          message.ack();
          continue;
        }
        // Attempt-start marker BEFORE any work: the one write that survives an
        // uncatchable platform kill (memory/CPU), so a dead-letter with starts
        // but no failures is positive evidence of that class — issue #7743.
        await recordDeliveryAttemptStart(
          env,
          message.body,
          attempt,
        );
        const disposition = await executeFleet(message.body, env);
        if (disposition?.kind === 'stale-head') {
          await markFleetIntentTerminal(
            env,
            message.body.deliveryId,
            'cancelled',
            'payload head is no longer current; acknowledged without model spend',
          );
        } else if (disposition?.kind === 'already-decided') {
          await markFleetIntentTerminal(
            env,
            message.body.deliveryId,
            disposition.conclusion,
            'required check already held a model-backed verdict; acknowledged without duplicate spend',
          );
        } else if (disposition?.kind === 'no-cloud-ships') {
          await markFleetIntentTerminal(
            env,
            message.body.deliveryId,
            'cancelled',
            'trusted Fleet configuration contains no Cloud-executable review ships',
          );
        } else {
          await finishFleetIntentFromRun(env, message.body);
        }
        // Squid delivery never blocks the Fleet verdict, but Workers may
        // terminate floating promises after the queue handler returns. Extend
        // the event lifetime so the run-concluded event and reconciliation
        // report get a best-effort chance to drain without delaying the ack.
        // https://developers.cloudflare.com/workers/runtime-apis/context/
        const telemetryDrain = flushSquidEvents();
        try {
          ctx.waitUntil(telemetryDrain);
        } catch {
          // Unit harnesses and non-Worker adapters may supply a bare context.
          // The telemetry promise is already fail-soft; never turn a completed
          // Fleet run into a retry because the adapter lacks waitUntil.
          void telemetryDrain;
        }
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
          attempt,
          err,
        );
        await markFleetIntentRetrying(env, message.body, attempt, err);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<ExecutorEnv, FleetRunJob>;

export { Sandbox } from '@cloudflare/sandbox';
