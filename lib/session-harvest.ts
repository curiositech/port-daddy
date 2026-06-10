/**
 * Session Harvest — automatic note → episode promotion.
 *
 * Implements the "compact-from-artifacts" constraint: every episode is derived
 * from the actual session note rows in the DB, never from a prior briefing or
 * summary. The note IS the source artifact.
 *
 * Large notes (> BLOB_THRESHOLD_BYTES) are promoted to the blob store with a
 * compact pointer stub in the episode body (zoom: every retained item is a lens,
 * not a terminal summary).
 *
 * Idempotent: notes already promoted to episodes (by source_type='note', source_id)
 * are skipped on repeat calls.
 */

import type { Database } from 'better-sqlite3';
import { NOTE_TYPE_TO_EPISODE, episodeExpiresAt } from './episodic-memory.js';
import type { EpisodicMemory } from './episodic-memory.js';

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
  episodeIds: number[];
  skipped: number;
  promoted: number;
}

interface HarvestDeps {
  episodicMemory: EpisodicMemory;
  /** Optional blob store for large artifact promotion. */
  blobs?: {
    store(content: string, opts: { mimeType?: string; agentId?: string; metadata?: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

/**
 * Promote all session notes to durable episodes.
 *
 * Recall → precision:
 * 1. Load ALL notes for the session (never filter before reading).
 * 2. Classify each by type.
 * 3. Check idempotency (skip if already promoted).
 * 4. Promote large notes to blob store, episode body gets pointer stub.
 * 5. Remember each note as an episode.
 *
 * Returns IDs of episodes created (not skipped).
 */
export async function harvestSession(
  sessionId: string,
  db: Database,
  deps: HarvestDeps,
): Promise<HarvestResult> {
  const { episodicMemory, blobs } = deps;

  // Step 1: recall pass — load ALL notes
  const notes = db.prepare(`
    SELECT sn.*, s.purpose as session_purpose, s.agent_id as session_agent_id,
           s.identity_project as identity_project, s.worktree_id as worktree_id
    FROM session_notes sn
    JOIN sessions s ON s.id = sn.session_id
    WHERE sn.session_id = ?
    ORDER BY sn.created_at ASC
  `).all(sessionId) as SessionNoteRow[];

  if (notes.length === 0) return { episodeIds: [], skipped: 0, promoted: 0 };

  // Step 2: load existing episodes promoted from this session's notes only (idempotency check).
  // Scoping by source_id prefix 'note-<noteId>' keeps this O(session notes) instead of O(all episodes).
  const noteSourceIds = notes.map(n => `note-${n.id}`);
  const placeholders = noteSourceIds.map(() => '?').join(', ');
  const existingSourceIds = new Set<string>(
    (db.prepare(`
      SELECT source_id FROM episodic_memory
      WHERE source_type = 'note' AND source_id IN (${placeholders})
    `).all(...noteSourceIds) as Array<{ source_id: string }>).map(r => r.source_id),
  );

  const episodeIds: number[] = [];
  let skipped = 0;
  let promoted = 0;

  for (const note of notes) {
    const noteSourceId = `note-${note.id}`;

    // Step 3: idempotency — skip already-promoted notes
    if (existingSourceIds.has(noteSourceId)) {
      skipped++;
      continue;
    }

    const episodeType = NOTE_TYPE_TO_EPISODE[note.type] ?? 'note';
    const project = note.identity_project ?? null;

    let summary = note.content;
    let blobId: string | null = null;

    // Step 4: large artifact promotion
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

    // Derive title from first line or purpose fallback
    const firstLine = note.content.split('\n')[0]?.trim() ?? '';
    const title = firstLine.length > 0 && firstLine.length <= 120
      ? firstLine
      : note.session_purpose
        ? `${note.type}: ${note.session_purpose}`
        : `${note.type} note from session ${sessionId}`;

    // Step 5: promote to episodic memory
    const episode = episodicMemory.remember({
      project,
      agentId: note.session_agent_id ?? null,
      episodeType,
      title: title.slice(0, 200),
      summary: summary.slice(0, 10_000),
      sourceType: 'note',
      sourceId: noteSourceId,
      worktreeId: note.worktree_id ?? null,
      expiresAt: episodeExpiresAt(episodeType),
      blobId,
      metadata: {
        sessionId,
        noteId: note.id,
        originalType: note.type,
        createdAt: note.created_at,
      },
    });

    episodeIds.push(episode.id);
    promoted++;
  }

  return { episodeIds, skipped, promoted };
}

export type { HarvestResult };
