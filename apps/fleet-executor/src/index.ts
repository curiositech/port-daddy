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
 * and GitHub's lack of atomic metadata/check mutation remain explicit residual
 * windows; this code does not claim they are closed by the queue consumer.
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
import { FLEET_WAITING_CONTROL } from '../../shared/fleet-suspension.js';
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
  runIdForDelivery,
} from './delivery-failure.js';
import { flushSquidEvents } from './squid-events.js';
import { parseFleetControl } from '../../relay/src/fleet-pause-control.js';
import { readRepoShipControls, repoShipEnabled } from '../../shared/repo-ship-controls.js';
import {
  assertFleetContinuationPending,
  claimFleetIntentWork,
  finishFleetIntentFromRun,
  holdFleetContinuationForControl,
  markFleetIntentRetrying,
  markFleetIntentWaitingForControl,
  markFleetIntentTerminal,
  prepareFleetIntentContinuation,
  readFleetIntentState,
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

/**
 * Recheck both canonical OFF authorities immediately before a continuation
 * queue send. A cached false is never permission; the Durable Object and D1
 * repository control must both be freshly readable and ON.
 */
async function continuationControlBlockReason(
  env: ExecutorEnv,
  job: FleetRunJob,
): Promise<string | null> {
  if (!env.FLEET_CONTROL) return 'global-control-binding-missing';
  try {
    const runId = `${job.repoFullName}/${runIdForDelivery(job.deliveryId)}`;
    const raw = await env.FLEET_CONTROL.admit(undefined, runId);
    const control = raw?.status === 'unknown' ? raw : parseFleetControl(raw);
    if (control.status !== 'unpaused') {
      return control.status === 'unknown' ? `global-control-${control.reason}` : 'global-control-paused';
    }
    if (env.CONTROL_KV) {
      try {
        const legacyRaw = await env.CONTROL_KV.get('fleet:paused');
        const parsed = legacyRaw == null ? null : JSON.parse(legacyRaw) as unknown;
        const legacyPaused = parsed === true
          || (typeof parsed === 'object' && parsed != null
            && (parsed as { paused?: unknown }).paused === true);
        if (legacyPaused) return 'legacy-pause-projection';
      } catch {
        // KV is a deny-only mixed-version projection. It cannot grant work and
        // its failure cannot override the fresh canonical DO response above.
      }
    }
    const repo = await readRepoShipControls(env.DB, job.repoFullName ?? '');
    return repoShipEnabled(repo, '*') ? null : repo.available
      ? 'repository-off'
      : 'repository-control-unavailable';
  } catch {
    return 'global-control-read-failed';
  }
}

/** Send or durably hold one exact pending continuation permit. */
async function sendPendingContinuation(
  env: ExecutorEnv,
  job: FleetRunJob,
  sequence: number,
): Promise<'sent' | 'held'> {
  await assertFleetContinuationPending(env, job, sequence);
  const blocked = await continuationControlBlockReason(env, job);
  if (blocked) {
    await holdFleetContinuationForControl(
      env,
      job,
      sequence,
      `Fleet suspended: ${blocked}; pending continuation ${sequence} was not sent`,
    );
    return 'held';
  }
  await assertFleetContinuationPending(env, job, sequence);
  if (!env.FLEET_CONTINUATIONS) {
    throw new Error(`cannot send pending continuation ${sequence}: producer binding unavailable`);
  }
  await env.FLEET_CONTINUATIONS.send(
    { ...job, continuationSequence: sequence },
    { delaySeconds: 1 },
  );
  return 'sent';
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
        try {
          await handleDlqJob(message.body, env);
          message.ack();
        } catch (error) {
          console.error(
            `[fleet-executor] DLQ repair will retry delivery=${message.body?.deliveryId}: ${String(error)}`,
          );
          message.retry({ delaySeconds: 60 });
        }
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
      let intentClaimed = false;
      try {
        if (
          message.body?.continuationSequence !== undefined &&
          explicitContinuation == null
        ) {
          throw new Error(
            `invalid continuation sequence: ${String(message.body.continuationSequence)}`,
          );
        }
        if (explicitContinuation != null && !message.body.deliveryId) {
          throw new Error('explicit continuation is missing its delivery id');
        }
        console.log(
          `[fleet-executor] job delivery=${message.body?.deliveryId} repo=${message.body?.repoFullName} ` +
            `pr=${message.body?.prNumber} attempt=${attempt} cursor=${attemptCursor} ` +
            `continuation=${explicitContinuation ?? 'legacy'}`,
        );
        const intentDecision = await claimFleetIntentWork(
          env,
          message.body,
          attemptCursor,
          explicitContinuation,
        );
        if (intentDecision.kind === 'repair-continuation') {
          const outcome = await sendPendingContinuation(
            env,
            message.body,
            intentDecision.sequence,
          );
          console.log(
            `[fleet-executor] ${outcome === 'sent' ? 'REPAIRED' : 'HELD'} continuation ` +
              `delivery=${message.body.deliveryId} sequence=${intentDecision.sequence}; ` +
              'predecessor performed no ship work',
          );
          message.ack();
          continue;
        }
        if (intentDecision.kind === 'skip') {
          // A superseded/terminal generation or an operator-control hold cannot
          // be reopened by an ordinary duplicate consumer delivery.
          console.log(
            `[fleet-executor] SKIPPED by durable admission state delivery=${message.body?.deliveryId} repo=${message.body?.repoFullName} pr=${message.body?.prNumber} — no check run will be created`,
          );
          message.ack();
          continue;
        }
        intentClaimed = true;
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
          intentAttemptCursor: attemptCursor,
        });
        if (disposition?.kind === 'continuation') {
          const nextSequence = (explicitContinuation ?? 0) + 1;
          await prepareFleetIntentContinuation(
            env,
            message.body,
            attemptCursor,
            nextSequence,
          );
          // From this point the predecessor no longer owns ship work. Any
          // thrown queue-send path leaves the permit repairable by a higher
          // retry instead of rewriting it as a generic running failure.
          intentClaimed = false;
          const recorded = await recordDeliveryContinuation(
            env,
            message.body,
            attemptCursor,
            disposition.completedShip,
            disposition.remainingShips,
            nextSequence,
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
          if (!env.FLEET_CONTINUATIONS) {
            console.warn(
              `[fleet-executor] continuation ${nextSequence} durably pending but producer binding is unavailable; ` +
                'retrying predecessor as a repair-only delivery',
            );
            message.retry({ delaySeconds: 1 });
            continue;
          }
          const sendOutcome = await sendPendingContinuation(
            env,
            message.body,
            nextSequence,
          );
          if (sendOutcome === 'sent') {
            console.log(
              `[fleet-executor] continuation delivery=${message.body.deliveryId} ` +
                `sequence=${nextSequence} completed=pd-${disposition.completedShip}; ` +
                `acknowledging current message`,
            );
            message.ack();
          } else {
            console.log(
              `[fleet-executor] continuation held by OFF authority delivery=${message.body.deliveryId} ` +
                `sequence=${nextSequence}; acknowledging predecessor without ship work`,
            );
            message.ack();
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
            message.body,
            attemptCursor,
            'cancelled',
            reason,
          );
        } else if (disposition?.kind === 'suspended') {
          // Keep a durable waiting-for-control intent, but acknowledge this message.
          // Suspension never schedules automatic paid work or becomes a
          // terminal model verdict. A later explicit redelivery rechecks the
          // same durable control epoch.
          await markFleetIntentWaitingForControl(env, message.body, attemptCursor,
            `Fleet suspended: ${disposition.reason}; operator-authorized redelivery or new delivery required; no automatic retry`);
          if (await readFleetIntentState(env, message.body) !== FLEET_WAITING_CONTROL) {
            throw new Error('Fleet suspension was not durably recorded; refusing to acknowledge the delivery');
          }
        } else if (disposition?.kind === 'coverage-held') {
          await markFleetIntentTerminal(
            env,
            message.body,
            attemptCursor,
            'failure',
            'Merge-group constituent review receipts are unverified',
          );
        } else if (disposition?.kind === 'already-decided') {
          await markFleetIntentTerminal(
            env,
            message.body,
            attemptCursor,
            disposition.conclusion,
            'required check already held a model-backed verdict; acknowledged without duplicate spend',
          );
        } else if (disposition?.kind === 'no-cloud-ships') {
          await markFleetIntentTerminal(
            env,
            message.body,
            attemptCursor,
            'cancelled',
            'trusted Fleet configuration contains no Cloud-executable review ships',
          );
        } else {
          await finishFleetIntentFromRun(env, message.body, attemptCursor);
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
        // A rejected or unverifiable queue body never owned this generation,
        // so it must not write a transcript or reopen the legitimate intent.
        // Only the exact attempt that completed the conditional admission write
        // may publish retry evidence for that run.
        if (intentClaimed) {
          await recordDeliveryFailure(
            env,
            message.body,
            attemptCursor,
            durableError,
          );
          await markFleetIntentRetrying(env, message.body, attemptCursor, durableError);
        }
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
