/**
 * Account-backed Cloud Fleet operator authorization (ADR-0101 Phase 1).
 *
 * Native clients authenticate with a revocable pdu_ account token; they must
 * never receive the relay's break-glass operator secret. Authority is a
 * separate server-owned user_roles row. The configured initial owner's durable
 * GitHub id is materialized into that ledger on first use so already-issued
 * device tokens start working immediately after deployment.
 */

import { grantUserRole, hasUserRole, resolveUserToken, type UserRow } from './db.js';
import { hashHex } from './crypto.js';
import { readBearerToken } from './device-flow.js';
import { operatorOnly } from './handlers.js';
import type { Env } from './types.js';

function json(status: number, code: string, error: string): Response {
  return Response.json({ code, error }, { status });
}

/** Parse the configured owner id strictly; malformed config never grants. */
function configuredOwnerGithubUserId(env: Env): number | null {
  const raw = env.RELAY_OPERATOR_GITHUB_USER_ID?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Resolve durable operator authority for an already-authenticated user.
 *
 * Existing role rows remain authoritative. The one bootstrap path compares the
 * trusted server var with GitHub's durable numeric id, then records provenance
 * before allowing the request.
 */
async function userIsFleetOperator(user: UserRow, env: Env): Promise<boolean> {
  if (await hasUserRole(env.DB, user.id, 'operator')) return true;
  if (configuredOwnerGithubUserId(env) !== user.github_user_id) return false;
  await grantUserRole(
    env.DB,
    user.id,
    'operator',
    'configured-github-owner',
    Math.floor(Date.now() / 1000),
  );
  return true;
}

/**
 * Gate Cloud Fleet reads and controls with either break-glass or account auth.
 *
 * @returns Null when authorized; otherwise a complete fail-closed response.
 */
export async function fleetOperatorOnly(request: Request, env: Env): Promise<Response | null> {
  const breakGlassDenied = operatorOnly(request, env);
  if (breakGlassDenied === null) return null;

  // ADR-0101 grants this path specifically to user_tokens bearers. Do not
  // accept browser cookies on pause/delete controls: that would widen the CSRF
  // boundary of native operator access.
  const bearer = readBearerToken(request);
  if (!bearer) return breakGlassDenied;

  let user: UserRow | null;
  try {
    user = await resolveUserToken(env.DB, hashHex(bearer), Math.floor(Date.now() / 1000));
  } catch {
    return json(503, 'FLEET_AUTH_UNAVAILABLE', 'Cloud Fleet authorization is temporarily unavailable');
  }
  if (!user) return breakGlassDenied;

  try {
    if (await userIsFleetOperator(user, env)) return null;
  } catch {
    return json(503, 'FLEET_AUTH_UNAVAILABLE', 'Cloud Fleet authorization is temporarily unavailable');
  }
  return json(403, 'FORBIDDEN', 'This account is not a Cloud Fleet operator');
}
