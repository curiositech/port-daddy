-- Per-repo agent-behavior settings, account-scoped (the /account/repos
-- configuration screen). One row per (user, repo full name). Apply on the
-- deployed D1 via the staging-first flow (see README.md in this directory).
--
-- Design notes:
--   * sitrep_end_of_turn is a first-class column (not buried in the JSON bag)
--     because the SITREP dial is the launch setting and the device-facing read
--     path (`GET /v1/repo-settings`) filters and renders on it.
--   * settings_json is the forward-compatible bag for the settings this screen
--     grows next; additive, defaults to '{}' so older Workers keep reading rows
--     written by newer ones (rule 3: rollback-compatible).
--   * The account is the RECORD of the operator's cross-device intent; the
--     enforcement point stays each clone's local sitrep dial (agent.config.json
--     read by the squid tentacles). This table is what devices poll to converge.

CREATE TABLE IF NOT EXISTS repo_settings (
  user_id            TEXT    NOT NULL REFERENCES users(id),
  repo_full_name     TEXT    NOT NULL,
  sitrep_end_of_turn TEXT    NOT NULL DEFAULT 'off'
    CHECK (sitrep_end_of_turn IN ('off','suggest','enforce')),
  settings_json      TEXT    NOT NULL DEFAULT '{}',
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  PRIMARY KEY (user_id, repo_full_name)
);

CREATE INDEX IF NOT EXISTS idx_repo_settings_user
  ON repo_settings(user_id, updated_at DESC);
