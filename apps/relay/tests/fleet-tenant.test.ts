import { describe, expect, it } from 'vitest';
import {
  isPositiveGithubId,
  resolveFleetTenantBinding,
} from '../../shared/fleet-tenant.js';
import { applyAllMigrations, makeDb } from './helpers/d1-sqlite.js';

function seededTenant() {
  const db = makeDb(applyAllMigrations());
  db.exec(`INSERT INTO fleet_accounts (id, display_name, created_at, updated_at)
    VALUES ('acct_port_daddy', 'Port Daddy', 1, 1)`);
  db.exec(`INSERT INTO fleet_tenant_repositories
    (tenant_account_id, installation_id, repository_id, github_account_id,
     repository_full_name, created_at, updated_at)
    VALUES ('acct_port_daddy', 777, 42, 9001, 'curiositech/port-daddy', 1, 1)`);
  return db;
}

describe('Fleet tenant identity spine', () => {
  it('admits only an active immutable-id binding and returns the Port Daddy account id', async () => {
    const db = seededTenant();
    await expect(resolveFleetTenantBinding(db.DB as never, {
      installationId: 777,
      repositoryId: 42,
      githubAccountId: 9001,
    })).resolves.toEqual({
      ok: true,
      binding: {
        tenantAccountId: 'acct_port_daddy',
        installationId: 777,
        repositoryId: 42,
        githubAccountId: 9001,
      },
    });

    expect(() => db.exec(
      `UPDATE fleet_tenant_repositories SET repository_id = 43
        WHERE tenant_account_id = 'acct_port_daddy' AND repository_id = 42`,
    )).toThrow(/immutable/);
  });

  it('does not use repository names as a tenant fallback', async () => {
    const db = seededTenant();
    await expect(resolveFleetTenantBinding(db.DB as never, {
      installationId: 778,
      repositoryId: 43,
      githubAccountId: 9001,
    })).resolves.toEqual({ ok: false, reason: 'unbound' });
  });

  it('refuses an owner-account mismatch and inactive bindings', async () => {
    const db = seededTenant();
    await expect(resolveFleetTenantBinding(db.DB as never, {
      installationId: 777,
      repositoryId: 42,
      githubAccountId: 9002,
    })).resolves.toEqual({ ok: false, reason: 'github-account-mismatch' });

    db.exec(`UPDATE fleet_tenant_repositories SET active = 0, updated_at = 2
      WHERE tenant_account_id = 'acct_port_daddy' AND repository_id = 42`);
    await expect(resolveFleetTenantBinding(db.DB as never, {
      installationId: 777,
      repositoryId: 42,
      githubAccountId: 9001,
    })).resolves.toEqual({ ok: false, reason: 'unbound' });
  });

  it('rejects missing, nonpositive, fractional, and lossy numeric identities', () => {
    for (const value of [undefined, null, '42', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isPositiveGithubId(value)).toBe(false);
    }
    expect(isPositiveGithubId(1)).toBe(true);
  });

  it('enforces one active tenant for an installation/repository identity', () => {
    const db = seededTenant();
    db.exec(`INSERT INTO fleet_accounts (id, created_at, updated_at)
      VALUES ('acct_other', 1, 1)`);
    expect(() => db.exec(`INSERT INTO fleet_tenant_repositories
      (tenant_account_id, installation_id, repository_id, github_account_id,
       repository_full_name, created_at, updated_at)
      VALUES ('acct_other', 777, 42, 9001, 'renamed/port-daddy', 1, 1)`)).toThrow(/UNIQUE/);
  });
});
