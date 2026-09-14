/**
 * Stable Fleet tenant identity shared by Relay producers and queue consumers.
 *
 * GitHub names are mutable presentation data. Fleet authority instead starts
 * at an explicit Port Daddy account binding and is witnessed by GitHub's
 * immutable numeric installation, repository, and owner-account identifiers.
 * This module is deliberately small so every producer can fail closed without
 * importing another Worker's runtime.
 */

export const FLEET_RUN_JOB_SCHEMA_VERSION = 2 as const;

/**
 * Production admission remains on the legacy envelope until the executor can
 * validate every server-owned tenant coordinate before doing work.
 */
export const FLEET_RUN_JOB_V2_ACTIVATION = 'blocked-pending-executor-validation' as const;

export interface FleetTenantIdentityWitness {
  installationId: number;
  repositoryId: number;
  githubAccountId: number;
}

export interface FleetTenantBinding extends FleetTenantIdentityWitness {
  tenantAccountId: string;
}

export type FleetTenantResolution =
  | { ok: true; binding: FleetTenantBinding }
  | {
      ok: false;
      disposition: 'permanent';
      reason: 'invalid-identity' | 'unbound' | 'ambiguous' | 'github-account-mismatch' | 'invalid-binding';
    }
  | {
      ok: false;
      disposition: 'retryable';
      reason: 'lookup-failed';
    };

/** Minimal D1 read surface needed at webhook admission. */
export interface FleetTenantDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ success?: boolean; results?: T[] }>;
    };
  };
}

/**
 * Versioned queue envelope emitted only after tenant resolution.
 *
 * PURPOSE: the authority tuple is promoted out of `payloadMinimal` so a
 * consumer never needs to rediscover tenancy from mutable repository names or
 * interpret raw webhook fragments differently from Relay.
 */
export interface FleetRunJobV2 extends FleetTenantBinding {
  schemaVersion: typeof FLEET_RUN_JOB_SCHEMA_VERSION;
  deliveryId: string;
  eventType: string;
  action: string | null;
  /** Mutable display/routing hint only; never an authority key. */
  repoFullName: string | null;
  prNumber: number | null;
  payloadMinimal: {
    sender?: Record<string, unknown>;
    repository?: Record<string, unknown>;
    pull_request?: Record<string, unknown>;
    push?: Record<string, unknown>;
    merge_group?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export type FleetRunJobV2Input = Omit<
  FleetRunJobV2,
  'schemaVersion' | keyof FleetTenantBinding
>;

/**
 * Recognize a GitHub numeric identity without accepting coercible strings,
 * zero, fractions, or values outside JavaScript's lossless integer range.
 * WHY: silently rounded or coerced identifiers can bind one tenant's work to
 * a different GitHub authority coordinate.
 *
 * @param value - Untrusted value from a webhook or database row.
 * @returns True only for a positive safe integer.
 */
export function isPositiveGithubId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/**
 * Construct the explicit v2 queue envelope after a caller has resolved tenant
 * authority. WHY: keeping this pure lets producers and consumers pin the wire
 * shape before either one activates it in production.
 *
 * @param binding - Verified active tenant binding returned by the resolver.
 * @param input - Delivery metadata and bounded webhook fragments.
 * @returns A complete v2 queue job with authority promoted to top-level fields.
 */
export function buildFleetRunJobV2(
  binding: FleetTenantBinding,
  input: FleetRunJobV2Input,
): FleetRunJobV2 {
  if (typeof binding.tenantAccountId !== 'string' || binding.tenantAccountId.length === 0
    || !isPositiveGithubId(binding.installationId)
    || !isPositiveGithubId(binding.repositoryId)
    || !isPositiveGithubId(binding.githubAccountId)) {
    throw new TypeError('Cannot build FleetRunJobV2 from an invalid tenant binding');
  }
  return {
    ...input,
    schemaVersion: FLEET_RUN_JOB_SCHEMA_VERSION,
    ...binding,
  };
}

/**
 * Resolve the Port Daddy tenant behind an authenticated GitHub delivery.
 *
 * DESIGN: names never participate. The query starts from the immutable
 * `(installation_id, repository_id)` pair, requires both repository and Fleet
 * account to be active, then compares the independently supplied owner id.
 * Limiting to two makes an impossible duplicate fail closed and observable
 * rather than choosing an arbitrary tenant.
 *
 * @param db - Relay D1 binding containing the additive tenant spine.
 * @param witness - Positive numeric identities from the HMAC-verified payload.
 * @returns A verified tenant binding or a stable refusal reason.
 */
export async function resolveFleetTenantBinding(
  db: FleetTenantDb,
  witness: FleetTenantIdentityWitness,
): Promise<FleetTenantResolution> {
  if (!isPositiveGithubId(witness.installationId)
    || !isPositiveGithubId(witness.repositoryId)
    || !isPositiveGithubId(witness.githubAccountId)) {
    return { ok: false, disposition: 'permanent', reason: 'invalid-identity' };
  }

  try {
    const result = await db.prepare(
      `SELECT r.tenant_account_id, r.installation_id, r.repository_id, r.github_account_id
         FROM fleet_tenant_repositories r
         JOIN fleet_accounts a ON a.id = r.tenant_account_id
        WHERE r.installation_id = ? AND r.repository_id = ?
          AND r.active = 1 AND a.status = 'active'
        LIMIT 2`,
    ).bind(witness.installationId, witness.repositoryId).all<{
      tenant_account_id: unknown;
      installation_id: unknown;
      repository_id: unknown;
      github_account_id: unknown;
    }>();

    if (result.success === false || !Array.isArray(result.results)) {
      return { ok: false, disposition: 'retryable', reason: 'lookup-failed' };
    }
    if (result.results.length === 0) return { ok: false, disposition: 'permanent', reason: 'unbound' };
    if (result.results.length !== 1) return { ok: false, disposition: 'permanent', reason: 'ambiguous' };

    const row = result.results[0]!;
    if (typeof row.tenant_account_id !== 'string' || row.tenant_account_id.length === 0
      || !isPositiveGithubId(row.installation_id)
      || !isPositiveGithubId(row.repository_id)
      || !isPositiveGithubId(row.github_account_id)
      || row.installation_id !== witness.installationId
      || row.repository_id !== witness.repositoryId) {
      return { ok: false, disposition: 'permanent', reason: 'invalid-binding' };
    }
    if (row.github_account_id !== witness.githubAccountId) {
      return { ok: false, disposition: 'permanent', reason: 'github-account-mismatch' };
    }

    return {
      ok: true,
      binding: {
        tenantAccountId: row.tenant_account_id,
        installationId: row.installation_id,
        repositoryId: row.repository_id,
        githubAccountId: row.github_account_id,
      },
    };
  } catch {
    // A release may briefly precede its forward-only migration or D1 may be
    // unavailable. That state is not a permanent tenant refusal: the eventual
    // admission handler MUST return a retryable 5xx so GitHub redelivers. It
    // must never audit-and-204 or fall back to a name/legacy row here.
    return { ok: false, disposition: 'retryable', reason: 'lookup-failed' };
  }
}
