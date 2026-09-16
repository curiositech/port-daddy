-- AGENT CHAT + DAILY SPEND CAPS (src/chat-engine.ts, src/chat-spend.ts,
-- src/snipe-chat.ts) — the storage and the budget for the relay's second
-- conversational surface, the Engineman's chat on the Seamanship page.
--
-- WHY A SECOND CHAT TABLE RATHER THAN A COLUMN ON THE FIRST
--
-- The obvious move is `ALTER TABLE shipwright_chats ADD COLUMN agent`. It is
-- rejected here on rollback-compatibility grounds (migrations/README.md rule
-- 3): the previous Worker release selects that table with `WHERE user_id = ?`
-- and nothing else, so the moment a second agent's turns land in those rows, a
-- prod rollback would render one conversation inside the other's window. A
-- migration must leave the schema usable by the release that comes BACK, and
-- that one would be wrong rather than merely limited.
--
-- So the rows are separate and the CODE is shared: both surfaces run the same
-- turn engine (src/chat-engine.ts) over a small store interface. Two tables,
-- one implementation — the opposite of a fork, which would be two
-- implementations over one table.
--
-- `agent_chats` is generic from the first day precisely so a third agent needs
-- no migration at all: it is a new value in the `agent` column, not a new
-- table and not a schema change.

CREATE TABLE IF NOT EXISTS agent_chats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Which conversational surface this turn belongs to ('snipe', …). Part of
  -- every read's WHERE clause alongside user_id, so two agents in one account
  -- can never see each other's turns.
  agent      TEXT    NOT NULL,
  user_id    TEXT    NOT NULL REFERENCES users(id),
  role       TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
-- Conversation order is by the AUTOINCREMENT id, not created_at: two turns
-- routinely share a unix second. The index carries id so the ORDER BY is served
-- from it.
CREATE INDEX IF NOT EXISTS agent_chats_scope_idx ON agent_chats (agent, user_id, id);
-- The retention sweep prunes by age.
CREATE INDEX IF NOT EXISTS agent_chats_created_idx ON agent_chats (created_at);

-- ── Daily spend counters ─────────────────────────────────────────────────────
--
-- A chat that can spend without a cap is a defect, not a feature, so the
-- counter ships in the same migration as the chat table rather than in a
-- follow-up: there is no window in which the surface exists and the budget
-- does not.
--
-- "Reset at rollover" is KEY ARITHMETIC, not a scheduled job: `window_start`
-- is the UTC midnight of the day a turn is charged to, so a new day reads a
-- row that does not exist yet and therefore counts zero. Nothing has to run
-- for a budget to refresh, which means nothing can fail to run.
--
-- Generic in `agent` for the same reason agent_chats is: a per-surface budget
-- is a different value in this column, never another table.
CREATE TABLE IF NOT EXISTS agent_chat_spend (
  agent        TEXT    NOT NULL,
  user_id      TEXT    NOT NULL REFERENCES users(id),
  -- UTC midnight (unix seconds) of the day this row counts.
  window_start INTEGER NOT NULL,
  messages     INTEGER NOT NULL DEFAULT 0,
  -- Estimated tokens, charged at ACCEPTANCE time. An estimate, and named as
  -- one: the true completion length is unknowable before the call, and a
  -- budget that guesses low protects nothing.
  est_tokens   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent, user_id, window_start)
);
-- The retention sweep prunes spent windows by age.
CREATE INDEX IF NOT EXISTS agent_chat_spend_window_idx ON agent_chat_spend (window_start);
