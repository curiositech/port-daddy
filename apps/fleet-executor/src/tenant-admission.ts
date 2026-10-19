import { resolveFleetTenantBinding } from '../../shared/fleet-tenant.js';
import type { ExecutorEnv, FleetRunJob } from './env.js';
import { ManagedBillingError, resolveManagedEntitlement } from './managed-billing.js';

export type TenantJobAdmission =
  | { ok: true }
  | { ok: false; disposition: 'permanent' | 'retryable'; reason: string };

/** Validate queue authority and activation before tokens, GitHub, or AI. */
export async function validateTenantJobAdmission(
  env: ExecutorEnv,
  job: FleetRunJob,
): Promise<TenantJobAdmission> {
  if (job?.schemaVersion !== 2 || typeof job.tenantAccountId !== 'string' || !job.tenantAccountId) {
    return { ok: false, disposition: 'permanent', reason: 'invalid-v2-envelope' };
  }
  if (!env.DB) return { ok: false, disposition: 'retryable', reason: 'tenant-store-unavailable' };

  const resolved = await resolveFleetTenantBinding(env.DB, {
    installationId: job.installationId as number,
    repositoryId: job.repositoryId as number,
    githubAccountId: job.githubAccountId as number,
  });
  if (!resolved.ok) return { ok: false, disposition: resolved.disposition, reason: resolved.reason };
  if (resolved.binding.tenantAccountId !== job.tenantAccountId) {
    return { ok: false, disposition: 'permanent', reason: 'tenant-account-mismatch' };
  }

  try {
    const result = await env.DB.prepare(`SELECT r.repository_full_name AS canonical_repo_full_name
      FROM fleet_repository_onboarding o
      JOIN fleet_tenant_repositories r
        ON r.tenant_account_id=o.tenant_account_id
       AND r.installation_id=o.installation_id AND r.repository_id=o.repository_id
      JOIN fleet_accounts a ON a.id=o.tenant_account_id
      WHERE o.tenant_account_id=? AND o.installation_id=? AND o.repository_id=?
        AND r.github_account_id=? AND r.active=1 AND a.status='active'
        AND o.config_status='accepted'
        AND EXISTS (
          SELECT 1 FROM fleet_configuration_proposals p
          WHERE p.tenant_account_id=o.tenant_account_id
            AND p.installation_id=o.installation_id
            AND p.repository_id=o.repository_id
            AND p.status='accepted'
        )
      LIMIT 1`).bind(job.tenantAccountId, job.installationId, job.repositoryId, job.githubAccountId)
      .all<{ canonical_repo_full_name: string }>();
    if (!Array.isArray(result.results)) {
      return { ok: false, disposition: 'retryable', reason: 'activation-store-unavailable' };
    }
    if (result.results.length !== 1) {
      return { ok: false, disposition: 'permanent', reason: 'configuration-not-accepted' };
    }
    const canonicalRepo = result.results[0]?.canonical_repo_full_name;
    if (typeof canonicalRepo !== 'string'
      || typeof job.repoFullName !== 'string'
      || canonicalRepo.toLowerCase() !== job.repoFullName.toLowerCase()) {
      return { ok: false, disposition: 'permanent', reason: 'repository-name-mismatch' };
    }
    // Read-only readiness check before token minting or GitHub access. The
    // later atomic reservation remains the spend authority and closes races.
    await resolveManagedEntitlement(env.DB, job.installationId as number);
    return { ok: true };
  } catch (error) {
    if (error instanceof ManagedBillingError) {
      const permanent = error.code === 'entitlement-missing' || error.code === 'entitlement-invalid';
      return {
        ok: false,
        disposition: permanent ? 'permanent' : 'retryable',
        reason: permanent ? 'managed-entitlement-not-ready' : 'managed-entitlement-store-unavailable',
      };
    }
    return { ok: false, disposition: 'retryable', reason: 'activation-store-unavailable' };
  }
}
