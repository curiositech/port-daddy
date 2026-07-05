/**
 * Cloud fleet executor.
 *
 * Receives a verified GitHub webhook envelope and dispatches the repo's
 * fleet ships that match the event trigger — entirely in the cloud.
 *
 * For analytical ships (code-reviewer, qa, red-team): calls Cloudflare
 * Workers AI and posts the result as a PR comment.
 *
 * For execution ships (ships with allowedTools that include non-gh bash):
 * dispatches a GitHub Actions workflow instead (ships that need bash run
 * in a real container via GHA, not in a Worker).
 *
 * No tunnel. No local daemon. No Anthropic API key.
 */

import type { WebhookEnvelope } from './forward.js';
import type { ExecutorEnv } from './worker.js';
import {
  getInstallationToken,
  fetchPRContext,
  fetchRepoFile,
  fetchFleetComments,
  postShipComment,
  createCheckRun,
  completeCheckRun,
  type PRContext,
} from './github.js';
import { parseFleetShips, defaultPRShips, type ShipConfig } from './fleet.js';
import { emitCloudTelemetry, extractWorkersAiUsage } from './telemetry.js';
import { withDeadline } from './deadline.js';

// Exported so tests can pin the ship-review deadline behavior.
export const AI_RUN_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------

const DIFF_CHAR_LIMIT = 24_000;

interface ShipRunResult {
  status: 'clean' | 'findings' | 'error';
  durationMs: number;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  responseChars?: number;
  error?: string;
}

export async function executeFleet(envelope: WebhookEnvelope, env: ExecutorEnv): Promise<void> {
  if (!env.AI) return;
  const fleetStartedAt = Date.now();

  const { event, action, payload, installation_id, repository } = envelope;

  // Only handle pull_request:opened and pull_request:synchronize for now
  if (event !== 'pull_request') return;
  if (action !== 'opened' && action !== 'synchronize') return;
  if (!repository || !installation_id) return;

  const [owner, repo] = repository.full_name.split('/');
  const pr = payload.pull_request as Record<string, unknown>;
  const prNumber = (pr?.number as number) ?? 0;
  if (!prNumber) return;

  // Get installation token
  const token = await getInstallationToken(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    installation_id,
  ).catch(() => null);
  if (!token) return;

  // Fetch PR context, fleet config, and prior fleet comments in parallel
  const [prCtx, fleetYaml, priorFleetFindings] = await Promise.all([
    fetchPRContext(owner, repo, prNumber, pr, token),
    fetchRepoFile(owner, repo, 'pd-fleet.yml', 'main', token),
    // On synchronize, ships read their prior findings so they can note what's addressed/still open
    action === 'synchronize'
      ? fetchFleetComments(owner, repo, prNumber, token)
      : Promise.resolve(''),
  ]);
  prCtx.priorFleetFindings = priorFleetFindings || undefined;

  // Determine which ships to run
  let ships: ShipConfig[];
  if (fleetYaml) {
    ships = (await parseFleetShips(fleetYaml, 'pull_request:opened', env.AI)) ?? defaultPRShips();
  } else {
    ships = defaultPRShips();
  }

  // Filter to cloud-executable ships only (skip execution ships for now)
  const cloudShips = ships.filter(s => !s.needsExecution);

  if (cloudShips.length === 0) return;

  // Create an umbrella check run
  const checkRunId = await createCheckRun(
    owner,
    repo,
    'Port Daddy Fleet',
    prCtx.headSha,
    token,
  ).catch(() => 0);

  // Run ships in parallel — faster total wall-clock time and reduces check run timeout risk
  const resultPairs = await Promise.all(
    cloudShips.map(async ship => ({
      ship,
      result: await runShip(ship, prCtx, token, env.AI),
    })),
  );

  const statusIcon = (s: string) =>
    s === 'clean' ? '✓ clean' : s === 'findings' ? '⚠ findings' : '✗ error';

  const summary = resultPairs
    .map(r => `- **pd-${r.ship.name}**: ${statusIcon(r.result.status)}`)
    .join('\n');

  // Fail the check when any ship has findings (so the PR must be addressed or overridden).
  // Error/timeout → neutral (operator-visible, but doesn't block if ships are broken).
  const hasFindings = resultPairs.some(r => r.result.status === 'findings');
  const hasErrors = resultPairs.some(r => r.result.status === 'error');
  const conclusion = hasFindings ? 'failure' : hasErrors ? 'neutral' : 'success';

  await completeCheckRun(
    owner,
    repo,
    checkRunId,
    conclusion,
    summary || 'No ships ran.',
    token,
  ).catch(err =>
    console.error('completeCheckRun failed', err instanceof Error ? err.message : String(err)),
  );

  await Promise.all([
    emitCloudTelemetry({
      deliveryId: envelope.delivery,
      event,
      action,
      owner,
      repo,
      prNumber,
      sha: prCtx.headSha,
      status: 'check_completed',
      conclusion,
      checkRunId,
      durationMs: Date.now() - fleetStartedAt,
      metadata: {
        shipCount: resultPairs.length,
        hasFindings,
        hasErrors,
        summary,
      },
    }, env).catch(err =>
      console.error('cloud-telemetry check error', err instanceof Error ? err.message : String(err)),
    ),
    ...resultPairs.map(({ ship, result }) =>
      emitCloudTelemetry({
        deliveryId: envelope.delivery,
        event,
        action,
        owner,
        repo,
        prNumber,
        sha: prCtx.headSha,
        ship: ship.name,
        role: ship.role,
        status: result.status,
        conclusion,
        backend: 'cloudflare',
        model: result.model,
        durationMs: result.durationMs,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        metadata: {
          responseChars: result.responseChars ?? null,
          error: result.error ?? null,
        },
      }, env).catch(err =>
        console.error('cloud-telemetry ship error', err instanceof Error ? err.message : String(err)),
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------

async function runShip(
  ship: ShipConfig,
  prCtx: PRContext,
  token: string,
  ai: Ai,
): Promise<ShipRunResult> {
  const startedAt = Date.now();
  try {
    const contractPath = `fleet/ships/${ship.name}.md`;
    const contract = await fetchRepoFile(
      prCtx.owner,
      prCtx.repo,
      contractPath,
      'main',
      token,
    ).catch(() => null);

    const systemPrompt = buildSystemPrompt(ship, contract);
    const userMessage = buildUserMessage(prCtx);

    // Hard deadline on the model call. A bad/unknown model id (or a stuck
    // Workers AI queue) does not error — it hangs, which previously consumed
    // the whole waitUntil budget and left the check run in_progress FOREVER
    // (the 2026-07-03 outage). A timed-out ship degrades to status 'error';
    // executeFleet still resolves the check run as neutral. withDeadline
    // clears its timer on every exit path — no orphaned timers per ship.
    const res = (await withDeadline(
      Promise.resolve(
        ai.run(ship.cfModel as Parameters<typeof ai.run>[0], {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
      ),
      AI_RUN_TIMEOUT_MS,
      `ai.run(${ship.cfModel})`,
    )) as { response?: string; usage?: Record<string, unknown> };
    const usage = extractWorkersAiUsage(res);

    const raw = (res.response ?? '').trim();
    const isClean = !raw || raw.length < 10 || /^clean$/i.test(raw);

    // Apply post-processor (e.g. idea-link injection for spider/spark)
    const processed = ship.postProcess
      ? ship.postProcess(raw, { owner: prCtx.owner, repo: prCtx.repo, prNumber: prCtx.prNumber, shipName: ship.name })
      : raw;

    const body = isClean ? '✓ No findings.' : processed;

    await postShipComment(
      prCtx.owner,
      prCtx.repo,
      prCtx.prNumber,
      ship.name,
      ship.role,
      body,
      token,
    );

    return {
      status: isClean ? 'clean' : 'findings',
      durationMs: Date.now() - startedAt,
      model: ship.cfModel,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      responseChars: raw.length,
    };
  } catch (err) {
    return {
      status: 'error',
      durationMs: Date.now() - startedAt,
      model: ship.cfModel,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildSystemPrompt(ship: ShipConfig, contract: string | null): string {
  const parts: string[] = [];

  if (contract) {
    parts.push(`# Ship Contract\n\n${contract}`);
    parts.push('---');
  }

  parts.push(ship.prompt);

  if (ship.telos) {
    parts.push(`\nYour telos: ${ship.telos}`);
  }

  parts.push(
    '\nYou are running as a Cloudflare Worker with no filesystem or shell access. ' +
      'Analyze the PR diff provided and respond with your findings only. ' +
      'If you find nothing worth noting, respond with exactly: CLEAN (the comment will say "✓ No findings.").',
  );

  return parts.join('\n\n');
}

function buildUserMessage(prCtx: PRContext): string {
  const fileList = prCtx.files
    .map(f => `- ${f.filename} (+${f.additions}/-${f.deletions})`)
    .join('\n');

  const diff = prCtx.diff.length > DIFF_CHAR_LIMIT
    ? prCtx.diff.slice(0, DIFF_CHAR_LIMIT) + '\n\n[diff truncated — ' + prCtx.diff.length + ' chars total]'
    : prCtx.diff;

  const parts = [
    `# PR #${prCtx.prNumber}: ${prCtx.title}`,
    `## Changed files\n${fileList || '(none)'}`,
    `## PR description\n${prCtx.body || '(none)'}`,
  ];

  if (prCtx.priorFleetFindings) {
    parts.push(
      `## Prior fleet findings (from previous run — note what's been addressed vs. still open)\n${prCtx.priorFleetFindings}`,
    );
  }

  parts.push(`## Diff\n\`\`\`diff\n${diff}\n\`\`\``);

  return parts.join('\n\n');
}
