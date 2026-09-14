import { describe, expect, it } from 'vitest';
import {
  buildFleetRunJobV2,
  FLEET_RUN_JOB_V2_ACTIVATION,
  isPositiveGithubId,
  resolveFleetTenantBinding,
} from '../../shared/fleet-tenant.js';
import { applyAllMigrations, makeDb } from './helpers/d1-sqlite.js';
import { saveFleetOnboardingDraft } from '../src/fleet-onboarding.js';

function seededTenant() {
  const db = makeDb(applyAllMigrations());
  db.exec(`INSERT INTO fleet_accounts (id, display_name, created_at, updated_at)
    VALUES ('acct_port_daddy', 'Port Daddy', 1, 1)`);
  db.exec(`INSERT INTO fleet_tenant_installations
    (installation_id, tenant_account_id, github_account_id, created_at, updated_at)
    VALUES (777, 'acct_port_daddy', 9001, 1, 1)`);
  db.exec(`INSERT INTO fleet_tenant_repositories
    (tenant_account_id, installation_id, repository_id, github_account_id,
     repository_full_name, created_at, updated_at)
    VALUES ('acct_port_daddy', 777, 42, 9001, 'curiositech/port-daddy', 1, 1)`);
  return db;
}

describe('Fleet tenant identity spine', () => {
  it('creates a server-owned tenant binding and inert proposal for the signed-in exact repository', async () => {
    const db = makeDb(applyAllMigrations());
    db.exec(`INSERT INTO users (id, github_user_id, login, created_at)
      VALUES ('u_signed_in', 123, 'captain', 1)`);
    const result = await saveFleetOnboardingDraft(db.DB as never, {
      userId: 'u_signed_in', userLogin: 'captain', installationId: 777,
      repositoryId: 42, githubAccountId: 9001,
      repositoryFullName: 'curiositech/port-daddy',
    }, {
      desiredOutcomes: ['correctness review'], customerBudgetMicrousd: 29_000_000,
      proposal: { yaml: 'fleet: {}', source: 'test' },
    }, 10);
    expect(result.tenantAccountId).toMatch(/^fta_[0-9a-f]{40}$/);
    const row = db.raw.prepare(`SELECT r.repository_id, r.github_account_id,
      o.config_status, o.execution_status, p.status
      FROM fleet_tenant_repositories r
      JOIN fleet_repository_onboarding o USING (tenant_account_id, installation_id, repository_id)
      JOIN fleet_configuration_proposals p USING (tenant_account_id, installation_id, repository_id)`).get();
    expect(row).toEqual({
      repository_id: 42, github_account_id: 9001, config_status: 'proposed',
      execution_status: 'blocked_pending_executor', status: 'proposed',
    });
  });

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
    })).resolves.toEqual({ ok: false, disposition: 'permanent', reason: 'unbound' });
  });

  it('refuses an owner-account mismatch and inactive bindings', async () => {
    const db = seededTenant();
    await expect(resolveFleetTenantBinding(db.DB as never, {
      installationId: 777,
      repositoryId: 42,
      githubAccountId: 9002,
    })).resolves.toEqual({ ok: false, disposition: 'permanent', reason: 'github-account-mismatch' });

    db.exec(`UPDATE fleet_tenant_repositories SET active = 0, updated_at = 2
      WHERE tenant_account_id = 'acct_port_daddy' AND repository_id = 42`);
    await expect(resolveFleetTenantBinding(db.DB as never, {
      installationId: 777,
      repositoryId: 42,
      githubAccountId: 9001,
    })).resolves.toEqual({ ok: false, disposition: 'permanent', reason: 'unbound' });
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

  it('prevents one GitHub installation from straddling Port Daddy tenants', () => {
    const db = seededTenant();
    db.exec(`INSERT INTO fleet_accounts (id, created_at, updated_at)
      VALUES ('acct_other', 1, 1)`);
    expect(() => db.exec(`INSERT INTO fleet_tenant_installations
      (installation_id, tenant_account_id, github_account_id, created_at, updated_at)
      VALUES (777, 'acct_other', 9001, 1, 1)`)).toThrow(/UNIQUE/);
    expect(() => db.exec(`UPDATE fleet_tenant_installations
      SET tenant_account_id='acct_other' WHERE installation_id=777`)).toThrow(/immutable/);
  });

  it('rolls back onboarding when another tenant already owns the installation', async () => {
    const db = makeDb(applyAllMigrations());
    db.exec(`INSERT INTO users (id, github_user_id, login, created_at) VALUES
      ('u_first', 100, 'first', 1), ('u_second', 101, 'second', 1)`);
    const draft = {
      desiredOutcomes: ['correctness'], customerBudgetMicrousd: 4_000_000,
      proposal: { yaml: 'fleet: {}' },
    };
    await saveFleetOnboardingDraft(db.DB as never, {
      userId: 'u_first', userLogin: 'first', installationId: 777,
      repositoryId: 42, githubAccountId: 9001, repositoryFullName: 'acme/one',
    }, draft, 10);
    await expect(saveFleetOnboardingDraft(db.DB as never, {
      userId: 'u_second', userLogin: 'second', installationId: 777,
      repositoryId: 43, githubAccountId: 9001, repositoryFullName: 'acme/two',
    }, draft, 11)).rejects.toThrow(/FOREIGN KEY/);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM fleet_accounts').get()).toEqual({ n: 1 });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM fleet_tenant_repositories').get()).toEqual({ n: 1 });
  });

  it('distinguishes infrastructure failure as retryable for a future 5xx admission response', async () => {
    const brokenDb = {
      prepare() {
        throw new Error('D1 unavailable');
      },
    };
    await expect(resolveFleetTenantBinding(brokenDb as never, {
      installationId: 777,
      repositoryId: 42,
      githubAccountId: 9001,
    })).resolves.toEqual({
      ok: false,
      disposition: 'retryable',
      reason: 'lookup-failed',
    });
  });

  it('builds the active fail-closed v2 envelope', () => {
    expect(FLEET_RUN_JOB_V2_ACTIVATION).toBe('active-fail-closed');
    expect(buildFleetRunJobV2({
      tenantAccountId: 'acct_port_daddy',
      installationId: 777,
      repositoryId: 42,
      githubAccountId: 9001,
    }, {
      deliveryId: 'delivery-v2',
      eventType: 'pull_request',
      action: 'opened',
      repoFullName: 'curiositech/port-daddy',
      prNumber: 12,
      payloadMinimal: {},
    })).toEqual({
      schemaVersion: 2,
      tenantAccountId: 'acct_port_daddy',
      installationId: 777,
      repositoryId: 42,
      githubAccountId: 9001,
      deliveryId: 'delivery-v2',
      eventType: 'pull_request',
      action: 'opened',
      repoFullName: 'curiositech/port-daddy',
      prNumber: 12,
      payloadMinimal: {},
    });
  });

  it('does not let runtime input override server-owned tenant authority', () => {
    const job = buildFleetRunJobV2({
      tenantAccountId: 'acct_port_daddy',
      installationId: 777,
      repositoryId: 42,
      githubAccountId: 9001,
    }, {
      schemaVersion: 999,
      tenantAccountId: 'acct_attacker',
      installationId: 1,
      repositoryId: 2,
      githubAccountId: 3,
      deliveryId: 'delivery-v2',
      eventType: 'pull_request',
      action: 'opened',
      repoFullName: 'attacker/repo',
      prNumber: 12,
      payloadMinimal: {},
    } as never);
    expect(job).toMatchObject({
      schemaVersion: 2,
      tenantAccountId: 'acct_port_daddy',
      installationId: 777,
      repositoryId: 42,
      githubAccountId: 9001,
    });
  });

  it('stores bespoke desired outcomes while enforcing the platform margin floor and blocked execution', () => {
    const db = seededTenant();
    db.exec(`INSERT INTO users (id, github_user_id, login, created_at)
      VALUES ('u_owner', 9001, 'octocat', 1)`);
    db.exec(`INSERT INTO fleet_account_members
      (tenant_account_id, user_id, role, created_at, updated_at)
      VALUES ('acct_port_daddy', 'u_owner', 'owner', 1, 1)`);

    db.exec(`INSERT INTO fleet_repository_onboarding
      (tenant_account_id, installation_id, repository_id, requested_by_user_id,
       desired_outcomes_json, customer_budget_microusd, provider_cost_cap_microusd,
       created_at, updated_at)
      VALUES ('acct_port_daddy', 777, 42, 'u_owner',
       '["catch correctness regressions","keep reviews under five minutes"]',
       29000000, 7250000, 1, 1)`);

    const row = db.raw.prepare(`SELECT desired_outcomes_json, margin_floor_bps,
      config_status, execution_status FROM fleet_repository_onboarding`).get() as Record<string, unknown>;
    expect(row).toEqual({
      desired_outcomes_json: '["catch correctness regressions","keep reviews under five minutes"]',
      margin_floor_bps: 7500,
      config_status: 'discovery',
      execution_status: 'blocked_pending_executor',
    });

    expect(() => db.exec(`UPDATE fleet_repository_onboarding
      SET execution_status = 'active'`)).toThrow(/CHECK/);
    expect(() => db.exec(`UPDATE fleet_repository_onboarding
      SET margin_floor_bps = 7499`)).toThrow(/CHECK/);
    expect(() => db.exec(`UPDATE fleet_repository_onboarding
      SET provider_cost_cap_microusd = 7250001`)).toThrow(/CHECK/);
    expect(() => db.exec(`UPDATE fleet_repository_onboarding
      SET repository_id = 43`)).toThrow(/immutable/);
  });

  it('keeps proposals reviewable and permits only one accepted proposal per repository', () => {
    const db = seededTenant();
    db.exec(`INSERT INTO users (id, github_user_id, login, created_at)
      VALUES ('u_owner', 9001, 'octocat', 1)`);
    db.exec(`INSERT INTO fleet_account_members
      (tenant_account_id, user_id, role, created_at, updated_at)
      VALUES ('acct_port_daddy', 'u_owner', 'owner', 1, 1)`);
    db.exec(`INSERT INTO fleet_repository_onboarding
      (tenant_account_id, installation_id, repository_id, requested_by_user_id,
       desired_outcomes_json, customer_budget_microusd, provider_cost_cap_microusd,
       created_at, updated_at)
      VALUES ('acct_port_daddy', 777, 42, 'u_owner', '[]', 29000000, 7250000, 1, 1)`);
    db.exec(`INSERT INTO fleet_configuration_proposals
      (id, tenant_account_id, installation_id, repository_id, proposed_by_user_id,
       proposal_json, status, created_at, updated_at)
      VALUES ('proposal_a', 'acct_port_daddy', 777, 42, 'u_owner',
       '{"ships":["reviewer","purser","merger"]}', 'accepted', 1, 1)`);

    expect(() => db.exec(`INSERT INTO fleet_configuration_proposals
      (id, tenant_account_id, installation_id, repository_id, proposed_by_user_id,
       proposal_json, status, created_at, updated_at)
      VALUES ('proposal_b', 'acct_port_daddy', 777, 42, 'u_owner',
       '{"ships":["reviewer"]}', 'accepted', 2, 2)`)).toThrow(/UNIQUE/);
    expect(() => db.exec(`INSERT INTO fleet_configuration_proposals
      (id, tenant_account_id, installation_id, repository_id, proposed_by_user_id,
       proposal_json, status, created_at, updated_at)
      VALUES ('proposal_invalid', 'acct_port_daddy', 777, 42, 'u_owner',
       '[]', 'draft', 2, 2)`)).toThrow(/CHECK/);
  });

  it('isolates onboarding and proposal writers through tenant membership', () => {
    const db = seededTenant();
    db.exec(`INSERT INTO users (id, github_user_id, login, created_at)
      VALUES ('u_outsider', 9002, 'outsider', 1)`);
    expect(() => db.exec(`INSERT INTO fleet_repository_onboarding
      (tenant_account_id, installation_id, repository_id, requested_by_user_id,
       desired_outcomes_json, customer_budget_microusd, provider_cost_cap_microusd,
       created_at, updated_at)
      VALUES ('acct_port_daddy', 777, 42, 'u_outsider', '[]', 29000000, 7250000, 1, 1)`)).toThrow(/FOREIGN KEY/);
  });
});
