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
 * `max_retries`. A successful one-ship slice durably checkpoints, enqueues an
 * explicit continuation, then acks its current message. The orchestrator
 * treats a ship-level failure as a verdict (fail-closed), so only genuine
 * infrastructure failures (token mint, GitHub API outage, unavailable durable
 * continuation state) spend the platform retry budget.
 */

import type { ExecutorEnv, FleetRunJob } from './env.js';
import { executeFleet } from './execute.js';
import { CheckRunCompletionError } from './github.js';
import {
  normalizeProviderQueueAttempt,
  FleetAiDependencyError,
  providerRetryDelaySeconds,
  PROVIDER_MAX_DELIVERY_ATTEMPTS,
} from './ai-resilience.js';
import { handleDlqJob } from './dlq.js';
import {
  countDeliveryContinuations,
  recordDeliveryAttemptStart,
  recordDeliveryContinuation,
  recordDeliveryFailure,
  readDeliveryContinuationCount,
  runIdForDelivery,
} from './delivery-failure.js';
import { flushSquidEvents } from './squid-events.js';
import {
  beginFleetIntentAttempt,
  finishFleetIntentFromRun,
  markFleetIntentRetrying,
  markFleetIntentTerminal,
} from './run-intent.js';
import {
  encodeFleetDeliveryAttempt,
  FLEET_CONTINUATION_ATTEMPT_STRIDE,
} from '../../shared/fleet-delivery-attempt.js';

export type { ExecutorEnv, FleetRunJob } from './env.js';
export { executeFleet } from './execute.js';

/** The dead-letter queue name (must match `dead_letter_queue` in wrangler.toml). */
const DLQ_QUEUE_NAME = 'fleet-runs-dlq';

/**
 * One provider-heavy ship per isolate. Checkpoints make the logical Fleet run
 * cumulative across these successful queue slices without depending on an OOM
 * or CPU kill to end an invocation.
 */
export const MAX_NEW_SHIPS_PER_INVOCATION = 1;

/**
 * Validate the explicit checkpoint sequence before it enters cursor storage.
 * Design intent: malformed queue bodies fail closed before model spend.
 *
 * @param job - Untrusted Fleet queue job.
 * @returns A bounded positive sequence, or null for an admission delivery.
 */
function continuationSequence(job: FleetRunJob): number | null {
  const value = job.continuationSequence;
  return Number.isSafeInteger(value) && (value ?? 0) > 0 && (value ?? 0) < 10_000
    ? value as number
    : null;
}

export default {
  /**
   * Consume admission and continuation deliveries through one replay-safe
   * implementation while Cloudflare gives each queue an isolated pool.
   * Design intent: topology isolation must not fork idempotency semantics.
   *
   * @param batch - One queue batch from either dedicated consumer.
   * @param env - Fleet bindings, including the required continuation producer.
   * @param ctx - Worker lifetime context for best-effort telemetry drains.
   * @returns Completion after every message is acknowledged or retried.
   */
  async queue(
    batch: MessageBatch<FleetRunJob>,
    env: ExecutorEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    // DLQ path: a job that exhausted retries on the main queue lands here. Its
    // 'Port Daddy Fleet' check is stuck in_progress — complete it as failure so a
    // lost blocking job can never leave a green/absent gate. Always ack (the
    // message already exhausted retries; re-queuing it would loop).
    // OBSERVABILITY (#7743 follow-up): one line per invocation, before any
    // branch can return early. The OOM investigation cost two cycles partly
    // because nothing recorded that the consumer had even been reached — an
    // absent 'Port Daddy Fleet' check is ambiguous between "never dispatched",
    // "skipped as superseded", and "died before creating the gate", and those
    // have completely different fixes. This line collapses the first ambiguity.
    console.log(
      `[fleet-executor] queue=${batch.queue} batchSize=${batch.messages.length}`,
    );

    if (batch.queue === DLQ_QUEUE_NAME) {
      for (const message of batch.messages) {
        console.log(
          `[fleet-executor] dlq delivery=${message.body?.deliveryId} repo=${message.body?.repoFullName} pr=${message.body?.prNumber}`,
        );
        await handleDlqJob(message.body, env);
        message.ack();
      }
      return;
    }

    for (const message of batch.messages) {
      const reportedAttempt = (message as unknown as { attempts?: number }).attempts;
      const attempt = Number.isInteger(reportedAttempt) &&
          (reportedAttempt ?? 0) > 0 &&
          (reportedAttempt ?? 0) < FLEET_CONTINUATION_ATTEMPT_STRIDE
        ? reportedAttempt as number
        : 1;
      const explicitContinuation = continuationSequence(message.body);
      const deliveryAttempt = encodeFleetDeliveryAttempt(explicitContinuation, attempt);
      const attemptCursor = deliveryAttempt.attemptCursor;
      const continuationQueue = env.FLEET_CONTINUATIONS;
      try {
        if (
          message.body?.continuationSequence !== undefined &&
          explicitContinuation == null
        ) {
          throw new Error(
            `invalid continuation sequence: ${String(message.body.continuationSequence)}`,
          );
        }
        console.log(
          `[fleet-executor] job delivery=${message.body?.deliveryId} repo=${message.body?.repoFullName} ` +
            `pr=${message.body?.prNumber} attempt=${attempt} cursor=${attemptCursor} ` +
            `continuation=${explicitContinuation ?? 'legacy'}`,
        );
        if (explicitContinuation != null) {
          if (!message.body.deliveryId) {
            throw new Error('explicit continuation is missing its delivery id');
          }
          const recordedSequence = await readDeliveryContinuationCount(
            env,
            runIdForDelivery(message.body.deliveryId),
          );
          if (recordedSequence == null) {
            throw new Error(
              `explicit continuation ${explicitContinuation} cannot verify durable checkpoint sequence`,
            );
          }
          if (recordedSequence < explicitContinuation) {
            throw new Error(
              `explicit continuation ${explicitContinuation} is ahead of durable sequence ${recordedSequence}`,
            );
          }
          if (recordedSequence === explicitContinuation + 1) {
            // The previous invocation may have committed its checkpoint and
            // then failed while sending this successor. Re-sending is safe:
            // the successor itself is deduplicated against the same ledger.
            if (!continuationQueue) {
              throw new Error(
                `cannot repair missing continuation ${recordedSequence}: producer binding unavailable`,
              );
            }
            await continuationQueue.send(
              { ...message.body, continuationSequence: recordedSequence },
              { delaySeconds: 1 },
            );
            console.log(
              `[fleet-executor] RECOVERED uncertain continuation delivery=${message.body.deliveryId} ` +
                `messageSequence=${explicitContinuation} resentSequence=${recordedSequence}; ` +
                `acknowledging predecessor`,
            );
            message.ack();
            continue;
          }
          if (recordedSequence > explicitContinuation) {
            console.log(
              `[fleet-executor] SKIPPED duplicate continuation delivery=${message.body?.deliveryId} ` +
                `messageSequence=${explicitContinuation} recordedSequence=${recordedSequence}`,
            );
            message.ack();
            continue;
          }
        }
        if (!continuationQueue) {
          throw new Error(
            'dedicated fleet-continuations producer binding unavailable before model spend',
          );
        }
        const intentDecision = await beginFleetIntentAttempt(env, message.body, attemptCursor);
        if (intentDecision === 'skip') {
          // A newer PR generation owns the required check.  The queue cannot
          // delete this stale message, so acknowledge it here before GitHub or
          // model work.  The superseded intent remains visible to operators.
          //
          // LOUD ON PURPOSE: this is the one exit that acks a job WITHOUT ever
          // creating the 'Port Daddy Fleet' check, so a PR that takes it shows
          // no gate at all — indistinguishable from "the fleet never ran" when
          // read from GitHub. If this fires when it shouldn't, silence would
          // make it invisible; a superseded skip is normal, a stream of them on
          // current heads is a bug.
          console.log(
            `[fleet-executor] SKIPPED as superseded delivery=${message.body?.deliveryId} repo=${message.body?.repoFullName} pr=${message.body?.prNumber} — no check run will be created`,
          );
          message.ack();
          continue;
        }
        // Attempt-start marker BEFORE any work: the one write that survives an
        // uncatchable platform kill (memory/CPU), so a dead-letter with starts
        // but no failures is positive evidence of that class — issue #7743.
        await recordDeliveryAttemptStart(
          env,
          message.body,
          deliveryAttempt,
        );
        const disposition = await executeFleet(message.body, env, {
          // Explicit continuations start a fresh Cloudflare delivery counter.
          // executeFleet subtracts durable continuations from this value, so
          // offset it here to preserve the true provider attempt (1..N).
          queueAttempt: explicitContinuation == null
            ? attempt
            : explicitContinuation + attempt,
          maxNewShipsPerInvocation: MAX_NEW_SHIPS_PER_INVOCATION,
        });
        if (disposition?.kind === 'continuation') {
          const recorded = await recordDeliveryContinuation(
            env,
            message.body,
            deliveryAttempt,
            disposition.completedShip,
            disposition.remainingShips,
          );
          if (!recorded) {
            throw new Error(
              `checkpoint continuation could not be recorded after pd-${disposition.completedShip}`,
            );
          }
          // The ship-verdict squid event is already queued. Give it the same
          // best-effort lifetime extension as a final verdict before returning
          // this successfully checkpointed message to the queue.
          const telemetryDrain = flushSquidEvents();
          try {
            ctx.waitUntil(telemetryDrain);
          } catch {
            void telemetryDrain;
          }
          const nextSequence = await readDeliveryContinuationCount(
            env,
            runIdForDelivery(message.body.deliveryId),
          );
          if (nextSequence == null || nextSequence <= 0) {
            throw new Error(
              `checkpoint continuation count unavailable after pd-${disposition.completedShip}`,
            );
          }
          await continuationQueue.send(
            { ...message.body, continuationSequence: nextSequence },
            { delaySeconds: 1 },
          );
          console.log(
            `[fleet-executor] continuation delivery=${message.body.deliveryId} ` +
              `sequence=${nextSequence} completed=pd-${disposition.completedShip}; ` +
              `acknowledging current message`,
          );
          message.ack();
          continue;
        }
        if (disposition?.kind === 'stale-head') {
          const reason = disposition.stage === 'mid-flight'
            ? (
                `pull request head changed during Fleet execution at ` +
                `${disposition.boundary ?? 'an unrecorded boundary'}; expected ` +
                `${disposition.expectedHead ?? 'unknown'}, current ` +
                `${disposition.currentHead ?? 'unknown'}. ` +
                (disposition.modelSpendPossible
                  ? 'Model work may already have occurred, but later GitHub side effects and the obsolete verdict were suppressed.'
                  : 'No model spend occurred in this invocation; the obsolete check was neutralized before ship execution.')
              )
            : 'payload head is no longer current; acknowledged without model spend';
          await markFleetIntentTerminal(
            env,
            message.body.deliveryId,
            'cancelled',
            reason,
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
        const providerError = err instanceof FleetAiDependencyError ? err : null;
        const recordedContinuations = explicitContinuation == null
          ? await countDeliveryContinuations(
              env,
              runIdForDelivery(message.body?.deliveryId ?? ''),
            )
          : 0;
        const providerAttempt = normalizeProviderQueueAttempt(
          attempt - recordedContinuations,
        );
        const providerDelaySeconds =
          providerError?.failure.retryable
            ? providerRetryDelaySeconds(
                providerAttempt,
                Math.random,
                providerError.failure.retryAfterSeconds,
              )
            : null;
        const durableError = providerDelaySeconds == null
          ? err
          : new Error(
              `${providerError?.message ?? 'Workers AI dependency unavailable'}; Workers AI circuit open on attempt ` +
                `${providerAttempt}/${PROVIDER_MAX_DELIVERY_ATTEMPTS}; queue retry scheduled in ` +
                `${providerDelaySeconds}s`,
            );
        // Recoverable infrastructure error — re-deliver. After max_retries the
        // platform routes this to fleet-runs-dlq, where the DLQ handler MUST
        // complete the (already-created) check run as 'failure'. Because the
        // check was created in_progress before any ship ran, a job lost here
        // never leaves a green or absent gate.
        console.error(
          `[fleet-executor] delivery=${message.body?.deliveryId} retry: ${String(durableError)}`,
        );
        // Persist WHY before retrying. A Worker console line does not survive
        // the run, so without this the only artifact a dead-lettered job leaves
        // is "was lost" with no cause — see delivery-failure.ts. Best-effort and
        // non-throwing by construction, so it can never eat the retry below.
        await recordDeliveryFailure(
          env,
          message.body,
          deliveryAttempt,
          durableError,
        );
        await markFleetIntentRetrying(env, message.body, attemptCursor, durableError);
        if (err instanceof CheckRunCompletionError && err.retryAfterSeconds) {
          message.retry({ delaySeconds: err.retryAfterSeconds });
        } else if (providerDelaySeconds != null) {
          message.retry({ delaySeconds: providerDelaySeconds });
        } else {
          message.retry();
        }
      }
    }
  },
} satisfies ExportedHandler<ExecutorEnv, FleetRunJob>;

export { Sandbox } from '@cloudflare/sandbox';
