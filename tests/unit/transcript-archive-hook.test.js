// tests/unit/transcript-archive-hook.test.js
//
// Verifies createTranscripts fires the durable archive sink whenever a transcript
// reaches a terminal state — via finalize() or a terminal recordTranscript()
// snapshot (ADR-0058).
// DB-backed (better-sqlite3 via createTestDb); runs in CI where bindings are built.

import { describe, it, expect, beforeEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import {
  createTranscripts,
  describeTranscriptArchiveArtifact,
} from '../../lib/transcripts.js';

describe('transcript archive sink — fired on every terminal transcript', () => {
  let db, archived, sink;
  let t = 1000;
  const now = () => t++;

  beforeEach(() => {
    db = createTestDb();
    archived = [];
    sink = {
      archive: (entry) => {
        archived.push(entry);
        return {
          ok: true,
          artifact: describeTranscriptArchiveArtifact(entry, `test://hook/${entry.id}`),
        };
      },
    };
  });

  it('finalize() pushes the full finalized transcript to the archive sink', () => {
    const store = createTranscripts(db, { now, archiveSink: sink });
    const id = store.start({
      ship: 'steward', spawned_agent_id: 'a1', trigger: 'manual',
      backend: 'claude-cli', model: 'claude-haiku-4-5-20251001',
    });
    store.appendMessage(id, { role: 'assistant', content: 'did the work' });
    expect(archived).toHaveLength(0); // not yet terminal

    store.finalize(id, { status: 'completed', cost_usd: 0.05, tokens_in: 10, tokens_out: 20 });

    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe(id);
    expect(archived[0].status).toBe('completed');
    expect(archived[0].messages.some((m) => m.content === 'did the work')).toBe(true);
  });

  it('recordTranscript() atomically imports terminal content before archiving it', () => {
    const store = createTranscripts(db, { now, archiveSink: sink });
    store.recordTranscript({
      id: 'ext-1', ship: 'external', session_id: null, spawned_agent_id: 'a2',
      trigger: 'manual', backend: 'codex', model: 'gpt-5.4-mini', status: 'completed',
      started_at: 1, ended_at: 2,
      messages: [{ role: 'assistant', content: 'terminal import', timestamp: 2 }],
      outputs: [{ type: 'commit', summary: 'terminal artifact' }],
    });
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({
      id: 'ext-1',
      status: 'completed',
      messages: [{ role: 'assistant', content: 'terminal import', timestamp: 2 }],
      outputs: [{ type: 'commit', summary: 'terminal artifact' }],
    });
  });

  it('recordTranscript() defers end emission and archival until a later terminal ingest', () => {
    const store = createTranscripts(db, { now, archiveSink: sink });
    const endEvents = [];
    store.subscribe((event) => {
      if (event.type === 'end') endEvents.push(event);
    });
    const running = {
      id: 'ext-running', ship: 'external', session_id: null, spawned_agent_id: 'a-running',
      trigger: 'manual', backend: 'codex', model: 'gpt-5.4-mini', status: 'running',
      started_at: 1, ended_at: null, messages: [], outputs: [],
    };

    store.recordTranscript(running);

    expect(archived).toHaveLength(0);
    expect(endEvents).toHaveLength(0);
    expect(db.prepare(`
      SELECT status FROM fleet_transcript_archive_receipts WHERE transcript_id = ?
    `).get(running.id)).toBeUndefined();

    store.recordTranscript({
      ...running,
      status: 'completed',
      ended_at: 2,
      messages: [{ role: 'assistant', content: 'finished later', timestamp: 2 }],
      outputs: [{ type: 'commit', summary: 'late terminal import' }],
    });

    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({
      id: running.id,
      status: 'completed',
      messages: [{ role: 'assistant', content: 'finished later', timestamp: 2 }],
      outputs: [{ type: 'commit', summary: 'late terminal import' }],
    });
    expect(endEvents).toHaveLength(1);
    expect(endEvents[0].entry).toMatchObject({ id: running.id, status: 'completed' });
    expect(db.prepare(`
      SELECT status FROM fleet_transcript_archive_receipts WHERE transcript_id = ?
    `).get(running.id)).toEqual({ status: 'succeeded' });
  });

  it('a throwing sink never breaks finalize (fire-and-forget)', () => {
    const store = createTranscripts(db, { now, archiveSink: { archive: () => { throw new Error('sink down'); } } });
    const id = store.start({
      ship: 'qa', spawned_agent_id: 'a3', trigger: 'manual', backend: 'claude', model: 'claude-haiku-4-5',
    });
    expect(() => store.finalize(id, { status: 'completed' })).not.toThrow();
    expect(store.getTranscript(id).status).toBe('completed'); // recording still succeeded
    expect(db.prepare(`
      SELECT status, artifact_locator FROM fleet_transcript_archive_receipts
       WHERE transcript_id = ?
    `).get(id)).toEqual({ status: 'failed', artifact_locator: null });
  });

  it('does not persist a generic success bit as durable artifact evidence', () => {
    const store = createTranscripts(db, { now, archiveSink: { archive: () => ({ ok: true }) } });
    const id = store.start({
      ship: 'qa', spawned_agent_id: 'a5', trigger: 'manual',
      backend: 'claude', model: 'claude-haiku-4-5',
    });
    store.finalize(id, { status: 'completed' });

    expect(db.prepare(`
      SELECT status, artifact_locator, last_error
        FROM fleet_transcript_archive_receipts
       WHERE transcript_id = ?
    `).get(id)).toEqual({
      status: 'failed',
      artifact_locator: null,
      last_error: 'archive sink returned invalid or mismatched artifact evidence',
    });
  });

  it('no sink configured → no error, recording unaffected (back-compat)', () => {
    const store = createTranscripts(db, { now });
    const id = store.start({
      ship: 'qa', spawned_agent_id: 'a4', trigger: 'manual', backend: 'claude', model: 'claude-haiku-4-5',
    });
    expect(() => store.finalize(id, { status: 'completed' })).not.toThrow();
  });
});
