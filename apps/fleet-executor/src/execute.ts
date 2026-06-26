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
  createReview,
  createCheckRun,
  completeCheckRun,
  findFleetCheckRun,
  type PRContext,
  type ReviewComment,
} from './github.js';
import { parseFleetShips, defaultPRShips, type ShipConfig } from './fleet.js';
import {
  resolveVerdict,
  aggregateConclusion,
  parseShipFindings,
  type ShipResult,
  type Verdict,
} from './verdict.js';

// ---------------------------------------------------------------------------

/** Per-chunk diff budget for the MAP fan-out (chars). */
const MAP_CHUNK_CHAR_LIMIT = 12_000;
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
  // Deterministic parse of the WHOLE pd-fleet.yml, exactly once. A 404 (no
  // fleetYaml) or an unparseable/empty doc falls back to defaultPRShips() once —
  // never a repeated parse.
  let ships: ShipConfig[];
  if (fleetYaml) {
    ships = parseFleetShips(fleetYaml, trigger) ?? defaultPRShips();
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
  // Each ship is a map-reduce over the diff: MAP one call per diff chunk, then
  // REDUCE via a manager call that merges the structured findings and computes
  // the FLEET-VERDICT.
  const results: ShipResult[] = [];
  for (const ship of cloudShips) {
    results.push(await runShip(ship, prCtx, token, env, branch));
  }

  // --- Conclusion (verdict logic is REAL; see verdict.ts) ------------------
  const conclusion = aggregateConclusion(results);

  // --- ONE GitHub Review with all inline comments + a roll-up summary -------
  // Inline review is the PRIMARY surface; the per-ship issue comments posted
  // during each runShip() remain for backward-compatible history.
  const summary = buildSummary(results, conclusion);
  const reviewComments: ReviewComment[] = [];
  for (const r of results) {
    for (const f of r.findings ?? []) {
      reviewComments.push({ path: f.path, line: f.line, body: `[${r.ship}] ${f.body}` });
    }
  }
  if (reviewComments.length > 0 || summary.trim()) {
    // Best-effort: createReview never throws (see github.ts), so a review
    // failure can't fail the gate or block completing the check run.
    await createReview(owner, repo, prNumber, 'COMMENT', summary, reviewComments, prCtx.headSha, token);
  }

  await completeCheckRun(owner, repo, checkRunId, conclusion, summary, token);
}

// ---------------------------------------------------------------------------

/**
 * Run a single ship as a MAP-REDUCE over the PR diff:
 *
 *   MAP    — split the diff into chunks (file-aligned, under a char budget) and
 *            make one ship call per chunk. Each chunk yields partial findings.
 *   REDUCE — when there is more than one chunk, a manager call merges the
 *            partial outputs into a single structured findings block + one
 *            FLEET-VERDICT. A single-chunk diff skips the manager (the lone map
 *            output already IS the reduced result).
 *
 * Then it parses the structured findings + verdict, posts the per-ship issue
 * comment (edit-in-place => idempotent on retry), and returns the result.
 *
 * Never throws — a ship failure (AI/transport crash OR malformed findings JSON)
 * is captured as `errored: true` so a blocking ship's failure fails the gate
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
    const chunks = chunkDiff(prCtx.diff);

    // --- MAP: one ship call per diff chunk ---------------------------------
    const partials: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const userMessage = buildUserMessage(prCtx, chunks[i], i, chunks.length);
      const res = (await env.AI.run(ship.cfModel as Parameters<typeof env.AI.run>[0], {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      })) as { response?: string };
      partials.push((res.response ?? '').trim());
    }

    // --- REDUCE: manager merges the partials (only when fan-out > 1) --------
    const output =
      chunks.length === 1 ? partials[0] ?? '' : await reduceFindings(ship, partials, env);

    // Parse the structured findings block. `null` => malformed JSON => the ship
    // is treated as errored (blocking → BLOCK, advisory → PASS, never silent).
    const findings = parseShipFindings(output);

    // Post the ship's full output (edit-in-place => idempotent on retry). This
    // is the backward-compatible history surface; inline review is primary.
    await postShipComment(
      prCtx.owner,
      prCtx.repo,
      prCtx.prNumber,
      ship.name,
      ship.role,
      output,
      token,
    );

    if (findings === null) {
      return {
        ship: ship.name,
        blocking: ship.blocking,
        verdict: ship.blocking ? 'BLOCK' : 'PASS',
        errored: true,
        findings: [],
      };
    }

    const verdict: Verdict = resolveVerdict(output, ship.blocking);
    return { ship: ship.name, blocking: ship.blocking, verdict, errored: false, findings };
  } catch {
    // A blocking ship that errors fails the gate (fail-closed). Verdict is
    // forced to BLOCK for blocking ships, PASS for advisory ones; `errored`
    // is the authoritative signal the aggregator keys on.
    return {
      ship: ship.name,
      blocking: ship.blocking,
      verdict: ship.blocking ? 'BLOCK' : 'PASS',
      errored: true,
      findings: [],
    };
  }
}

/**
 * Split a unified diff into chunks aligned on `diff --git` file boundaries,
 * each under {@link MAP_CHUNK_CHAR_LIMIT}. A single file larger than the budget
 * is hard-split. Always returns at least one chunk (possibly empty-string).
 */
export function chunkDiff(diff: string): string[] {
  if (!diff || !diff.trim()) return [''];

  // Split BEFORE each `diff --git` header so each part is one file's hunks.
  const parts = diff.split(/(?=^diff --git )/m).filter(p => p.length > 0);
  if (parts.length === 0) return [diff];

  const chunks: string[] = [];
  let cur = '';
  for (const part of parts) {
    if (part.length > MAP_CHUNK_CHAR_LIMIT) {
      if (cur) {
        chunks.push(cur);
        cur = '';
      }
      for (let i = 0; i < part.length; i += MAP_CHUNK_CHAR_LIMIT) {
        chunks.push(part.slice(i, i + MAP_CHUNK_CHAR_LIMIT));
      }
      continue;
    }
    if (cur && cur.length + part.length > MAP_CHUNK_CHAR_LIMIT) {
      chunks.push(cur);
      cur = part;
    } else {
      cur += part;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length > 0 ? chunks : [diff];
}

/**
 * REDUCE step: one manager call that merges the per-chunk partial reviews into a
 * single structured findings block + exactly one FLEET-VERDICT line.
 */
async function reduceFindings(
  ship: ShipConfig,
  partials: string[],
  env: ExecutorEnv,
): Promise<string> {
  const managerSystem =
    `You are the fleet REDUCE manager for ship pd-${ship.name}. You receive ` +
    `several partial reviews of different chunks of one PR diff. Merge them into ` +
    `a SINGLE review of the whole PR. Deduplicate findings.\n\n` +
    buildOutputContract() +
    (ship.blocking
      ? '\n\nThis ship is BLOCKING: emit FLEET-VERDICT: BLOCK if any partial raised a HIGH finding or objected; otherwise FLEET-VERDICT: PASS.'
      : '\n\nThis ship is ADVISORY: still emit exactly one FLEET-VERDICT line.');

  const userMessage = partials
    .map((p, i) => `## Partial review ${i + 1} of ${partials.length}\n\n${p || '(empty)'}`)
    .join('\n\n');

  const res = (await env.AI.run(ship.cfModel as Parameters<typeof env.AI.run>[0], {
    messages: [
      { role: 'system', content: managerSystem },
      { role: 'user', content: userMessage },
    ],
  })) as { response?: string };

  return (res.response ?? '').trim();
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

/**
 * The machine-readable ship output contract: a fenced `json` array of findings
 * BEFORE exactly one FLEET-VERDICT line. Shared by the per-chunk MAP prompt and
 * the REDUCE manager prompt so both sides speak the same shape.
 */
function buildOutputContract(): string {
  return (
    '## Output Format\n\n' +
    'Render your findings as a JSON array inside triple-backtick fences:\n\n' +
    '```json\n' +
    '[\n' +
    '  { "path": "<file>", "line": <number>, "severity": "HIGH|MEDIUM|LOW", "body": "<description>" }\n' +
    ']\n' +
    '```\n\n' +
    '`line` is the 1-indexed line number in the file. If you have no findings, ' +
    'emit an empty array `[]` (or omit the block). Then end with EXACTLY one ' +
    'verdict line:\n' +
    'FLEET-VERDICT: PASS   (no objection to merge)\n' +
    'FLEET-VERDICT: BLOCK  (this change must not merge)'
  );
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
    'You are running as a Cloudflare Worker with no filesystem or shell access. ' +
      'You may be shown ONE CHUNK of a larger PR diff at a time — review only the ' +
      'chunk in front of you; a manager will merge the chunks. Analyze the diff ' +
      'and report findings only. If you find nothing worth noting, say so briefly.\n\n' +
      buildOutputContract(),
  );

  return parts.join('\n\n');
}

function buildUserMessage(
  prCtx: PRContext,
  diffChunk: string,
  chunkIndex: number,
  chunkCount: number,
): string {
  const fileList = prCtx.files
    .map(f => `- ${f.filename} (+${f.additions}/-${f.deletions})`)
    .join('\n');

  const chunkNote =
    chunkCount > 1 ? ` (chunk ${chunkIndex + 1} of ${chunkCount})` : '';

  return `# PR #${prCtx.prNumber}: ${prCtx.title}

## Changed files
${fileList || '(none)'}

## PR description
${prCtx.body || '(none)'}

## Diff${chunkNote}
\`\`\`diff
${diffChunk}
\`\`\``;
}

function is401(err: unknown): boolean {
  return /\b401\b/.test(String(err));
}
