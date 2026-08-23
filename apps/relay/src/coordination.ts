/** Worker routes for the ADR-0092 per-project coordination peer. */

import {
  isCoordinationScopeId,
  type CoordinationSyncRequest,
} from '../../../lib/coordination-ledger.js';
import {
  COORDINATION_DEFAULT_GRANT_TTL_MS,
  coordinationMacaroonFromRequest,
  mintCoordinationMacaroon,
  verifyCoordinationMacaroon,
} from './coordination-auth.js';
import { operatorOnly } from './handlers.js';
import type { Env } from './types.js';

const MAX_SYNC_BODY_BYTES = 1024 * 1024;

function error(code: string, message: string, status: number): Response {
  return Response.json({ error: message, code }, { status });
}

export function parseCoordinationProject(encoded: string): string | null {
  try {
    const project = decodeURIComponent(encoded);
    return isCoordinationScopeId(project, 200) ? project : null;
  } catch {
    return null;
  }
}

export async function handleCoordinationGrant(
  request: Request,
  env: Env,
  project: string,
): Promise<Response> {
  const authError = operatorOnly(request, env);
  if (authError) return authError;
  if (!env.COORDINATION_MACAROON_ROOT_KEY_HEX) {
    return error('COORDINATION_UNCONFIGURED', 'Coordination macaroon root key is not configured', 503);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error('BAD_JSON', 'Request body must be JSON', 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return error('VALIDATION_ERROR', 'Grant body must be an object', 400);
  }
  const input = body as Record<string, unknown>;
  const actorId = input.actor_id;
  if (!isCoordinationScopeId(actorId)) {
    return error('VALIDATION_ERROR', 'actor_id must be a coordination scope id', 400);
  }
  const ttlSeconds = input.ttl_seconds === undefined
    ? COORDINATION_DEFAULT_GRANT_TTL_MS / 1000
    : Number(input.ttl_seconds);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return error('VALIDATION_ERROR', 'ttl_seconds must be a positive number', 400);
  }
  try {
    const grant = mintCoordinationMacaroon(
      env.COORDINATION_MACAROON_ROOT_KEY_HEX,
      project,
      actorId,
      {
        ttlMs: Math.floor(ttlSeconds * 1000),
        location: `${new URL(request.url).origin}/v1/coordination/${encodeURIComponent(project)}`,
      },
    );
    return Response.json({
      macaroon: grant.token,
      project,
      actor_id: actorId,
      verb: 'coordination-sync',
      expires_at: grant.expiresAt,
    });
  } catch (cause) {
    return error('COORDINATION_UNCONFIGURED', (cause as Error).message, 503);
  }
}

export async function handleCoordinationSync(
  request: Request,
  env: Env,
  project: string,
): Promise<Response> {
  if (!env.COORDINATION_ROOM || !env.COORDINATION_MACAROON_ROOT_KEY_HEX) {
    return error('COORDINATION_UNCONFIGURED', 'Coordination room or macaroon gate is not configured', 503);
  }
  const declaredSize = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declaredSize) && declaredSize > MAX_SYNC_BODY_BYTES) {
    return error('PAYLOAD_TOO_LARGE', 'Coordination sync body exceeds 1 MiB', 413);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_SYNC_BODY_BYTES) {
    return error('PAYLOAD_TOO_LARGE', 'Coordination sync body exceeds 1 MiB', 413);
  }
  let body: CoordinationSyncRequest;
  try {
    body = JSON.parse(raw) as CoordinationSyncRequest;
  } catch {
    return error('BAD_JSON', 'Request body must be JSON', 400);
  }
  if (
    typeof body?.actorId !== 'string'
    || typeof body?.replicaId !== 'string'
    || !Array.isArray(body?.operations)
  ) {
    return error('VALIDATION_ERROR', 'Malformed coordination sync envelope', 400);
  }
  if (body.actorId !== body.replicaId) {
    return error('SCOPE_MISMATCH', 'actorId and replicaId must match for this peer grant', 403);
  }
  if (body.operations.some((operation) => operation?.project !== project)) {
    return error('SCOPE_MISMATCH', 'Every operation must match the room project', 403);
  }
  const token = coordinationMacaroonFromRequest(request);
  if (!token) return error('UNAUTHORIZED', 'Coordination macaroon required', 401);
  const grant = verifyCoordinationMacaroon(token, env.COORDINATION_MACAROON_ROOT_KEY_HEX, {
    project,
    actorId: body.actorId,
    nowMs: Date.now(),
  });
  if (!grant.authorized) return error('UNAUTHORIZED', grant.reason, 401);

  const id = env.COORDINATION_ROOM.idFromName(project);
  const stub = env.COORDINATION_ROOM.get(id);
  return stub.fetch('https://coordination-room.invalid/?action=sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  });
}
