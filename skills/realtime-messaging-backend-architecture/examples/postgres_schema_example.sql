-- Concrete starting schema for a Postgres-first chat/messaging backend.
-- Supports 1:1 DMs, group chat, message edit/delete, moderation flags,
-- a low-churn "last read" cursor, and ephemeral (TTL) conversations.
--
-- Deliberately NOT included here (see references/ephemeral-and-presence-data.md):
--   typing indicators, live presence, per-keystroke signals -> those belong
--   in Redis, not in this durable schema.

create extension if not exists pgcrypto; -- for gen_random_uuid()

-- One row per DM pair or group chat.
create table conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'group')),
  created_at timestamptz not null default now(),
  -- NULL = permanent conversation. Non-null = ephemeral; a cleanup job
  -- deletes rows past this timestamp. Decide this at creation time,
  -- not bolted on later.
  expires_at timestamptz,
  -- Lets you flip delivery strategy per-conversation without a client
  -- protocol rewrite. See references/fanout-strategies.md.
  delivery_mode text not null default 'push' check (delivery_mode in ('push', 'pull'))
);

-- Partial index: the TTL cleanup job scans only ephemeral conversations,
-- never the whole table.
create index idx_conversations_expiring
  on conversations (expires_at)
  where expires_at is not null;

-- Membership + a coarse, low-churn "last read" cursor.
-- This cursor is fine to keep durable/transactional (it changes once per
-- read session, not per keystroke) -- contrast with typing/presence,
-- which are high-churn and belong in Redis.
create table conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  last_read_message_id bigint,
  primary key (conversation_id, user_id)
);

-- The message log itself. Partitioned by created_at so old partitions can
-- be dropped cheaply (especially useful for ephemeral conversations) and
-- so autovacuum/index maintenance stays bounded per partition.
create table messages (
  id bigint generated always as identity,
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null,
  body text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  moderation_flag text,
  primary key (conversation_id, created_at, id)
) partition by range (created_at);

-- Create one partition per month (automate this with pg_partman or a
-- scheduled job in production; shown manually here for clarity).
create table messages_2026_09 partition of messages
  for values from ('2026-09-01') to ('2026-10-01');

create table messages_2026_10 partition of messages
  for values from ('2026-10-01') to ('2026-11-01');

-- The hot-path index: "give me the last N messages in this conversation."
create index idx_messages_conversation_created
  on messages (conversation_id, created_at desc);

-- Deliberately no full-text (GIN/tsvector) index here by default.
-- Add one only for conversations where expires_at IS NULL if you need
-- search -- indexing ephemeral content that will be deleted anyway is
-- pure write-amplification for no benefit.

-- Example: editing a message and touching the read cursor atomically.
-- This kind of multi-row transactional guarantee is the main reason
-- Postgres beats a wide-column store for most chat products' actual
-- feature set (edits, deletes, moderation, receipts-adjacent state).
--
-- begin;
--   update messages set body = $1, edited_at = now()
--     where conversation_id = $2 and id = $3 and sender_id = $4;
--   update conversation_members set last_read_message_id = $3
--     where conversation_id = $2 and user_id = $4;
-- commit;
