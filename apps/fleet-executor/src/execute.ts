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
  fetchOpenPullRequests,
  listRecentBranches,
  renderFleetContext,
  postShipComment,
  createReview,
  createCheckRun,
  completeCheckRun,
  findFleetCheckRun,
  createIssue,
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
import {
  parseProposals,
  renderProposalComment,
  ideationOutputContract,
} from './proposals.js';
import { extractAiText, describeResponseShape } from './ai-response.js';
import { renderFindingsComment } from './findings-render.js';
import {
  captureProposals,
  ensureIdeasTable,
  EMBED_MODEL,
  type IdeaCtx,
} from './ideas-store.js';
import type { Proposal } from './proposals.js';
import { decideShipGate, isDocsOnly } from './gates.js';

// ---------------------------------------------------------------------------

/** Per-chunk diff budget for the MAP fan-out (chars). */
const MAP_CHUNK_CHAR_LIMIT = 12_000;
const CHECK_NAME = 'Port Daddy Fleet';

/**
 * Output-token cap for every ship AI call (MAP + REDUCE). Without an explicit
 * cap the model hits a small provider default and its findings JSON is truncated
 * mid-string — the 2026-07-07 mobile screenshots showed every reviewer comment
 * ending in an unterminated `"`. A findings/proposals array is small; this is
 * generous headroom while still bounding cost per call.
 */
const MAX_OUTPUT_TOKENS = 2048;

/**
 * Workers AI call options: a stable per-ship `x-session-affinity` key so the
 * ship's large, identical system-prompt prefix (its contract + output format,
 * repeated across every MAP chunk of a PR and across PRs) routes to the same
 * model instance and hits the prefix cache — cached input tokens bill lower.
 * Keyed per ship (not per run) to maximize hits on the shared prefix.
 * (Cloudflare Workers AI prompt caching, `extraHeaders` binding option.)
 */
function aiOptions(shipName: string): { extraHeaders: Record<string, string> } {
  return { extraHeaders: { 'x-session-affinity': `pd-fleet-${shipName}` } };
}

/**
 * Kill-switch flag key in the relay's CONTROL_KV namespace (the relay writes it
 * via POST /v1/fleet/pause; the executor reads it via env.CONTROL_KV). Value is
 * either JSON `{ paused: boolean, pausedAt: number }` or the literal
 * `"true"`/`"false"`. When paused, a job is acked WITHOUT any AI spend or posts.
 */
const PAUSE_KEY = 'fleet:paused';
const DELIVERY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Epoch seconds — the timestamp unit used by fleet_runs / fleet_run_steps. */
function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function validDeliveryId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.trim() !== raw) return null;
  if (!DELIVERY_ID_RE.test(raw)) return null;
  return raw;
}

/**
 * Read the kill-switch flag. Tolerates both the JSON object form and the bare
 * `"true"`/`"false"` string. Best-effort: a KV read failure means "not paused"
 * — the fail-safe here is to keep running the gate, never to silently skip it.
 */
async function isFleetPaused(env: ExecutorEnv): Promise<boolean> {
  // Read the kill switch from the relay's CONTROL-PLANE KV — the SAME namespace
  // the relay's POST /v1/fleet/pause writes to. (Previously read FLEET_TOKENS, a
  // DIFFERENT namespace, so a pause toggle never reached the executor.) Absent
  // binding ⇒ NOT paused (fail-safe: the gate keeps running).
  const kv = env.CONTROL_KV;
  if (!kv) return false;
  try {
    const raw = await kv.get(PAUSE_KEY);
    if (!raw) return false;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    try {
      const parsed = JSON.parse(raw) as { paused?: boolean };
      return parsed.paused === true;
    } catch {
      // Non-JSON, non-boolean payload — treat anything truthy-but-unknown as
      // NOT paused so a corrupt flag can never silently disable the gate.
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Append-only transcript recorder. Each {@link step} writes one fleet_run_steps
 * row with a monotonically increasing seq. Every write is BEST-EFFORT: a missing
 * DB binding (unit tests) or a D1 failure is swallowed and can NEVER fail the
 * run, change the conclusion, or alter the merge gate.
 *
 * Uses INSERT OR REPLACE keyed on (run_id, seq) so a retried delivery (same
 * deterministic runId) overwrites its transcript cleanly instead of erroring on
 * the PK — preserving the pipeline's idempotency invariant.
 */
class Transcript {
  private seq = 0;

  constructor(
    private readonly db: D1Database | undefined,
    readonly runId: string,
  ) {}

  async step(kind: string, ship: string | null, title: string, detail: unknown): Promise<void> {
    const seq = this.seq++;
    if (!this.db) return;
    try {
      await this.db
        .prepare(
          `INSERT OR REPLACE INTO fleet_run_steps (run_id, seq, kind, ship, title, detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(this.runId, seq, kind, ship, title, detail == null ? null : JSON.stringify(detail), nowSec())
        .run();
    } catch (err) {
      console.error(
        `[fleet-executor] transcript step failed run=${this.runId} seq=${seq}: ${String(err)}`,
      );
    }
  }
}

/**
 * Write the fleet_runs audit header BEFORE any ship runs (conclusion 'pending').
 * Best-effort + idempotent (INSERT OR REPLACE on the deterministic id). A write
 * failure here NEVER aborts the run.
 */
async function recordRunStart(
  env: ExecutorEnv,
  runId: string,
  job: FleetRunJob,
  prCtx: PRContext,
  prNumber: number,
  ships: ShipConfig[],
): Promise<void> {
  if (!env.DB) return;
  const prUrl = `https://github.com/${job.repoFullName}/pull/${prNumber}`;
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO fleet_runs
         (id, delivery_id, repo_full_name, pr_number, pr_url, head_sha, conclusion, ships_csv, ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`,
    )
      .bind(
        runId,
        job.deliveryId,
        job.repoFullName,
        prNumber,
        prUrl,
        prCtx.headSha,
        ships.map(s => s.name).join(','),
        nowSec(),
      )
      .run();
  } catch (err) {
    console.error(`[fleet-executor] fleet_runs insert failed run=${runId}: ${String(err)}`);
  }
}

/**
 * Stamp the final conclusion + wall-clock elapsed onto the fleet_runs row.
 * Best-effort: a write failure NEVER changes the gate (the check run is already
 * the authoritative surface on GitHub).
 */
async function recordRunEnd(
  env: ExecutorEnv,
  runId: string,
  conclusion: string,
  startMs: number,
): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`UPDATE fleet_runs SET conclusion = ?, ms = ? WHERE id = ?`)
      .bind(conclusion, Date.now() - startMs, runId)
      .run();
  } catch (err) {
    console.error(`[fleet-executor] fleet_runs update failed run=${runId}: ${String(err)}`);
  }
}

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
  const deliveryId = validDeliveryId(job.deliveryId);
  if (!deliveryId) {
    console.warn(`[fleet-executor] invalid deliveryId; skipping malformed fleet job`);
    return;
  }

  const [owner, repo] = job.repoFullName.split('/');
  if (!owner || !repo) return;
  const prNumber = job.prNumber;
  const prPayload = (job.payloadMinimal.pull_request as Record<string, unknown>) ?? {};

  // --- KILL SWITCH ---------------------------------------------------------
  // Checked at the very START, before any token mint, GitHub call, or AI spend.
  // When paused we return normally so the queue handler acks the message: no
  // work performed, nothing posted, no cost. (Returning early == acked.) Note:
  // this leaves NO check run, so a paused fleet does not gate PRs at all —
  // pausing is an explicit operator decision to stop reviewing entirely.
  if (await isFleetPaused(env)) {
    console.log(`[fleet-executor] delivery=${deliveryId} paused; skipping (no AI spend, no posts)`);
    return;
  }

  // Deterministic run id from the delivery id so a retried delivery rewrites its
  // own audit row + transcript (INSERT OR REPLACE) instead of duplicating.
  const runId = `run:${deliveryId}`;
  const startMs = Date.now();
  const transcript = new Transcript(env.DB, runId);

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

  // --- Transcript: record the run header (best-effort) ---------------------
  // Written AFTER the gating check is established but BEFORE any ship runs, so
  // the audit trail records every attempt that got far enough to gate. A
  // write failure is swallowed and never changes the run or the gate.
  await recordRunStart(env, runId, job, prCtx, prNumber, cloudShips);

  // --- Run ships sequentially (Workers AI rate limits) ---------------------
  // Each ship is a map-reduce over the diff: MAP one call per diff chunk, then
  // REDUCE via a manager call that merges the structured findings and computes
  // the FLEET-VERDICT.
  // Deterministic ship gating (cost): a ship whose surface the diff doesn't touch
  // is skipped BEFORE any AI spend; reviewer ships skip docs-only diffs while
  // ideation ships run on them. Computed once per run from the PR's changed files.
  const changedPaths = prCtx.files.map(f => f.filename).filter(Boolean);
  const docsOnly = isDocsOnly(changedPaths);

  const results: ShipResult[] = [];
  for (const ship of cloudShips) {
    // Re-check the operator kill switch before each ship. The start-of-job
    // check prevents any setup work while paused; this second gate closes the
    // TOCTOU gap where the operator pauses after the GitHub check is created
    // but before additional AI spend or review posts. Complete neutral rather
    // than leaving the already-created check run in progress forever.
    if (await isFleetPaused(env)) {
      const summary = `Fleet paused before pd-${ship.name}; stopped before additional AI spend or review posts.`;
      await transcript.step('check-completed', null, 'Check concluded: neutral (paused)', {
        checkRunId,
        conclusion: 'neutral',
        pausedBeforeShip: ship.name,
      });
      await completeCheckRun(owner, repo, checkRunId, 'neutral', summary, token);
      await recordRunEnd(env, runId, 'neutral', startMs);
      return;
    }

    // Surface gate: skip a ship with nothing to say on this diff, spending no AI.
    // A gated-out ship resolves PASS (advisory-clean) and posts nothing — a
    // gated-out BLOCKING ship (red-team off its security surface) correctly does
    // not block, matching its own "exit clean" contract.
    const gate = decideShipGate(ship, changedPaths, docsOnly);
    if (!gate.run) {
      await transcript.step('ship-skipped', ship.name, `pd-${ship.name}: skipped — ${gate.reason}`, {
        reason: gate.reason,
        changedPathCount: changedPaths.length,
      });
      results.push({ ship: ship.name, blocking: ship.blocking, verdict: 'PASS', errored: false, findings: [] });
      continue;
    }

    results.push(await runShip(ship, prCtx, token, env, branch, transcript));
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

  // --- Transcript: check completion + final run header (best-effort) --------
  await transcript.step('check-completed', null, `Check concluded: ${conclusion}`, {
    checkRunId,
    conclusion,
  });
  await recordRunEnd(env, runId, conclusion, startMs);
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
  transcript: Transcript,
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

    // Lookout's tools: cross-PR / cross-branch awareness. Fetched once per run and
    // injected into every MAP chunk so it can spot contradictions and duplication
    // against OTHER open PRs and feature branches. Best-effort (helpers return []
    // on failure) — Lookout degrades to single-PR reasoning, never crashes.
    let fleetContext = '';
    if (ship.name === 'lookout') {
      const [openPRs, branches] = await Promise.all([
        fetchOpenPullRequests(prCtx.owner, prCtx.repo, token, prCtx.prNumber),
        listRecentBranches(prCtx.owner, prCtx.repo, token),
      ]);
      fleetContext = renderFleetContext(openPRs, branches);
    }

    // --- MAP: one ship call per diff chunk ---------------------------------
    const partials: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const userMessage = buildUserMessage(prCtx, chunks[i], i, chunks.length, fleetContext);
      const request = {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        ...(ship.temperature === null ? {} : { temperature: ship.temperature }),
      };
      const res = await env.AI.run(
        ship.cfModel as Parameters<typeof env.AI.run>[0],
        request,
        aiOptions(ship.name),
      );
      const { text, shape } = extractAiText(res);
      partials.push(text);

      // Diagnose the silent-blank case: an empty result makes a ship post nothing
      // and resolve PASS. Log the model + response shape so an empty-returning
      // model (gpt-oss Responses API mismatch, an outage, an error object) is
      // legible instead of a mystery green check. (2026-07-07 blackout postmortem.)
      if (!text) {
        console.warn(
          `[fleet-executor] pd-${ship.name} MAP chunk ${i + 1}/${chunks.length} EMPTY on ` +
            `${ship.cfModel}: ${describeResponseShape(res)}`,
        );
      }

      // Transcript: one row per MAP chunk (best-effort). `shape` records which
      // envelope produced the text; `responseShape` is only stamped on an empty
      // result so a future blackout is diagnosable from D1 alone.
      await transcript.step('map-chunk', ship.name, `MAP chunk ${i + 1}/${chunks.length}`, {
        chunkIndex: i,
        chunkCount: chunks.length,
        outputLength: text.length,
        shape,
        ...(text ? {} : { responseShape: describeResponseShape(res) }),
      });
    }

    // --- REDUCE: manager merges the partials (only when fan-out > 1) --------
    const output =
      chunks.length === 1 ? partials[0] ?? '' : await reduceFindings(ship, partials, env);

    // Transcript: the REDUCE step exists only on a multi-chunk fan-out.
    if (chunks.length > 1) {
      await transcript.step('reduce', ship.name, `REDUCE pd-${ship.name}`, {
        chunkCount: chunks.length,
        outputLength: output.length,
      });
    }

    // --- IDEATION ships: proposals, not findings ---------------------------
    // spark / spider / lookout / snipe propose forward work. Parse the validated
    // Proposal schema and render it into REAL actionable Port Daddy syntax. These
    // ships are always advisory: they NEVER gate a merge and NEVER contribute
    // inline review comments, so a malformed block just falls back to the raw
    // model output — it can't destabilize the check.
    if (ship.ideation) {
      const proposals = parseProposals(output);
      const rendered =
        proposals && proposals.length > 0
          ? renderProposalComment(proposals, {
              owner: prCtx.owner,
              repo: prCtx.repo,
              prNumber: prCtx.prNumber,
              shipName: ship.name,
            })
          : '';
      // When proposals parse to a real set → post the actionable render. When the
      // ship proposed nothing (empty array) → silence. When the block was
      // malformed (null) → post the raw output so the model's prose isn't lost.
      const body = rendered || (proposals === null ? output : '');

      await transcript.step('ship-verdict', ship.name, `pd-${ship.name}: PASS (ideation)`, {
        proposals: proposals ?? 'malformed',
        posted: !!body.trim(),
      });

      await postShipComment(
        prCtx.owner,
        prCtx.repo,
        prCtx.prNumber,
        ship.name,
        ship.role,
        body,
        token,
      );

      // Durably capture the proposals (D1 + semantic dedup + auto-issue) so a
      // Spark/Spider idea doesn't evaporate when the PR scrolls away. Best-effort:
      // it NEVER throws or changes the advisory PASS.
      if (proposals && proposals.length > 0) {
        await captureIdeas(
          proposals,
          { owner: prCtx.owner, repo: prCtx.repo, prNumber: prCtx.prNumber, shipName: ship.name },
          env,
          token,
          transcript,
        );
      }

      return {
        ship: ship.name,
        blocking: false,
        verdict: 'PASS',
        errored: false,
        findings: [],
      };
    }

    // Parse the structured findings block. `null` => malformed JSON => the ship
    // is treated as errored (blocking → BLOCK, advisory → PASS, never silent).
    const findings = parseShipFindings(output);

    // Transcript: findings parse outcome. A malformed block is a 'ship-finding'
    // marker (the ship produced output we couldn't parse); a parsed block is a
    // 'ship-verdict' carrying the resolved verdict line.
    const verdictForTranscript: Verdict | null =
      findings === null ? null : resolveVerdict(output, ship.blocking);
    await transcript.step(
      findings === null ? 'ship-finding' : 'ship-verdict',
      ship.name,
      findings === null
        ? `pd-${ship.name}: MALFORMED`
        : `pd-${ship.name}: ${verdictForTranscript}`,
      findings === null ? { error: 'failed to parse findings' } : findings,
    );

    // Render the findings into clean, actionable markdown (edit-in-place =>
    // idempotent on retry). When a ship parsed a real findings set → post the
    // render. When it found nothing (empty array) → post nothing (silence: this
    // is why red-team stops spamming a bare `[]`). When the block was malformed
    // (null → errored above) we still surface the raw output so the model's prose
    // isn't lost. NEVER post the raw fenced JSON — it truncates on mobile and is
    // not actionable (2026-07-07 screenshots).
    const reviewerBody =
      findings === null
        ? output
        : renderFindingsComment(findings, {
            owner: prCtx.owner,
            repo: prCtx.repo,
            prNumber: prCtx.prNumber,
            shipName: ship.name,
          });

    await postShipComment(
      prCtx.owner,
      prCtx.repo,
      prCtx.prNumber,
      ship.name,
      ship.role,
      reviewerBody,
      token,
    );

    // Transcript: the per-ship issue comment was posted (or intentionally
    // skipped when a clean ship rendered to silence). Keep the message honest —
    // a silent ship must not log "Posted review".
    const posted = !!reviewerBody.trim();
    await transcript.step(
      'review-posted',
      ship.name,
      posted ? `Posted review for pd-${ship.name}` : `pd-${ship.name}: clean — nothing to post`,
      { posted },
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

    const verdict: Verdict = verdictForTranscript ?? resolveVerdict(output, ship.blocking);
    return { ship: ship.name, blocking: ship.blocking, verdict, errored: false, findings };
  } catch {
    // A blocking ship that errors fails the gate (fail-closed). Verdict is
    // forced to BLOCK for blocking ships, PASS for advisory ones; `errored`
    // is the authoritative signal the aggregator keys on.
    // Transcript: record the errored verdict so the run remains legible.
    await transcript.step(
      'ship-verdict',
      ship.name,
      `pd-${ship.name}: ${ship.blocking ? 'BLOCK' : 'PASS'} (errored)`,
      { errored: true },
    );
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
 * Embed a string to a vector via Workers AI (bge). Returns [] on any unexpected
 * envelope so the caller (best-effort capture) degrades to "no dedup" rather
 * than throwing.
 */
async function embedText(ai: Ai, text: string): Promise<number[]> {
  const res = await ai.run(EMBED_MODEL as Parameters<typeof ai.run>[0], { text: [text] });
  const data = (res as { data?: unknown }).data;
  if (Array.isArray(data) && Array.isArray(data[0])) return data[0] as number[];
  return [];
}

/**
 * Durably capture an ideation ship's proposals into the relay D1 idea store,
 * semantic-deduped, opening a `fleet-idea` GitHub issue for each novel one.
 * Best-effort: a missing DB binding (unit tests / unconfigured) skips capture
 * entirely, and any failure is swallowed — it can NEVER change the advisory PASS.
 */
async function captureIdeas(
  proposals: Proposal[],
  ctx: IdeaCtx,
  env: ExecutorEnv,
  token: string,
  transcript: Transcript,
): Promise<void> {
  if (!env.DB) return; // no store bound → comment-only fallback (still posted above)
  try {
    await ensureIdeasTable(env.DB);
    const results = await captureProposals({
      db: env.DB,
      proposals,
      ctx,
      embed: text => embedText(env.AI, text),
      openIssue: (title, body, labels) =>
        createIssue(ctx.owner, ctx.repo, title, body, labels, token),
      now: nowSec(),
    });
    const created = results.filter(r => r.outcome === 'tracked-new').length;
    const dupes = results.filter(r => r.outcome === 'duplicate' || r.outcome === 'already-tracked').length;
    await transcript.step(
      'ideas-captured',
      ctx.shipName,
      `pd-${ctx.shipName}: ${created} new idea(s), ${dupes} already tracked`,
      { results },
    );
  } catch (err) {
    console.error(`[fleet-executor] captureIdeas failed pd-${ctx.shipName}: ${String(err)}`);
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
  const mergeVerb = ship.ideation ? 'proposals' : 'findings';
  const managerSystem =
    `You are the fleet REDUCE manager for ship pd-${ship.name}. You receive ` +
    `several partial reviews of different chunks of one PR diff. Merge them into ` +
    `a SINGLE review of the whole PR. Deduplicate ${mergeVerb}.\n\n` +
    (ship.ideation ? ideationOutputContract() : buildOutputContract()) +
    (ship.blocking
      ? '\n\nThis ship is BLOCKING: emit FLEET-VERDICT: BLOCK if any partial raised a HIGH finding or objected; otherwise FLEET-VERDICT: PASS.'
      : '\n\nThis ship is ADVISORY: still emit exactly one FLEET-VERDICT line.');

  const userMessage = partials
    .map((p, i) => `## Partial review ${i + 1} of ${partials.length}\n\n${p || '(empty)'}`)
    .join('\n\n');

  const request = {
    messages: [
      { role: 'system', content: managerSystem },
      { role: 'user', content: userMessage },
    ],
    max_tokens: MAX_OUTPUT_TOKENS,
    ...(ship.temperature === null ? {} : { temperature: ship.temperature }),
  };
  const res = await env.AI.run(
    ship.cfModel as Parameters<typeof env.AI.run>[0],
    request,
    aiOptions(ship.name),
  );
  const { text } = extractAiText(res);
  if (!text) {
    console.warn(
      `[fleet-executor] pd-${ship.name} REDUCE EMPTY on ${ship.cfModel}: ${describeResponseShape(res)}`,
    );
  }
  return text;
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
      'and report ' +
      (ship.ideation ? 'proposals' : 'findings') +
      ' only. If you have nothing worth noting, say so briefly.\n\n' +
      (ship.ideation ? ideationOutputContract() : buildOutputContract()),
  );

  return parts.join('\n\n');
}

function buildUserMessage(
  prCtx: PRContext,
  diffChunk: string,
  chunkIndex: number,
  chunkCount: number,
  fleetContext = '',
): string {
  const fileList = prCtx.files
    .map(f => `- ${f.filename} (+${f.additions}/-${f.deletions})`)
    .join('\n');

  const chunkNote =
    chunkCount > 1 ? ` (chunk ${chunkIndex + 1} of ${chunkCount})` : '';

  const contextBlock = fleetContext ? `\n\n${fleetContext}` : '';

  return `# PR #${prCtx.prNumber}: ${prCtx.title}

## Changed files
${fileList || '(none)'}

## PR description
${prCtx.body || '(none)'}${contextBlock}

## Diff${chunkNote}
\`\`\`diff
${diffChunk}
\`\`\``;
}

function is401(err: unknown): boolean {
  return /\b401\b/.test(String(err));
}
