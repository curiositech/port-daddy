-- Repository authority is independent of any user's account preferences.
-- Intentionally no cascading user FK: deleting an account must not enable ships.
CREATE TABLE IF NOT EXISTS repo_ship_controls (
  repo_full_name TEXT NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  ship TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (repo_full_name, ship)
);
CREATE TABLE IF NOT EXISTS repo_ship_control_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_full_name TEXT NOT NULL,
  ship TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS repo_ship_controls_insert_audit AFTER INSERT ON repo_ship_controls
BEGIN
  INSERT INTO repo_ship_control_events (repo_full_name, ship, enabled, revision, updated_by, updated_at)
  VALUES (NEW.repo_full_name, NEW.ship, NEW.enabled, NEW.revision, NEW.updated_by, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS repo_ship_controls_update_audit AFTER UPDATE ON repo_ship_controls
BEGIN
  INSERT INTO repo_ship_control_events (repo_full_name, ship, enabled, revision, updated_by, updated_at)
  VALUES (NEW.repo_full_name, NEW.ship, NEW.enabled, NEW.revision, NEW.updated_by, NEW.updated_at);
END;
