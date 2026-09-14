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
