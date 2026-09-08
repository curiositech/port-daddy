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
 *   POST /v1/fleet/pause {paused, revision}  change the primary-D1 global control.
 *
 * Shared envelope: every response is JSON `{ code, error, ... }` to match the
 * fleet control-plane contract. Observability accepts a break-glass secret or
 * account operator role. Global writes require the Cloudflare ID allowlist,
 * an exact revision, and an atomic D1 audit. Reads never mutate Fleet state.
 */

import { fleetOperatorOnly, type FleetOperatorAuthorization } from './fleet-access.js';
import {
  lastFleetRunAt,
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
import { fleetAdminOnly } from './fleet-settings-access.js';
import { readFleetControl, writeFleetControl } from '../../../shared/fleet-controls.js';

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
    const [control, lastAt, intentHealth] = await Promise.all([
      readFleetControl(env.DB, 'global'),
      lastFleetRunAt(env.DB),
      fleetIntentHealth(env.DB),
    ]);
    const lastRunAgeSec = lastAt === null ? null : Math.floor(Date.now() / 1000) - lastAt;
    return envelope(200, {
      code: 'OK',
      error: null,
      paused: !control.enabled,
      controlRevision: control.revision,
      controlAvailable: control.available,
      lastRunAgeSec,
      // D1-known intents, not a promise of Cloudflare's exact internal queue
      // position.  The explicit estimate label prevents false precision while
      // still making the previously invisible backlog actionable.
      queueDepthEstimate: intentHealth.known === 0
        ? null
        : intentHealth.queued + intentHealth.retrying,
      running: intentHealth.running,
      retrying: intentHealth.retrying,
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
  revision?: number;
}

/**
 * Global control is allowlisted, revision-bound and atomically audited in D1.
 * Broad operator roles and break-glass secrets cannot mutate it anymore.
 */
export async function handleFleetPause(request: Request, env: Env): Promise<Response> {
  const authorization = await fleetAdminOnly(request, env);
  if (authorization instanceof Response) return authorization;

  const body = await readJson<PauseBody>(request);
  if (!body || typeof body.paused !== 'boolean' || !Number.isSafeInteger(body.revision) || body.revision! < 0) {
    return fleetErr('BAD_JSON', 'Request body must be JSON {paused: boolean, revision: nonnegative integer}', 400);
  }

  try {
    const state = await writeFleetControl(env.DB, 'global', !body.paused, body.revision!, authorization.id);
    return envelope(200, { code: 'OK', error: null, ok: true, paused: !state.enabled, revision: state.revision });
  } catch (e) {
    if (e instanceof Error && e.message === 'STALE_CONTROL') return fleetErr('STALE_CONTROL', 'Reload the current control before changing it', 409);
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
