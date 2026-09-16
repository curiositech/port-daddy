-- Tighten the repository-scoped Shipwright thread ledger after the additive
-- table migration. One durable thread is reused per account/install/repo, and
-- a trigger makes the 100-repository account quota race-safe in D1.
--
-- ROLLBACK WARNING: deploying a Worker older than the scoped-context release
-- reactivates user-only shipwright_chats prompts. The schema remains usable,
-- but that runtime rollback is isolation-unsafe and must keep Shipwright routes
-- disabled until the scoped Worker is restored.

CREATE UNIQUE INDEX IF NOT EXISTS shipwright_threads_one_repo_idx
  ON shipwright_threads (user_id, installation_id, repo_full_name);

CREATE TRIGGER IF NOT EXISTS shipwright_threads_quota_guard
BEFORE INSERT ON shipwright_threads
WHEN (SELECT COUNT(*) FROM shipwright_threads WHERE user_id = NEW.user_id) >= 100
 AND NOT EXISTS (
   SELECT 1 FROM shipwright_threads
    WHERE user_id = NEW.user_id AND installation_id = NEW.installation_id
      AND repo_full_name = NEW.repo_full_name
 )
BEGIN
  SELECT RAISE(ABORT, 'shipwright thread quota exceeded');
END;
