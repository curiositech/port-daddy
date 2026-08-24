/**
 * Unit tests for lib/transcripts.ts — ship-run conversation recorder.
 *
 * Coverage:
 *   - schema creation + idempotency
 *   - start/appendMessage/appendOutput/finalize lifecycle
 *   - recordTranscript() upsert path
 *   - filter coverage on listTranscripts (ship/pr/agentId/status/since/limit)
 *   - getTranscript returns full conversation (messages + outputs)
 *   - deleteTranscript cascades to messages + outputs
 *   - costRollup aggregates correctly across ships and days
 *   - subscribe/emit lifecycle events (start, update, end)
 *   - redactSecrets scrubs API keys / bearer tokens / OpenAI/Anthropic/Stripe/AWS
 *   - large tool-call arg fields truncate with sha256 marker
 *   - large message content truncates with sha256 marker
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import {
  createTranscripts,
  describeTranscriptArchiveArtifact,
  redactSecrets,
} from '../../lib/transcripts.js';

function archiveSuccess(entry, locator = `test://transcripts/${entry.id}`) {
  return { ok: true, artifact: describeTranscriptArchiveArtifact(entry, locator) };
}

describe('transcripts module', () => {
  let db;
  let clock;
  let now;
  let store;

  beforeEach(() => {
    db = createTestDb();
    clock = 1_700_000_000_000;
    now = () => clock;
    store = createTranscripts(db, { now });
  });

  afterEach(() => {
    if (db) db.close();
  });

  describe('durable archive receipts', () => {
    it('binds one first-terminal transition to exact artifact evidence', () => {
      const archived = [];
      store = createTranscripts(db, {
        now,
        archiveSink: {
          archive(entry) {
            archived.push({ id: entry.id, status: entry.status });
            return archiveSuccess(entry);
          },
        },
      });
      const id = store.start({
        ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'claude', model: 'm',
      });

      store.finalize(id, { status: 'killed', error: 'Killed by spawner' });
      store.finalize(id, { status: 'completed' });

      expect(archived).toEqual([{ id, status: 'killed' }]);
      expect(db.prepare(`
        SELECT content_sha256, status, succeeded_at, artifact_locator,
               artifact_sha256, artifact_bytes, artifact_format, attempts
          FROM fleet_transcript_archive_receipts
         WHERE transcript_id = ?
      `).get(id)).toEqual({
        content_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        status: 'succeeded',
        succeeded_at: clock,
        artifact_locator: `test://transcripts/${id}`,
        artifact_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        artifact_bytes: expect.any(Number),
        artifact_format: 'port-daddy.transcript-jsonl.v1',
        attempts: 1,
      });
    });

    it('freezes messages and outputs after the first terminal snapshot is archived', () => {
      store = createTranscripts(db, {
        now,
        archiveSink: { archive: (entry) => archiveSuccess(entry) },
      });
      const id = store.start({
        ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'claude', model: 'm',
      });
      store.appendMessage(id, { role: 'assistant', content: 'final answer', timestamp: clock });
      store.appendOutput(id, { type: 'commit', summary: 'published result' });
      store.finalize(id, { status: 'completed' });

      const terminal = store.getTranscript(id);
      const receipt = db.prepare(`
        SELECT content_sha256, artifact_sha256, artifact_bytes, attempts
          FROM fleet_transcript_archive_receipts
         WHERE transcript_id = ?
      `).get(id);

      expect(() => store.appendMessage(id, {
        role: 'assistant', content: 'late mutation', timestamp: clock + 1,
      })).toThrow(/terminal and immutable/);
      expect(() => store.appendOutput(id, {
        type: 'other', summary: 'late output',
      })).toThrow(/terminal and immutable/);

      expect(store.getTranscript(id)).toEqual(terminal);
      expect(db.prepare(`
        SELECT content_sha256, artifact_sha256, artifact_bytes, attempts
          FROM fleet_transcript_archive_receipts
         WHERE transcript_id = ?
      `).get(id)).toEqual(receipt);
      const expected = describeTranscriptArchiveArtifact(terminal, 'receipt-validation');
      expect(receipt).toEqual({
        content_sha256: expected.sha256,
        artifact_sha256: expected.sha256,
        artifact_bytes: expected.bytes,
        attempts: 1,
      });
    });

    it('retries a failed receipt and then skips the exact durable snapshot idempotently', () => {
      let fail = true;
      let calls = 0;
      store = createTranscripts(db, {
        now,
        archiveSink: {
          archive(entry) {
            calls += 1;
            return fail ? { ok: false, error: 'warehouse unavailable' } : archiveSuccess(entry);
          },
        },
      });
      const id = store.start({
        ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'claude', model: 'm',
      });
      store.finalize(id, { status: 'completed' });
      expect(store.backfillArchive()).toEqual({ archived: 0 });

      fail = false;
      expect(store.backfillArchive()).toEqual({ archived: 1 });
      expect(store.backfillArchive()).toEqual({ archived: 1 });
      expect(calls).toBe(3);
      expect(db.prepare(`
        SELECT status, last_error, attempts
          FROM fleet_transcript_archive_receipts
         WHERE transcript_id = ?
      `).get(id)).toEqual({ status: 'succeeded', last_error: null, attempts: 3 });
    });

    it('retries a stale or mismatched success receipt instead of trusting it', () => {
      let calls = 0;
      store = createTranscripts(db, {
        now,
        archiveSink: {
          archive(entry) {
            calls += 1;
            return archiveSuccess(entry);
          },
        },
      });
      const id = store.start({
        ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'claude', model: 'm',
      });
      store.finalize(id, { status: 'completed' });
      db.prepare(`
        UPDATE fleet_transcript_archive_receipts
           SET artifact_sha256 = ?
         WHERE transcript_id = ?
      `).run('f'.repeat(64), id);

      expect(store.backfillArchive()).toEqual({ archived: 1 });
      expect(calls).toBe(2);
      const receipt = db.prepare(`
        SELECT content_sha256, artifact_sha256, attempts
          FROM fleet_transcript_archive_receipts
         WHERE transcript_id = ?
      `).get(id);
      expect(receipt.artifact_sha256).toBe(receipt.content_sha256);
      expect(receipt.attempts).toBe(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Schema
  // ───────────────────────────────────────────────────────────────────────────

  describe('schema', () => {
    it('creates fleet_transcripts + message + output tables', () => {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'fleet_transcript%'"
      ).all().map((r) => r.name).sort();
      expect(tables).toEqual([
        'fleet_transcript_archive_receipts',
        'fleet_transcript_messages',
        'fleet_transcript_outputs',
        'fleet_transcripts',
      ]);
    });

    it('is idempotent on re-construction', () => {
      const id = store.start({
        ship: 'code-reviewer',
        spawned_agent_id: 'a1',
        trigger: 'pull_request:opened',
        backend: 'claude',
        model: 'claude-haiku-4-5',
      });
      // Re-create — schema CREATE IF NOT EXISTS, row survives
      const second = createTranscripts(db, { now });
      const tx = second.getTranscript(id);
      expect(tx).not.toBeNull();
      expect(tx.ship).toBe('code-reviewer');
    });

    it('migrates old fleet_transcripts rows with runtime provenance defaults', () => {
      const oldDb = createTestDb();
      try {
        oldDb.exec(`
          CREATE TABLE fleet_transcripts (
            id TEXT PRIMARY KEY,
            ship TEXT NOT NULL,
            session_id TEXT,
            spawned_agent_id TEXT NOT NULL,
            pr_number INTEGER,
            issue_number INTEGER,
            trigger TEXT NOT NULL,
            backend TEXT NOT NULL,
            model TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            cost_usd REAL,
            tokens_in INTEGER,
            tokens_out INTEGER,
            error TEXT,
            project TEXT,
            identity TEXT
          );
          INSERT INTO fleet_transcripts (
            id, ship, spawned_agent_id, trigger, backend, model, status, started_at
          ) VALUES (
            'tx_old_runtime', 'spawn:openai', 'agent-old', 'manual', 'openai', 'gpt-5-mini', 'completed', 1700000000000
          );
        `);

        const migrated = createTranscripts(oldDb, { now });
        const columns = oldDb.prepare('PRAGMA table_info(fleet_transcripts)').all().map((row) => row.name);
        expect(columns).toEqual(expect.arrayContaining([
          'requested_backend',
          'effective_backend',
          'requested_model',
          'effective_model',
          'backend_override_source',
        ]));

        const oldTx = migrated.getTranscript('tx_old_runtime');
        expect(oldTx).toEqual(expect.objectContaining({
          backend: 'openai',
          model: 'gpt-5-mini',
          requested_backend: 'openai',
          effective_backend: 'openai',
          requested_model: 'gpt-5-mini',
          effective_model: 'gpt-5-mini',
          backend_override_source: 'none',
        }));

        const newId = migrated.start({
          ship: 'spawn:cli:codex',
          spawned_agent_id: 'agent-new',
          trigger: 'manual',
          backend: 'cli:codex',
          model: 'codex-cli',
          requested_backend: 'openai',
          effective_backend: 'cli:codex',
          requested_model: 'gpt-5-mini',
          effective_model: 'codex-cli',
          backend_override_source: 'env',
        });
        expect(migrated.getTranscript(newId)).toEqual(expect.objectContaining({
          requested_backend: 'openai',
          effective_backend: 'cli:codex',
          requested_model: 'gpt-5-mini',
          effective_model: 'codex-cli',
          backend_override_source: 'env',
        }));
      } finally {
        oldDb.close();
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Lifecycle: start / appendMessage / appendOutput / finalize
  // ───────────────────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('starts a transcript and returns a generated id', () => {
      const id = store.start({
        ship: 'qa',
        spawned_agent_id: 'spawn-1',
        trigger: 'manual',
        backend: 'ollama',
        model: 'llama3.1:8b',
      });
      expect(id).toMatch(/^tx_/);
      const tx = store.getTranscript(id);
      expect(tx.status).toBe('running');
      expect(tx.started_at).toBe(clock);
      expect(tx.messages).toEqual([]);
      expect(tx.outputs).toEqual([]);
    });

    it('respects an explicit id from start()', () => {
      const id = store.start({
        id: 'tx_custom_42',
        ship: 'qa',
        spawned_agent_id: 'spawn-1',
        trigger: 'manual',
        backend: 'ollama',
        model: 'llama3.1:8b',
      });
      expect(id).toBe('tx_custom_42');
    });

    it('appends messages in order', () => {
      const id = store.start({
        ship: 'code-reviewer',
        spawned_agent_id: 'a',
        trigger: 'pull_request:opened',
        backend: 'claude',
        model: 'claude-haiku-4-5',
      });
      store.appendMessage(id, { role: 'system', content: 'You are a reviewer.', timestamp: clock });
      clock += 100;
      store.appendMessage(id, { role: 'user', content: 'Review PR #42', timestamp: clock });
      clock += 200;
      store.appendMessage(id, { role: 'assistant', content: 'LGTM after small nits.', timestamp: clock });
      const tx = store.getTranscript(id);
      expect(tx.messages).toHaveLength(3);
      expect(tx.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
      expect(tx.messages[2].content).toBe('LGTM after small nits.');
    });

    it('appends outputs in order', () => {
      const id = store.start({
        ship: 'code-reviewer',
        spawned_agent_id: 'a',
        trigger: 't',
        backend: 'claude',
        model: 'm',
      });
      store.appendOutput(id, { type: 'pr-comment', url: 'https://github.com/x/y/pull/1#c', summary: 'Posted review' });
      store.appendOutput(id, { type: 'noop', summary: 'No further action' });
      const tx = store.getTranscript(id);
      expect(tx.outputs).toHaveLength(2);
      expect(tx.outputs[0].type).toBe('pr-comment');
      expect(tx.outputs[0].url).toBe('https://github.com/x/y/pull/1#c');
    });

    it('appendMessage throws for unknown transcript id', () => {
      expect(() => store.appendMessage('tx_missing', { role: 'user', content: 'hi', timestamp: clock }))
        .toThrow(/no transcript with id/);
    });

    it('finalize updates status, ended_at, cost, tokens, error', () => {
      const id = store.start({
        ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'claude', model: 'm',
      });
      clock += 1500;
      store.finalize(id, {
        status: 'completed',
        ended_at: clock,
        cost_usd: 0.0123,
        tokens_in: 1200,
        tokens_out: 350,
      });
      const tx = store.getTranscript(id);
      expect(tx.status).toBe('completed');
      expect(tx.ended_at).toBe(clock);
      expect(tx.cost_usd).toBeCloseTo(0.0123, 5);
      expect(tx.tokens_in).toBe(1200);
      expect(tx.tokens_out).toBe(350);
    });

    it('keeps the first terminal transition authoritative', () => {
      const id = store.start({
        ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'claude', model: 'm',
      });
      store.finalize(id, { status: 'completed', cost_usd: 0.05 });
      store.finalize(id, { status: 'failed', error: 'boom' });
      const tx = store.getTranscript(id);
      expect(tx.status).toBe('completed');
      expect(tx.cost_usd).toBeCloseTo(0.05, 5);
      expect(tx.error).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // recordTranscript (upsert)
  // ───────────────────────────────────────────────────────────────────────────

  describe('recordTranscript', () => {
    it('inserts a full transcript in one call', () => {
      store.recordTranscript({
        id: 'tx_one_shot',
        ship: 'qa',
        session_id: null,
        spawned_agent_id: 'spawn-42',
        trigger: 'manual',
        backend: 'claude',
        model: 'claude-haiku-4-5',
        status: 'completed',
        started_at: clock,
        ended_at: clock + 1000,
        cost_usd: 0.002,
        tokens_in: 500,
        tokens_out: 100,
        messages: [
          { role: 'user', content: 'Run tests', timestamp: clock },
          { role: 'assistant', content: 'All green', timestamp: clock + 800 },
        ],
        outputs: [
          { type: 'commit', summary: 'No changes' },
        ],
      });
      const tx = store.getTranscript('tx_one_shot');
      expect(tx.messages).toHaveLength(2);
      expect(tx.outputs).toHaveLength(1);
      expect(tx.cost_usd).toBeCloseTo(0.002, 5);
    });

    it('upsert overwrites header fields', () => {
      store.recordTranscript({
        id: 'tx_upsert',
        ship: 'qa',
        spawned_agent_id: 'a',
        trigger: 'manual',
        backend: 'claude',
        model: 'm',
        status: 'running',
        started_at: clock,
        messages: [],
        outputs: [],
      });
      store.recordTranscript({
        id: 'tx_upsert',
        ship: 'qa',
        spawned_agent_id: 'a',
        trigger: 'manual',
        backend: 'claude',
        model: 'm',
        status: 'completed',
        started_at: clock,
        ended_at: clock + 100,
        cost_usd: 0.01,
        messages: [],
        outputs: [],
      });
      const tx = store.getTranscript('tx_upsert');
      expect(tx.status).toBe('completed');
      expect(tx.ended_at).toBe(clock + 100);
    });

    it('does not reopen or append to an already terminal imported transcript', () => {
      const terminal = {
        id: 'tx_import_frozen',
        ship: 'qa',
        spawned_agent_id: 'a',
        trigger: 'manual',
        backend: 'claude',
        model: 'm',
        status: 'completed',
        started_at: clock,
        ended_at: clock + 100,
        messages: [{ role: 'assistant', content: 'original', timestamp: clock }],
        outputs: [{ type: 'commit', summary: 'original output' }],
      };
      store.recordTranscript(terminal);

      expect(() => store.recordTranscript({
        ...terminal,
        status: 'running',
        ended_at: null,
        messages: [{ role: 'assistant', content: 'replacement', timestamp: clock + 1 }],
        outputs: [{ type: 'other', summary: 'replacement output' }],
      })).toThrow(/terminal and immutable/);
      expect(store.getTranscript(terminal.id)).toEqual(expect.objectContaining({
        status: 'completed',
        messages: [{ role: 'assistant', content: 'original', timestamp: clock }],
        outputs: [{ type: 'commit', summary: 'original output' }],
      }));
    });

    it('rolls back a terminal import when any child row fails', () => {
      store.recordTranscript({
        id: 'tx_atomic_import',
        ship: 'qa',
        spawned_agent_id: 'a',
        trigger: 'manual',
        backend: 'claude',
        model: 'm',
        status: 'running',
        started_at: clock,
        messages: [{ role: 'assistant', content: 'existing running content', timestamp: clock }],
        outputs: [],
      });
      db.exec(`
        CREATE TRIGGER reject_failed_terminal_import
        BEFORE INSERT ON fleet_transcript_messages
        WHEN NEW.content = 'reject this import'
        BEGIN
          SELECT RAISE(ABORT, 'injected child import failure');
        END
      `);

      expect(() => store.recordTranscript({
        id: 'tx_atomic_import',
        ship: 'qa',
        spawned_agent_id: 'a',
        trigger: 'manual',
        backend: 'claude',
        model: 'm',
        status: 'completed',
        started_at: clock,
        ended_at: clock + 100,
        messages: [{ role: 'assistant', content: 'reject this import', timestamp: clock }],
        outputs: [{ type: 'commit', summary: 'must roll back too' }],
      })).toThrow(/injected child import failure/);

      expect(store.getTranscript('tx_atomic_import')).toEqual(expect.objectContaining({
        status: 'running',
        ended_at: null,
        messages: [{ role: 'assistant', content: 'existing running content', timestamp: clock }],
        outputs: [],
      }));
      expect(db.prepare(`
        SELECT status FROM fleet_transcript_archive_receipts WHERE transcript_id = ?
      `).get('tx_atomic_import')).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // listTranscripts filters
  // ───────────────────────────────────────────────────────────────────────────

  describe('listTranscripts', () => {
    function seed() {
      const t0 = clock;
      store.start({ ship: 'code-reviewer', spawned_agent_id: 'a1', trigger: 'pr', backend: 'claude', model: 'm', pr_number: 1, started_at: t0 });
      store.start({ ship: 'qa', spawned_agent_id: 'a2', trigger: 'pr', backend: 'claude', model: 'm', pr_number: 1, started_at: t0 + 1000 });
      store.start({ ship: 'qa', spawned_agent_id: 'a3', trigger: 'manual', backend: 'ollama', model: 'm', started_at: t0 + 2000 });
      store.start({ ship: 'code-reviewer', spawned_agent_id: 'a4', trigger: 'pr', backend: 'claude', model: 'm', pr_number: 2, started_at: t0 + 3000 });
    }

    it('filters by ship', () => {
      seed();
      const rows = store.listTranscripts({ ship: 'qa' });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.ship === 'qa')).toBe(true);
    });

    it('filters by PR number', () => {
      seed();
      const rows = store.listTranscripts({ pr: 1 });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.pr_number === 1)).toBe(true);
    });

    it('filters by agentId', () => {
      seed();
      const rows = store.listTranscripts({ agentId: 'a3' });
      expect(rows).toHaveLength(1);
      expect(rows[0].spawned_agent_id).toBe('a3');
    });

    it('filters by since', () => {
      seed();
      const rows = store.listTranscripts({ since: clock + 1500 });
      expect(rows.map((r) => r.spawned_agent_id).sort()).toEqual(['a3', 'a4']);
    });

    it('orders newest first', () => {
      seed();
      const rows = store.listTranscripts({});
      expect(rows[0].spawned_agent_id).toBe('a4');
      expect(rows[rows.length - 1].spawned_agent_id).toBe('a1');
    });

    it('respects limit', () => {
      seed();
      const rows = store.listTranscripts({ limit: 2 });
      expect(rows).toHaveLength(2);
    });

    it('does not include messages in headers (lightweight)', () => {
      const id = store.start({ ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'c', model: 'm' });
      store.appendMessage(id, { role: 'user', content: 'hello', timestamp: clock });
      const rows = store.listTranscripts({});
      expect(rows[0].messages).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // deleteTranscript
  // ───────────────────────────────────────────────────────────────────────────

  describe('deleteTranscript', () => {
    it('cascades to messages and outputs', () => {
      const id = store.start({ ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'c', model: 'm' });
      store.appendMessage(id, { role: 'user', content: 'x', timestamp: clock });
      store.appendOutput(id, { type: 'noop', summary: 'x' });
      expect(store.deleteTranscript(id)).toBe(true);
      expect(store.getTranscript(id)).toBeNull();
      const msgs = db.prepare('SELECT COUNT(*) AS n FROM fleet_transcript_messages').get();
      const outs = db.prepare('SELECT COUNT(*) AS n FROM fleet_transcript_outputs').get();
      expect(msgs.n).toBe(0);
      expect(outs.n).toBe(0);
    });

    it('returns false for unknown id', () => {
      expect(store.deleteTranscript('tx_does_not_exist')).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // costRollup
  // ───────────────────────────────────────────────────────────────────────────

  describe('costRollup', () => {
    it('sums cost + tokens across ships and days', () => {
      const t0 = clock;
      const cr1 = store.start({ ship: 'code-reviewer', spawned_agent_id: 'a1', trigger: 't', backend: 'c', model: 'm', started_at: t0 });
      store.finalize(cr1, { status: 'completed', cost_usd: 0.01, tokens_in: 100, tokens_out: 50 });
      const cr2 = store.start({ ship: 'code-reviewer', spawned_agent_id: 'a2', trigger: 't', backend: 'c', model: 'm', started_at: t0 });
      store.finalize(cr2, { status: 'completed', cost_usd: 0.02, tokens_in: 200, tokens_out: 100 });
      const qa = store.start({ ship: 'qa', spawned_agent_id: 'a3', trigger: 't', backend: 'c', model: 'm', started_at: t0 });
      store.finalize(qa, { status: 'completed', cost_usd: 0.005, tokens_in: 50, tokens_out: 25 });

      const rollup = store.costRollup({ since: t0 - 1, until: t0 + 1 });
      expect(rollup.total_runs).toBe(3);
      expect(rollup.total_cost_usd).toBeCloseTo(0.035, 5);
      expect(rollup.total_tokens_in).toBe(350);
      expect(rollup.total_tokens_out).toBe(175);

      const reviewer = rollup.by_ship.find((s) => s.ship === 'code-reviewer');
      expect(reviewer.runs).toBe(2);
      expect(reviewer.cost_usd).toBeCloseTo(0.03, 5);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // subscribe / emit
  // ───────────────────────────────────────────────────────────────────────────

  describe('subscribe', () => {
    it('fires start, update, end events on lifecycle', () => {
      const events = [];
      const unsub = store.subscribe((e) => events.push({ type: e.type, id: e.entry.id, status: e.entry.status }));
      const id = store.start({ ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'c', model: 'm' });
      store.appendMessage(id, { role: 'user', content: 'hi', timestamp: clock });
      store.finalize(id, { status: 'completed' });
      unsub();

      expect(events.map((e) => e.type)).toEqual(['start', 'update', 'end']);
      expect(events.every((e) => e.id === id)).toBe(true);
      expect(events[2].status).toBe('completed');
    });

    it('subscriber failure does not throw or stop other listeners', () => {
      const ok = jest.fn();
      store.subscribe(() => { throw new Error('listener bug'); });
      store.subscribe(ok);
      store.start({ ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'c', model: 'm' });
      expect(ok).toHaveBeenCalled();
    });

    it('unsubscribe stops further events', () => {
      const ok = jest.fn();
      const unsub = store.subscribe(ok);
      store.start({ ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'c', model: 'm' });
      expect(ok).toHaveBeenCalledTimes(1);
      unsub();
      store.start({ ship: 's', spawned_agent_id: 'a2', trigger: 't', backend: 'c', model: 'm' });
      expect(ok).toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Secret redaction
  // ───────────────────────────────────────────────────────────────────────────

  describe('redactSecrets', () => {
    it('redacts ANTHROPIC_API_KEY style values', () => {
      const input = 'export ANTHROPIC_API_KEY=sk-ant-superlongsecretvaluetokenabcdef123456789';
      const out = redactSecrets(input);
      expect(out).not.toContain('sk-ant-superlongsecretvaluetokenabcdef123456789');
      expect(out).toMatch(/\[REDACTED:/);
    });

    it('redacts GitHub PAT', () => {
      const input = 'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789';
      const out = redactSecrets(input);
      expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    });

    it('redacts OpenAI keys', () => {
      const input = 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz012345';
      const out = redactSecrets(input);
      expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    });

    it('redacts AWS access keys', () => {
      const input = 'AKIA0123456789ABCDEF';
      const out = redactSecrets(input);
      expect(out).not.toContain('AKIA0123456789ABCDEF');
    });

    it('redacts secrets in message content on append', () => {
      const id = store.start({ ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'c', model: 'm' });
      store.appendMessage(id, {
        role: 'system',
        content: 'env: ANTHROPIC_API_KEY=sk-ant-superlongsecretvaluetokenabcdef123456789',
        timestamp: clock,
      });
      const tx = store.getTranscript(id);
      expect(tx.messages[0].content).not.toContain('sk-ant-superlongsecretvaluetokenabcdef123456789');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Truncation
  // ───────────────────────────────────────────────────────────────────────────

  describe('truncation', () => {
    it('truncates tool-call args > maxToolArgFieldBytes', () => {
      const tinyStore = createTranscripts(createTestDb(), { now, maxToolArgFieldBytes: 64 });
      const id = tinyStore.start({ ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'c', model: 'm' });
      const bigContents = 'A'.repeat(2000);
      tinyStore.appendMessage(id, {
        role: 'assistant',
        content: 'making a tool call',
        timestamp: clock,
        tool_calls: [{ name: 'edit_file', args: { path: '/x', contents: bigContents } }],
      });
      const tx = tinyStore.getTranscript(id);
      const stored = tx.messages[0].tool_calls[0].args.contents;
      expect(stored).toMatch(/\[truncated: original=\d+ chars sha256:[a-f0-9]{16}\]/);
      expect(stored.length).toBeLessThan(bigContents.length);
    });

    it('truncates message content > maxMessageContentBytes', () => {
      const tinyStore = createTranscripts(createTestDb(), { now, maxMessageContentBytes: 32 });
      const id = tinyStore.start({ ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'c', model: 'm' });
      tinyStore.appendMessage(id, {
        role: 'assistant',
        content: 'X'.repeat(500),
        timestamp: clock,
      });
      const tx = tinyStore.getTranscript(id);
      expect(tx.messages[0].content).toMatch(/\[truncated: original=\d+ chars sha256:/);
    });
  });
});
