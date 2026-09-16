/**
 * Cloud fleet executor — Cloudflare Queues consumer entry point.
 *
 * Relay enqueues one {@link FleetRunJob} per GitHub delivery to the `fleet-runs`
 * queue. This Worker consumes batches, runs the orchestrator per message, and
 * acks/retries each message independently.
 *
 * FAIL-CLOSED / DLQ CONTRACT
 * --------------------------
 * After admission, the orchestrator creates a delivery-bound 'Port Daddy
 * Fleet' check run in_progress before model work. A lost admitted job normally
 * leaves that owned check unresolved until the DLQ claims the same intent and
 * marks the exact creator-run check failure. The webhook-to-check interval,
 * degraded legacy admission, and GitHub's lack of atomic metadata/check
 * mutation remain explicit residual windows; this code does not claim they are
 * closed by the queue consumer.
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
 * Leave enough room for Cloudflare's platform retries inside one checkpoint.
 * The resulting cursor is monotonic across explicit continuation messages,
 * whose platform `attempts` counter restarts at one.
 */
const CONTINUATION_ATTEMPT_STRIDE = 100;

function continuationSequence(job: FleetRunJob): number | null {
  const value = job.continuationSequence;
  return Number.isSafeInteger(value) && (value ?? 0) > 0 && (value ?? 0) < 10_000
    ? value as number
    : null;
}

function deliveryAttemptCursor(job: FleetRunJob, platformAttempt: number): number {
  const sequence = continuationSequence(job);
  return sequence == null
    ? platformAttempt
    : sequence * CONTINUATION_ATTEMPT_STRIDE + platformAttempt;
}

export default {
  async queue(
    batch: MessageBatch<FleetRunJob>,
    env: ExecutorEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    // DLQ path: a job that exhausted retries on the main queue lands here. Its
    // exact creator-run 'Port Daddy Fleet' check may be stuck in_progress. The
    // DLQ first claims the active intent, then marks only that check failure.
    // Missing/degraded authority is logged and leaves GitHub untouched.
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
      const attempt = Number.isInteger(reportedAttempt) && (reportedAttempt ?? 0) > 0
        ? reportedAttempt as number
        : 1;
      const explicitContinuation = continuationSequence(message.body);
      const attemptCursor = deliveryAttemptCursor(message.body, attempt);
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
            if (!env.FLEET_CONTINUATIONS) {
              throw new Error(
                `cannot repair missing continuation ${recordedSequence}: producer binding unavailable`,
              );
            }
            await env.FLEET_CONTINUATIONS.send(
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
          attemptCursor,
        );
        const disposition = await executeFleet(message.body, env, {
          // Explicit continuations start a fresh Cloudflare delivery counter.
          // executeFleet subtracts durable continuations from this value, so
          // offset it here to preserve the true provider attempt (1..N).
          queueAttempt: explicitContinuation == null
            ? attempt
            : explicitContinuation + attempt,
          maxNewShipsPerInvocation: MAX_NEW_SHIPS_PER_INVOCATION,
          enforceIntentOwnership: intentDecision === 'run',
        });
        if (disposition?.kind === 'continuation') {
          const recorded = await recordDeliveryContinuation(
            env,
            message.body,
            attemptCursor,
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
          if (env.FLEET_CONTINUATIONS) {
            const nextSequence = await readDeliveryContinuationCount(
              env,
              runIdForDelivery(message.body.deliveryId),
            );
            if (nextSequence == null || nextSequence <= 0) {
              throw new Error(
                `checkpoint continuation count unavailable after pd-${disposition.completedShip}`,
              );
            }
            await env.FLEET_CONTINUATIONS.send(
              { ...message.body, continuationSequence: nextSequence },
              { delaySeconds: 1 },
            );
            console.log(
              `[fleet-executor] continuation delivery=${message.body.deliveryId} ` +
                `sequence=${nextSequence} completed=pd-${disposition.completedShip}; ` +
                `acknowledging current message`,
            );
            message.ack();
          } else {
            // Rolling-deploy compatibility: code may reach an isolate before
            // the producer binding is live. Preserve the old cumulative path
            // until Wrangler finishes installing FLEET_CONTINUATIONS.
            console.warn(
              `[fleet-executor] continuation producer absent delivery=${message.body.deliveryId}; ` +
                `falling back to platform retry`,
            );
            message.retry({ delaySeconds: 1 });
          }
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
        // platform routes this to fleet-runs-dlq, where the handler attempts an
        // intent-claimed failure of this delivery's exact check. An authority
        // outage or pre-check crash can still leave the gate absent/pending;
        // those residuals must remain visible rather than be described away.
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
          attemptCursor,
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
