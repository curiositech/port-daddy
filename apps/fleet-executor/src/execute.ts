/**
 * Cloud fleet executor — orchestrator.
 *
 * Given ONE queue job (one GitHub delivery), this:
 *   1. mints (or reuses, via KV) an installation token,
 *   2. fetches PR context (diff) from the GitHub API,
 *   3. fetches fleet config + each ship contract FROM THE TRUSTED DEFAULT
 *      BRANCH ONLY (hard zero-trust invariant — never pull_request.head),
 *   4. creates ONE 'Port Daddy Fleet' check run in 'in_progress' (reusing an
 *      existing one for the same head SHA so retries are idempotent),
 *   5. runs each matching cloud-executable ship on Workers AI and posts its
 *      comment (edit-in-place, so a re-run never duplicates),
 *   6. completes the check: 'failure' if any BLOCKING ship returns BLOCK,
 *      errors, or lacks a parseable verdict; else 'success' (or 'neutral' when
 *      only a non-blocking ship objected).
 *
 * Adapted from PR #549 (apps/github-app-receiver/src/execute.ts): the entry
 * point now takes a {@link FleetRunJob} from the queue instead of a webhook
 * envelope, the token comes from the KV-backed cache, ship verdicts drive the
 * conclusion, and the check run is looked up for idempotent retries.
 */

import type { ExecutorEnv, FleetRunJob } from './env.js';
import {
  getInstallationTokenCached,
  invalidateInstallationToken,
  fetchPRContext,
  fetchRepoFile,
  postShipComment,
  createCheckRun,
  completeCheckRun,
  findFleetCheckRun,
  type PRContext,
} from './github.js';
import { parseFleetShips, defaultPRShips, type ShipConfig } from './fleet.js';
import { resolveVerdict, aggregateConclusion, type ShipResult, type Verdict } from './verdict.js';

// ---------------------------------------------------------------------------

const DIFF_CHAR_LIMIT = 24_000;
const CHECK_NAME = 'Port Daddy Fleet';

/** The trigger we currently dispatch (pull_request opened/synchronize). */
function triggerFor(job: FleetRunJob): string | null {
  if (job.eventType !== 'pull_request') return null;
  if (job.action !== 'opened' && job.action !== 'synchronize') return null;
  return 'pull_request:opened';
}

/**
 * Run the fleet for a single delivery. Throws on a recoverable infrastructure
 * error so the queue consumer can retry; returns normally otherwise (including
 * for non-actionable events, which are simply skipped).
 */
export async function executeFleet(job: FleetRunJob, env: ExecutorEnv): Promise<void> {
  if (!env.AI) return;

  const trigger = triggerFor(job);
  if (!trigger) return;
  if (!job.repoFullName || !job.installationId || !job.prNumber) return;

  const [owner, repo] = job.repoFullName.split('/');
  if (!owner || !repo) return;
  const prNumber = job.prNumber;
  const prPayload = (job.payloadMinimal.pull_request as Record<string, unknown>) ?? {};

  // --- Token (KV-cached; remint once on 401) -------------------------------
  let token: string;
  try {
    token = await getInstallationTokenCached(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      job.installationId,
      env.FLEET_TOKENS,
    );
  } catch (err) {
    // Token mint is infrastructure — let the queue retry.
    throw new Error(`token mint failed: ${String(err)}`);
  }

  // --- PR context + trusted config (default branch ONLY) -------------------
  const branch = env.DEFAULT_BRANCH || 'main';
  let prCtx: PRContext;
  let fleetYaml: string | null;
  try {
    [prCtx, fleetYaml] = await Promise.all([
      fetchPRContext(owner, repo, prNumber, prPayload, token),
      // ZERO-TRUST: config is read from the trusted branch, NEVER PR head.
      fetchRepoFile(owner, repo, 'pd-fleet.yml', branch, token),
    ]);
  } catch (err) {
    // One automatic remint on a likely-401, then retry the fetch.
    if (is401(err)) {
      await invalidateInstallationToken(job.installationId, env.FLEET_TOKENS);
      token = await getInstallationTokenCached(
        env.GITHUB_APP_ID,
        env.GITHUB_APP_PRIVATE_KEY,
        job.installationId,
        env.FLEET_TOKENS,
        true,
      );
      [prCtx, fleetYaml] = await Promise.all([
        fetchPRContext(owner, repo, prNumber, prPayload, token),
        fetchRepoFile(owner, repo, 'pd-fleet.yml', branch, token),
      ]);
    } else {
      throw err;
    }
  }

  // --- Resolve ships -------------------------------------------------------
  let ships: ShipConfig[];
  if (fleetYaml) {
    ships = (await parseFleetShips(fleetYaml, trigger, env.AI)) ?? defaultPRShips();
  } else {
    ships = defaultPRShips();
  }

  // Cloud-executable ships only (execution ships dispatch to GHA elsewhere).
  const cloudShips = ships.filter(s => !s.needsExecution);
  if (cloudShips.length === 0) return;

  // --- Check run (idempotent: reuse one for this head SHA) -----------------
  let checkRunId = await findFleetCheckRun(owner, repo, prCtx.headSha, CHECK_NAME, token).catch(
    () => null,
  );
  if (!checkRunId) {
    // No swallow: a createCheckRun failure must propagate so the job RETRIES.
    checkRunId = await createCheckRun(owner, repo, CHECK_NAME, prCtx.headSha, token);
  }
  if (!checkRunId) {
    // Fail closed: never proceed (and never ack) when we could not establish the
    // gating check. Throwing triggers message.retry() in the queue handler;
    // after max_retries the job DLQs and the required "Port Daddy Fleet" check
    // stays ABSENT, which GitHub treats as unsatisfied — the PR remains blocked,
    // never falsely green.
    throw new Error(
      `createCheckRun failed for ${owner}/${repo}@${prCtx.headSha}: cannot establish the Port Daddy Fleet gate`,
    );
  }

  // --- Run ships sequentially (Workers AI rate limits) ---------------------
  const results: ShipResult[] = [];
  for (const ship of cloudShips) {
    results.push(await runShip(ship, prCtx, token, env, branch));
  }

  // --- Conclusion (verdict logic is REAL; see verdict.ts) ------------------
  const conclusion = aggregateConclusion(results);
  await completeCheckRun(owner, repo, checkRunId, conclusion, buildSummary(results, conclusion), token);
}

// ---------------------------------------------------------------------------

/**
 * Run a single ship: fetch its contract (trusted branch), call Workers AI,
 * post the comment, and resolve its verdict. Never throws — a ship failure is
 * captured as `errored: true` so a blocking ship's crash fails the gate
 * (fail-closed) without aborting the rest of the fleet.
 */
async function runShip(
  ship: ShipConfig,
  prCtx: PRContext,
  token: string,
  env: ExecutorEnv,
  branch: string,
): Promise<ShipResult> {
  try {
    // ZERO-TRUST: ship contract is read from the trusted branch, NEVER PR head.
    const contract = await fetchRepoFile(
      prCtx.owner,
      prCtx.repo,
      `fleet/ships/${ship.name}.md`,
      branch,
      token,
    ).catch(() => null);

    const systemPrompt = buildSystemPrompt(ship, contract);
    const userMessage = buildUserMessage(prCtx);

    const res = (await env.AI.run(ship.cfModel as Parameters<typeof env.AI.run>[0], {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })) as { response?: string };

    const output = (res.response ?? '').trim();

    // Post the ship's findings (edit-in-place => idempotent on retry).
    await postShipComment(
      prCtx.owner,
      prCtx.repo,
      prCtx.prNumber,
      ship.name,
      ship.role,
      output,
      token,
    );

    const verdict: Verdict = resolveVerdict(output, ship.blocking);
    return { ship: ship.name, blocking: ship.blocking, verdict, errored: false };
  } catch {
    // A blocking ship that errors fails the gate (fail-closed). Verdict is
    // forced to BLOCK for blocking ships, PASS for advisory ones; `errored`
    // is the authoritative signal the aggregator keys on.
    return {
      ship: ship.name,
      blocking: ship.blocking,
      verdict: ship.blocking ? 'BLOCK' : 'PASS',
      errored: true,
    };
  }
}

function buildSummary(results: ShipResult[], conclusion: string): string {
  const lines = results.map(r => {
    const tag = r.blocking ? ' [BLOCKING]' : '';
    const state = r.errored ? 'error' : r.verdict;
    const advisory = !r.blocking && (r.verdict === 'BLOCK' || r.errored) ? ' (advisory)' : '';
    return `- pd-${r.ship}${tag}: ${state}${advisory}`;
  });
  lines.push('');
  lines.push(`Verdict: ${conclusion.toUpperCase()}`);
  return lines.join('\n');
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
      'If you find nothing worth noting, say so briefly.\n\n' +
      'End your response with EXACTLY one verdict line:\n' +
      'FLEET-VERDICT: PASS   (no objection to merge)\n' +
      'FLEET-VERDICT: BLOCK  (this change must not merge)',
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

  return `# PR #${prCtx.prNumber}: ${prCtx.title}

## Changed files
${fileList || '(none)'}

## PR description
${prCtx.body || '(none)'}

## Diff
\`\`\`diff
${diff}
\`\`\``;
}

function is401(err: unknown): boolean {
  return /\b401\b/.test(String(err));
}
