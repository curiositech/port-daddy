# 0007. Immutable Session Notes (Append-Only)

## Status

Accepted

## Context

Port Daddy's sessions feature allows AI agents to record their progress, decisions, and handoff information as "notes" attached to a session. The question arose: should notes be editable after they are created?

This is not a trivial question. Most note-taking systems allow editing. If an agent records "starting work on auth module" and then wants to correct a typo, the natural impulse is to allow an edit. But Port Daddy's notes serve a specific purpose: they are an **audit trail of agent activity**, not a general-purpose scratchpad.

The use cases that motivated the notes system were:
1. Agent A writes notes throughout its session about what it did, what it found, and what is left to do
2. Agent A loses its context window or crashes
3. Agent B picks up where Agent A left off — it reads Agent A's notes to understand what was done
4. The notes must be trustworthy — Agent B must know that "I completed the authentication module" means that was actually true at the time it was written, not that someone edited the note afterward

## Decision Drivers

- **Audit trail integrity**: Notes are evidence of what an agent did at a point in time. Allowing edits breaks this property — a note claiming "completed X" might have been written before X was actually done, then backdated.
- **Coordination trust**: Multiple agents reading the same session's notes need to trust that the notes accurately represent what actually happened. Editability introduces uncertainty.
- **Simplicity**: An append-only system has a simpler data model. There is no need to track note revisions, deletion status, or edit history.
- **Resurrection context**: When the resurrection system collects notes from a dead agent's session to hand off to a new agent, the notes must be a reliable record of progress. Mutable notes could be accidentally cleared or corrupted.
- **Session deletion vs. note deletion**: Deleting an entire session (which CASCADEs to its notes) is permitted — this is a clean-slate operation. But individual note deletion within an active session is not.

## Considered Options

### Option A: Append-only notes (create only, no edit or delete)

Notes can be added to a session at any time while the session is active. Once written, a note's content is permanent. Notes are never individually deleted — they persist until the session itself is deleted.

Session deletion CASCADEs to notes via `ON DELETE CASCADE` on the foreign key.

**Pros:**
- Provides a trustworthy audit trail
- Simple schema: `INSERT` only, no `UPDATE` or individual `DELETE` for notes
- Agents can trust that existing notes accurately represent historical state
- The resurrection system can safely read notes as a reliable handoff context

**Cons:**
- Typos and mistakes in notes are permanent
- Agents cannot "correct" a note that was written incorrectly

### Option B: Mutable notes (full CRUD)

Notes can be created, edited, and deleted.

**Pros:**
- More flexible
- Errors can be corrected

**Cons:**
- Destroys the audit trail property — notes can no longer be trusted as historical records
- Requires revision tracking if edit history is desired
- Coordination ambiguity: if Agent A wrote a note and Agent B edits it, who is responsible for the content?
- More complex schema and API surface

### Option C: Soft-delete (mark as deleted, retain data)

Notes cannot be truly deleted but can be marked as deleted. Content remains in the database but is filtered from most queries.

**Pros:**
- Maintains audit trail
- Allows "hiding" mistakes without erasing evidence

**Cons:**
- Adds complexity to the schema (a `deleted_at` column or similar)
- UI and API must handle two states for every note
- Agents must decide whether to show "deleted" notes — most of the time they should not, but during resurrection they might need to
- The audit trail benefit of soft-delete is only marginally better than hard-delete if the `deleted_at` timestamp is queryable — and the added complexity is not worth it for a tool of this scale

### Option D: Versioned notes (replace rather than edit)

Creating an "edited" note actually creates a new note version, with the old version preserved.

**Pros:**
- Full edit history preserved
- Content is never lost

**Cons:**
- Significant schema complexity (version tables, current-version pointers)
- API complexity: which version of a note does `getNotes()` return?
- Overkill for an agent coordination tool where notes are typically short progress updates, not formal documents

## Decision

Notes are **append-only and immutable after creation**.

The `session_notes` table has no `UPDATE` route. The canonical write API is
`POST /notes`; callers pass `sessionId` when they are targeting a known session,
or omit it when they want the daemon to resolve the active session/quick-note
context. `POST /sessions/:id/notes` remains a compatibility alias, but it
funnels through the same `POST /notes`/`quickNote` path. The session read API is
`GET /sessions/:id/notes`. There is no `PUT` or `PATCH` for individual notes.
There is no `DELETE /sessions/:id/notes/:noteId`.

The schema enforces this structurally:

```sql
CREATE TABLE IF NOT EXISTS session_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',
  created_at INTEGER NOT NULL
);
```

There is no `updated_at` column and no `deleted_at` column. The absence of these columns is the schema's statement of intent.

Notes support typed categorization via the `type` column (e.g., `note`, `handoff`, `progress`, `error`) but the content field itself is free text. The type is set at creation time and is also immutable.

When a session ends, the optional `note` parameter to `POST /sessions/:id/end` creates a final handoff note of type `handoff` before the session closes. This final note is also immutable.

Session deletion (via `DELETE /sessions/:id`) does cascade to notes — this is the only way notes are removed. This operation is used for administrative cleanup, not for normal agent workflow.

## Rationale

The decision comes down to what notes are *for*. Notes in Port Daddy are not a general-purpose text editor. They are a structured log of agent activity for the purpose of:

1. Human inspection ("what did the agent working on this feature do?")
2. Agent handoff via the resurrection system ("pick up where the dead agent left off")
3. Session briefings ("what is the current state of work on this project?")

All three use cases require the notes to be trustworthy records of what happened. An editable note system introduces the question "which version of this note represents reality?" — a question that should not need to be asked.

The practical cost is low. If an agent makes a mistake in a note, it can write a correction in a new note: "Previous note was incorrect — X is not done, Y needs to happen first." This pattern is actually more transparent than silent edits, because it preserves the original note and the correction in sequence.

## Consequences

### Positive

- The internal `addNote()` storage function in `lib/sessions.ts` is a simple `INSERT` — no conditional logic, no version management
- Agents consuming notes via the resurrection system can trust them as reliable historical records
- The CLAUDE.md documentation is clear and accurate: "Notes are immutable (append-only, never edited/deleted individually)"
- Typed notes (`type: 'handoff'`, `type: 'progress'`) allow filtering by intent without requiring mutable content

### Negative

- An agent that writes a note with a factual error (e.g., "migration complete" when it is not) cannot correct the record except by writing a follow-up note. This is more transparent but can be confusing.
- There is no "undo" for notes. A well-intentioned but incorrect note persists.

### Neutral

- The `quickNote()` method in `lib/sessions.ts` is the public write gate for `pd note`, SDK `pd.note()`, MCP `add_note`, IPC note writes, and the REST `POST /notes` route. It creates an implicit session if none exists (useful for one-off notes from the CLI: `pd note "found the bug"`). The implicit session is also governed by the immutability rule — notes written to it are equally permanent.
- Session-level deletion (not note-level deletion) means that cleanup of old sessions via `sessions.cleanup()` — which removes completed/abandoned sessions older than 7 days — also removes their notes. This is the intended long-term retention policy.
