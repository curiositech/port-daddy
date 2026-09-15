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
 *   POST /v1/fleet/pause             commit pause, or resume with revision + request ID
 *                                     at job START, before any AI spend.
 *
 * Shared envelope: every response is JSON `{ code, error, ... }` to match the
 * fleet control-plane contract. The gate accepts either the break-glass secret
 * or an account-backed operator role. Reads NEVER mutate fleet state; pause
 * writes the serialized control object plus audit.
 */

import { fleetOperatorOnly, type FleetOperatorAuthorization } from './fleet-access.js';
import {
  lastFleetRunAt,
  getFleetControl,
  setFleetPaused,
  appendAudit,
} from './db.js';
import {
  deleteFleetRunProjection,
  fleetIntentHealth,
  getFleetRunProjectionWithSteps,
  listFleetRunProjections,
  type FleetRunProjection,
} from './fleet-run-intents.js';
import type { Env } from './types.js';

// ── Envelope helpers ──────────────────────────────────────────────────────────

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/;

function envelope(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

function fleetErr(code: string, error: string, status: number): Response {
  return envelope(status, { code, error });
}

const LEGACY_FLEET_PAUSE_KEY = 'fleet:paused';

/**
 * Read the rollback-era KV projection as a deny-only witness. A readable false
 * never authorizes work without the Durable Object; true, absent, malformed,
 * and unreadable values keep health visibly blocked during mixed-version
 * rollout.
 */
async function readLegacyFleetPauseProjection(
  kv: KVNamespace,
): Promise<'paused' | 'unpaused' | 'unknown'> {
  try {
    const raw = await kv.get(LEGACY_FLEET_PAUSE_KEY);
    if (raw === 'true') return 'paused';
    if (raw === 'false') return 'unpaused';
    if (!raw) return 'unknown';
    const parsed = JSON.parse(raw) as unknown;
    const paused = typeof parsed === 'object'
      && parsed !== null
      && !Array.isArray(parsed)
      ? (parsed as { paused?: unknown }).paused
      : undefined;
    return typeof paused === 'boolean' ? (paused ? 'paused' : 'unpaused') : 'unknown';
  } catch {
    return 'unknown';
  }
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

/** Project a stored run row into the wire shape (short SHA, ships array). */
function runForList(r: FleetRunProjection): Record<string, unknown> {
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
    elapsedMs: r.ms,
    createdAt: r.created_at,
    state: r.logical_state,
    generation: r.generation,
    attemptCount: r.attempt_count,
    queuedAt: r.queued_at,
    startedAt: r.started_at,
    lastProgressAt: r.last_progress_at,
    finishedAt: r.finished_at,
    expectedStartAt: r.expected_start_at,
    expectedFinishAt: r.expected_finish_at,
    queueAheadEstimate: r.queue_ahead_estimate,
    hasTranscript: r.has_transcript,
    supersededBy: r.superseded_by,
    lastError: r.last_error,
  };
}

// ── GET /v1/fleet/activity ──────────────────────────────────────────────────

/** Recent fleet runs, newest first. Each carries pr_url for hyperlinking. */
export async function handleFleetActivity(request: Request, env: Env): Promise<Response> {
  const authorization = await fleetOperatorOnly(request, env);
  if (authorization instanceof Response) return authorization;

  const url = new URL(request.url);
  const raw = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Math.min(Number.isFinite(raw) && raw > 0 ? raw : 50, 500);

  try {
    const rows = await listFleetRunProjections(env.DB, limit);
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
  const authorization = await fleetOperatorOnly(request, env);
  if (authorization instanceof Response) return authorization;

  if (!runId || !isSafeRunId(runId)) {
    return fleetErr('BAD_REQUEST', 'run id required', 400);
  }

  try {
    const found = await getFleetRunProjectionWithSteps(env.DB, runId);
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
        elapsedMs: run.ms,
        createdAt: run.created_at,
        state: run.logical_state,
        generation: run.generation,
        attemptCount: run.attempt_count,
        queuedAt: run.queued_at,
        startedAt: run.started_at,
        lastProgressAt: run.last_progress_at,
        finishedAt: run.finished_at,
        expectedStartAt: run.expected_start_at,
        expectedFinishAt: run.expected_finish_at,
        queueAheadEstimate: run.queue_ahead_estimate,
        hasTranscript: run.has_transcript,
        supersededBy: run.superseded_by,
        lastError: run.last_error,
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
  const authorization = await fleetOperatorOnly(request, env);
  if (authorization instanceof Response) return authorization;

  try {
    const [control, lastAt, intentHealth, legacyProjection] = await Promise.all([
      getFleetControl(env),
      lastFleetRunAt(env.DB),
      fleetIntentHealth(env.DB),
      readLegacyFleetPauseProjection(env.KV),
    ]);
    // The projection is a deny-only witness. It cannot make an unknown or
    // canonical pause look healthy, and a readable false cannot authorize
    // without the Durable Object. Any non-ON projection keeps a canonical ON
    // visibly blocked until the two authorities converge.
    const legacyReadbackMismatch = control.status === 'unpaused'
      && legacyProjection !== 'unpaused';
    const lastRunAgeSec = lastAt === null ? null : Math.floor(Date.now() / 1000) - lastAt;
    return envelope(200, {
      code: 'OK',
      error: null,
      paused: legacyReadbackMismatch ? null : control.paused,
      pauseStatus: legacyReadbackMismatch ? 'unknown' : control.status,
      pauseRevision: legacyReadbackMismatch ? null : control.revision,
      automationBlocked: control.status !== 'unpaused' || legacyReadbackMismatch,
      lastRunAgeSec,
      // D1-known intents, not a promise of Cloudflare's exact internal queue
      // position.  The explicit estimate label prevents false precision while
      // still making the previously invisible backlog actionable.
      queueDepthEstimate: intentHealth.known === 0
        ? null
        : intentHealth.queued + intentHealth.retrying,
      running: intentHealth.running,
      retrying: intentHealth.retrying,
      waitingForControl: intentHealth.waitingForControl,
      superseded: intentHealth.superseded,
      failedAdmission: intentHealth.failedAdmission,
      oldestQueuedAgeSec: intentHealth.oldestQueuedAgeSec,
      knownIntents: intentHealth.known,
    });
  } catch (e) {
    return fleetErr('INTERNAL_ERROR', `health read failed: ${msg(e)}`, 500);
  }
}

// ── POST /v1/fleet/pause ────────────────────────────────────────────────────

interface PauseBody {
  paused?: boolean;
  expectedRevision?: number;
  requestId?: string;
}

/**
 * Commit the pause before acknowledging it. Each new ship admission consults
 * the same object. A ship already admitted may finish its bounded work.
 */
export async function handleFleetPause(request: Request, env: Env): Promise<Response> {
  const authorization = await fleetOperatorOnly(request, env);
  if (authorization instanceof Response) return authorization;

  const body = await readJson<PauseBody>(request);
  if (!body || typeof body.paused !== 'boolean') {
    return fleetErr('BAD_JSON', 'Request body must be JSON {paused: boolean}', 400);
  }
  if (!body.paused && (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1
      || typeof body.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(body.requestId))) {
    return fleetErr('RESUME_PRECONDITION_REQUIRED', 'Resume requires the observed pauseRevision and a unique requestId.', 400);
  }

  try {
    const state = await setFleetPaused(env, body.paused, body.paused ? undefined : {
      expectedRevision: body.expectedRevision!, requestId: body.requestId!,
    });
    await appendAudit(env.DB, {
      action: body.paused ? 'fleet_pause' : 'fleet_resume',
      detail: operatorAuditDetail(authorization, body.paused ? 'pause' : 'resume'),
    }).catch(() => {
      /* audit is best-effort; never fail the toggle on an audit write error */
    });
    return envelope(200, { code: 'OK', error: null, ok: true, paused: state.paused,
      pauseStatus: state.status, pauseRevision: state.revision });
  } catch (e) {
    if (!body.paused) return fleetErr('RESUME_CONFLICT', `Resume refused: ${msg(e)}`, 409);
    return fleetErr('INTERNAL_ERROR', `pause toggle failed: ${msg(e)}`, 500);
  }
}

// ── DELETE /v1/fleet/runs/:id ─────────────────────────────────────────────────

/**
 * Delete one run + its transcript (ADR-0101 export/delete per-tier — the repo
 * tier's delete control). Operator-gated; the JSON read side already serves the
 * export (GET /v1/fleet/runs/:id). Idempotent: deleting an unknown id is a 404,
 * a deleted one reports deleted:0.
 */
export async function handleDeleteFleetRun(
  request: Request,
  env: Env,
  runId: string,
): Promise<Response> {
  const authorization = await fleetOperatorOnly(request, env);
  if (authorization instanceof Response) return authorization;
  if (!runId || !isSafeRunId(runId)) {
    return fleetErr('BAD_REQUEST', 'run id required', 400);
  }
  try {
    const removed = await deleteFleetRunProjection(env.DB, runId);
    if (removed === 0) return fleetErr('NOT_FOUND', `Run ${runId} not found`, 404);
    await appendAudit(env.DB, {
      action: 'fleet_run_delete',
      target: runId,
      detail: operatorAuditDetail(authorization, 'delete-run'),
    }).catch(
      () => {
        /* best-effort audit */
      },
    );
    return envelope(200, { code: 'OK', error: null, deleted: removed });
  } catch (e) {
    return fleetErr('INTERNAL_ERROR', `run delete failed: ${msg(e)}`, 500);
  }
}

// ── shared ──────────────────────────────────────────────────────────────────

/** Durable actor attribution without ever copying bearer/token material. */
function operatorAuditDetail(
  authorization: FleetOperatorAuthorization,
  operation: 'pause' | 'resume' | 'delete-run',
): string {
  return JSON.stringify(
    authorization.kind === 'account'
      ? {
          source: 'account',
          operation,
          actor: {
            userId: authorization.userId,
            githubUserId: authorization.githubUserId,
          },
        }
      : { source: 'break-glass', operation },
  );
}

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
