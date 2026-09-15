/**
 * Dead-letter queue consumer for the fleet executor.
 *
 * For an admitted generation, the main queue creates a creator-run-bound Fleet
 * check before model work. A dead-lettered delivery can therefore leave that
 * exact check pending. This handler conditionally claims the still-active D1
 * intent and mutates only the matching App-owned check; missing or degraded
 * authority is reported and leaves GitHub untouched.
 *
 * For each dead-lettered {@link FleetRunJob} it: mints an installation token,
 * finds the stuck check run for the PR head SHA, completes it as **failure**, and
 * emits an error telemetry event so the drop is operator-visible. The summary it
 * writes carries the LAST recorded per-attempt failure (delivery-failure.ts), so
 * the gate says what killed the run instead of only that it died. The handler
 * claims a fresh durable repair attempt and terminalizes it only after GitHub
 * confirms the failure check. Infrastructure failures use the DLQ's bounded
 * retry instead of acknowledging an unconfirmed required check.
 */

import type { ExecutorEnv, FleetRunJob } from './env.js';
import {
  getInstallationTokenCached,
  findFleetCheckRun,
  completeCheckRunDetailed,
  CheckRunCompletionError,
} from './github.js';
import { emitCloudTelemetry } from './telemetry.js';
import { runDetailsUrl } from './run-page.js';
import { CHECK_NAME, ensureRunRow } from './execute.js';
import {
  countDeliveryContinuations,
  countDeliveryAttemptStarts,
  deadLetterSummary,
  readLastDeliveryFailure,
  runIdForDelivery,
} from './delivery-failure.js';
import { countShipCheckpoints } from './ship-checkpoint.js';
import {
  assertFleetIntentCurrent,
  claimFleetIntentForDlq,
  markFleetIntentTerminal,
} from './run-intent.js';

export const DLQ_CHECK_OUTPUT_TITLE = 'Port Daddy Fleet — infrastructure failure (no verdict)';
const DLQ_NO_VERDICT_PREAMBLE =
  'Port Daddy Fleet infrastructure failed before review completed. This failed check is not a verdict on your change.';

interface DlqTarget {
  owner: string;
  repo: string;
  headSha: string;
  installationId: number;
  prNumber: number | null;
}

/** Pull the check-run coordinates out of a dead-lettered job (best-effort). */
function targetOf(job: FleetRunJob): DlqTarget | null {
  const [owner, repo] = (job.repoFullName ?? '').split('/');
  const pr = job.payloadMinimal?.pull_request as { head?: { sha?: string } } | undefined;
  const group = job.payloadMinimal?.merge_group as { head_sha?: string } | undefined;
  const headSha = job.eventType === 'merge_group' ? group?.head_sha ?? '' : pr?.head?.sha ?? '';
  const installationId = job.installationId ?? 0;
  if (!owner || !repo || !headSha || !installationId) return null;
  return { owner, repo, headSha, installationId, prNumber: job.prNumber };
}

/**
 * Complete the stuck check as failure + emit an error event for one dead job.
 * Infrastructure failures throw so the DLQ consumer uses its bounded retry;
 * the intent stays non-terminal until GitHub confirms the failure receipt.
 */
export async function handleDlqJob(job: FleetRunJob, env: ExecutorEnv): Promise<void> {
  const target = targetOf(job);
  if (!target) {
    throw new Error(`DLQ job is unparseable delivery=${job?.deliveryId}`);
  }
  if (!env.DB) {
    throw new Error(`DLQ generation ledger unavailable delivery=${job?.deliveryId}`);
  }
  const claim = await claimFleetIntentForDlq(
    env,
    job,
    'delivery exhausted queue retries; DLQ failure-check repair is in progress',
  );
  if (claim.kind === 'skip') {
    console.log(
      `[fleet-executor] DLQ: delivery=${job?.deliveryId} ${claim.reason}; no GitHub mutation`,
    );
    return;
  }
  const claimedAttempt = claim.attempt;
  const { owner, repo, headSha, installationId, prNumber } = target;
  // Same deterministic run id the main consumer used, so the failed gate still
  // links to whatever transcript the lost run managed to write — and so the
  // per-attempt failures the retry path recorded are readable from here.
  const runId = runIdForDelivery(job.deliveryId);

  try {
    const summary = `${DLQ_NO_VERDICT_PREAMBLE}\n\n${deadLetterSummary(
      owner,
      repo,
      prNumber,
      await readLastDeliveryFailure(env, runId),
      await countDeliveryAttemptStarts(env, runId),
      await countShipCheckpoints(env, runId),
      await countDeliveryContinuations(env, runId),
    )}`;
    const token = await getInstallationTokenCached(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      installationId,
      env.FLEET_TOKENS,
    );
    const checkRunId = await findFleetCheckRun(
      owner,
      repo,
      headSha,
      CHECK_NAME,
      token,
      env.GITHUB_APP_ID,
      runId,
    );
    if (checkRunId) {
      const detailsUrl = await runDetailsUrl(env, runId);
      // This path never calls recordRunStart at all, so without this the
      // details_url it publishes would always 404 ("Run not found") — the
      // DLQ variant of the same gap execute.ts's ensureRunRow closes.
      await ensureRunRow(env, runId, job.deliveryId, job.repoFullName ?? `${owner}/${repo}`, prNumber, headSha);
      const assertDlqOwnership = () => assertFleetIntentCurrent(env, job, claimedAttempt);
      const completion = await completeCheckRunDetailed(
        owner,
        repo,
        checkRunId,
        'failure',
        summary,
        token,
        detailsUrl,
        DLQ_CHECK_OUTPUT_TITLE,
        assertDlqOwnership,
      );
      if (!completion.ok) {
        throw new CheckRunCompletionError(
          `DLQ Fleet check completion failed after bounded retries for ${owner}/${repo}@${headSha} ` +
            `(check ${checkRunId}): ${completion.diagnostic ?? 'unknown GitHub response'}`,
          completion.retryAfterSeconds,
        );
      }
      await markFleetIntentTerminal(
        env,
        job,
        claimedAttempt,
        'failure',
        'delivery exhausted queue retries and the GitHub failure check was confirmed',
      );
    } else {
      throw new Error(
        `DLQ: no '${CHECK_NAME}' creator-run check found for ${owner}/${repo}@${headSha}`,
      );
    }
    await emitCloudTelemetry(
      {
        deliveryId: job.deliveryId,
        event: 'dlq',
        action: job.action,
        owner,
        repo,
        prNumber,
        sha: headSha,
        status: 'error',
        conclusion: 'failure',
        backend: 'cloudflare',
        checkRunId: checkRunId || null,
        metadata: { deadLettered: true },
      },
      env,
    );
  } catch (err) {
    console.error(`[fleet-executor] DLQ handler failed delivery=${job.deliveryId}: ${String(err)}`);
    throw err;
  }
}
