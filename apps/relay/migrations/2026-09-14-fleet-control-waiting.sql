-- Add a structured control hold without replacing fleet_run_intents.
--
-- The existing state CHECK is deliberately left intact. A previous Relay or
-- executor release can therefore keep reading and writing this table after a
-- rollback. New releases store terminal `state = 'cancelled'` plus a non-null
-- control_waiting_at and project that pair as logical `waiting_for_control`.
-- A rolled-back executor therefore sees a terminal row rather than retryable
-- work. New code also recognizes legacy retrying rows whose bounded error starts
-- with `Fleet suspended:`; no destructive backfill is required.
ALTER TABLE fleet_run_intents ADD COLUMN control_waiting_at INTEGER;
ALTER TABLE fleet_run_intents ADD COLUMN control_wait_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fleet_run_intents ADD COLUMN requeue_revision INTEGER;

-- Continuation handoff is a durable permit, not a timing lease. The completed
-- predecessor CASes its exact running attempt into `state = 'retrying'` with
-- one exact pending sequence. Only a message carrying that sequence may CAS
-- the row back to running. A retry of the predecessor can therefore repair the
-- queue send, but cannot execute another ship.
ALTER TABLE fleet_run_intents ADD COLUMN continuation_sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fleet_run_intents ADD COLUMN pending_continuation_sequence INTEGER;
ALTER TABLE fleet_run_intents ADD COLUMN pending_continuation_at INTEGER;

-- One operator grant per suspension incarnation; request IDs cannot be replayed
-- to authorize a later suspension. Only signed webhook admission consumes it.
CREATE TABLE IF NOT EXISTS fleet_control_requeues (
  request_id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  control_wait_count INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  issuer TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (delivery_id, control_wait_count)
);
