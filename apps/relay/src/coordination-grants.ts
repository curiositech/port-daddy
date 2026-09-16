/** Narrow internal grant contract for ADR-0092 Fleet coordination peers. */

import { isCoordinationScopeId } from '../../../lib/coordination-ledger.js';
import type {
  FleetCoordinationGrant,
  FleetCoordinationGrantRequest,
  FleetInterruptionGrant,
  FleetInterruptionGrantRequest,
} from '../../../lib/coordination-grant-contract.js';
import {
  COORDINATION_SYNC_VERB,
  INTERRUPTION_CREATE_VERB,
  mintCoordinationMacaroon,
  mintInterruptionMacaroon,
} from './coordination-auth.js';
import type { Env } from './types.js';

export const FLEET_COORDINATION_GRANT_DEFAULT_TTL_SECONDS = 30 * 60;
export const FLEET_COORDINATION_GRANT_MIN_TTL_SECONDS = 60;
export const FLEET_COORDINATION_GRANT_MAX_TTL_SECONDS = 60 * 60;

export type {
  FleetCoordinationGrant,
  FleetCoordinationGrantRequest,
  FleetInterruptionGrant,
  FleetInterruptionGrantRequest,
} from '../../../lib/coordination-grant-contract.js';

/**
 * Mint one attenuated capability for a verified Fleet run.
 *
 * This is deliberately separate from the public operator endpoint. The caller
 * supplies only tenant context; the root key remains inside Relay.
 */
export function mintFleetCoordinationGrant(
  env: Pick<Env, 'COORDINATION_MACAROON_ROOT_KEY_HEX'>,
  input: unknown,
  nowMs = Date.now(),
): FleetCoordinationGrant {
  if (!env.COORDINATION_MACAROON_ROOT_KEY_HEX) {
    throw new Error('coordination macaroon gate is not configured');
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('coordination grant input must be an object');
  }

  const request = input as Record<string, unknown>;
  if (!isCoordinationScopeId(request.project, 200)) {
    throw new Error('invalid coordination project');
  }
  if (!isCoordinationScopeId(request.actorId)) {
    throw new Error('invalid coordination actor');
  }
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new Error('invalid coordination grant clock');
  }

  const ttlSeconds = request.ttlSeconds === undefined
    ? FLEET_COORDINATION_GRANT_DEFAULT_TTL_SECONDS
    : request.ttlSeconds;
  if (
    !Number.isSafeInteger(ttlSeconds)
    || Number(ttlSeconds) < FLEET_COORDINATION_GRANT_MIN_TTL_SECONDS
    || Number(ttlSeconds) > FLEET_COORDINATION_GRANT_MAX_TTL_SECONDS
  ) {
    throw new Error(
      `coordination grant ttlSeconds must be an integer between ${FLEET_COORDINATION_GRANT_MIN_TTL_SECONDS} and ${FLEET_COORDINATION_GRANT_MAX_TTL_SECONDS}`,
    );
  }

  const project = request.project;
  const actorId = request.actorId;
  const grant = mintCoordinationMacaroon(
    env.COORDINATION_MACAROON_ROOT_KEY_HEX,
    project,
    actorId,
    {
      nowMs,
      ttlMs: Number(ttlSeconds) * 1000,
      location: `pd://relay/coordination/${encodeURIComponent(project)}`,
    },
  );

  return {
    macaroon: grant.token,
    project,
    actorId,
    verb: COORDINATION_SYNC_VERB,
    expiresAt: grant.expiresAt,
  };
}

/**
 * Resolve the configured operator to one durable Relay tenant and mint a
 * create-only capability for one exact Fleet ask. The service binding is the
 * trust boundary: no public HTTP caller can invoke this issuer.
 */
export async function mintFleetInterruptionGrant(
  env: Pick<Env, 'COORDINATION_MACAROON_ROOT_KEY_HEX' | 'DB'>,
  input: unknown,
  nowMs = Date.now(),
): Promise<FleetInterruptionGrant> {
  if (!env.COORDINATION_MACAROON_ROOT_KEY_HEX) {
    throw new Error('interruption macaroon gate is not configured');
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('interruption grant input must be an object');
  }
  const request = input as Record<string, unknown>;
  if (!Number.isSafeInteger(request.operatorGithubUserId) || Number(request.operatorGithubUserId) <= 0) {
    throw new Error('invalid interruption operator GitHub user id');
  }
  const sourceAgent = typeof request.sourceAgent === 'string' ? request.sourceAgent : '';
  const sourceSession = typeof request.sourceSession === 'string' ? request.sourceSession : '';
  const requestKey = typeof request.requestKey === 'string' ? request.requestKey : '';
  const requestFingerprint = typeof request.requestFingerprint === 'string' ? request.requestFingerprint : '';
  const ttlSeconds = request.ttlSeconds === undefined ? 60 : Number(request.ttlSeconds);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 10 || ttlSeconds > 300) {
    throw new Error('interruption grant ttlSeconds must be an integer between 10 and 300');
  }
  const users = await env.DB.prepare(
    'SELECT id FROM users WHERE github_user_id = ? AND deleted_at IS NULL LIMIT 2',
  ).bind(request.operatorGithubUserId).all<{ id: string }>();
  if (users.results.length !== 1) {
    throw new Error('configured Fleet operator does not resolve to exactly one Relay account');
  }
  const userId = users.results[0]!.id;
  const grant = mintInterruptionMacaroon(
    env.COORDINATION_MACAROON_ROOT_KEY_HEX,
    {
      verb: INTERRUPTION_CREATE_VERB,
      userId,
      sourceAgent,
      sourceSession,
      requestKey,
      requestFingerprint,
    },
    { nowMs, ttlMs: ttlSeconds * 1000 },
  );
  return {
    macaroon: grant.token,
    userId,
    sourceAgent,
    sourceSession,
    requestKey,
    requestFingerprint,
    verb: INTERRUPTION_CREATE_VERB,
    expiresAt: grant.expiresAt,
  };
}
