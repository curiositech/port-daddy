-- No initial enables. Missing controls keep all Fleet admission closed.
CREATE TABLE IF NOT EXISTS fleet_controls (
  scope TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fleet_control_audit (
  scope TEXT NOT NULL,
  revision INTEGER NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, revision)
);
CREATE TRIGGER IF NOT EXISTS fleet_control_insert_audit AFTER INSERT ON fleet_controls BEGIN
  INSERT INTO fleet_control_audit VALUES (NEW.scope, NEW.revision, NEW.enabled, NEW.updated_by, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS fleet_control_update_audit AFTER UPDATE ON fleet_controls BEGIN
  INSERT INTO fleet_control_audit VALUES (NEW.scope, NEW.revision, NEW.enabled, NEW.updated_by, NEW.updated_at);
END;
