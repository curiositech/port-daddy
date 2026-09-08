/**
 * Durable HITL escalation for Fleet agents.
 *
 * A blocking degradation is not "reported" until Relay returns the exact
 * OperatorInterruption row. Callers await this function and include the
 * receipt in their transcript. Missing configuration, transport ambiguity,
 * non-2xx responses, and malformed success bodies all fail loudly.
 */

import type {
  CoordinationGrantServiceContract,
  FleetInterruptionGrant,
  FleetInterruptionGrantRequest,
} from '../../../lib/coordination-grant-contract.js';

export type InterruptionUrgency = 'low' | 'normal' | 'high' | 'critical';

export interface InterruptionAsk {
  /** Short human headline, <=200 chars (relay-enforced). */
  title: string;
  /** What happened + what the operator must do, <=4000 chars. */
  body: string;
  urgency: InterruptionUrgency;
  /** Canonical Fleet producer stamped into the Relay-issued capability. */
  sourceAgent: string;
  /** Durable run or issue identity so the ask links back to evidence. */
  sourceSession: string;
  /** GitHub App installation the degradation occurred under. */
  installationId?: number;
}

/** The minimal remote executor transport surface. */
export interface InterruptionEnv {
  INTERRUPTIONS_URL?: string;
  /** Non-secret GitHub id of the operator whose Relay tenant receives asks. */
  INTERRUPTIONS_OPERATOR_GITHUB_USER_ID?: string;
  /** RPC-only Relay issuer; its root key never enters the executor. */
  COORDINATION_GRANTS?: Pick<CoordinationGrantServiceContract, 'mintInterruptionGrant'>;
}

export interface InterruptionReceipt {
  durable: true;
  interruptionId: string;
  requestKey: string;
  replayed: boolean;
}

export class InterruptionDeliveryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'InterruptionDeliveryError';
  }
}

const DELIVERY_TIMEOUT_MS = 10_000;
const GRANT_TTL_SECONDS = 60;
const MIN_REMAINING_GRANT_LIFETIME_MS = 5_000;
const MAX_GRANT_CLOCK_SKEW_MS = 5_000;
const RELAY_USER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;

async function requestKey(ask: InterruptionAsk): Promise<string> {
  const material = JSON.stringify([
    'pd.operator-interruption.v1',
    ask.sourceAgent,
    ask.sourceSession ?? null,
    ask.title,
    ask.body,
    ask.urgency,
    ask.installationId ?? null,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `pd_oi_${hex}`;
}

async function requestFingerprint(ask: InterruptionAsk): Promise<string> {
  const material = JSON.stringify([
    'pd.operator-interruption.fingerprint.v1',
    ask.title,
    ask.body,
    ask.urgency,
    ask.sourceAgent,
    ask.sourceSession ?? null,
    ask.installationId ?? null,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

interface RelayEnvelope {
  code?: string;
  error?: string | null;
  replayed?: boolean;
  interruption?: {
    id?: string;
    requestKey?: string | null;
    requestFingerprint?: string | null;
    installationId?: number | null;
    sourceAgent?: string;
    sourceSession?: string | null;
    title?: string;
    body?: string;
    urgency?: string;
  };
}

function parseOperatorGithubUserId(raw: string | undefined): number | null {
  const value = raw?.trim() ?? '';
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validateGrant(
  grant: FleetInterruptionGrant,
  expected: FleetInterruptionGrantRequest,
  requestedAt: number,
): FleetInterruptionGrant {
  if (!grant || typeof grant !== 'object') {
    throw new InterruptionDeliveryError(
      'Relay returned no interruption capability',
      'INTERRUPTION_GRANT_MISSING',
    );
  }
  if (
    grant.sourceAgent !== expected.sourceAgent
    || grant.sourceSession !== expected.sourceSession
    || grant.requestKey !== expected.requestKey
    || grant.requestFingerprint !== expected.requestFingerprint
    || grant.verb !== 'operator-interruption:create'
    || typeof grant.userId !== 'string'
    || !RELAY_USER_ID_RE.test(grant.userId)
  ) {
    throw new InterruptionDeliveryError(
      'Relay returned an interruption capability for a different exact scope',
      'INTERRUPTION_GRANT_MISMATCH',
    );
  }
  if (typeof grant.macaroon !== 'string' || grant.macaroon.trim().length === 0) {
    throw new InterruptionDeliveryError(
      'Relay returned an empty interruption capability',
      'INTERRUPTION_GRANT_MISSING',
    );
  }
  const now = Date.now();
  if (
    !Number.isSafeInteger(grant.expiresAt)
    || grant.expiresAt <= now + MIN_REMAINING_GRANT_LIFETIME_MS
    || grant.expiresAt > requestedAt + GRANT_TTL_SECONDS * 1000 + MAX_GRANT_CLOCK_SKEW_MS
  ) {
    throw new InterruptionDeliveryError(
      'Relay returned an expired or over-broad interruption capability',
      'INTERRUPTION_GRANT_INVALID',
    );
  }
  return { ...grant, macaroon: grant.macaroon.trim() };
}

/**
 * Files one exact, idempotent interruption and returns Relay's durable row.
 * A caller may retry the same ask safely after an ambiguous transport result.
 */
export async function emitInterruption(
  env: InterruptionEnv,
  ask: InterruptionAsk,
  fetchImpl: typeof fetch = fetch,
): Promise<InterruptionReceipt> {
  const url = env.INTERRUPTIONS_URL?.trim() ?? '';
  const operatorGithubUserId = parseOperatorGithubUserId(
    env.INTERRUPTIONS_OPERATOR_GITHUB_USER_ID,
  );
  if (!url || !operatorGithubUserId || !env.COORDINATION_GRANTS) {
    throw new InterruptionDeliveryError(
      'Operator interruption transport is not configured: URL, operator identity, and Relay grant service are all required',
      'INTERRUPTION_TRANSPORT_UNCONFIGURED',
    );
  }

  const stableRequestKey = await requestKey(ask);
  const expectedFingerprint = await requestFingerprint(ask);
  const grantRequest: FleetInterruptionGrantRequest = {
    operatorGithubUserId,
    sourceAgent: ask.sourceAgent,
    sourceSession: ask.sourceSession,
    requestKey: stableRequestKey,
    requestFingerprint: expectedFingerprint,
    ttlSeconds: GRANT_TTL_SECONDS,
  };
  const grantRequestedAt = Date.now();
  let grant: FleetInterruptionGrant;
  try {
    grant = validateGrant(
      await env.COORDINATION_GRANTS.mintInterruptionGrant(grantRequest),
      grantRequest,
      grantRequestedAt,
    );
  } catch (error) {
    if (error instanceof InterruptionDeliveryError) throw error;
    throw new InterruptionDeliveryError(
      `Relay interruption capability is unproven: ${error instanceof Error ? error.message : String(error)}`,
      'INTERRUPTION_GRANT_UNPROVEN',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Macaroon ${grant.macaroon}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: ask.title,
        body: ask.body,
        urgency: ask.urgency,
        ...(typeof ask.installationId === 'number' ? { installation_id: ask.installationId } : {}),
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as RelayEnvelope;
    if (!response.ok) {
      throw new InterruptionDeliveryError(
        payload.error || `Operator interruption delivery failed (HTTP ${response.status})`,
        payload.code || 'INTERRUPTION_DELIVERY_FAILED',
        response.status,
      );
    }
    const interruptionId = payload.interruption?.id?.trim() ?? '';
    if (!interruptionId) {
      throw new InterruptionDeliveryError(
        'Relay accepted the interruption without returning its durable row',
        'INTERRUPTION_RECEIPT_MISSING',
        response.status,
      );
    }
    const row = payload.interruption!;
    if (
      row.requestKey !== stableRequestKey
      || row.requestFingerprint !== expectedFingerprint
      || row.sourceAgent !== ask.sourceAgent
      || row.sourceSession !== (ask.sourceSession ?? null)
      || row.title !== ask.title
      || row.body !== ask.body
      || row.urgency !== ask.urgency
      || row.installationId !== (ask.installationId ?? null)
    ) {
      throw new InterruptionDeliveryError(
        'Relay returned an interruption that does not match the submitted ask',
        'INTERRUPTION_RECEIPT_MISMATCH',
        response.status,
      );
    }
    return {
      durable: true,
      interruptionId,
      requestKey: stableRequestKey,
      replayed: payload.replayed === true,
    };
  } catch (error) {
    if (error instanceof InterruptionDeliveryError) throw error;
    throw new InterruptionDeliveryError(
      `Operator interruption delivery is unproven: ${error instanceof Error ? error.message : String(error)}`,
      'INTERRUPTION_DELIVERY_UNPROVEN',
    );
  } finally {
    clearTimeout(timeout);
  }
}
