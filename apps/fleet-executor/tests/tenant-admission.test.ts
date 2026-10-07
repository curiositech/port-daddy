import { describe, expect, it } from 'vitest';
import { validateTenantJobAdmission } from '../src/tenant-admission.js';
import type { ExecutorEnv, FleetRunJob } from '../src/env.js';

const JOB: FleetRunJob = {
  schemaVersion: 2,
  tenantAccountId: 'fta_owner',
  deliveryId: 'delivery-1', eventType: 'pull_request', action: 'opened',
  repoFullName: 'curiositech/port-daddy', installationId: 777,
  repositoryId: 42, githubAccountId: 9001, prNumber: 1, payloadMinimal: {},
};

function env(options: {
  binding?: boolean;
  accepted?: boolean;
  entitled?: boolean;
  broken?: boolean;
  canonicalRepo?: string;
} = {}): ExecutorEnv {
  const binding = options.binding ?? true;
  const accepted = options.accepted ?? true;
  return {
    DB: {
      prepare(sql: string) {
        if (options.broken) throw new Error('D1 down');
        return {
          bind() { return this; },
          async all() {
            if (sql.includes('FROM fleet_tenant_repositories r')) {
              return { success: true, results: binding ? [{
                tenant_account_id: 'fta_owner', installation_id: 777,
                repository_id: 42, github_account_id: 9001,
              }] : [] };
            }
            return { success: true, results: accepted ? [{
              canonical_repo_full_name: options.canonicalRepo ?? 'curiositech/port-daddy',
            }] : [] };
          },
          async first() {
            if (!sql.includes('FROM fleet_managed_entitlements')) return null;
            if (options.entitled === false) return null;
            return {
              installation_id: 777,
              retail_balance_microusd: 10_000_000,
              run_retail_microusd: 1_000_000,
            };
          },
        };
      },
    } as unknown as D1Database,
  } as ExecutorEnv;
}

describe('executor tenant admission', () => {
  it('accepts only the exact active tenant tuple with accepted configuration', async () => {
    await expect(validateTenantJobAdmission(env(), JOB)).resolves.toEqual({ ok: true });
  });

  it('permanently rejects legacy, forged, and unaccepted jobs before work', async () => {
    await expect(validateTenantJobAdmission(env(), { ...JOB, schemaVersion: undefined }))
      .resolves.toMatchObject({ ok: false, disposition: 'permanent', reason: 'invalid-v2-envelope' });
    await expect(validateTenantJobAdmission(env(), { ...JOB, tenantAccountId: 'fta_attacker' }))
      .resolves.toMatchObject({ ok: false, disposition: 'permanent', reason: 'tenant-account-mismatch' });
    await expect(validateTenantJobAdmission(env({ accepted: false }), JOB))
      .resolves.toMatchObject({ ok: false, disposition: 'permanent', reason: 'configuration-not-accepted' });
    await expect(validateTenantJobAdmission(env({ canonicalRepo: 'curiositech/other' }), JOB))
      .resolves.toMatchObject({ ok: false, disposition: 'permanent', reason: 'repository-name-mismatch' });
    await expect(validateTenantJobAdmission(env({ entitled: false }), JOB))
      .resolves.toMatchObject({ ok: false, disposition: 'permanent', reason: 'managed-entitlement-not-ready' });
  });

  it('marks unavailable tenant state retryable without widening authority', async () => {
    await expect(validateTenantJobAdmission(env({ broken: true }), JOB))
      .resolves.toMatchObject({ ok: false, disposition: 'retryable' });
    await expect(validateTenantJobAdmission({} as ExecutorEnv, JOB))
      .resolves.toEqual({ ok: false, disposition: 'retryable', reason: 'tenant-store-unavailable' });
  });
});
