// tests/unit/transcript-archive-hook.test.js
//
// Verifies createTranscripts fires the durable archive sink whenever a transcript
// reaches a terminal state — via both finalize() and recordTranscript() (ADR-0058).
// DB-backed (better-sqlite3 via createTestDb); runs in CI where bindings are built.

import { describe, it, expect, beforeEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createTranscripts } from '../../lib/transcripts.js';

describe('transcript archive sink — fired on every terminal transcript', () => {
  let db, archived, sink;
  let t = 1000;
  const now = () => t++;

  beforeEach(() => {
    db = createTestDb();
    archived = [];
    sink = { archive: (e) => archived.push(e) };
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

  it('recordTranscript() (full-entry ingest) also archives', () => {
    const store = createTranscripts(db, { now, archiveSink: sink });
    store.recordTranscript({
      id: 'ext-1', ship: 'external', session_id: null, spawned_agent_id: 'a2',
      trigger: 'manual', backend: 'codex', model: 'gpt-5.4-mini', status: 'completed',
      started_at: 1, ended_at: 2, messages: [], outputs: [],
    });
    expect(archived.map((e) => e.id)).toContain('ext-1');
  });

  it('a throwing sink never breaks finalize (fire-and-forget)', () => {
    const store = createTranscripts(db, { now, archiveSink: { archive: () => { throw new Error('sink down'); } } });
    const id = store.start({
      ship: 'qa', spawned_agent_id: 'a3', trigger: 'manual', backend: 'claude', model: 'claude-haiku-4-5',
    });
    expect(() => store.finalize(id, { status: 'completed' })).not.toThrow();
    expect(store.getTranscript(id).status).toBe('completed'); // recording still succeeded
  });

  it('no sink configured → no error, recording unaffected (back-compat)', () => {
    const store = createTranscripts(db, { now });
    const id = store.start({
      ship: 'qa', spawned_agent_id: 'a4', trigger: 'manual', backend: 'claude', model: 'claude-haiku-4-5',
    });
    expect(() => store.finalize(id, { status: 'completed' })).not.toThrow();
  });
});
