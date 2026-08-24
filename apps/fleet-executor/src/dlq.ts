/**
 * Dead-letter queue consumer for the fleet executor.
 *
 * The main queue creates the 'Port Daddy Fleet' check run `in_progress` BEFORE
 * any ship runs, so a job lost to exhausted retries leaves an unresolved gate
 * (never green, never absent) — fail-closed. The index.ts docblock promised a
 * "separate DLQ handler [that] MUST complete that check run as 'failure'", but
 * none existed: a dead-lettered blocking job left the check stuck `in_progress`
 * FOREVER, and nothing told the operator. This is that handler.
 *
 * For each dead-lettered {@link FleetRunJob} it: mints an installation token,
 * finds the stuck check run for the PR head SHA, completes it as **failure**, and
 * emits an error telemetry event so the drop is operator-visible. The summary it
 * writes carries the LAST recorded per-attempt failure (delivery-failure.ts), so
 * the gate says what killed the run instead of only that it died. Best-effort per
 * message; a failure here is logged and the message acked (it has already
 * exhausted retries — re-queuing it would loop).
 */

import type { ExecutorEnv, FleetRunJob } from './env.js';
import {
  getInstallationTokenCached,
  findFleetCheckRun,
  completeCheckRun,
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
import { markFleetIntentTerminal } from './run-intent.js';

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
  const headSha = pr?.head?.sha ?? '';
  const installationId = job.installationId ?? 0;
  if (!owner || !repo || !headSha || !installationId) return null;
  return { owner, repo, headSha, installationId, prNumber: job.prNumber };
}

/**
 * Complete the stuck check as failure + emit an error event for one dead job.
 * Never throws.
 */
export async function handleDlqJob(job: FleetRunJob, env: ExecutorEnv): Promise<void> {
  await markFleetIntentTerminal(
    env,
    job?.deliveryId ?? '',
    'failure',
    'delivery exhausted queue retries and entered the dead-letter queue',
  );
  const target = targetOf(job);
  if (!target) {
    console.error(`[fleet-executor] DLQ: unparseable job delivery=${job?.deliveryId}`);
    return;
  }
  const { owner, repo, headSha, installationId, prNumber } = target;
  // Same deterministic run id the main consumer used, so the failed gate still
  // links to whatever transcript the lost run managed to write — and so the
  // per-attempt failures the retry path recorded are readable from here.
  const runId = runIdForDelivery(job.deliveryId);

  try {
    // Inside the try deliberately. This function is documented "never throws",
    // and its caller acks the message immediately after it returns; a throw
    // here would leave a dead-lettered job unacked on a queue whose own
    // max_retries is 1. readLastDeliveryFailure guards itself, but that
    // guarantee should be enforced here rather than borrowed from a second
    // function's discipline.
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
    const checkRunId = await findFleetCheckRun(owner, repo, headSha, CHECK_NAME, token);
    if (checkRunId) {
      const detailsUrl = await runDetailsUrl(env, runId);
      // This path never calls recordRunStart at all, so without this the
      // details_url it publishes would always 404 ("Run not found") — the
      // DLQ variant of the same gap execute.ts's ensureRunRow closes.
      await ensureRunRow(env, runId, job.deliveryId, job.repoFullName ?? `${owner}/${repo}`, prNumber, headSha);
      await completeCheckRun(
        owner,
        repo,
        checkRunId,
        'failure',
        summary,
        token,
        detailsUrl,
        DLQ_CHECK_OUTPUT_TITLE,
      );
    } else {
      console.error(
        `[fleet-executor] DLQ: no '${CHECK_NAME}' check run found for ${owner}/${repo}@${headSha}`,
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
  }
}
