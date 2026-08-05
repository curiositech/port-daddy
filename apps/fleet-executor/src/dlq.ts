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
 * emits an error telemetry event so the drop is operator-visible. Best-effort per
 * message; a failure here is logged and the message acked (it has already
 * exhausted retries — re-queuing it would loop).
 */

import type { ExecutorEnv, FleetRunJob } from './env.js';
import {
  getInstallationTokenCached,
  invalidateInstallationToken,
  findFleetCheckRun,
  completeCheckRun,
} from './github.js';
import { emitCloudTelemetry } from './telemetry.js';
import { runDetailsUrl } from './run-page.js';
import { CHECK_NAME, ensureRunRow } from './execute.js';

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
  const headSha = pr?.head?.sha ?? group?.head_sha ?? '';
  const installationId = job.installationId ?? 0;
  if (!owner || !repo || !headSha || !installationId) return null;
  return { owner, repo, headSha, installationId, prNumber: job.prNumber };
}

/**
 * Complete the stuck check as failure + emit an error event for one dead job.
 * Never throws.
 */
export async function handleDlqJob(job: FleetRunJob, env: ExecutorEnv): Promise<void> {
  const target = targetOf(job);
  if (!target) {
    console.error(`[fleet-executor] DLQ: unparseable job delivery=${job?.deliveryId}`);
    return;
  }
  const { owner, repo, headSha, installationId, prNumber } = target;
  const summary =
    `pd-fleet: run for ${owner}/${repo} PR #${prNumber ?? '?'} was lost (job exhausted retries / ` +
    `dead-lettered). This gate is failed rather than left stuck in-progress.`;

  try {
    let token = await getInstallationTokenCached(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      installationId,
      env.FLEET_TOKENS,
    );
    const completeFailure = async (): Promise<number | null> => {
      const checkRunId = await findFleetCheckRun(owner, repo, headSha, CHECK_NAME, token);
      if (!checkRunId) return null;
      // Same deterministic run id the main consumer used, so the failed gate
      // still links to whatever transcript the lost run managed to write.
      const runId = `run:${job.deliveryId}`;
      const detailsUrl = await runDetailsUrl(env, runId);
      await ensureRunRow(
        env,
        runId,
        job.deliveryId,
        job.repoFullName ?? `${owner}/${repo}`,
        prNumber,
        headSha,
      );
      await completeCheckRun(owner, repo, checkRunId, 'failure', summary, token, detailsUrl);
      return checkRunId;
    };
    let checkRunId: number | null;
    try {
      checkRunId = await completeFailure();
    } catch (error) {
      if (!/\b401\b/.test(String(error))) throw error;
      await invalidateInstallationToken(installationId, env.FLEET_TOKENS);
      token = await getInstallationTokenCached(
        env.GITHUB_APP_ID,
        env.GITHUB_APP_PRIVATE_KEY,
        installationId,
        env.FLEET_TOKENS,
        true,
      );
      checkRunId = await completeFailure();
    }
    if (!checkRunId) {
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
