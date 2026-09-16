-- Raw ship session transcripts — the pd-transcript.v1 INDEX
-- (docs/FLEET-SESSION-TRANSCRIPTS.md, Phase 1).
--
-- The raw bytes live in R2 (`fleet-transcripts`, one JSONL object per
-- (run, ship, attempt), written once by the fleet-executor's
-- flushShipTranscript). This table is the joinable index the run page and
-- the transcript read route consult: nobody ever LISTs the bucket. Rows are
-- small and live forever (they double as the per-ship × per-model outcome
-- ledger); the R2 objects carry their own lifecycle.
--
-- Additive-only: safe under ADR-0119's rollback rule (a previous Worker
-- release simply never reads it).

CREATE TABLE IF NOT EXISTS fleet_run_transcripts (
  run_id            TEXT    NOT NULL,   -- fleet_runs.id (run:<uuid>)
  ship              TEXT    NOT NULL,   -- ship name (qa, purser, …)
  attempt           INTEGER NOT NULL,   -- provider delivery attempt (1-based)
  r2_key            TEXT    NOT NULL,   -- v1/<runId>/<ship>.<attempt>.jsonl
  turns             INTEGER NOT NULL,   -- envelope count in the object
  bytes             INTEGER NOT NULL,   -- serialized JSONL size
  models_csv        TEXT,               -- distinct models that produced turns
  prompt_tokens     INTEGER,            -- summed assistant-turn usage.prompt
  completion_tokens INTEGER,            -- summed assistant-turn usage.completion
  cost_usd          REAL,               -- summed per-call cost at each model's rate
  incomplete        INTEGER NOT NULL DEFAULT 0, -- 1 ⇒ capture dropped turns/bodies
  created_at        INTEGER NOT NULL,   -- unix seconds at flush
  PRIMARY KEY (run_id, ship, attempt)
);

CREATE INDEX IF NOT EXISTS fleet_run_transcripts_run_idx
  ON fleet_run_transcripts (run_id);
