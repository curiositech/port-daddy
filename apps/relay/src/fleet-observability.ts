/**
 * Fleet observability + controllability API (operator-gated) for the relay.
 *
 * Read side (Phase C): projects the fleet-executor's transcript/audit trail
 * (D1 tables `fleet_runs` + `fleet_run_steps`) for the pd-console Cloud Fleet
 * pane.
 *   GET  /v1/fleet/activity?limit=N   recent runs, newest first
 *   GET  /v1/fleet/runs/:id           one run + its ordered transcript
 *   GET  /v1/fleet/health             paused flag + last-run age + queue depth
 *
 * Control side: the kill switch.
 *   POST /v1/fleet/pause {paused}     toggle the KV flag the executor checks
 *                                     at job START, before any AI spend.
 *
 * Shared envelope: every response is JSON `{ code, error, ... }` to match the
 * fleet control-plane contract. Operator gate is the shared {@link operatorOnly}
 * (timing-safe token compare). Reads NEVER mutate; pause writes only KV + audit.
 */

import { operatorOnly } from './handlers.js';
import {
  listFleetRuns,
  getFleetRunWithSteps,
  fleetRunsForStats,
  lastFleetRunAt,
  getFleetPaused,
  setFleetPaused,
  appendAudit,
  type FleetRunRow,
} from './db.js';
import type { Env } from './types.js';

// ── Envelope helpers ──────────────────────────────────────────────────────────

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/;

function envelope(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

function fleetErr(code: string, error: string, status: number): Response {
  return envelope(status, { code, error });
}

function isSafeRunId(runId: string): boolean {
  return runId.trim() === runId && RUN_ID_RE.test(runId) && !runId.includes('..');
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Distinct model ids from a stored `models_csv`, or [] when absent. */
function modelsOf(r: FleetRunRow): string[] {
  return r.models_csv ? r.models_csv.split(',').filter(Boolean) : [];
}

/** Project a stored run row into the wire shape (short SHA, ships array). */
function runForList(r: FleetRunRow): Record<string, unknown> {
  return {
    id: r.id,
    deliveryId: r.delivery_id,
    repo: r.repo_full_name,
    prNumber: r.pr_number,
    prUrl: r.pr_url,
    headSha: r.head_sha.slice(0, 7),
    conclusion: r.conclusion,
    ships: r.ships_csv ? r.ships_csv.split(',') : [],
    neurons: r.neurons,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costUsd: r.cost_usd,
    models: modelsOf(r),
    elapsedMs: r.ms,
    createdAt: r.created_at,
  };
}

// ── GET /v1/fleet/activity ──────────────────────────────────────────────────

/** Recent fleet runs, newest first. Each carries pr_url for hyperlinking. */
export async function handleFleetActivity(request: Request, env: Env): Promise<Response> {
  const denied = operatorOnly(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const raw = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Math.min(Number.isFinite(raw) && raw > 0 ? raw : 50, 500);

  try {
    const rows = await listFleetRuns(env.DB, limit);
    return envelope(200, { code: 'OK', error: null, runs: rows.map(runForList) });
  } catch (e) {
    return fleetErr('INTERNAL_ERROR', `activity read failed: ${msg(e)}`, 500);
  }
}

// ── GET /v1/fleet/runs/:id ──────────────────────────────────────────────────

/** One run plus its ordered transcript steps (detail JSON re-hydrated). */
export async function handleFleetRun(
  request: Request,
  env: Env,
  runId: string,
): Promise<Response> {
  const denied = operatorOnly(request, env);
  if (denied) return denied;

  if (!runId || !isSafeRunId(runId)) {
    return fleetErr('BAD_REQUEST', 'run id required', 400);
  }

  try {
    const found = await getFleetRunWithSteps(env.DB, runId);
    if (!found) {
      return fleetErr('NOT_FOUND', `Run ${runId} not found`, 404);
    }
    const { run, steps } = found;
    return envelope(200, {
      code: 'OK',
      error: null,
      run: {
        id: run.id,
        deliveryId: run.delivery_id,
        repo: run.repo_full_name,
        prNumber: run.pr_number,
        prUrl: run.pr_url,
        headSha: run.head_sha,
        conclusion: run.conclusion,
        ships: run.ships_csv ? run.ships_csv.split(',') : [],
        neurons: run.neurons,
        inputTokens: run.input_tokens,
        outputTokens: run.output_tokens,
        costUsd: run.cost_usd,
        models: modelsOf(run),
        elapsedMs: run.ms,
        createdAt: run.created_at,
      },
      steps: steps.map((s) => ({
        seq: s.seq,
        kind: s.kind,
        ship: s.ship,
        title: s.title,
        detail: parseDetail(s.detail),
        createdAt: s.created_at,
      })),
    });
  } catch (e) {
    return fleetErr('INTERNAL_ERROR', `run read failed: ${msg(e)}`, 500);
  }
}

// ── GET /v1/fleet/health ────────────────────────────────────────────────────

/**
 * Kill-switch state + recent-activity heartbeat. queueDepthEstimate is reserved
 * (Cloudflare Queues does not yet expose depth via API) and returns null.
 */
export async function handleFleetHealth(request: Request, env: Env): Promise<Response> {
  const denied = operatorOnly(request, env);
  if (denied) return denied;

  try {
    const [paused, lastAt] = await Promise.all([
      getFleetPaused(env.KV),
      lastFleetRunAt(env.DB),
    ]);
    const lastRunAgeSec = lastAt === null ? null : Math.floor(Date.now() / 1000) - lastAt;
    return envelope(200, {
      code: 'OK',
      error: null,
      paused,
      lastRunAgeSec,
      queueDepthEstimate: null,
    });
  } catch (e) {
    return fleetErr('INTERNAL_ERROR', `health read failed: ${msg(e)}`, 500);
  }
}

// ── GET /v1/fleet/stats ─────────────────────────────────────────────────────

interface StatAccum {
  runs: number;
  costUsd: number;
  costKnown: boolean; // false until at least one priced run contributes
  inputTokens: number;
  outputTokens: number;
}

function emptyAccum(): StatAccum {
  return { runs: 0, costUsd: 0, costKnown: false, inputTokens: 0, outputTokens: 0 };
}

function fold(acc: StatAccum, r: FleetRunRow): void {
  acc.runs += 1;
  acc.inputTokens += r.input_tokens ?? 0;
  acc.outputTokens += r.output_tokens ?? 0;
  if (r.cost_usd != null) {
    acc.costUsd += r.cost_usd;
    acc.costKnown = true;
  }
}

interface AccumWire {
  runs: number;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function accumWire(acc: StatAccum): AccumWire {
  return {
    runs: acc.runs,
    costUsd: acc.costKnown ? Math.round(acc.costUsd * 1e6) / 1e6 : null,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    totalTokens: acc.inputTokens + acc.outputTokens,
  };
}

/**
 * Aggregate PR-review statistics across recent fleet runs: overall cost/token
 * totals, per-conclusion counts, per-repo spend, and per-model usage. This is
 * the "we know statistics and cost and models and tokens for PR reviews" surface
 * the operator sees in FleetBar's Cloud Fleet view. Read-only projection.
 *
 *   GET /v1/fleet/stats?sinceSec=<epoch>&cap=<N>
 */
export async function handleFleetStats(request: Request, env: Env): Promise<Response> {
  const denied = operatorOnly(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const sinceRaw = parseInt(url.searchParams.get('sinceSec') ?? '0', 10);
  const sinceSec = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0;
  const capRaw = parseInt(url.searchParams.get('cap') ?? '1000', 10);
  const cap = Math.min(Number.isFinite(capRaw) && capRaw > 0 ? capRaw : 1000, 5000);

  try {
    const rows = await fleetRunsForStats(env.DB, sinceSec, cap);

    const totals = emptyAccum();
    const byConclusion: Record<string, number> = {};
    const byRepo = new Map<string, StatAccum & { prs: Set<number> }>();
    const byModel = new Map<string, StatAccum>();
    const distinctPrs = new Set<string>();

    for (const r of rows) {
      fold(totals, r);
      byConclusion[r.conclusion] = (byConclusion[r.conclusion] ?? 0) + 1;
      distinctPrs.add(`${r.repo_full_name}#${r.pr_number}`);

      const repo = byRepo.get(r.repo_full_name) ?? Object.assign(emptyAccum(), { prs: new Set<number>() });
      fold(repo, r);
      repo.prs.add(r.pr_number);
      byRepo.set(r.repo_full_name, repo);

      for (const model of r.models_csv ? r.models_csv.split(',').filter(Boolean) : []) {
        const m = byModel.get(model) ?? emptyAccum();
        fold(m, r);
        byModel.set(model, m);
      }
    }

    return envelope(200, {
      code: 'OK',
      error: null,
      windowSinceSec: sinceSec,
      sampled: rows.length,
      capped: rows.length >= cap,
      distinctPrsReviewed: distinctPrs.size,
      totals: accumWire(totals),
      byConclusion,
      byRepo: [...byRepo.entries()]
        .map(([repo, a]) => ({ repo, prs: a.prs.size, ...accumWire(a) }))
        .sort((x, y) => y.runs - x.runs),
      byModel: [...byModel.entries()]
        .map(([model, a]) => ({ model, ...accumWire(a) }))
        .sort((x, y) => y.runs - x.runs),
    });
  } catch (e) {
    return fleetErr('INTERNAL_ERROR', `stats read failed: ${msg(e)}`, 500);
  }
}

// ── POST /v1/fleet/pause ────────────────────────────────────────────────────

interface PauseBody {
  paused?: boolean;
}

/**
 * Toggle the fleet kill switch. The executor reads this KV flag at job START
 * (before any AI spend or GitHub post), so pausing stops new runs immediately.
 * Audited.
 */
export async function handleFleetPause(request: Request, env: Env): Promise<Response> {
  const denied = operatorOnly(request, env);
  if (denied) return denied;

  const body = await readJson<PauseBody>(request);
  if (!body || typeof body.paused !== 'boolean') {
    return fleetErr('BAD_JSON', 'Request body must be JSON {paused: boolean}', 400);
  }

  try {
    const state = await setFleetPaused(env.KV, body.paused);
    await appendAudit(env.DB, {
      action: body.paused ? 'fleet_pause' : 'fleet_resume',
      detail: 'operator toggle',
    }).catch(() => {
      /* audit is best-effort; never fail the toggle on an audit write error */
    });
    return envelope(200, { code: 'OK', error: null, ok: true, paused: state.paused });
  } catch (e) {
    return fleetErr('INTERNAL_ERROR', `pause toggle failed: ${msg(e)}`, 500);
  }
}

// ── shared ──────────────────────────────────────────────────────────────────

/** Re-hydrate a step's JSON `detail` blob; pass through non-JSON as a string. */
function parseDetail(detail: string | null): unknown {
  if (detail === null) return null;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
