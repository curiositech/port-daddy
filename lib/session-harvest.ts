/**
 * Session Harvest — note → harbor MemoryEpisode promotion (ADR-0097 engine).
 *
 * Rewritten for the episodic-memory consolidation: harvested episodes are
 * persisted through `persistEpisode` (lib/agent-harbor/memory-episodes.ts) —
 * the single contract gate (frozen-schema validation, mandatory citations,
 * idempotent insert, supersession closure). The legacy `episodic_memory`
 * table gains NO new rows from this path; it is a read-only transition store
 * (see lib/episodic-memory.ts header).
 *
 * Implements the "compact-from-artifacts" constraint: every episode is derived
 * from the actual session note rows in the DB, never from a prior briefing or
 * summary. The note IS the source artifact, and every episode carries a
 * `{kind: 'claim', claimRef: 'session-note:<sessionId>:<noteId>'}` citation
 * back to it — "a memory without a source is a suggestion, not a fact".
 *
 * Encryption discipline (both directions of the old bypass): a note stored
 * encrypted-at-rest is SKIPPED and counted as `redacted`. We neither harvest
 * ciphertext garbage into the episode store nor copy plaintext of encrypted
 * notes into a plaintext store — an encrypted session's knowledge stays
 * inside its encrypted notes.
 *
 * Large notes (> BLOB_THRESHOLD_BYTES) are promoted to the blob store with a
 * compact pointer stub in the episode summary (zoom: every retained item is a
 * lens, not a terminal summary).
 *
 * Idempotent: episode ids derive from sha256(sessionId:noteId), so
 * `persistEpisode`'s exists-check makes repeat harvests no-ops — no separate
 * promotion ledger needed.
 */

import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import {
  persistEpisode,
  extractEpisodesFromSession,
  MEMORY_EPISODE_SCHEMA,
  type MemoryEpisode,
} from './agent-harbor/memory-episodes.js';

const BLOB_THRESHOLD_BYTES = 10_000;

interface SessionNoteRow {
  id: number;
  session_id: string;
  content: string;
  type: string;
  created_at: number;
  session_purpose?: string;
  session_agent_id?: string;
  identity_project?: string;
  worktree_id?: string;
}

interface HarvestResult {
  /** Harbor episode ids newly persisted by this harvest. */
  episodeIds: string[];
  /** Notes already promoted (idempotent no-ops). */
  skipped: number;
  /** Notes newly promoted to episodes. */
  promoted: number;
  /** Encrypted-at-rest notes skipped — never harvested into a plaintext store. */
  redacted: number;
}

interface HarvestDeps {
  /**
   * Note-encryption inspector (server.ts's noteEncryption instance). When
   * absent, no note is treated as encrypted — matches deployments with
   * encryption disabled.
   */
  noteEncryption?: { isEncrypted(content: string): boolean };
  /** Optional blob store for large artifact promotion. */
  blobs?: {
    store(content: string, opts: { mimeType?: string; agentId?: string; metadata?: Record<string, unknown> }): Promise<{ id: string }>;
  };
  /** Clock injection for tests / bi-temporal determinism. */
  now?: () => Date;
}

/**
 * Note-type → episode importance + forgetting policy.
 *
 * Three concepts the old system conflated, kept separate here: "no longer
 * true" is `validUntil` (set only by contradiction/supersession — never by a
 * timer); "no longer worth recalling" is the decay policy feeding the
 * recency/importance ranking blend; "safe to delete" is a future custodian
 * duty, not encoded here. Timers demote, they do not falsify.
 */
const NOTE_TYPE_EPISODE_POLICY: Record<string, {
  importance: number;
  forgettingPolicy: NonNullable<MemoryEpisode['forgettingPolicy']>;
}> = {
  // Verified knowledge — the "Never ship lexical-only search" class of fact.
  finding:   { importance: 7, forgettingPolicy: { kind: 'never-forget' } },
  result:    { importance: 7, forgettingPolicy: { kind: 'never-forget' } },
  syllogism: { importance: 7, forgettingPolicy: { kind: 'never-forget' } },
  // Architectural intent outlives sessions.
  design:    { importance: 7, forgettingPolicy: { kind: 'never-forget' } },
  // Intensely relevant, then superseded by the continuation.
  handoff:   { importance: 8, forgettingPolicy: { kind: 'decay', halfLifeHours: 720 } },
  // Plans go stale in months.
  plan:      { importance: 5, forgettingPolicy: { kind: 'decay', halfLifeHours: 4320 } },
  // Long-tail inspiration.
  idea:      { importance: 5, forgettingPolicy: { kind: 'decay', halfLifeHours: 8760 } },
  prototype: { importance: 5, forgettingPolicy: { kind: 'decay', halfLifeHours: 8760 } },
  // Preferences drift.
  want:      { importance: 4, forgettingPolicy: { kind: 'decay', halfLifeHours: 2160 } },
  // Anxieties resolve or escalate.
  worry:     { importance: 4, forgettingPolicy: { kind: 'decay', halfLifeHours: 1440 } },
  // Safe default: unknown → forgettable, never → permanent.
  note:      { importance: 3, forgettingPolicy: { kind: 'decay', halfLifeHours: 720 } },
  scope:     { importance: 3, forgettingPolicy: { kind: 'decay', halfLifeHours: 720 } },
};

const UNKNOWN_TYPE_POLICY = NOTE_TYPE_EPISODE_POLICY.note;

/** Deterministic harbor episode id for a session note (idempotent harvest). */
export function noteEpisodeId(sessionId: string, noteId: number): string {
  return `note-${createHash('sha256').update(`${sessionId}:${noteId}`).digest('hex').slice(0, 24)}`;
}

/**
 * Promote all of a session's notes to harbor memory episodes.
 *
 * Recall → precision:
 * 1. Load ALL notes for the session (never filter before reading).
 * 2. Skip encrypted-at-rest notes (counted as `redacted`).
 * 3. Promote large notes to blob store; episode summary gets a pointer stub.
 * 4. Persist each note through `persistEpisode` — deterministic ids make the
 *    engine's exists-check the idempotency ledger.
 */
export async function harvestSession(
  sessionId: string,
  db: Database,
  deps: HarvestDeps = {},
): Promise<HarvestResult> {
  const { noteEncryption, blobs } = deps;
  const nowIso = (deps.now?.() ?? new Date()).toISOString();

  // Step 1: recall pass — load ALL notes
  const notes = db.prepare(`
    SELECT sn.*, s.purpose as session_purpose, s.agent_id as session_agent_id,
           s.identity_project as identity_project, s.worktree_id as worktree_id
    FROM session_notes sn
    JOIN sessions s ON s.id = sn.session_id
    WHERE sn.session_id = ?
    ORDER BY sn.created_at ASC
  `).all(sessionId) as SessionNoteRow[];

  const episodeIds: string[] = [];
  let skipped = 0;
  let promoted = 0;
  let redacted = 0;

  for (const note of notes) {
    // Step 2: encrypted-at-rest notes never enter a plaintext episode store.
    if (noteEncryption?.isEncrypted(note.content)) {
      redacted++;
      continue;
    }

    const episodeId = noteEpisodeId(sessionId, note.id);
    let summary = note.content;
    let blobId: string | null = null;

    // Step 3: large artifact promotion
    if (blobs && Buffer.byteLength(note.content, 'utf8') > BLOB_THRESHOLD_BYTES) {
      try {
        const result = await blobs.store(note.content, {
          mimeType: 'text/plain',
          agentId: note.session_agent_id,
          metadata: { sessionId, noteId: note.id, noteType: note.type },
        });
        blobId = result.id;
        // Compact pointer stub — the episode body is a lens, not the content
        summary = `[Large note — ${Buffer.byteLength(note.content, 'utf8')} bytes stored in blob ${blobId}. Retrieve: pd blob get ${blobId}]`;
      } catch {
        // Blob store unavailable — store inline, don't fail the harvest
      }
    }

    const policy = NOTE_TYPE_EPISODE_POLICY[note.type] ?? UNKNOWN_TYPE_POLICY;
    const episode: MemoryEpisode = {
      schema: MEMORY_EPISODE_SCHEMA,
      episodeId,
      tier: 'recall',
      agentNodeId: note.session_agent_id ?? null,
      sessionId,
      runId: null,
      summary: summary.slice(0, 10_000),
      validFrom: new Date(note.created_at).toISOString(),
      validUntil: null,
      ingestedAt: nowIso,
      supersedes: [],
      supersededBy: null,
      extractedBy: { kind: 'daemon', agentNodeId: null },
      citations: [
        {
          kind: 'claim',
          claimRef: `session-note:${sessionId}:${note.id}`,
          sessionId,
        },
      ],
      sourcePayloadState: 'present',
      importance: policy.importance,
      forgettingPolicy: policy.forgettingPolicy,
      // Extra fields tolerated by the frozen schema (additionalProperties):
      noteType: note.type,
      identityProject: note.identity_project ?? null,
      worktreeId: note.worktree_id ?? null,
      blobId,
    };

    // Step 4: one gate for everything — schema, citations, idempotency.
    const result = persistEpisode(db, episode);
    if (result.inserted) {
      episodeIds.push(episodeId);
      promoted++;
    } else {
      skipped++;
    }
  }

  // Convergence hook (future feedstock): when compaction wiring lands and
  // real transcript-events reach the harbor ledger, this same harvest pass
  // extracts them too. Today it is a cheap idempotent no-op over an empty
  // per-session transcript stream.
  extractEpisodesFromSession(db, { sessionId, now: deps.now });

  return { episodeIds, skipped, promoted, redacted };
}

export type { HarvestResult, HarvestDeps };
