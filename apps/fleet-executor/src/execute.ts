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
import { TRANSCRIPT_EMERGENCY_EVENT } from '../../../lib/transcript-emergency-constants.js';
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
  findFleetCheckRunState,
  createIssue,
  resolveFleetAppLogin,
  type PRContext,
  type ReviewComment,
  PR_FILES_PAGE_SIZE,
} from './github.js';
import { parseFleetShips, parseFleetSquidEvents, parseFleetXo, defaultPRShips, type ShipConfig } from './fleet.js';
import { classifyPrAuthorship } from './fleet-identity.js';
import { classifyPrLifecycle } from './pr-lifecycle.js';
import { fleetPrBodyTrailers } from './fleet-pr-body.js';
import {
  resolveVerdict,
  aggregateConclusion,
  parseShipFindings,
  type ShipResult,
  type Verdict,
  reviewEventFor,
} from './verdict.js';
import {
  parseProposals,
  renderProposalComment,
  ideationOutputContract,
  validateStackProposalFiles,
  slugify,
} from './proposals.js';
import {
  createOrUpdateBranch,
  openStackedPr,
  GitHubApiError,
} from './stacked-pr.js';
import { runTestsInSandbox } from './sandbox-runner.js';
import { createSkillGraftCache, type SkillGraftCache } from './skill-graft.js';
import { emitSquidEvent } from './squid-events.js';
import { extractAiText, describeResponseShape } from './ai-response.js';
import {
  classifyShipOutput,
  describeNoUsableOutput,
  type NoUsableOutputReason,
} from './usable-output.js';
import { renderFindingsComment } from './findings-render.js';
import {
  captureProposals,
  ensureIdeasTable,
  listRecentIdeas,
  EMBED_MODEL,
  type IdeaCtx,
} from './ideas-store.js';
import {
  resolveXoModel,
  runXoEditorPass,
  collectAdvisoryFindings,
  xoOrdersSection,
  XO_RECENT_IDEAS_LIMIT,
} from './xo.js';
import type { Proposal } from './proposals.js';
import { decideShipGate, isDocsOnly, isReviewableForBugs } from './gates.js';
import { runPurser } from './purser.js';
import { isDeadLetteredSummary } from './dead-letter-marker.js';
import { emitCloudTelemetry, extractWorkersAiUsage } from './telemetry.js';
import { runDetailsUrl } from './run-page.js';
import {
  costUsdForModel,
  isPricedModel,
  MODEL_CONTEXT_TOKENS,
  hasKnownContextWindow,
} from './spend.js';

const TRANSCRIPT_FAILURE_TELEMETRY_TIMEOUT_MS = 250;

// ---------------------------------------------------------------------------

/**
 * The model that scans one chunk.
 *
 * Falls back to `cfModel` so a ship with no tiering behaves exactly as before --
 * untiered, but never silently broken.
 *
 * @param ship the ship config (only the two model fields are read)
 * @returns the model id every MAP chunk call runs on
 */
export function mapModelFor(ship: { cfModel: string; cfMapModel?: string }): string {
  return ship.cfMapModel ?? ship.cfModel;
}

/**
 * The model that synthesises across chunks. Always the ship's capable model.
 *
 * @param ship the ship config
 * @returns the model id the single REDUCE call runs on
 */
export function reduceModelFor(ship: { cfModel: string }): string {
  return ship.cfModel;
}

/**
 * Rough chars-per-token for unified diffs. Diffs are punctuation- and
 * identifier-dense, so they tokenize WORSE than prose (~4 chars/token); 3 is
 * the conservative direction -- it under-estimates how much text fits, which
 * costs an occasional extra chunk rather than an over-window request.
 */
const CHARS_PER_TOKEN = 3;

/**
 * Fraction of the MAP model's context window the diff chunk may occupy.
 *
 * The rest is real: the ship's system prompt (contract + graft + output format)
 * is several KB, the PR title/body/file-list block rides along, and
 * {@link MAX_OUTPUT_TOKENS} of completion has to fit too. Half is generous
 * headroom for all of it.
 */
const CONTEXT_BUDGET_FRACTION = 0.5;

/**
 * Floor for the chunk budget when the MAP model's window is unknown.
 *
 * Deliberately the OLD hard-coded value, so an unrecognised model degrades to
 * exactly the behaviour that shipped for months rather than to something
 * untested.
 */
const FALLBACK_MAP_CHUNK_CHARS = 12_000;

/**
 * Per-chunk diff budget for the MAP fan-out, DERIVED from the model that will
 * actually read the chunk.
 *
 * Why this is not a constant any more: it was `12_000` with no recorded
 * reasoning anywhere in the source -- roughly 3,000 tokens, against a MAP model
 * with a 32,768-token window. Every diff over 12KB was split for a limit no
 * model imposed, and 22% of recent commits to this repo cross it. Each
 * resulting reviewer then held a partial view it had no way to know was
 * partial, which is where fabricated "X is missing" findings come from. The
 * prompt-level scope contract mitigates that; this removes most of the cause.
 *
 * Note the coupling to tiering, because it is a real cost: MAP now runs on the
 * cheap model, whose window (32,768) is a quarter of the capable one's
 * (128,000). Tiering therefore makes chunks four times smaller than an untiered
 * reviewer could take. That trade is worth making at these rates, but it is a
 * trade, not a free win.
 *
 * @param mapModel the model id that will receive each chunk
 * @returns the per-chunk character budget
 */
export function mapChunkCharLimit(mapModel: string): number {
  if (!hasKnownContextWindow(mapModel)) return FALLBACK_MAP_CHUNK_CHARS;
  const chars = MODEL_CONTEXT_TOKENS[mapModel] * CHARS_PER_TOKEN * CONTEXT_BUDGET_FRACTION;
  return Math.max(FALLBACK_MAP_CHUNK_CHARS, Math.floor(chars));
}


/** Bound Workers AI fan-out so large diffs finish without a rate-limit stampede. */
const MAP_CONCURRENCY = 8;
/** The umbrella check-run name. Exported so the DLQ handler targets the same run. */
export const CHECK_NAME = 'Port Daddy Fleet';

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
 *
 * When `env.AI_GATEWAY_ID` is set, the call is ALSO routed through Cloudflare AI
 * Gateway (`{ gateway: { id } }`) for token/cost/latency logging (ADR-0116/0117).
 * Unset ⇒ the gateway key is omitted ⇒ exactly today's direct Workers AI call.
 */
function aiOptions(
  env: ExecutorEnv,
  shipName: string,
): { extraHeaders: Record<string, string>; gateway?: { id: string } } {
  const opts: { extraHeaders: Record<string, string>; gateway?: { id: string } } = {
    extraHeaders: { 'x-session-affinity': `pd-fleet-${shipName}` },
  };
  if (env.AI_GATEWAY_ID) opts.gateway = { id: env.AI_GATEWAY_ID };
  return opts;
}

/**
 * Per-ship cost + failure metrics, accumulated across a ship's MAP + REDUCE
 * calls, then emitted as ONE cloud-telemetry event. Restores FleetBar cost
 * tracking (input/output/cached tokens → daemon cost derivation) AND records
 * failures (an errored or blacked-out ship → an operator-visible error event).
 */
interface ShipMetrics {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** ai.run calls made (0 = the ship was gated out or never reached the model). */
  calls: number;
  /** True if every ai.run returned empty text — the silent-blackout signal. */
  allEmpty: boolean;
  /**
   * How many ai.run results actually carried a readable `usage` block. Zero
   * with `calls > 0` means the binding/model reported NO usage at all — the
   * run page must then say "not reported", never render a 0 that reads as
   * "this run was free". (2026-08-04: a 9-call run showed 0/0 tokens.)
   */
  usageReports: number;
  /**
   * USD accumulated PER CALL, each priced at the model THAT call used.
   *
   * Not derivable from the totals any more. Once MAP and REDUCE can run on
   * different models (see {@link mapModelFor}), applying one rate to a ship's
   * summed tokens prices every cheap MAP token at the capable model's rate and
   * reports a cost the operator was never charged -- overstating it by roughly
   * the tiering saving, which is to say by exactly the amount the tiering was
   * introduced to produce. Cost has to be summed where the model is known.
   */
  costUsd: number;
  /**
   * Distinct models this ship actually called, in first-call order. The run
   * page shows this instead of the ship's configured `cfModel`, because with
   * tiering those are no longer the same claim: `cfModel` is what the ship
   * reduces with, and a reader deserves to see that 92 of 93 calls went
   * somewhere cheaper.
   */
  modelsUsed: string[];
  /**
   * Calls made against a model with no entry in WORKERS_AI_RATES. Their tokens
   * count but their cost is unknowable, so {@link costUsd} is a FLOOR whenever
   * this is non-zero -- and the transcript must say so rather than presenting a
   * partial sum as a total.
   */
  unpricedCalls: number;
}

function newShipMetrics(): ShipMetrics {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    calls: 0,
    allEmpty: true,
    usageReports: 0,
    costUsd: 0,
    modelsUsed: [],
    unpricedCalls: 0,
  };
}

/**
 * Fold one ai.run result's usage + emptiness into a ship's running metrics.
 *
 * `model` is the model THIS call ran on, not the ship's configured one. It is a
 * required parameter rather than an optional convenience precisely so that a
 * future call site cannot forget it and silently mis-price itself.
 */
function accumulateUsage(
  metrics: ShipMetrics,
  model: string,
  res: unknown,
  text: string,
): void {
  const u = extractWorkersAiUsage(res);
  metrics.inputTokens += u.inputTokens ?? 0;
  metrics.outputTokens += u.outputTokens ?? 0;
  metrics.cachedInputTokens += u.cachedInputTokens ?? 0;
  metrics.calls += 1;
  metrics.costUsd = Math.round(
    (metrics.costUsd + costUsdForModel(model, u.inputTokens ?? 0, u.outputTokens ?? 0)) * 1e6,
  ) / 1e6;
  if (!isPricedModel(model)) metrics.unpricedCalls += 1;
  if (!metrics.modelsUsed.includes(model)) metrics.modelsUsed.push(model);
  if (u.inputTokens != null || u.outputTokens != null) metrics.usageReports += 1;
  if (text) metrics.allEmpty = false;
}

/**
 * Flags that stop a PARTIAL spend sum from being read as a complete one.
 *
 * Rationale: `usageReported` only asserts that SOME call carried a usage block.
 * A run where 3 of 93 calls reported produces token and cost figures covering
 * three calls, rendered beside a `calls: 93` — a plausible number that is not
 * true, which is the exact failure this row exists to avoid. Two independent
 * ways to be incomplete, so two separate counts:
 *
 *   - `unpricedCalls` — the call ran on a model absent from WORKERS_AI_RATES,
 *     so its real tokens priced to 0. COST is understated; tokens are correct.
 *   - `unreportedCalls` — the call returned no usage block at all, so neither
 *     its tokens nor its cost entered any sum. BOTH are understated.
 *
 * @param metrics the ship's accumulated metrics
 * @returns `{}` when every call was both priced and reported (the figures are
 *   totals); otherwise `costIsFloor: true` plus whichever counts apply.
 */
export function spendHonesty(metrics: {
  calls: number;
  usageReports: number;
  unpricedCalls: number;
}): Record<string, unknown> {
  const unreportedCalls = Math.max(0, metrics.calls - metrics.usageReports);
  if (metrics.unpricedCalls === 0 && unreportedCalls === 0) return {};
  return {
    costIsFloor: true,
    ...(metrics.unpricedCalls > 0 ? { unpricedCalls: metrics.unpricedCalls } : {}),
    ...(unreportedCalls > 0 ? { unreportedCalls } : {}),
  };
}

/**
 * Emit one best-effort cloud-telemetry event for a ship's run. Never throws.
 * `status`/`conclusion` drive the daemon's errorEvents aggregation; token counts
 * drive cost. A ship that ran but produced only empty output (the 2026-07-07
 * blackout) is flagged `status: 'error'` so a silent green check still surfaces.
 */
async function emitShipTelemetry(
  env: ExecutorEnv,
  job: FleetRunJob,
  prCtx: PRContext,
  ship: ShipConfig,
  result: ShipResult,
  metrics: ShipMetrics,
  checkRunId: number,
  shipStartMs: number,
): Promise<void> {
  try {
    const blackout = metrics.calls > 0 && metrics.allEmpty;
    // A ship that produced NO USABLE OUTPUT is an operator-visible failure of
    // the same kind as a blackout: it burned model calls and reviewed nothing.
    // Surfacing it as `status: 'ok'` would recreate the green theater one layer
    // down, in the daemon's errorEvents aggregation.
    const errored = result.errored || result.noUsableOutput === true || blackout;
    await emitCloudTelemetry(
      {
        deliveryId: job.deliveryId,
        event: 'ship-run',
        action: job.action,
        owner: prCtx.owner,
        repo: prCtx.repo,
        prNumber: prCtx.prNumber,
        sha: prCtx.headSha,
        ship: ship.name,
        role: ship.role,
        status: errored ? 'error' : 'ok',
        conclusion: errored ? 'failure' : result.verdict === 'BLOCK' ? 'failure' : 'success',
        backend: 'cloudflare',
        model: ship.cfModel,
        durationMs: Date.now() - shipStartMs,
        inputTokens: metrics.inputTokens,
        cachedInputTokens: metrics.cachedInputTokens,
        outputTokens: metrics.outputTokens,
        checkRunId: checkRunId || null,
        ...(blackout ? { metadata: { blackout: true } } : {}),
      },
      env,
    );
  } catch (err) {
    console.error(`[fleet-executor] emitShipTelemetry failed pd-${ship.name}: ${String(err)}`);
  }
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
    private readonly onWriteFailure?: (failure: TranscriptWriteFailure) => Promise<void>,
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
      const error = String(err);
      console.error(
        `[fleet-executor] transcript step failed run=${this.runId} seq=${seq}: ${error}`,
      );
      this.reportWriteFailure({ runId: this.runId, seq, kind, ship, title, error });
    }
  }

  private reportWriteFailure(failure: TranscriptWriteFailure): void {
    if (!this.onWriteFailure) return;
    let telemetry: Promise<void>;
    try {
      telemetry = this.onWriteFailure(failure);
    } catch (telemetryErr) {
      console.error(`[fleet-executor] transcript failure telemetry failed run=${this.runId}: ${String(telemetryErr)}`);
      return;
    }
    void withTranscriptFailureTelemetryTimeout(telemetry, failure.runId).catch((telemetryErr) => {
      console.error(`[fleet-executor] transcript failure telemetry failed run=${failure.runId}: ${String(telemetryErr)}`);
    });
  }
}

interface TranscriptWriteFailure {
  runId: string;
  seq: number;
  kind: string;
  ship: string | null;
  title: string;
  error: string;
}

function withTranscriptFailureTelemetryTimeout(
  telemetry: Promise<void>,
  runId: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<void>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`transcript failure telemetry timed out after ${TRANSCRIPT_FAILURE_TELEMETRY_TIMEOUT_MS}ms for ${runId}`));
    }, TRANSCRIPT_FAILURE_TELEMETRY_TIMEOUT_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  telemetry.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer),
  );
  return Promise.race([telemetry, timeout]);
}

async function emitTranscriptWriteFailureTelemetry(
  env: ExecutorEnv,
  job: FleetRunJob,
  failure: TranscriptWriteFailure,
): Promise<void> {
  const [owner, repo] = (job.repoFullName || '').split('/');
  const prPayload = (job.payloadMinimal.pull_request as Record<string, unknown>) ?? {};
  const head = prPayload.head && typeof prPayload.head === 'object'
    ? prPayload.head as Record<string, unknown>
    : {};
  await emitCloudTelemetry(
    {
      deliveryId: job.deliveryId,
      event: TRANSCRIPT_EMERGENCY_EVENT.WRITE_FAILED,
      action: job.action,
      owner: owner || null,
      repo: repo || null,
      prNumber: job.prNumber ?? null,
      sha: typeof head.sha === 'string' ? head.sha : null,
      ship: failure.ship,
      status: 'error',
      conclusion: 'failure',
      backend: 'cloudflare',
      model: null,
      metadata: {
        transcriptWriteFailure: true,
        table: 'fleet_run_steps',
        runId: failure.runId,
        seq: failure.seq,
        kind: failure.kind,
        title: failure.title,
        error: failure.error,
      },
    },
    env,
  );
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
 * Guarantee a `fleet_runs` row exists before a check run's completion is
 * published — an idempotent (INSERT OR IGNORE) backstop independent of
 * `recordRunStart`'s own best-effort write.
 *
 * `recordRunStart` deliberately swallows write failures ("NEVER aborts the
 * run" — correct: an audit-log hiccup must not block gating). But that means
 * a transient D1 error at exactly that moment leaves NO row behind, while the
 * check run on GitHub still completes normally with a real conclusion — its
 * `details_url` then points at a run id with no row, and the run page 404s
 * ("Run not found") even though nothing else went wrong. `dlq.ts`'s
 * completion path has the same gap: it never calls `recordRunStart` at all.
 * Calling this once, right after `recordRunStart`, closes both: if the
 * INSERT OR REPLACE above already succeeded this is a guaranteed no-op (same
 * primary key); if it silently failed, this creates a minimal-but-truthful
 * fallback row so the link a completed check publishes always resolves to
 * something real.
 */
export async function ensureRunRow(
  env: ExecutorEnv,
  runId: string,
  deliveryId: string,
  repoFullName: string | null,
  prNumber: number | null,
  headSha: string,
): Promise<void> {
  if (!env.DB) return;
  const repo = repoFullName ?? 'unknown/unknown';
  const prUrl = prNumber != null ? `https://github.com/${repo}/pull/${prNumber}` : '';
  try {
    // Columns: (id, delivery_id, repo_full_name, pr_number, pr_url, head_sha,
    // conclusion, ships_csv, ms, created_at) — a superset of recordRunStart's
    // INSERT: the same identity/context columns plus a placeholder 'pending'
    // conclusion and 0 ms (recordRunComplete stamps the real values later).
    // ships_csv is empty since this is only ever the no-ships-info fallback
    // (recordRunStart already succeeded with the real list, or this is the
    // DLQ path, which never has a ship list to begin with).
    await env.DB.prepare(
      `INSERT OR IGNORE INTO fleet_runs
         (id, delivery_id, repo_full_name, pr_number, pr_url, head_sha, conclusion, ships_csv, ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`,
    )
      .bind(runId, deliveryId, repo, prNumber ?? 0, prUrl, headSha, '', nowSec())
      .run();
  } catch (err) {
    console.error(`[fleet-executor] ensureRunRow failed run=${runId}: ${String(err)}`);
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

/**
 * Per-installation SPEND CIRCUIT-BREAKER (ADR-0116/0117). Returns true ONLY when
 * the `credit_ledger` table exists, this installation HAS ledger rows, and its
 * balance (SUM(delta_usd)) is <= 0 — i.e. billing is configured for them and
 * they are out of credit. FAIL-OPEN everywhere else:
 *   - DB binding absent               ⇒ false (allow)
 *   - `credit_ledger` table absent    ⇒ query throws ⇒ false (allow)
 *   - installation has NO ledger rows ⇒ false (allow: trial / billing not live)
 *   - any read error                  ⇒ false (allow)
 * Inert until the relay starts writing credit_ledger; then it is the
 * per-installation abuse gate once billing is live.
 */
async function creditsExhausted(env: ExecutorEnv, installationId: number): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(delta_usd), 0) AS bal
         FROM credit_ledger
        WHERE installation_id = ?`,
    )
      .bind(installationId)
      .first<{ n: number; bal: number }>();
    if (!row) return false;
    const n = Number(row.n) || 0;
    if (n <= 0) return false; // no ledger rows ⇒ billing not configured ⇒ allow
    return Number(row.bal) <= 0; // rows exist AND balance spent ⇒ skip
  } catch {
    // Table absent (billing not deployed) or any read error ⇒ fail-open.
    return false;
  }
}

/**
 * Record the ship's token spend into the RUN TRANSCRIPT, so the human-facing
 * run page can report it.
 *
 * Why this exists: the run page derives its "Input tokens / Output tokens"
 * stat tiles by summing `inputTokens` / `outputTokens` out of `fleet_run_steps`
 * detail blobs (`sumDetailField` in the relay's fleet-run-page.ts). The
 * executor recorded token counts in TELEMETRY and in `fleet_run_spend`, but
 * never in a transcript step — so the page summed nothing and rendered **0 / 0**
 * for a run that made nine model calls (2026-08-04). The Workers AI usage data
 * was there all along; the transcript was simply never told. This step closes
 * that gap with one row per ship.
 *
 * `usageReported` is carried explicitly: when a binding/model returns no
 * `usage` block at all, the page must render "not reported" rather than a zero
 * that looks like the run was free.
 */
async function recordShipTokensInTranscript(
  transcript: Transcript,
  ship: ShipConfig,
  metrics: ShipMetrics,
): Promise<void> {
  if (metrics.calls === 0) return; // gated-out ship: no spend to report
  const usageReported = metrics.usageReports > 0;
  await transcript.step(
    'ship-spend',
    ship.name,
    usageReported
      ? `pd-${ship.name}: ${metrics.inputTokens.toLocaleString('en-US')} in / ` +
        `${metrics.outputTokens.toLocaleString('en-US')} out tokens over ${metrics.calls} call(s)`
      : `pd-${ship.name}: token usage not reported by ${metrics.modelsUsed.join(' + ') || ship.cfModel} ` +
        `(${metrics.calls} call(s))`,
    {
      // `model` stays the ship's configured (REDUCE) model for backward
      // compatibility with existing run-page readers; `models` is the honest
      // list of what actually ran, which under tiering is not the same thing.
      model: ship.cfModel,
      models: metrics.modelsUsed,
      calls: metrics.calls,
      usageReported,
      usageReports: metrics.usageReports,
      // Only stamp the summable fields when usage was genuinely reported — a 0
      // here would be indistinguishable from "free" on the run page.
      ...(usageReported
        ? {
            inputTokens: metrics.inputTokens,
            outputTokens: metrics.outputTokens,
            cachedInputTokens: metrics.cachedInputTokens,
            // Summed per call at each call's own model rate -- see
            // ShipMetrics.costUsd. Deriving this from the totals would price
            // every MAP token at the REDUCE model's rate.
            costUsd: metrics.costUsd,
            ...spendHonesty(metrics),
          }
        : {}),
    },
  );
}

/**
 * Record ONE `fleet_run_spend` row for a completed ship (best-effort). The
 * per-ship input/output tokens come from the ship's {@link ShipMetrics}; cost is
 * derived from {@link costUsdForModel} at the ship's model rate. A failed insert
 * (missing table / D1 down) is swallowed and NEVER changes the run — the same
 * best-effort contract the transcript writes hold to.
 */
async function recordShipSpend(
  env: ExecutorEnv,
  runId: string,
  ship: ShipConfig,
  installationId: number | null,
  metrics: ShipMetrics,
): Promise<void> {
  if (!env.DB) return;
  // Per-call sum (see ShipMetrics.costUsd), NOT a single rate applied to the
  // ship's totals -- MAP and REDUCE may have run on different models.
  const cost = metrics.costUsd;
  try {
    await env.DB.prepare(
      `INSERT INTO fleet_run_spend
         (run_id, ship, installation_id, model, input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        runId,
        ship.name,
        installationId,
        ship.cfModel,
        metrics.inputTokens,
        metrics.outputTokens,
        cost,
        nowSec(),
      )
      .run();
  } catch (err) {
    console.error(
      `[fleet-executor] fleet_run_spend insert failed run=${runId} ship=${ship.name}: ${String(err)}`,
    );
  }
}

const REVIEWABLE_PR_ACTIONS = new Set(['opened', 'synchronize', 'reopened', 'ready_for_review']);

/** The fleet trigger used by reviewable pull_request deliveries. */
function triggerFor(job: FleetRunJob): string | null {
  if (job.eventType !== 'pull_request') return null;
  if (!job.action || !REVIEWABLE_PR_ACTIONS.has(job.action)) return null;
  return 'pull_request:opened';
}

/**
 * Run the fleet for a single delivery. Throws on a recoverable infrastructure
 * error so the queue consumer can retry; returns normally otherwise (including
 * for non-actionable events, which are simply skipped).
 */
/**
 * Report `Port Daddy Fleet` on a merge-queue branch.
 *
 * WHY A PASS-THROUGH AND NOT A REVIEW. The queue branch is `main` + the queued
 * PRs, and every PR in it was already gated by the full fleet at
 * `pull_request` time. Re-running every ship on each queue permutation would
 * re-spend the entire review budget per entry, per reorder, to re-derive a
 * verdict the fleet already published — while the queue branch's own CI (which
 * DOES run on `merge_group`) is what actually exercises the combined code. This
 * repo already takes that position elsewhere: scripts/check-roadmap-link.ts
 * treats `merge_group` heads as a pass-through for exactly this reason.
 *
 * What matters is that the context REPORTS. It is required on the merge queue,
 * so a context that never appears is not a strict gate — it is a permanent
 * deadlock, which is what it had been since 2026-08-06.
 *
 * Fails soft on purpose: any error here leaves the check absent, which is
 * exactly today's behaviour, so this can never be worse than not running.
 *
 * @param job the merge_group delivery
 * @param env executor bindings (token minting + details url)
 */
async function reportMergeGroupPassThrough(job: FleetRunJob, env: ExecutorEnv): Promise<void> {
  const mergeGroup = job.payloadMinimal?.merge_group as Record<string, unknown> | undefined;
  const headSha = typeof mergeGroup?.head_sha === 'string' ? mergeGroup.head_sha : '';
  if (!job.repoFullName || !job.installationId || !headSha) return;
  const [owner, repo] = job.repoFullName.split('/');
  if (!owner || !repo) return;

  const token = await getInstallationTokenCached(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    job.installationId,
    env.FLEET_TOKENS,
  ).catch(() => null);
  if (!token) return;

  try {
    const checkRunId = await createCheckRun(owner, repo, CHECK_NAME, headSha, token, null);
    await completeCheckRun(
      owner,
      repo,
      checkRunId,
      'success',
      'Merge-queue pass-through. Every PR in this group was reviewed by the fleet at ' +
        'pull_request time; the queue branch is gated by its own CI, which runs on ' +
        'merge_group. The fleet does not re-review each queue permutation.',
      token,
      null,
    );
  } catch (err) {
    // Absent check == today's behaviour. Never throw: a failure here must not
    // retry the job or dead-letter it.
    console.error(`[fleet-executor] merge_group pass-through failed for ${job.repoFullName}@${headSha}: ${String(err)}`);
  }
}

export async function executeFleet(job: FleetRunJob, env: ExecutorEnv): Promise<void> {
  if (!env.AI) return;

  // MERGE QUEUE: handled before every guard below, all of which assume a PR.
  // A merge_group delivery has no pull_request and no prNumber, so it would
  // otherwise fall straight out of `!job.prNumber` and report nothing — the
  // deadlock this branch exists to end.
  if (job.eventType === 'merge_group') {
    await reportMergeGroupPassThrough(job, env);
    return;
  }

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

  // Deterministic run id from the delivery id so a retried delivery rewrites its
  // own audit row + transcript (INSERT OR REPLACE) instead of duplicating.
  const runId = `run:${deliveryId}`;
  // Capability URL for the human-facing run page (ADR-0101 Phase 0). Null when
  // RUN_DETAILS_BASE_URL / RUN_PAGE_SECRET are unconfigured; never throws.
  const detailsUrl = await runDetailsUrl(env, runId);
  const startMs = Date.now();
  const transcript = new Transcript(env.DB, runId, (failure) =>
    emitTranscriptWriteFailureTelemetry(env, job, failure)
  );

  // --- KILL SWITCH ---------------------------------------------------------
  // Checked at the very START, before any AI spend or review/comment post.
  // STILL posts a neutral 'Port Daddy Fleet' check — it must NEVER just
  // return silently here. "Port Daddy Fleet" is a REQUIRED status check on
  // the main-branch merge-queue ruleset (ALLGREEN grouping); an absent check
  // blocks the WHOLE queue forever, not just this one run, and looks like
  // nothing at all in GitHub's UI (no failing check to investigate — just
  // permanent silence). This is exactly what happened 2026-07-16: an
  // out-of-band `fleet:paused=true` (written straight into CONTROL_KV,
  // bypassing the audited POST /v1/fleet/pause endpoint — no audit_log row
  // exists for the toggle) left the check silently ABSENT on every PR for 4
  // days, and every PR needed an admin bypass past a check that never even
  // attempted to run. One token mint + one create/complete(neutral) check-run
  // pair is a small, worthwhile cost to keep the gate legible while paused.
  // Any infra failure here is swallowed (never thrown) so a broken pause path
  // can never spiral into queue retries/DLQ churn — pausing must stay cheap.
  if (await isFleetPaused(env)) {
    console.log(`[fleet-executor] delivery=${deliveryId} paused; posting neutral check (no AI spend, no posts)`);
    const head = prPayload.head as { sha?: unknown } | undefined;
    const headSha = typeof head?.sha === 'string' ? head.sha : null;
    if (!headSha) {
      console.warn(`[fleet-executor] delivery=${deliveryId} paused; no head sha in payload, cannot post check`);
      return;
    }
    try {
      const token = await getInstallationTokenCached(
        env.GITHUB_APP_ID,
        env.GITHUB_APP_PRIVATE_KEY,
        job.installationId,
        env.FLEET_TOKENS,
      );
      let checkRunId = await findFleetCheckRun(owner, repo, headSha, CHECK_NAME, token).catch(
        () => null,
      );
      if (!checkRunId) {
        checkRunId = await createCheckRun(owner, repo, CHECK_NAME, headSha, token, detailsUrl);
      }
      const summary =
        'Fleet paused by operator; no automated review was performed for this delivery. ' +
        'Resume the fleet (POST /v1/fleet/pause {"paused":false}) or review this PR manually.';
      if (checkRunId) {
        await completeCheckRun(owner, repo, checkRunId, 'neutral', summary, token, detailsUrl);
      }
      await transcript.step(
        'check-completed',
        null,
        'Check concluded: neutral (paused at job start)',
        { checkRunId, conclusion: 'neutral', reason: 'paused-at-start' },
      );
      const base = prPayload.base as { sha?: unknown } | undefined;
      const stubPrCtx: PRContext = {
        owner,
        repo,
        prNumber,
        title: '',
        body: '',
        headSha,
        baseSha: typeof base?.sha === 'string' ? base.sha : '',
        // Stub context for a short-circuited (paused) run: no ship ever acts on
        // it, so refs stay empty and isFork stays conservatively true (a fork is
        // never retargeted/stacked — the safe default for an unknown PR).
        headRef: '',
        baseRef: '',
        isFork: true,
        // Authorship is unknown on a short-circuited run and nothing reads it
        // here; empty classifies as "not the fleet", the conservative default.
        authorLogin: '',
        authorType: '',
        // Likewise unknown: the run is already short-circuited by the pause, so
        // the lifecycle gate never sees this. Empty/false is the fail-open pair
        // (`classifyPrLifecycle` reads it as "still open").
        state: '',
        merged: false,
        installationId: job.installationId,
        files: [],
        diff: '',
      };
      await recordRunStart(env, runId, job, stubPrCtx, prNumber, []);
      await recordRunEnd(env, runId, 'neutral', startMs);
    } catch (err) {
      console.error(
        `[fleet-executor] delivery=${deliveryId} paused-check post failed: ${String(err)}`,
      );
    }
    return;
  }

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

  // A synchronize delivery can sit behind an expensive review long enough for
  // several newer commits to arrive. Its payload SHA is immutable, while the PR
  // files/diff endpoints above describe the current head. Never spend AI on that
  // mismatched combination or attach a current-diff verdict to an obsolete SHA.
  // Acknowledge stale deliveries; the newest synchronize event owns the gate.
  const eventHead = prPayload.head && typeof prPayload.head === 'object'
    ? (prPayload.head as Record<string, unknown>).sha
    : null;
  if (typeof eventHead === 'string' && eventHead && eventHead !== prCtx.headSha) {
    console.log(
      `[fleet-executor] delivery=${deliveryId} stale head ${eventHead.slice(0, 12)}; current=${prCtx.headSha.slice(0, 12)}; skipping`,
    );
    return;
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

  // TENANCY CONSENT (cloud squid): fleet-cloud events carry this repo's name,
  // PR numbers, verdicts, and stacked-PR urls onto a shared relay channel, so
  // they additionally require the TENANT's `squidEvents: true` in pd-fleet.yml
  // (trusted default branch, parsed above; default false). No pd-fleet.yml ⇒
  // no consent ⇒ no events, regardless of RELAY_PUBLISH_* wiring.
  const squidConsent = fleetYaml ? parseFleetSquidEvents(fleetYaml) : false;

  // XO CONSENT: the XO synthesis officer (src/xo.ts) — idea editor pass +
  // advisory-findings triage — is opt-in per tenant via `xo: true` in
  // pd-fleet.yml (trusted default branch, same zero-trust fetch; default OFF).
  // Both duties are strictly advisory and fail-open: an XO failure changes
  // NOTHING about proposals, comments, or the check conclusion.
  const xoEnabled = fleetYaml ? parseFleetXo(fleetYaml) : false;

  // Cloud-executable ships only (execution ships dispatch to GHA elsewhere).
  const cloudShips = ships.filter(s => !s.needsExecution);
  if (cloudShips.length === 0) return;

  // --- Check run (idempotent: reuse one for this head SHA) -----------------
  //
  // IDEMPOTENCY, AND WHY IT IS ABOUT MONEY. A queue redelivery re-runs this
  // whole function. Comment posting is already idempotent -- a re-run edits the
  // ship comment in place rather than duplicating it -- but the MODEL CALLS
  // behind that comment are not: every ship is re-run to produce the text it
  // then overwrites. Identical output, paid for again.
  //
  // When the check for this head SHA is already COMPLETED that spend buys
  // literally nothing, because a finished check run cannot be reopened. The
  // work cannot change the gate, cannot change the comment's meaning, and
  // cannot be seen by anyone. Observed 2026-08-06: runs that exceeded the
  // Worker wall-clock were redelivered, dead-lettered, completed as `failure`
  // by the DLQ handler -- and then kept re-running ships for HOURS against a
  // gate that could never go green again.
  //
  // So a completed check is a full stop. `in_progress` is NOT: that is the
  // genuine retry of a run that died mid-flight, and it must proceed.
  const existing = await findFleetCheckRunState(
    owner,
    repo,
    prCtx.headSha,
    CHECK_NAME,
    token,
  ).catch(() => null);
  //
  // `neutral` is deliberately NOT terminal. The fleet completes neutral when it
  // DEFERRED rather than decided -- paused by the kill switch, skipped by the PR
  // lifecycle gate, skipped by the self-review guard. Treating those as decided
  // would strand a PR permanently unreviewed: unpause the fleet, redeliver, and
  // the guard would skip forever. Only `success` and `failure` mean ships
  // actually ran and reached a verdict.
  //
  // …and a DLQ-completed `failure` is NOT decided either, for the same reason
  // `neutral` isn't: no ship ran, nothing was reviewed, no verdict was reached.
  // A lost job's red gate is honest fail-closed output, but counting it as
  // DECIDED strands the head SHA permanently — every later delivery returns
  // right here, before even creating a check run, so no retry can ever produce
  // a real verdict and the only escape is a brand-new commit. Observed
  // 2026-08-19: #7278, #7339 and #7344 each lost one run to a dead-letter and
  // were then unreviewable at that SHA; reopening them re-ran all of GitHub
  // Actions CI while the fleet check never reappeared at all.
  const DECIDED: ReadonlySet<string> = new Set(['success', 'failure']);
  const deadLettered = isDeadLetteredSummary(existing?.summary);
  if (
    existing &&
    existing.status === 'completed' &&
    DECIDED.has(existing.conclusion ?? '') &&
    !deadLettered
  ) {
    console.log(
      `[fleet-executor] ${owner}/${repo}@${prCtx.headSha}: check already decided ` +
        `(${existing.conclusion}) — skipping ${cloudShips.length} ship(s). ` +
        `A redelivery cannot reopen a finished check, so running them would spend and change nothing.`,
    );
    return;
  }
  if (deadLettered) {
    console.log(
      `[fleet-executor] ${owner}/${repo}@${prCtx.headSha}: previous check was dead-lettered, ` +
        `not decided — running ${cloudShips.length} ship(s) for a real verdict.`,
    );
  }

  // A finished check cannot be reopened, so a dead-lettered one must not be
  // REUSED either: completing it again would be a no-op against a gate GitHub
  // considers closed. Mint a fresh check run instead — GitHub surfaces the
  // newest run of a given name, so the new one is what the branch rule reads.
  let checkRunId = deadLettered ? null : existing?.id ?? null;
  if (!checkRunId) {
    // No swallow: a createCheckRun failure must propagate so the job RETRIES.
    checkRunId = await createCheckRun(owner, repo, CHECK_NAME, prCtx.headSha, token, detailsUrl);
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
  // Backstop: guarantee the row exists even if the write above silently
  // failed, so every completion path below can rely on details_url resolving
  // to a real run page (see ensureRunRow's docstring).
  await ensureRunRow(env, runId, job.deliveryId, job.repoFullName, prNumber, prCtx.headSha);

  // --- SELF-REVIEW GUARD (the fleet does not review its own branches) ------
  // WHY THIS SITS HERE — after the gating check exists, before any AI spend.
  // "Port Daddy Fleet" is a REQUIRED status check; returning early WITHOUT
  // completing it would leave it permanently in_progress and block the branch
  // forever (the 2026-07-16 pause incident). So we complete it honestly and
  // then stop.
  //
  // WHY AT ALL: nothing previously distinguished a human's PR from the fleet's
  // own purser test branch, so the full roster reviewed machine-authored tests
  // and filed findings on them — pd-qa was producing 6–11 findings per round on
  // this repo, several hallucinated, against code the fleet had just written
  // minutes earlier. That is pure cost and pure noise.
  //
  // IDENTITY, NOT BRANCH NAME: `classifyPrAuthorship` requires the author to be
  // a Bot, and prefers matching this App's own resolved login over the
  // attacker-controllable head ref (see src/fleet-identity.ts). A human on a
  // branch called `purser/anything` is still reviewed normally.
  //
  // ZERO-TRUST UNCHANGED: config still came from the trusted default branch
  // above; this guard reads only authorship, and adds no new trust in PR head.
  // --- PR LIFECYCLE GATE (before authorship: needs no API call at all) ------
  // A queue can hand us a job for a PR that has since merged or closed. The
  // purser then authors adversarial tests for a PR that is already in the base
  // branch — observed as #5456 (tests for #5372, merged 100 minutes earlier)
  // and #5451 (tests for #5367). Those test PRs cannot do their job: the
  // contract is that the reviewed PR merges THROUGH the tests.
  //
  // Placed ahead of the authorship guard deliberately — this reads fields the
  // live PR fetch already returned, whereas `resolveFleetAppLogin` below may
  // hit the API on a cold KV. Cheapest gate first.
  //
  // FAIL-OPEN: an absent or unrecognised state counts as open. See
  // src/pr-lifecycle.ts — wrongly skipping a live PR silently removes its
  // review gate, which is far worse than wrongly spending on a dead one.
  const lifecycle = classifyPrLifecycle(prCtx);
  if (lifecycle.over) {
    // HUMAN-FACING: this is the entire explanation an author gets for a neutral
    // required check, so it has to read like a sentence AND claim only what we
    // actually observed. The earlier draft ended "…it has since ${state}",
    // which is both ungrammatical for 'closed' and an assertion about when the
    // job was enqueued that this code never checked and that need not be true —
    // a delivery can be raised for a PR that was already finished.
    const summary =
      `Not reviewed — ${lifecycle.reason}. No ships were run and no AI was spent. ` +
      `Fleet jobs are queued, so a delivery can arrive after the pull request it ` +
      `was raised for has already finished.`;
    await transcript.step(
      'pr-lifecycle-skip',
      null,
      `Check concluded: neutral (pull request already ${lifecycle.state})`,
      {
        checkRunId,
        conclusion: 'neutral',
        reason: `pr-${lifecycle.state}`,
        prState: lifecycle.state,
        shipsRun: 0,
      },
    );
    await completeCheckRun(owner, repo, checkRunId, 'neutral', summary, token, detailsUrl);
    await recordRunEnd(env, runId, 'neutral', startMs);
    return;
  }

  const fleetAppLogin = await resolveFleetAppLogin(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    env.FLEET_TOKENS,
  ).catch(() => null);
  const authorship = classifyPrAuthorship({
    authorLogin: prCtx.authorLogin,
    authorType: prCtx.authorType,
    headRef: prCtx.headRef,
    fleetAppLogin,
  });
  if (authorship.fleetAuthored) {
    const summary =
      `Fleet-authored branch — not self-reviewed. ${authorship.reason}. ` +
      `No ships were run and no AI was spent: reviewing the fleet's own output produces ` +
      `machine noise on machine work, not review. The branch is still gated by the repo's ` +
      `normal CI and requires a human to merge it.`;
    await transcript.step(
      'fleet-authored-skip',
      null,
      'Check concluded: neutral (fleet-authored branch, not self-reviewed)',
      {
        checkRunId,
        conclusion: 'neutral',
        reason: 'fleet-authored',
        authorLogin: prCtx.authorLogin,
        authorType: prCtx.authorType,
        headRef: prCtx.headRef,
        signal: authorship.signal,
        shipsRun: 0,
      },
    );
    await completeCheckRun(owner, repo, checkRunId, 'neutral', summary, token, detailsUrl);
    await recordRunEnd(env, runId, 'neutral', startMs);
    return;
  }

  // Cloud squid: announce the run (fire-and-forget; disabled unless BOTH
  // RELAY_PUBLISH_URL and RELAY_PUBLISH_TOKEN are configured AND the tenant
  // opted in via `squidEvents: true` in pd-fleet.yml).
  emitSquidEvent(env, 'run-started', { repo: job.repoFullName, pr: prNumber, runId }, squidConsent);

  // --- SPEND CIRCUIT-BREAKER (pre-spend, before any ship runs) --------------
  // The per-installation abuse gate: if this installation has a credit_ledger and
  // its balance is spent (SUM(delta_usd) <= 0), skip ALL AI spend and complete
  // the gating check NEUTRAL (never falsely-green, never blocking) so the PR is
  // not gated by an unpaid bill. FAIL-OPEN: absent table / no ledger rows / trial
  // installs run normally (see creditsExhausted). Runs after the check is
  // established so we can complete it, but BEFORE any ship inference.
  if (job.installationId != null && (await creditsExhausted(env, job.installationId))) {
    const summary =
      'Fleet skipped: this installation is out of credits. Top up credits to resume automated reviews.';
    await transcript.step('check-completed', null, 'Check concluded: neutral (credits exhausted)', {
      checkRunId,
      conclusion: 'neutral',
      reason: 'credits-exhausted',
      installationId: job.installationId,
    });
    await completeCheckRun(owner, repo, checkRunId, 'neutral', summary, token, detailsUrl);
    await recordRunEnd(env, runId, 'neutral', startMs);
    return;
  }

  // --- Run ships sequentially (Workers AI rate limits) ---------------------
  // Each ship is a map-reduce over the diff: MAP one call per diff chunk, then
  // REDUCE via a manager call that merges the structured findings and computes
  // the FLEET-VERDICT.
  // Deterministic ship gating (cost): a ship whose surface the diff doesn't touch
  // is skipped BEFORE any AI spend; reviewer ships skip docs-only diffs while
  // ideation ships run on them. Computed once per run from the PR's changed files.
  const changedPaths = prCtx.files.map(f => f.filename).filter(Boolean);
  const docsOnly = isDocsOnly(changedPaths);

  // PURSER ordering: purser ships run AFTER every reviewer/ideation ship, so
  // the stacked-tests demand lands on top of (and can reference) the rest of
  // the fleet's review. Purser is OFF unless a `class: purser` ship is declared
  // in pd-fleet.yml — defaultPRShips() carries none (safe rollout).
  const orderedShips = [
    ...cloudShips.filter(s => !s.purser),
    ...cloudShips.filter(s => s.purser),
  ];

  // Per-run skill-graft cache (src/skill-graft.ts). Bound to the TRUSTED
  // default branch — a skill file is fetched at most once per run no matter how
  // many ships graft it. ZERO-TRUST: never the PR head.
  const skillGrafts = createSkillGraftCache(path =>
    fetchRepoFile(owner, repo, path, branch, token),
  );

  const results: ShipResult[] = [];
  for (const ship of orderedShips) {
    // Per-ship wall-clock start: durationMs must reflect THIS ship's work
    // (including its gate/skip decision), not the cumulative run time — else
    // later ships report inflated durations that fold in every earlier ship.
    const shipStartMs = Date.now();
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
      await completeCheckRun(owner, repo, checkRunId, 'neutral', summary, token, detailsUrl);
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
      const skipped: ShipResult = { ship: ship.name, blocking: ship.blocking, verdict: 'PASS', errored: false, findings: [] };
      results.push(skipped);
      // Telemetry for a gated ship: zero AI spend, status ok (calls=0 ⇒ not a blackout).
      await emitShipTelemetry(env, job, prCtx, ship, skipped, newShipMetrics(), checkRunId, shipStartMs);
      continue;
    }

    // Skill graft: build this ship's prompt prefix from its `graft:` list.
    // Unknown ids are a transcript WARNING, never a failure — the ship still
    // runs, just without the missing skill.
    let graftText = '';
    if (ship.graft.length > 0) {
      const graft = await skillGrafts.graftFor(ship.graft);
      graftText = graft.text;
      if (graft.missing.length > 0) {
        await transcript.step(
          'skill-graft',
          ship.name,
          `pd-${ship.name}: unknown graft skill(s) skipped — ${graft.missing.join(', ')}`,
          { loaded: graft.loaded, missing: graft.missing, warning: true },
        );
      }
    }

    const metrics = newShipMetrics();
    const result = ship.purser
      ? await runPurser(ship, prCtx, env, token, transcript, metrics, graftText, runId, squidConsent)
      : await runShip(ship, prCtx, token, env, branch, transcript, metrics, graftText, runId, squidConsent, xoEnabled);
    results.push(result);
    // Cloud squid: one ship-verdict event per ship that ran (fire-and-forget).
    emitSquidEvent(env, 'ship-verdict', {
      repo: job.repoFullName,
      pr: prNumber,
      runId,
      ship: ship.name,
      verdict: result.errored ? 'ERROR' : result.verdict,
    }, squidConsent);
    await emitShipTelemetry(env, job, prCtx, ship, result, metrics, checkRunId, shipStartMs);
    // Per-run spend: one fleet_run_spend row per ship that actually ran, so the
    // relay can bill per installation. Best-effort — never changes the run.
    await recordShipSpend(env, runId, ship, job.installationId, metrics);
    // …and the same numbers into the transcript, which is what the human-facing
    // run page actually reads for its token tiles.
    await recordShipTokensInTranscript(transcript, ship, metrics);
  }

  // --- Conclusion (verdict logic is REAL; see verdict.ts) ------------------
  const conclusion = aggregateConclusion(results);

  // --- ONE GitHub Review with all inline comments + a roll-up summary -------
  // Inline review is the PRIMARY surface; the per-ship issue comments posted
  // during each runShip() remain for backward-compatible history.
  const summary = buildSummary(results, conclusion);

  // --- XO TRIAGE (advisory-findings curation; src/xo.ts) --------------------
  // The XO ranks which ADVISORY findings are worth doing for THIS PR and the
  // review comment gains an "XO's orders" section. Strictly fail-open: on any
  // XO failure the section is '' and the comment renders EXACTLY as today. The
  // check conclusion (and its summary) is computed above and NEVER touched.
  let reviewBody = summary;
  if (xoEnabled) {
    const advisories = collectAdvisoryFindings(results);
    if (advisories.length > 0) {
      const section = await xoOrdersSection({
        ai: env.AI,
        model: resolveXoModel(env.XO_MODEL),
        advisories,
        changedPaths,
        gatewayId: env.AI_GATEWAY_ID,
      });
      if (section) reviewBody = `${summary}\n\n${section}`;
      await transcript.step(
        'xo-triage',
        null,
        section
          ? `XO triage: orders appended (${advisories.length} advisory finding(s) reviewed)`
          : `XO triage: no section (XO failed or declined) — comment unchanged`,
        { advisories: advisories.length, appended: !!section },
      );
    }
  }

  const reviewComments: ReviewComment[] = [];
  for (const r of results) {
    for (const f of r.findings ?? []) {
      reviewComments.push({ path: f.path, line: f.line, body: `[${r.ship}] ${f.body}` });
    }
  }
  if (reviewComments.length > 0 || summary.trim()) {
    // Best-effort: createReview never throws (see github.ts), so a review
    // failure can't fail the gate or block completing the check run.
    // A blocking ship with HIGH findings REJECTS the PR rather than commenting
    // beside it -- see reviewEventFor(). Anything else stays COMMENT.
    const reviewEvent = reviewEventFor(results);
    await createReview(owner, repo, prNumber, reviewEvent, reviewBody, reviewComments, prCtx.headSha, token);
  }

  await completeCheckRun(owner, repo, checkRunId, conclusion, summary, token, detailsUrl);

  // Cloud squid: the run is over (fire-and-forget).
  emitSquidEvent(env, 'run-concluded', {
    repo: job.repoFullName,
    pr: prNumber,
    runId,
    verdict: conclusion,
  }, squidConsent);

  // --- Transcript: check completion + final run header (best-effort) --------
  await transcript.step('check-completed', null, `Check concluded: ${conclusion}`, {
    checkRunId,
    conclusion,
  });
  await recordRunEnd(env, runId, conclusion, startMs);
}

// ---------------------------------------------------------------------------

/**
 * Record a ship's NO-USABLE-OUTPUT outcome and build its {@link ShipResult}.
 *
 * Writes one `ship-no-output` transcript step whose title is an honest English
 * sentence ("… returned no usable output — nothing was reviewed"), never a
 * verdict word, so neither the transcript nor the run page can render it as a
 * pass. The returned result carries `noUsableOutput: true`, which
 * {@link aggregateConclusion} gates on: a broken ship fails the run whatever
 * its blocking flag (broken-ship doctrine, 2026-08-19).
 *
 * `verdict` is still populated because {@link ShipResult} requires it — BLOCK
 * for a blocking ship (absence of a review is not approval) and PASS for an
 * advisory one (advisory judgment cannot object on its own) — but
 * `noUsableOutput` is the authoritative signal and every renderer must key on
 * it first.
 *
 * @param ship The ship whose output could not be used.
 * @param transcript The run's best-effort step recorder.
 * @param reason Which contract test failed (see {@link NoUsableOutputReason}).
 * @param detail Lengths and fan-out recorded so an operator can audit the call
 *   without re-running the model.
 * @returns The ship's result, flagged `noUsableOutput`.
 */
async function recordNoUsableOutput(
  ship: ShipConfig,
  transcript: Transcript,
  reason: NoUsableOutputReason,
  detail: { strippedLength: number; rawLength: number; chunkCount: number },
): Promise<ShipResult> {
  await transcript.step(
    'ship-no-output',
    ship.name,
    describeNoUsableOutput(`pd-${ship.name}`, reason),
    {
      noUsableOutput: true,
      reason,
      blocking: ship.blocking,
      ideation: ship.ideation,
      strippedLength: detail.strippedLength,
      outputLength: detail.rawLength,
      chunkCount: detail.chunkCount,
    },
  );
  return {
    ship: ship.name,
    blocking: ship.blocking,
    verdict: ship.blocking ? 'BLOCK' : 'PASS',
    errored: false,
    noUsableOutput: true,
    findings: [],
  };
}

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
  metrics: ShipMetrics,
  /** Skill-graft prompt prefix ('' ⇒ none) — see src/skill-graft.ts. */
  graftText = '',
  /** Run id for squid coordination events. */
  runId = '',
  /** Tenant `squidEvents: true` consent from pd-fleet.yml (default false). */
  squidConsent = false,
  /** Tenant `xo: true` consent from pd-fleet.yml (default false) — src/xo.ts. */
  xoEnabled = false,
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

    const systemPrompt = buildSystemPrompt(ship, contract, graftText);

    // Drop generated files BEFORE chunking. A lockfile refresh or a regenerated
    // snapshot is often the largest thing in a diff, and every chunk of it is a
    // model call spent on output no human wrote — while displacing real code
    // into later chunks, which is exactly what makes each reviewer's view of
    // the change partial. Falls back to the full diff if the filter would leave
    // nothing, so a genuinely all-generated PR still gets looked at rather than
    // silently passing.
    const reviewableDiff = filterDiffToReviewable(prCtx.diff);
    const chunks = chunkDiff(reviewableDiff || prCtx.diff, mapChunkCharLimit(mapModelFor(ship)));

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
    const partials = await mapWithConcurrency(chunks, MAP_CONCURRENCY, async (chunk, i) => {
      const userMessage = buildUserMessage(prCtx, chunk, i, chunks.length, fleetContext);
      const request = {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        ...(ship.temperature === null ? {} : { temperature: ship.temperature }),
      };
      const res = await env.AI.run(
        mapModelFor(ship) as Parameters<typeof env.AI.run>[0],
        request,
        aiOptions(env, ship.name),
      );
      const { text, shape } = extractAiText(res);
      accumulateUsage(metrics, mapModelFor(ship), res, text);

      // Diagnose the silent-blank case: an empty result makes a ship post nothing
      // and resolve PASS. Log the model + response shape so an empty-returning
      // model (gpt-oss Responses API mismatch, an outage, an error object) is
      // legible instead of a mystery green check. (2026-07-07 blackout postmortem.)
      if (!text) {
        console.warn(
          `[fleet-executor] pd-${ship.name} MAP chunk ${i + 1}/${chunks.length} EMPTY on ` +
            `${mapModelFor(ship)}: ${describeResponseShape(res)}`,
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
      return text;
    });

    // --- REDUCE: manager merges the partials (only when fan-out > 1) --------
    const output =
      chunks.length === 1 ? partials[0] ?? '' : await reduceFindings(ship, partials, env, metrics);

    // Transcript: the REDUCE step exists only on a multi-chunk fan-out.
    if (chunks.length > 1) {
      await transcript.step('reduce', ship.name, `REDUCE pd-${ship.name}`, {
        chunkCount: chunks.length,
        outputLength: output.length,
      });
    }

    // --- NO USABLE OUTPUT gate (src/usable-output.ts) ----------------------
    // Before either contract is parsed: did the model say ANYTHING its contract
    // asked for? If not, the ship reviewed nothing, and must never be folded
    // into a clean PASS. A ship in this state is BROKEN, and a broken ship
    // fails the run whatever its blocking flag (aggregateConclusion returns
    // `failure`; broken-ship doctrine, 2026-08-19).
    const usability = classifyShipOutput(output, { ideation: ship.ideation });
    if (!usability.usable) {
      return await recordNoUsableOutput(ship, transcript, usability.reason, {
        strippedLength: usability.strippedLength,
        rawLength: output.length,
        chunkCount: chunks.length,
      });
    }

    // --- IDEATION ships: proposals, not findings ---------------------------
    // spark / spider / lookout / snipe propose forward work. Parse the validated
    // Proposal schema and render it into REAL actionable Port Daddy syntax.
    // Their JUDGMENT is always advisory — a proposal never gates a merge and
    // never contributes inline review comments. Their MACHINERY is not: a
    // malformed proposal block means the ship is broken, and a broken ship
    // fails the run (`errored: true` → aggregateConclusion `failure`;
    // broken-ship doctrine, 2026-08-19). The raw model output is still posted
    // so the prose isn't lost while the breakage gets fixed.
    if (ship.ideation) {
      const proposals = parseProposals(output);

      // --- XO EDITOR PASS (src/xo.ts) --------------------------------------
      // Before the batch is finalized (rendered / stacked / captured), the XO
      // curates it against the most recent tracked ideas: merge near-dupes,
      // sharpen titles, drop what's already tracked. Strictly fail-open: any
      // XO failure keeps `proposals` untouched, and the cosine dedup inside
      // captureProposals remains the pre-filter/fallback either way.
      let curated = proposals;
      if (xoEnabled && proposals && proposals.length > 0) {
        const recentIdeas = env.DB
          ? await listRecentIdeas(env.DB, XO_RECENT_IDEAS_LIMIT)
          : [];
        const editor = await runXoEditorPass({
          ai: env.AI,
          model: resolveXoModel(env.XO_MODEL),
          proposals,
          recentIdeas,
          gatewayId: env.AI_GATEWAY_ID,
        });
        curated = editor.proposals;
        await transcript.step(
          'xo-editor',
          ship.name,
          editor.applied
            ? `XO editor: ${editor.editCount} edit(s) applied (${proposals.length} → ${curated.length} proposal(s))`
            : `XO editor: fallback — ${editor.reason}`,
          {
            applied: editor.applied,
            reason: editor.reason,
            before: proposals.length,
            after: curated.length,
          },
        );
      }

      // "Stack onto the review diff": when a proposal carries action 'stack'
      // with valid files, the ship's own code is branched from the PR HEAD and
      // opened as a PR based on the PR's head branch. At most ONE stack PR per
      // ship per run; every failure mode degrades to a transcript note.
      const stackedPr =
        curated && curated.length > 0
          ? await maybeStackProposal(ship, prCtx, curated, env, token, transcript, runId, squidConsent)
          : null;
      const rendered =
        curated && curated.length > 0
          ? renderProposalComment(curated, {
              owner: prCtx.owner,
              repo: prCtx.repo,
              prNumber: prCtx.prNumber,
              shipName: ship.name,
              stackedPr,
            })
          : '';
      // When proposals parse to a real set → post the actionable render. When the
      // ship proposed nothing (empty array) → silence. When the block was
      // malformed (null) → post the raw output so the model's prose isn't lost,
      // and record the ship as BROKEN rather than laundering it into a PASS.
      const malformed = proposals === null;
      const body = rendered || (malformed ? output : '');

      await transcript.step(
        malformed ? 'ship-finding' : 'ship-verdict',
        ship.name,
        malformed
          ? `pd-${ship.name}: proposal block MALFORMED — broken ship, fails the run`
          : `pd-${ship.name}: PASS (ideation)`,
        malformed
          ? { error: 'failed to parse proposals', posted: !!body.trim() }
          : { proposals: curated, posted: !!body.trim() },
      );

      await postShipComment(
        prCtx.owner,
        prCtx.repo,
        prCtx.prNumber,
        ship.name,
        ship.role,
        body,
        token,
      );

      // Durably capture the (XO-curated) proposals (D1 + semantic dedup +
      // auto-issue) so a Spark/Spider idea doesn't evaporate when the PR scrolls
      // away. Best-effort: it NEVER throws or changes the advisory PASS.
      if (curated && curated.length > 0) {
        await captureIdeas(
          curated,
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
        errored: malformed,
        findings: [],
      };
    }

    // Parse the structured findings block. `null` => malformed JSON => the ship
    // is treated as errored (blocking → BLOCK, advisory → PASS, never silent).
    const parsedFindings = parseShipFindings(output);

    // Drop findings that cite a file this PR never touched.
    //
    // A prompt instruction is guidance; this is enforcement. Review is
    // map-reduce over diff chunks, and a reviewer holding several files' hunks
    // at once can attribute a snippet from one to the path of another — on
    // #4956 a fragment from `lib/local-citizen/ink-cloud.ts` was reported as a
    // syntax error at a line in `lib/squid/reconcile-sources.ts`, a file that
    // does not contain the quoted text anywhere. A finding pinned to a path
    // outside the diff cannot be about this PR, and shipping it burns reviewer
    // trust on every finding that IS real.
    //
    // Deliberately scoped to paths, not line numbers: a slightly-off line is a
    // navigational annoyance, while a wrong FILE means the reasoning was about
    // something else entirely.
    // FAIL OPEN when the changed-file list is not known to be complete.
    //
    // `fetchPRContext` returns `files: []` when the /files call fails, and asks
    // GitHub for `per_page=100` without paginating — so an empty list means
    // "we don't know", and a list AT the page size may be truncated. Filtering
    // against either would silently discard real findings, which is a far worse
    // failure than letting a bogus one through: a dropped finding is invisible,
    // while a wrong one is at least arguable in the thread. The prompt-level
    // scope contract is the primary defence; this is the backstop, and a
    // backstop that can eat correct output is not worth having.
    const changedPaths = new Set(prCtx.files.map(f => f.filename));
    const fileListTrustworthy = changedPaths.size > 0 && prCtx.files.length < PR_FILES_PAGE_SIZE;
    const findings =
      parsedFindings === null || !fileListTrustworthy
        ? parsedFindings
        : parsedFindings.filter(f => {
            const cited = String((f as { path?: unknown }).path ?? '').trim();
            if (!cited || changedPaths.has(cited)) return true;
            console.warn(
              `[fleet-executor] pd-${ship.name}: dropped finding citing '${cited}', ` +
                `which is not among this PR's ${changedPaths.size} changed files`,
            );
            return false;
          });

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

// ---------------------------------------------------------------------------
// Ideation "stack" proposals: the ship codes the fix itself.

interface StackOutcome {
  proposalIndex: number;
  number: number;
  url: string;
}

/**
 * Realize the FIRST `stack` proposal in an ideation ship's set (max 1 stack PR
 * per ship per run): branch `fleet/<ship>-pr-<n>-<slug>` is cut FROM THE PR
 * HEAD sha with the ship's files, and a PR is opened whose BASE IS THE
 * REVIEWED PR'S HEAD BRANCH — the ship's code lands stacked ON TOP of the
 * review diff.
 *
 * Guards, all degrading to an honest 'stack-posted' transcript note (never a
 * throw, never a gate change):
 *   - same-repo only (fork PRs are never written to),
 *   - files bounded by {@link validateStackProposalFiles} (≤5 files, ≤16KB
 *     each, purser-grade path whitelist),
 *   - sandbox validation when env.SANDBOX exists: the repo suite runs with
 *     the fix grafted onto the PR head, and a FAILING suite blocks the stack
 *     (a ship must not stack a fix that breaks the build). Absent binding ⇒
 *     the stack proceeds honestly un-validated.
 */
async function maybeStackProposal(
  ship: ShipConfig,
  prCtx: PRContext,
  proposals: Proposal[],
  env: ExecutorEnv,
  token: string,
  transcript: Transcript,
  runId: string,
  /** Tenant `squidEvents: true` consent from pd-fleet.yml (default false). */
  squidConsent = false,
): Promise<StackOutcome | null> {
  const proposalIndex = proposals.findIndex(p => p.action === 'stack');
  if (proposalIndex === -1) return null;
  const proposal = proposals[proposalIndex];
  if (!proposal) return null;

  const degrade = async (reason: string): Promise<null> => {
    await transcript.step(
      'stack-posted',
      ship.name,
      `pd-${ship.name}: stack fix NOT posted — ${reason}`,
      { stacked: false, degraded: reason, proposalTitle: proposal.title },
    );
    return null;
  };

  if (prCtx.isFork) return degrade('fork PR — stacking is same-repo only');
  if (!prCtx.headSha) return degrade('PR head sha unknown');
  if (!prCtx.headRef) return degrade('PR head branch unknown');

  const files = proposal.files ?? [];
  const validation = validateStackProposalFiles(files);
  if (!validation.ok) return degrade(validation.reason);

  const sandbox = await runTestsInSandbox({
    sandboxBinding: env.SANDBOX,
    owner: prCtx.owner,
    repo: prCtx.repo,
    headSha: prCtx.headSha,
    files,
    token,
  });
  if (sandbox.executed && sandbox.passed === false) {
    return degrade(
      `sandbox validation FAILED on the PR head — fix not stacked (tail: ${sandbox.outputTail.slice(-300)})`,
    );
  }

  const branchName = `fleet/${ship.name}-pr-${prCtx.prNumber}-${slugify(proposal.title)}`;
  try {
    await createOrUpdateBranch(
      prCtx.owner,
      prCtx.repo,
      branchName,
      prCtx.headSha, // FROM THE PR HEAD: the fix sits on top of the review diff
      files,
      `pd-${ship.name}: ${proposal.title} (stacked on #${prCtx.prNumber})`,
      token,
    );
    const pr = await openStackedPr(
      prCtx.owner,
      prCtx.repo,
      branchName,
      prCtx.headRef, // BASE = the reviewed PR's head branch
      `pd-${ship.name}: ${proposal.title} (stacks on #${prCtx.prNumber})`,
      buildStackPrBody(ship, prCtx, proposal, sandbox.executed === true && sandbox.passed === true),
      ['fleet-stack', `pd-${ship.name}`],
      token,
    );
    await transcript.step(
      'stack-posted',
      ship.name,
      `pd-${ship.name}: coded its own fix and stacked #${pr.number} on top of #${prCtx.prNumber}`,
      {
        stacked: true,
        stackPrNumber: pr.number,
        stackPrUrl: pr.url,
        proposalTitle: proposal.title,
        files: files.map(f => f.path),
        sandboxValidated: sandbox.executed === true && sandbox.passed === true,
      },
    );
    emitSquidEvent(env, 'pr-stacked', {
      repo: `${prCtx.owner}/${prCtx.repo}`,
      pr: prCtx.prNumber,
      runId,
      ship: ship.name,
      url: pr.url,
    }, squidConsent);
    return { proposalIndex, number: pr.number, url: pr.url };
  } catch (err) {
    const reason =
      err instanceof GitHubApiError && err.status === 403
        ? 'the GitHub App lacks the `contents: write` permission'
        : `stacking failed (${String(err).slice(0, 200)})`;
    return degrade(reason);
  }
}

/**
 * Render the ideation stack-proposal PR's body.
 *
 * MOTIVATION: same deadlock as the purser's test branch (see
 * `src/fleet-pr-body.ts`). A `fleet/<ship>-pr-<n>-<slug>` branch is based on the
 * REVIEWED PR's head, so a gate that bounces this body strands the fix behind a
 * permanently-blocked PR nobody can clear — the machine cannot write a human
 * Test Plan, and no human is standing by to write one for it. The trailers
 * declare the exemptions the guards already offer, each with a reason specific
 * to what this branch actually is.
 *
 * @param ship The ideation ship that authored the fix (named in the prose).
 * @param prCtx The reviewed PR this fix stacks on.
 * @param proposal The parsed proposal (title/rationale/files).
 * @param sandboxValidated Whether the repo's suite actually ran green with the
 *   fix applied — stated honestly either way, never assumed.
 * @returns The full markdown body for the stacked fix PR.
 */
function buildStackPrBody(
  ship: ShipConfig,
  prCtx: PRContext,
  proposal: Proposal,
  sandboxValidated: boolean,
): string {
  const files = (proposal.files ?? []).map(f => `- \`${f.path}\``).join('\n');
  return [
    `pd-${ship.name} coded this fix itself while reviewing #${prCtx.prNumber}. ` +
      `The branch is cut from that PR's head, and this PR is based on its head ` +
      `branch — merging it lands the fix stacked ON TOP of the review diff.`,
    `**Why:** ${proposal.rationale}`,
    files ? `**Files:**\n${files}` : '',
    sandboxValidated
      ? `Sandbox-validated: the repo's test suite passed with this fix applied to the PR head.`
      : `Not sandbox-validated (no sandbox available this run) — review before merging.`,
    fleetPrBodyTrailers(
      `stacked fix proposed by pd-${ship.name} while reviewing #${prCtx.prNumber}; it carries no roadmap ` +
        `item of its own — it is machinery attached to whichever item #${prCtx.prNumber} advances`,
    ),
  ]
    .filter(Boolean)
    .join('\n\n');
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
 * each under `limit` characters.
 *
 * A single file larger than the budget is emitted WHOLE and over budget -- it
 * is not hard-split. (This docstring used to say the opposite; the hard-split
 * was removed and the comment was not, which is its own small lesson.) See the
 * reasoning inside the loop.
 *
 * Always returns at least one chunk (possibly the empty string).
 *
 * @param diff the unified diff to split
 * @param limit per-chunk character budget, from {@link mapChunkCharLimit}
 * @returns one or more chunks whose union is the whole diff
 */
/**
 * Strip file sections whose diffs cannot carry a reviewable defect.
 *
 * Operates on `diff --git` boundaries so a dropped file takes its whole hunk
 * set with it and never leaves an orphan header that a reviewer would try to
 * interpret.
 */
export function filterDiffToReviewable(diff: string): string {
  if (!diff || !diff.trim()) return diff;
  return diff
    .split(/(?=^diff --git )/m)
    .filter(part => {
      if (!part.startsWith('diff --git ')) return true; // preamble, keep
      const path = pathFromDiffLine(part.split('\n', 1)[0] ?? '') ?? '';
      return !path || isReviewableForBugs(path);
    })
    .join('');
}

export function chunkDiff(diff: string, limit: number = FALLBACK_MAP_CHUNK_CHARS): string[] {
  if (!diff || !diff.trim()) return [''];

  // Split BEFORE each `diff --git` header so each part is one file's hunks.
  const parts = diff.split(/(?=^diff --git )/m).filter(p => p.length > 0);
  if (parts.length === 0) return [diff];

  const chunks: string[] = [];
  let cur = '';
  for (const part of parts) {
    if (part.length > limit) {
      // An oversized single file becomes ONE chunk, over budget and whole.
      //
      // It used to be hard-split into raw slices, which was wrong twice over:
      // only the first slice carried the `diff --git` header, so every
      // continuation was un-attributable — the scope contract failing on
      // exactly the largest files — and a reviewer handed half a function has
      // no more chance of judging it correctly than one handed none.
      //
      // A file is the smallest unit that can be reviewed coherently, so it is
      // the smallest unit we will split to. When one file exceeds the budget
      // that is unavoidable: emit it intact and let the caller's own limits
      // decide what to do, rather than shredding it into pieces that are
      // cheaper to send and impossible to review.
      if (cur) {
        chunks.push(cur);
        cur = '';
      }
      chunks.push(part);
      continue;
    }
    if (cur && cur.length + part.length > limit) {
      chunks.push(cur);
      cur = part;
    } else {
      cur += part;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length > 0 ? chunks : [diff];
}

/** Ordered async map with a hard in-flight cap. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('concurrency limit must be a positive integer');
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await work(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/**
 * REDUCE step: one manager call that merges the per-chunk partial reviews into a
 * single structured findings block + exactly one FLEET-VERDICT line.
 */
async function reduceFindings(
  ship: ShipConfig,
  partials: string[],
  env: ExecutorEnv,
  metrics: ShipMetrics,
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
    aiOptions(env, ship.name),
  );
  const { text } = extractAiText(res);
  accumulateUsage(metrics, reduceModelFor(ship), res, text);
  if (!text) {
    console.warn(
      `[fleet-executor] pd-${ship.name} REDUCE EMPTY on ${reduceModelFor(ship)}: ` +
        `${describeResponseShape(res)}`,
    );
  }
  return text;
}

function buildSummary(results: ShipResult[], conclusion: string): string {
  const lines = results.map(r => {
    const tag = r.blocking ? ' [BLOCKING]' : '';
    // A ship that produced nothing is reported as exactly that. It must never
    // print as `PASS` here — this summary is the check-run body an operator
    // reads before merging. Broken states (error / no usable output) fail the
    // run whatever the ship's blocking flag — see aggregateConclusion.
    const state = r.noUsableOutput
      ? 'no usable output — nothing was reviewed (broken ship ⇒ run FAILED)'
      : r.errored
        ? 'error (broken ship ⇒ run FAILED)'
        : r.verdict;
    const advisory =
      !r.blocking && r.verdict === 'BLOCK' && !r.errored && !r.noUsableOutput ? ' (advisory)' : '';
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

function buildSystemPrompt(ship: ShipConfig, contract: string | null, graftText = ''): string {
  const parts: string[] = [];

  // Grafted skills come FIRST: they are the repo's own playbooks, fetched from
  // the trusted branch, and frame everything the ship reads after them.
  if (graftText) {
    parts.push(graftText.replace(/\n+---\n+$/, ''));
    parts.push('---');
  }

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

/**
 * Paths whose hunks appear in this chunk, read off the `diff --git` headers.
 *
 * The reviewer must be able to tell what it is actually looking at. A chunk
 * concatenates several files, and the changed-file list names every file in the
 * PR — so without this the model sees N filenames and some hunks with no way to
 * bind one to the other, and attributing a snippet to the wrong path is the
 * natural outcome rather than an unlucky one.
 */
export function filesInChunk(diffChunk: string): string[] {
  const out = new Set<string>();
  // Section-aware, not line-aware. A rename emits BOTH `--- a/old` and
  // `+++ b/new`; collecting every line would report the old path as present
  // too, telling a reviewer it holds a file that exists only under its new
  // name. One path per file section, preferring the post-image.
  for (const section of diffChunk.split(/(?=^diff --git )/m)) {
    if (!section.trim()) continue;
    let newSide: string | null = null;
    let oldSide: string | null = null;
    let headerSide: string | null = null;
    for (const line of section.split('\n')) {
      if (line.startsWith('+++ b/')) newSide ??= line.slice(6).trim() || null;
      else if (line.startsWith('--- a/')) oldSide ??= line.slice(6).trim() || null;
      else if (line.startsWith('diff --git a/')) headerSide ??= pathFromDiffLine(line);
      if (newSide) break;
    }
    // `+++ /dev/null` on a deletion leaves newSide null, so the old path is
    // the only truthful answer there.
    const path = newSide ?? headerSide ?? oldSide;
    if (path) out.add(path);
  }
  return [...out];
}

/**
 * Extract a path from one diff line, tolerating spaces.
 *
 * `diff --git a/X b/Y` cannot be parsed with `\S+`: git does not escape spaces
 * in paths, and this repository already contains `public/Untitled 2.png`. A
 * greedy split on whitespace silently yields the wrong path — or none — and the
 * file is then mis-marked "not in this chunk" even though its hunks are right
 * there, which defeats the scope contract on exactly the files most likely to
 * need it.
 *
 * The `+++ b/<path>` line is the reliable source: the path runs to end of line,
 * so no delimiter ambiguity exists. `diff --git` is used only as a fallback,
 * and there the a/ and b/ halves are separated on the ` b/` boundary nearest
 * the middle, which is correct whenever both sides name the same file (the
 * common case) and degrades to the whole remainder for a rename.
 */
function pathFromDiffLine(line: string): string | null {
  if (line.startsWith('+++ b/')) return line.slice(6).trim() || null;
  if (line.startsWith('+++ ')) return null; // +++ /dev/null — a deletion
  if (line.startsWith('--- a/')) return line.slice(6).trim() || null;
  if (line.startsWith('diff --git a/')) {
    const rest = line.slice('diff --git a/'.length);
    const sep = rest.lastIndexOf(' b/');
    if (sep === -1) return rest.trim() || null;
    return rest.slice(sep + 3).trim() || rest.slice(0, sep).trim() || null;
  }
  return null;
}

/**
 * Build the MAP-stage prompt for one diff chunk.
 *
 * **The chunk is a partial view, and saying so is load-bearing.** Review is
 * map-reduce: each call sees one chunk of a diff that may span dozens of files.
 * Earlier this was communicated only as ` (chunk 3 of 12)` appended to a
 * heading, with the full changed-file list rendered flat above it. That
 * produced two systematic failure modes on a large PR, both observed on
 * #4956:
 *
 *   1. *Fabricated absence.* A reviewer that cannot see `features.manifest.json`
 *      or a test file in ITS chunk reported them missing — "no CJK tests", "not
 *      added to the manifest", "PD_HALT_KEY is not exported" — when each was
 *      present in another chunk. Every one of those shipped as a HIGH finding
 *      with a one-click issue button.
 *   2. *Misattribution.* With every path in the PR listed but no marking of
 *      which are present here, a snippet from one file was reported at a line
 *      number in a different file that happened to be in the same list.
 *
 * The fix is to make the boundary explicit: mark which files this chunk
 * actually contains, state plainly that the rest exists and is not visible, and
 * forbid claims that depend on having seen the whole diff. Absence is a
 * REDUCE-stage judgement — only that stage has all the partials — so the MAP
 * stage must not guess at it.
 */
function buildUserMessage(
  prCtx: PRContext,
  diffChunk: string,
  chunkIndex: number,
  chunkCount: number,
  fleetContext = '',
): string {
  const present = new Set(filesInChunk(diffChunk));
  const partial = chunkCount > 1;

  // If GitHub's /files call failed, `prCtx.files` is empty — but the chunk in
  // hand plainly contains hunks. Rendering "Changed files: (none)" above them
  // is worse than saying nothing: it tells the reviewer the PR touched nothing
  // while showing it a diff, which undercuts the very boundary this block
  // exists to draw. Fall back to what the chunk itself proves.
  const fileRows = prCtx.files.length
    ? prCtx.files.map(f => ({ filename: f.filename, adds: f.additions, dels: f.deletions }))
    : [...present].map(filename => ({ filename, adds: null as number | null, dels: null as number | null }));

  // Mark in-chunk files so the model can bind a hunk to a path. Files from
  // other chunks stay listed — the reviewer should know the PR is larger than
  // what it can see — but are explicitly flagged as not visible here.
  const fileList = fileRows
    .map(r => {
      const here = !partial || present.has(r.filename);
      const mark = here ? '✔' : '·';
      const counts = r.adds === null ? '' : ` (+${r.adds}/-${r.dels})`;
      const note = here ? '' : '  — not in this chunk';
      return `- ${mark} ${r.filename}${counts}${note}`;
    })
    .join('\n');

  const chunkNote = partial ? ` (chunk ${chunkIndex + 1} of ${chunkCount})` : '';

  const scopeBlock = partial
    ? `

## SCOPE — read before reviewing

You are seeing **chunk ${chunkIndex + 1} of ${chunkCount}** of this diff. The files marked \`✔\`
above are the ONLY ones whose changes are visible to you. Files marked \`·\` are
part of this PR and were changed, but their hunks are in another chunk that a
different reviewer is reading.

Therefore, in this stage:

- **Do not report anything as missing, absent, undeclared, unexported, or
  untested.** You cannot see most of the PR. A test, a manifest entry, an
  export, or a registration you did not encounter is almost certainly in a
  chunk you were not given. Claims of absence are decided later, by the stage
  that has every chunk.
- **Every finding must cite a path marked \`✔\`**, and the code you quote must
  appear verbatim in the diff below. A snippet from one file reported against
  another file's path is worse than no finding at all.
- Report only defects you can see *in the code shown here*: a wrong condition,
  an unhandled case, a broken invariant, a real bug in these hunks.`
    : '';

  const contextBlock = fleetContext ? `\n\n${fleetContext}` : '';

  return `# PR #${prCtx.prNumber}: ${prCtx.title}

## Changed files
${fileList || '(none)'}

## PR description
${prCtx.body || '(none)'}${scopeBlock}${contextBlock}

## Diff${chunkNote}
\`\`\`diff
${diffChunk}
\`\`\``;
}

function is401(err: unknown): boolean {
  return /\b401\b/.test(String(err));
}
