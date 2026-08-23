-- migration 088 — cross-backend dispatch failover (ADR-0121,
-- helmsman-backend-failover).
--
-- Idempotent applier: migrateDispatchFailoverColumns() in lib/dispatch/queue.ts.
-- This file documents the same change for readers. It has to be applied there
-- rather than by a numbered runner because `dispatches` is created by that
-- module's own `CREATE TABLE IF NOT EXISTS` and not by the core schema — and
-- `IF NOT EXISTS` succeeds silently against the old shape, which is exactly how
-- a drifted schema boots "verified" and then fails every write.
--
-- Every column is additive and nullable-or-defaulted: a dispatch that never
-- fails over reads exactly as it did before, and no existing row needs backfill.
--
-- WHY THE SUCCESSION IS AN EDGE, NOT A STATE. "This run failed and another
-- picked the work up" is a relationship between two dispatches, not an eleventh
-- thing one dispatch can be. Modelling it as a state would have reopened a
-- deliberately closed 8-state machine and forced every consumer to learn a new
-- terminal value; modelling it as an edge leaves the state machine untouched and
-- makes the chain a plain recursive read.

-- WHY predecessor_dispatch_id IS PLAIN TEXT AND NOT A REFERENCES CONSTRAINT.
-- It is a foreign key in meaning, and this table stores every one of those as
-- TEXT by an existing, documented decision: 083_dispatches.sql says its FK
-- columns to actors / body_leases "are stored as plain TEXT here" and that "a
-- follow-up migration (after 082) tightens them to REFERENCES". Constraining
-- this ONE column would make it the only enforced FK on a table where every
-- sibling defers, and it cannot be done here anyway — SQLite adds columns by
-- ALTER TABLE, which is not where this table's constraints will be tightened.
-- The tightening is table-wide follow-up work; this column joins the queue for
-- it rather than jumping ahead of it alone. `foreign_keys` IS ON at runtime
-- (lib/db.ts), so when that migration lands the constraint will actually bite.

-- The dispatch this one succeeded. NULL for an original dispatch.
ALTER TABLE dispatches ADD COLUMN predecessor_dispatch_id TEXT;

-- 0 for an original dispatch; n for the nth successor in one chain. Replaces
-- the marker-counting hack that inferred attempt counts from error_message.
ALTER TABLE dispatches ADD COLUMN failover_attempt INTEGER NOT NULL DEFAULT 0;

-- The backend that failed, so a lane can render "codex → claude-code" without
-- re-reading the predecessor row.
ALTER TABLE dispatches ADD COLUMN failover_from_backend TEXT;

-- The ADR-0118 handoff episode whose sanitized capsule briefed this successor.
-- NULL for a same-family native resume, and NULL for a cold successor that ran
-- with the original goal because no capsule could be produced.
ALTER TABLE dispatches ADD COLUMN handoff_episode_id TEXT;

-- The agent id the body actually ran as, stamped at body-start.
--
-- Its absence was a load-bearing gap: fleet_transcripts is keyed by the
-- Conductor's Launch.agentId, so without this column a dispatch could not be
-- joined to what its own body did. Both the handoff-capsule builder and the
-- per-lane live stream are downstream of it.
ALTER TABLE dispatches ADD COLUMN spawned_agent_id TEXT;

-- The remaining preference order this succession may still walk, as a JSON
-- array, frozen at the first attempt. Frozen deliberately: reading the live
-- order at each hop would let a profile edit mid-flight redirect a succession
-- already underway, so the chain a lane renders would not be the chain that ran.
ALTER TABLE dispatches ADD COLUMN failover_chain_json TEXT;
