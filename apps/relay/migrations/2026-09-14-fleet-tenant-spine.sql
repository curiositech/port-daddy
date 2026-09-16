-- Fleet tenant identity spine.
--
-- This is intentionally additive and contains no backfill. Existing
-- name-scoped rows are not evidence of tenancy and remain quarantined until an
-- onboarding flow creates an explicit active repository binding.

CREATE TABLE fleet_accounts (
  id          TEXT    PRIMARY KEY
                      CHECK (length(id) BETWEEN 1 AND 128),
  display_name TEXT,
  status      TEXT    NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'suspended', 'closed')),
  created_at  INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at > 0),
  updated_at  INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at > 0)
);

CREATE TABLE fleet_account_members (
  tenant_account_id TEXT    NOT NULL REFERENCES fleet_accounts(id),
  user_id           TEXT    NOT NULL REFERENCES users(id),
  role              TEXT    NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at        INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at > 0),
  updated_at        INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at > 0),
  PRIMARY KEY (tenant_account_id, user_id)
);
CREATE INDEX fleet_account_members_user_idx
  ON fleet_account_members (user_id, tenant_account_id);

CREATE TABLE fleet_tenant_repositories (
  tenant_account_id TEXT    NOT NULL REFERENCES fleet_accounts(id),
  installation_id   INTEGER NOT NULL
                            CHECK (typeof(installation_id) = 'integer' AND installation_id > 0),
  repository_id     INTEGER NOT NULL
                            CHECK (typeof(repository_id) = 'integer' AND repository_id > 0),
  github_account_id INTEGER NOT NULL
                            CHECK (typeof(github_account_id) = 'integer' AND github_account_id > 0),
  repository_full_name TEXT NOT NULL CHECK (length(repository_full_name) BETWEEN 3 AND 201),
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at        INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at > 0),
  updated_at        INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at > 0),
  PRIMARY KEY (tenant_account_id, installation_id, repository_id)
);
CREATE UNIQUE INDEX fleet_tenant_repositories_active_identity_idx
  ON fleet_tenant_repositories (installation_id, repository_id)
  WHERE active = 1;
CREATE INDEX fleet_tenant_repositories_account_idx
  ON fleet_tenant_repositories (tenant_account_id, active, repository_id);

-- Identity coordinates are append-only. Mutable labels, roles, lifecycle
-- state, and timestamps may change; changing authority means creating a new
-- binding and deactivating the old one.
CREATE TRIGGER fleet_accounts_immutable_id
BEFORE UPDATE OF id ON fleet_accounts
BEGIN
  SELECT RAISE(ABORT, 'fleet account id is immutable');
END;

CREATE TRIGGER fleet_account_members_immutable_ids
BEFORE UPDATE OF tenant_account_id, user_id ON fleet_account_members
BEGIN
  SELECT RAISE(ABORT, 'fleet account member identity is immutable');
END;

CREATE TRIGGER fleet_tenant_repositories_immutable_ids
BEFORE UPDATE OF tenant_account_id, installation_id, repository_id, github_account_id
ON fleet_tenant_repositories
BEGIN
  SELECT RAISE(ABORT, 'fleet tenant repository identity is immutable');
END;

-- Bespoke onboarding is deliberately inert. It records what an authorized
-- member wants and a reviewable fleet proposal, but cannot activate execution.
-- A later release must add an executor-validated activation contract rather
-- than reinterpret any of these rows as permission to spend.
CREATE TABLE fleet_repository_onboarding (
  tenant_account_id       TEXT    NOT NULL,
  installation_id         INTEGER NOT NULL,
  repository_id           INTEGER NOT NULL,
  requested_by_user_id    TEXT    NOT NULL,
  desired_outcomes_json   TEXT    NOT NULL
                                  CHECK (json_valid(desired_outcomes_json)
                                    AND json_type(desired_outcomes_json) = 'array'),
  customer_budget_microusd INTEGER NOT NULL
                                   CHECK (typeof(customer_budget_microusd) = 'integer'
                                     AND customer_budget_microusd BETWEEN 0 AND 1000000000000),
  provider_cost_cap_microusd INTEGER NOT NULL
                                    CHECK (typeof(provider_cost_cap_microusd) = 'integer'
                                      AND provider_cost_cap_microusd BETWEEN 0 AND 1000000000000),
  margin_floor_bps        INTEGER NOT NULL DEFAULT 7500
                                  CHECK (typeof(margin_floor_bps) = 'integer'
                                    AND margin_floor_bps BETWEEN 7500 AND 10000),
  config_status           TEXT    NOT NULL DEFAULT 'discovery'
                                  CHECK (config_status IN ('discovery', 'proposed', 'accepted', 'rejected')),
  execution_status        TEXT    NOT NULL DEFAULT 'blocked_pending_executor'
                                  CHECK (execution_status = 'blocked_pending_executor'),
  created_at              INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at > 0),
  updated_at              INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at > 0),
  PRIMARY KEY (tenant_account_id, installation_id, repository_id, requested_by_user_id),
  FOREIGN KEY (tenant_account_id, installation_id, repository_id)
    REFERENCES fleet_tenant_repositories (tenant_account_id, installation_id, repository_id),
  FOREIGN KEY (tenant_account_id, requested_by_user_id)
    REFERENCES fleet_account_members (tenant_account_id, user_id),
  CHECK (provider_cost_cap_microusd * 10000
    <= customer_budget_microusd * (10000 - margin_floor_bps))
);
CREATE INDEX fleet_repository_onboarding_requester_idx
  ON fleet_repository_onboarding (requested_by_user_id, tenant_account_id, repository_id);

CREATE TABLE fleet_configuration_proposals (
  id                    TEXT    PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  tenant_account_id     TEXT    NOT NULL,
  installation_id       INTEGER NOT NULL,
  repository_id         INTEGER NOT NULL,
  proposed_by_user_id   TEXT    NOT NULL,
  proposal_json         TEXT    NOT NULL
                                CHECK (json_valid(proposal_json) AND json_type(proposal_json) = 'object'),
  status                TEXT    NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'proposed', 'accepted', 'rejected', 'superseded')),
  created_at            INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at > 0),
  updated_at            INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at > 0),
  FOREIGN KEY (tenant_account_id, installation_id, repository_id)
    REFERENCES fleet_tenant_repositories (tenant_account_id, installation_id, repository_id),
  FOREIGN KEY (tenant_account_id, proposed_by_user_id)
    REFERENCES fleet_account_members (tenant_account_id, user_id)
);
CREATE UNIQUE INDEX fleet_configuration_proposals_one_accepted_idx
  ON fleet_configuration_proposals (tenant_account_id, installation_id, repository_id)
  WHERE status = 'accepted';
CREATE INDEX fleet_configuration_proposals_repo_idx
  ON fleet_configuration_proposals (tenant_account_id, repository_id, updated_at DESC);

CREATE TRIGGER fleet_repository_onboarding_immutable_scope
BEFORE UPDATE OF tenant_account_id, installation_id, repository_id, requested_by_user_id
ON fleet_repository_onboarding
BEGIN
  SELECT RAISE(ABORT, 'fleet onboarding user/repository scope is immutable');
END;

CREATE TRIGGER fleet_configuration_proposals_immutable_scope
BEFORE UPDATE OF id, tenant_account_id, installation_id, repository_id, proposed_by_user_id
ON fleet_configuration_proposals
BEGIN
  SELECT RAISE(ABORT, 'fleet proposal user/repository scope is immutable');
END;
