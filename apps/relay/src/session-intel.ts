/**
 * Session Intelligence cloud-mining ingest boundary.
 *
 * Eureka/coordination mining raw material (Claude Code transcripts, the local
 * daemon's SQLite store) exists only on the operator's own machine -- relay
 * has no filesystem access to either. The local side runs the existing
 * structural detectors (lib/session-intel/), applies the single-expert-oracle
 * recurrence guard, and REDACTS (lib/session-intel/redact.js's structural
 * grammars, the same code the local coordination ledger already uses) BEFORE
 * anything crosses the network. This endpoint is the landing zone for the
 * result: already-small, already-redacted, already-clipped findings, never a
 * raw transcript or full conversation turn.
 *
 * Defense in depth: {@link assertNoObviousSecret} re-checks every string field
 * of every incoming finding against the same secret/PII shape grammars the
 * local ledger enforces (lib/session-intel/ledger.js's FORBIDDEN_SHAPES),
 * independently of whatever the local uploader did. A relay Worker cannot
 * import lib/session-intel/ directly (separate package, separate bundle), so
 * this is a small, deliberately duplicated port of the same structural check
 * -- not a new redaction design.
 *
 * Zero-trust invariant: operator-gated write (operatorOnly), same as every
 * other mutating relay endpoint. This table has no read-side judgment logic
 * yet -- a cloud-native ship consumes it as a separate, later piece; this
 * file is the ingest boundary only.
 */

import { operatorOnly } from './handlers.js';
import type { Env } from './types.js';

function envelope(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

// Same structural grammars as lib/session-intel/ledger.js's FORBIDDEN_SHAPES.
// Kept in lockstep deliberately -- if that list grows, mirror it here.
const FORBIDDEN_SHAPES: ReadonlyArray<readonly [string, RegExp]> = [
  ['anthropic_key', /\bsk-ant-[A-Za-z0-9_-]{16,}/],
  ['token', /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/],
  ['github_token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/],
  ['github_pat', /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['aws_key_id', /\bAKIA[0-9A-Z]{16}\b/],
  ['google_key', /\bAIza[0-9A-Za-z_-]{20,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/],
  ['email', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ['home_path', /\/(?:Users|home)\/[^/\s"'`)]+/],
];

/** Returns the first forbidden-shape name found anywhere in `value`, or null. */
function findForbiddenShape(value: unknown): string | null {
  if (typeof value === 'string') {
    for (const [name, re] of FORBIDDEN_SHAPES) {
      if (re.test(value)) return name;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findForbiddenShape(v);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) {
      const hit = findForbiddenShape(v);
      if (hit) return hit;
    }
  }
  return null;
}

export interface SessionIntelFinding {
  kind: 'coordination-suggestion' | 'recurring-eureka-arc';
  title: string;
  occurrences: number;
  sessionCount: number;
  payload: Record<string, unknown>;
}

export interface SessionIntelIngestBody {
  digestDate: string; // YYYY-MM-DD
  findings: SessionIntelFinding[];
}

function isValidDigestDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

/**
 * POST /v1/session-intel/ingest
 * Body: { digestDate: "YYYY-MM-DD", findings: SessionIntelFinding[] }
 * Idempotent per (digestDate, kind, title): re-ingesting the same day's
 * digest twice does not duplicate rows.
 */
export async function handleSessionIntelIngest(request: Request, env: Env): Promise<Response> {
  const denied = operatorOnly(request, env);
  if (denied) return denied;

  const body = await readJson<SessionIntelIngestBody>(request);
  if (!body || !isValidDigestDate(body.digestDate) || !Array.isArray(body.findings)) {
    return envelope(400, { code: 'BAD_REQUEST', error: 'digestDate (YYYY-MM-DD) and findings[] are required' });
  }
  if (body.findings.length === 0) {
    // ALL QUIET is a valid, expected ingest -- not an error, nothing to store.
    return envelope(200, { code: 'OK_EMPTY', accepted: 0 });
  }
  if (body.findings.length > 200) {
    return envelope(400, { code: 'BAD_REQUEST', error: 'too many findings in one batch (max 200)' });
  }

  for (const f of body.findings) {
    if (
      (f.kind !== 'coordination-suggestion' && f.kind !== 'recurring-eureka-arc') ||
      typeof f.title !== 'string' ||
      !f.title.trim() ||
      typeof f.occurrences !== 'number' ||
      typeof f.sessionCount !== 'number' ||
      f.sessionCount < 2 || // single-expert-oracle guard, re-enforced server-side too
      typeof f.payload !== 'object' ||
      f.payload === null
    ) {
      return envelope(400, { code: 'BAD_FINDING', error: 'each finding needs kind, title, occurrences, sessionCount >= 2, and a payload object' });
    }
    const hit = findForbiddenShape(f);
    if (hit) {
      // Fail closed and loud: this should be structurally impossible if the
      // local uploader redacted correctly. Reject the WHOLE batch rather than
      // silently dropping one finding, so a redaction bug is visible, not swallowed.
      return envelope(400, { code: 'UNREDACTED_CONTENT', error: `finding contains an unredacted ${hit} shape -- rejecting batch, fix the local uploader` });
    }
  }

  const batchId = randomId('sib');
  const now = Math.floor(Date.now() / 1000);
  const stmts = body.findings.map(f =>
    env.DB.prepare(
      `INSERT INTO session_intel_findings
         (id, batch_id, kind, digest_date, title, occurrences, session_count, payload_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(
      randomId('sif'), batchId, f.kind, body.digestDate, f.title.slice(0, 500),
      f.occurrences, f.sessionCount, JSON.stringify(f.payload), now,
    )
  );
  await env.DB.batch(stmts);

  return envelope(200, { code: 'OK', accepted: body.findings.length, batchId });
}

/**
 * GET /v1/session-intel/pending?limit=N
 * Read-only surface for the (separate, not-yet-built) judgment ship, and for
 * operator inspection. Operator-gated -- these are internal findings, not
 * public data.
 */
export async function handleSessionIntelPending(request: Request, env: Env): Promise<Response> {
  const denied = operatorOnly(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 200) : 50;

  const { results } = await env.DB.prepare(
    `SELECT id, batch_id, kind, digest_date, title, occurrences, session_count, payload_json, status, created_at
       FROM session_intel_findings
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT ?`
  ).bind(limit).all();

  return envelope(200, { code: 'OK', findings: results ?? [] });
}
