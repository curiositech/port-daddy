import { hashHex, randomHex } from './crypto.js';

export interface FleetOnboardingIdentity {
  userId: string;
  userLogin: string;
  installationId: number;
  repositoryId: number;
  githubAccountId: number;
  repositoryFullName: string;
}

export interface FleetOnboardingDraft {
  desiredOutcomes: string[];
  customerBudgetMicrousd: number;
  proposal: Record<string, unknown>;
}

/**
 * Materialize the signed-in user's server-owned tenant and an inert repository
 * proposal. This never creates an entitlement, serves an installation, accepts
 * configuration, or launches work.
 */
export async function saveFleetOnboardingDraft(
  db: D1Database,
  identity: FleetOnboardingIdentity,
  draft: FleetOnboardingDraft,
  now: number,
): Promise<{ tenantAccountId: string; proposalId: string }> {
  if (!Number.isSafeInteger(draft.customerBudgetMicrousd) || draft.customerBudgetMicrousd < 0) {
    throw new TypeError('customer budget must be a nonnegative integer microusd amount');
  }
  const tenantAccountId = `fta_${hashHex(`fleet-account:v1:${identity.userId}`).slice(0, 40)}`;
  const proposalId = `fcp_${randomHex(24)}`;
  const providerCostCapMicrousd = Math.floor(draft.customerBudgetMicrousd / 4);

  await db.batch([
    db.prepare(`INSERT INTO fleet_accounts (id, display_name, status, created_at, updated_at)
      VALUES (?, ?, 'active', ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(tenantAccountId, `${identity.userLogin}'s Fleet`, now, now),
    db.prepare(`INSERT INTO fleet_account_members
      (tenant_account_id, user_id, role, created_at, updated_at)
      VALUES (?, ?, 'owner', ?, ?) ON CONFLICT(tenant_account_id, user_id) DO NOTHING`)
      .bind(tenantAccountId, identity.userId, now, now),
    db.prepare(`INSERT INTO fleet_tenant_installations
      (installation_id, tenant_account_id, github_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(installation_id) DO NOTHING`)
      .bind(identity.installationId, tenantAccountId, identity.githubAccountId, now, now),
    db.prepare(`INSERT INTO fleet_tenant_repositories
      (tenant_account_id, installation_id, repository_id, github_account_id,
       repository_full_name, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(tenant_account_id, installation_id, repository_id) DO NOTHING`)
      .bind(tenantAccountId, identity.installationId, identity.repositoryId,
        identity.githubAccountId, identity.repositoryFullName, now, now),
    db.prepare(`UPDATE fleet_tenant_repositories SET repository_full_name=?, updated_at=?
      WHERE tenant_account_id=? AND installation_id=? AND repository_id=? AND github_account_id=?`)
      .bind(identity.repositoryFullName, now, tenantAccountId, identity.installationId,
        identity.repositoryId, identity.githubAccountId),
    db.prepare(`INSERT INTO fleet_repository_onboarding
      (tenant_account_id, installation_id, repository_id, requested_by_user_id,
       desired_outcomes_json, customer_budget_microusd, provider_cost_cap_microusd,
       margin_floor_bps, config_status, execution_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 7500, 'proposed', 'blocked_pending_executor', ?, ?)
      ON CONFLICT(tenant_account_id, installation_id, repository_id, requested_by_user_id)
      DO UPDATE SET desired_outcomes_json=excluded.desired_outcomes_json,
        customer_budget_microusd=excluded.customer_budget_microusd,
        provider_cost_cap_microusd=excluded.provider_cost_cap_microusd,
        config_status='proposed', updated_at=excluded.updated_at`)
      .bind(tenantAccountId, identity.installationId, identity.repositoryId, identity.userId,
        JSON.stringify(draft.desiredOutcomes), draft.customerBudgetMicrousd,
        providerCostCapMicrousd, now, now),
    db.prepare(`INSERT INTO fleet_configuration_proposals
      (id, tenant_account_id, installation_id, repository_id, proposed_by_user_id,
       proposal_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`)
      .bind(proposalId, tenantAccountId, identity.installationId, identity.repositoryId,
        identity.userId, JSON.stringify(draft.proposal), now, now),
  ]);

  const witness = await db.prepare(`SELECT r.tenant_account_id, r.github_account_id,
      r.repository_full_name,
      m.user_id, o.config_status, o.execution_status, p.status AS proposal_status
    FROM fleet_tenant_repositories r
    JOIN fleet_account_members m ON m.tenant_account_id=r.tenant_account_id AND m.user_id=?
    JOIN fleet_repository_onboarding o ON o.tenant_account_id=r.tenant_account_id
      AND o.installation_id=r.installation_id AND o.repository_id=r.repository_id
      AND o.requested_by_user_id=m.user_id
    JOIN fleet_configuration_proposals p ON p.id=?
    WHERE r.tenant_account_id=? AND r.installation_id=? AND r.repository_id=? AND r.active=1`)
    .bind(identity.userId, proposalId, tenantAccountId, identity.installationId, identity.repositoryId)
    .first<Record<string, unknown>>();
  if (!witness || witness.tenant_account_id !== tenantAccountId
      || witness.github_account_id !== identity.githubAccountId
      || witness.repository_full_name !== identity.repositoryFullName
      || witness.user_id !== identity.userId || witness.config_status !== 'proposed'
      || witness.execution_status !== 'blocked_pending_executor'
      || witness.proposal_status !== 'proposed') {
    throw new Error('fleet onboarding write could not be verified');
  }
  return { tenantAccountId, proposalId };
}
