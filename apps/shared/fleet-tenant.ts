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
      reason: 'invalid-identity' | 'unbound' | 'ambiguous' | 'github-account-mismatch' | 'invalid-binding' | 'lookup-failed';
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
    return { ok: false, reason: 'invalid-identity' };
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
      return { ok: false, reason: 'lookup-failed' };
    }
    if (result.results.length === 0) return { ok: false, reason: 'unbound' };
    if (result.results.length !== 1) return { ok: false, reason: 'ambiguous' };

    const row = result.results[0]!;
    if (typeof row.tenant_account_id !== 'string' || row.tenant_account_id.length === 0
      || !isPositiveGithubId(row.installation_id)
      || !isPositiveGithubId(row.repository_id)
      || !isPositiveGithubId(row.github_account_id)
      || row.installation_id !== witness.installationId
      || row.repository_id !== witness.repositoryId) {
      return { ok: false, reason: 'invalid-binding' };
    }
    if (row.github_account_id !== witness.githubAccountId) {
      return { ok: false, reason: 'github-account-mismatch' };
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
    // A release may briefly precede its forward-only migration. That state is
    // quarantined: no name-based or legacy-row fallback may mint authority.
    return { ok: false, reason: 'lookup-failed' };
  }
}
