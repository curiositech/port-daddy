-- Port Daddy v2.0 Schema Migration
-- Adds: semantic identities, service directory, messaging

-- Rename old table for migration
ALTER TABLE port_assignments RENAME TO port_assignments_v1;

-- New services table (replaces port_assignments)
CREATE TABLE services (
  id TEXT PRIMARY KEY,                    -- semantic identity: 'project:stack:context'
  port INTEGER UNIQUE,
  pid INTEGER,
  cmd TEXT,                               -- command to launch service
  cwd TEXT,                               -- working directory
  status TEXT DEFAULT 'assigned',         -- assigned, running, stopped, crashed
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER,                     -- null = never expires
  restart_policy TEXT DEFAULT 'never',    -- never, always, on-failure
  health_url TEXT,                        -- URL to check for readiness
  tunnel_provider TEXT,                   -- ngrok, cloudflare, etc.
  tunnel_url TEXT,                        -- public tunnel URL
  paired_with TEXT,                       -- linked service ID
  metadata TEXT                           -- JSON for extra attributes
);

CREATE INDEX idx_services_port ON services(port);
CREATE INDEX idx_services_status ON services(status);
CREATE INDEX idx_services_expires ON services(expires_at) WHERE expires_at IS NOT NULL;

-- Service directory (URLs for all environments)
CREATE TABLE endpoints (
  service_id TEXT NOT NULL,
  env TEXT NOT NULL,                      -- local, tunnel, dev, staging, prod
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (service_id, env),
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
);

-- Messages (pub/sub)
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  payload TEXT NOT NULL,                  -- JSON
  sender TEXT,                            -- service ID or 'cli' or agent ID
  created_at INTEGER NOT NULL,
  expires_at INTEGER                      -- null = never expires
);

CREATE INDEX idx_messages_channel ON messages(channel, created_at);
CREATE INDEX idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL;

-- Migrate existing data
INSERT INTO services (id, port, pid, cmd, status, created_at, last_seen, expires_at, metadata)
SELECT
  project,                                -- use project name as ID (v1 compat)
  port,
  pid,
  NULL,                                   -- no cmd in v1
  'assigned',                             -- assume assigned status
  started,
  last_seen,
  NULL,                                   -- no expiration in v1
  NULL
FROM port_assignments_v1;

-- Insert local endpoints for migrated services
INSERT INTO endpoints (service_id, env, url, created_at, updated_at)
SELECT
  project,
  'local',
  'http://localhost:' || port,
  started,
  last_seen
FROM port_assignments_v1;

-- Drop old table
DROP TABLE port_assignments_v1;

-- Config table for persistent settings
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Insert default config
INSERT INTO config (key, value, updated_at) VALUES
  ('version', '"2.0.0"', strftime('%s', 'now') * 1000),
  ('defaultRange', '[3100, 9999]', strftime('%s', 'now') * 1000),
  ('reservedPorts', '[8080, 8000, 9876]', strftime('%s', 'now') * 1000),
  ('defaultExpires', 'null', strftime('%s', 'now') * 1000);
