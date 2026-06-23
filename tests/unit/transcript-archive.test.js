// tests/unit/transcript-archive.test.js
//
// Durable transcript retention (ADR-0058): every finalized transcript is written
// to an append-only JSONL archive OUTSIDE the live DB, so it survives DB loss.

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createJsonlTranscriptArchive, backfillTranscriptArchive, defaultTranscriptArchiveDir } =
  await import('../../lib/transcript-archive.js');

function entry(over = {}) {
  return {
    id: 'tx-1',
    ship: 'steward',
    session_id: 's1',
    spawned_agent_id: 'agent-1',
    trigger: 'manual',
    backend: 'claude-cli',
    model: 'claude-haiku-4-5-20251001',
    status: 'completed',
    started_at: Date.parse('2026-06-15T10:00:00Z'),
    ended_at: Date.parse('2026-06-15T10:05:00Z'),
    cost_usd: 0.04,
    tokens_in: 100,
    tokens_out: 200,
    messages: [{ seq: 0, role: 'assistant', content: 'did the thing', timestamp: 1, tool_calls: [] }],
    outputs: [{ seq: 0, type: 'pr', url: 'http://x/1', summary: 'opened', created_at: 1 }],
    error: null,
    project: 'port-daddy',
    identity: 'port-daddy:fleet:steward',
    ...over,
  };
}

describe('jsonl transcript archive — durable retention', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pd-tx-archive-')); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

  test('writes a finalized transcript, in full, as one JSONL line in a day-partitioned file', () => {
    const sink = createJsonlTranscriptArchive({ dir });
    sink.archive(entry());

    const files = readdirSync(dir);
    expect(files).toContain('transcripts-2026-06-15.jsonl'); // partitioned by UTC ended_at
    const lines = readFileSync(join(dir, 'transcripts-2026-06-15.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.id).toBe('tx-1');
    expect(rec.status).toBe('completed');
    expect(rec.messages[0].content).toBe('did the thing'); // full conversation retained
    expect(rec.outputs[0].url).toBe('http://x/1');
    expect(typeof rec.archived_at).toBe('number'); // archive stamps its own write time
  });

  test('appends — multiple finalizations accumulate, never overwrite', () => {
    const sink = createJsonlTranscriptArchive({ dir });
    sink.archive(entry({ id: 'tx-1' }));
    sink.archive(entry({ id: 'tx-2' }));
    const lines = readFileSync(join(dir, 'transcripts-2026-06-15.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('tx-1');
    expect(JSON.parse(lines[1]).id).toBe('tx-2');
  });

  test('the archive is independent of any DB — the file is the retained copy', () => {
    // No DB is involved here at all; the JSONL line IS the durable record. This is
    // the whole point: it survives a dropped/corrupted/reset port-registry.db.
    const sink = createJsonlTranscriptArchive({ dir });
    sink.archive(entry());
    expect(readdirSync(dir).length).toBe(1);
  });

  test('fire-and-forget: a write failure NEVER throws, but IS reported loudly', () => {
    const errors = [];
    // Point at a path that cannot be created (a file where a dir is expected).
    const badParent = join(dir, 'not-a-dir');
    writeFileSync(badParent, 'x');
    const sink = createJsonlTranscriptArchive({
      dir: join(badParent, 'sub'),
      onError: (msg, err) => errors.push({ msg, err }),
    });
    expect(() => sink.archive(entry())).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toMatch(/failed to archive transcript tx-1/);
  });

  test('partitions by day — a run that ended on a different date lands in its own file', () => {
    const sink = createJsonlTranscriptArchive({ dir });
    sink.archive(entry({ id: 'a', ended_at: Date.parse('2026-06-15T23:59:00Z') }));
    sink.archive(entry({ id: 'b', ended_at: Date.parse('2026-06-16T00:01:00Z') }));
    const files = readdirSync(dir).sort();
    expect(files).toEqual(['transcripts-2026-06-15.jsonl', 'transcripts-2026-06-16.jsonl']);
  });

  test('backfill archives every existing transcript (covers history, not just new runs)', () => {
    const sink = createJsonlTranscriptArchive({ dir });
    const headers = [entry({ id: 'old-1' }), entry({ id: 'old-2' }), entry({ id: 'old-3' })];
    const byId = Object.fromEntries(headers.map((h) => [h.id, h]));
    const { archived } = backfillTranscriptArchive(() => headers, (id) => byId[id] ?? null, sink);
    expect(archived).toBe(3);
    const lines = readFileSync(join(dir, 'transcripts-2026-06-15.jsonl'), 'utf8').trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).id).sort()).toEqual(['old-1', 'old-2', 'old-3']);
  });
});

describe('default archive dir', () => {
  test('defaults under ~/.port-daddy/transcripts and honors PD_TRANSCRIPT_ARCHIVE_DIR', () => {
    const prev = process.env.PD_TRANSCRIPT_ARCHIVE_DIR;
    delete process.env.PD_TRANSCRIPT_ARCHIVE_DIR;
    expect(defaultTranscriptArchiveDir()).toMatch(/\.port-daddy[/\\]transcripts$/);
    process.env.PD_TRANSCRIPT_ARCHIVE_DIR = '/custom/warehouse';
    expect(defaultTranscriptArchiveDir()).toBe('/custom/warehouse');
    if (prev === undefined) delete process.env.PD_TRANSCRIPT_ARCHIVE_DIR;
    else process.env.PD_TRANSCRIPT_ARCHIVE_DIR = prev;
  });
});
