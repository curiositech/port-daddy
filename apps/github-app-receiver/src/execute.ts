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

// ---------------------------------------------------------------------------

const DIFF_CHAR_LIMIT = 24_000;

export async function executeFleet(envelope: WebhookEnvelope, env: ExecutorEnv): Promise<void> {
  if (!env.AI) return;

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
      ship: ship.name,
      status: await runShip(ship, prCtx, token, env.AI),
    })),
  );

  const summary = resultPairs
    .map(r => `- **pd-${r.ship}**: ${r.status === 'ok' ? '✓ posted' : '✗ error'}`)
    .join('\n');

  // Always complete the check run, even if some ships failed
  await completeCheckRun(
    owner,
    repo,
    checkRunId,
    resultPairs.every(r => r.status !== 'error') ? 'success' : 'neutral',
    summary || 'No ships ran.',
    token,
  ).catch(err =>
    console.error('completeCheckRun failed', err instanceof Error ? err.message : String(err)),
  );
}

// ---------------------------------------------------------------------------

async function runShip(
  ship: ShipConfig,
  prCtx: PRContext,
  token: string,
  ai: Ai,
): Promise<'ok' | 'empty' | 'error'> {
  try {
    // Fetch ship contract file if it exists
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

    const res = (await ai.run(ship.cfModel as Parameters<typeof ai.run>[0], {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })) as { response?: string };

    const output = (res.response ?? '').trim();
    const isClean = !output || output.length < 10 || /^clean$/i.test(output);
    const body = isClean ? '✓ No findings.' : output;

    await postShipComment(
      prCtx.owner,
      prCtx.repo,
      prCtx.prNumber,
      ship.name,
      ship.role,
      body,
      token,
    );

    return 'ok';
  } catch {
    return 'error';
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
