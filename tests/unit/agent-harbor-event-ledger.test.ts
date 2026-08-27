/**
 * Agent Harbor event ledger tests (binder ch18 Work Order C1; ADR-0095).
 *
 * Gates covered here:
 *   - append-only is enforced (UPDATE/DELETE rejected by trigger);
 *   - duplicate events are idempotent (event_id AND idempotency key);
 *   - unknown schema fields are tolerated and preserved (tolerant reader);
 *   - per-session (sessionId, sequence) uniqueness and hash chain;
 *   - fail-closed validation against the frozen F0 required fields.
 *
 * Payload fixtures are loaded from schemas/agent-harbor/v0/fixtures/ so the
 * ledger is tested against the exact frozen contract instances.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initDatabase, closeDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import {
  appendEvent,
  readEvents,
  ledgerHeadSeq,
  verifySessionChain,
  ensureEventLedgerSchema,
  computeContentHash,
  LedgerValidationError,
  SequenceConflictError,
  type HarborPayload,
} from '../../lib/agent-harbor/event-ledger.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', '..', 'schemas', 'agent-harbor', 'v0', 'fixtures');

function fixture(name: string): HarborPayload {
  return JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), 'utf8')) as HarborPayload;
}

/** Frozen fixture, minus the sender-side hash fields the ledger assigns. */
function transcriptFixture(overrides: HarborPayload = {}): HarborPayload {
  const base = fixture('transcript-event');
  delete base.contentHash;
  delete base.prevHash;
  // Each test event needs unique identity/ordering fields by default.
  return { ...base, ...overrides };
}

describe('agent-harbor event ledger', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    ensureEventLedgerSchema(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  describe('schema + verification (sqlite-durable-agent-state)', () => {
    it('is idempotent — ensure twice is safe', () => {
      expect(() => ensureEventLedgerSchema(db)).not.toThrow();
      expect(() => ensureEventLedgerSchema(db)).not.toThrow();
    });

    it('verifies the live table, and fails closed when the schema is wrong', () => {
      // A pre-existing partial table makes CREATE TABLE IF NOT EXISTS a silent
      // no-op — exactly the "migration history is not migration" trap. The
      // post-apply probe must catch it by inspecting the real table.
      db.exec('DROP TRIGGER harbor_events_no_update; DROP TRIGGER harbor_events_no_delete; DROP TABLE harbor_events;');
      db.exec(`CREATE TABLE harbor_events (
        ledger_seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        stream_type TEXT NOT NULL,
        agent_node_id TEXT, session_id TEXT, sequence REAL,
        idempotency_key TEXT
      )`);
      expect(() => ensureEventLedgerSchema(db)).toThrow(/verification failed: missing columns/);
    });
  });

  describe('append-only enforcement', () => {
    it('rejects UPDATE and DELETE on persisted events', () => {
      appendEvent(db, { streamType: 'transcript-event', payload: transcriptFixture() });
      expect(() => db.prepare("UPDATE harbor_events SET kind = 'forged'").run()).toThrow(/append-only/);
      expect(() => db.prepare('DELETE FROM harbor_events').run()).toThrow(/append-only/);
    });
  });

  describe('idempotency (duplicate events are no-ops)', () => {
    it('duplicate eventId returns the original row and writes nothing', () => {
      const first = appendEvent(db, { streamType: 'transcript-event', payload: transcriptFixture() });
      const dup = appendEvent(db, { streamType: 'transcript-event', payload: transcriptFixture() });
      expect(first.duplicate).toBe(false);
      expect(dup.duplicate).toBe(true);
      expect(dup.ledgerSeq).toBe(first.ledgerSeq);
      expect(ledgerHeadSeq(db)).toBe(first.ledgerSeq);
    });

    it('duplicate (streamType, idempotencyKey) with a DIFFERENT eventId is a no-op', () => {
      const first = appendEvent(db, { streamType: 'transcript-event', payload: transcriptFixture() });
      const retry = transcriptFixture({ eventId: 'evt_retry_different_id', sequence: 43 });
      // Same source.idempotencyKey as the fixture — a reconnecting stream retry.
      const dup = appendEvent(db, { streamType: 'transcript-event', payload: retry });
      expect(dup.duplicate).toBe(true);
      expect(dup.eventId).toBe(first.eventId);
      expect(ledgerHeadSeq(db)).toBe(first.ledgerSeq);
    });

    it('duplicate cost event idempotencyKey is a no-op (no double-spend)', () => {
      const first = appendEvent(db, { streamType: 'cost-accrual-event', payload: fixture('cost-accrual-event') });
      const retryPayload = { ...fixture('cost-accrual-event'), costEventId: 'cost_retry_9' };
      const dup = appendEvent(db, { streamType: 'cost-accrual-event', payload: retryPayload });
      expect(dup.duplicate).toBe(true);
      expect(dup.eventId).toBe(first.eventId);
    });

    it('agent-node state facts derive event ids from content: unchanged fact is a no-op, changed fact is a new event', () => {
      const node = fixture('agent-node');
      const a = appendEvent(db, { streamType: 'agent-node', payload: node });
      const b = appendEvent(db, { streamType: 'agent-node', payload: fixture('agent-node') });
      expect(b.duplicate).toBe(true);
      expect(b.ledgerSeq).toBe(a.ledgerSeq);

      const changed = appendEvent(db, {
        streamType: 'agent-node',
        payload: { ...fixture('agent-node'), status: 'paused' },
      });
      expect(changed.duplicate).toBe(false);
      expect(changed.ledgerSeq).toBeGreaterThan(a.ledgerSeq);
    });
  });

  describe('per-session sequence + hash chain', () => {
    it('assigns prevHash from the previous persisted event of the same session (null first)', () => {
      const e1 = appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcriptFixture({ eventId: 'evt_1', sequence: 1, source: {} }),
      });
      const e2 = appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcriptFixture({ eventId: 'evt_2', sequence: 2, source: {} }),
      });
      expect(e1.prevHash).toBeNull();
      expect(e1.contentHash).toMatch(/^sha256:/);
      expect(e2.prevHash).toBe(e1.contentHash);
      expect(verifySessionChain(db, 'session_01JZFIX0001')).toBeNull();
    });

    it('chains are per-session — a second session starts at null again', () => {
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcriptFixture({ eventId: 'evt_a', sequence: 1, source: {} }),
      });
      const other = appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcriptFixture({ eventId: 'evt_b', sessionId: 'session_other', sequence: 1, source: {} }),
      });
      expect(other.prevHash).toBeNull();
    });

    it('rejects a caller-supplied contentHash that disagrees with the canonical body (forged hash)', () => {
      expect(() =>
        appendEvent(db, {
          streamType: 'transcript-event',
          payload: transcriptFixture({
            eventId: 'evt_forged_hash',
            sequence: 1,
            source: {},
            contentHash: 'sha256:' + 'f'.repeat(64),
          }),
        }),
      ).toThrow(LedgerValidationError);
      // Nothing was persisted — the forged hash never entered the chain.
      expect(ledgerHeadSeq(db)).toBe(0);
    });

    it('accepts a caller-supplied contentHash that matches the canonical body', () => {
      const payload = transcriptFixture({ eventId: 'evt_honest_hash', sequence: 1, source: {} });
      const honest = computeContentHash(payload);
      const res = appendEvent(db, {
        streamType: 'transcript-event',
        payload: { ...payload, contentHash: honest },
      });
      expect(res.duplicate).toBe(false);
      expect(res.contentHash).toBe(honest);
    });

    it('state-fact event ids embed the FULL content hash (no truncated collision window)', () => {
      const res = appendEvent(db, { streamType: 'agent-node', payload: fixture('agent-node') });
      const hex = res.eventId.split(':').pop() as string;
      expect(hex).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects a (sessionId, sequence) collision under a different eventId', () => {
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcriptFixture({ eventId: 'evt_1', sequence: 7, source: {} }),
      });
      expect(() =>
        appendEvent(db, {
          streamType: 'transcript-event',
          payload: transcriptFixture({ eventId: 'evt_2_same_seq', sequence: 7, source: {} }),
        }),
      ).toThrow(SequenceConflictError);
    });

    it('rejects an event whose claimed prevHash contradicts the ledger head (tamper evidence)', () => {
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcriptFixture({ eventId: 'evt_1', sequence: 1, source: {} }),
      });
      expect(() =>
        appendEvent(db, {
          streamType: 'transcript-event',
          payload: transcriptFixture({ eventId: 'evt_2', sequence: 2, source: {}, prevHash: 'sha256:forged' }),
        }),
      ).toThrow(/hash-chain conflict/);
    });

    it('canonical hashing is key-order independent and excludes contentHash/prevHash', () => {
      const a = computeContentHash({ x: 1, y: { b: 2, a: 3 } });
      const b = computeContentHash({ y: { a: 3, b: 2 }, x: 1, contentHash: 'sha256:zzz', prevHash: null });
      expect(a).toBe(b);
    });
  });

  describe('fail-closed validation against the frozen contracts', () => {
    it('rejects a transcript event missing a required field', () => {
      const bad = transcriptFixture();
      delete bad.sessionId;
      expect(() => appendEvent(db, { streamType: 'transcript-event', payload: bad })).toThrow(
        LedgerValidationError,
      );
    });

    it('rejects a transcript event with the wrong schemaVersion', () => {
      expect(() =>
        appendEvent(db, { streamType: 'transcript-event', payload: transcriptFixture({ schemaVersion: 2 }) }),
      ).toThrow(/schemaVersion must be 1/);
    });

    it('rejects a payload whose schema discriminator is not the frozen v0 const', () => {
      const bad = { ...fixture('cost-accrual-event'), schema: 'pd.agent-harbor.cost-accrual-event.v1' };
      expect(() => appendEvent(db, { streamType: 'cost-accrual-event', payload: bad })).toThrow(
        /schema discriminator/,
      );
    });

    it('rejects an unknown streamType', () => {
      expect(() =>
        appendEvent(db, { streamType: 'mystery-stream' as never, payload: transcriptFixture() }),
      ).toThrow(/unknown streamType/);
    });

    it('accepts every frozen fixture instance', () => {
      expect(appendEvent(db, { streamType: 'work-intent', payload: fixture('work-intent') }).duplicate).toBe(false);
      expect(appendEvent(db, { streamType: 'work-plan', payload: fixture('work-plan') }).duplicate).toBe(false);
      expect(appendEvent(db, { streamType: 'control-command', payload: fixture('control-command') }).duplicate).toBe(false);
      expect(appendEvent(db, { streamType: 'transcript-event', payload: transcriptFixture() }).duplicate).toBe(false);
      expect(appendEvent(db, { streamType: 'cost-accrual-event', payload: fixture('cost-accrual-event') }).duplicate).toBe(false);
      expect(appendEvent(db, { streamType: 'compliance-probe-result', payload: fixture('compliance-probe-result') }).duplicate).toBe(false);
      expect(appendEvent(db, { streamType: 'work-receipt', payload: fixture('work-receipt') }).duplicate).toBe(false);
      expect(appendEvent(db, { streamType: 'doctrine-evidence', payload: fixture('doctrine-evidence') }).duplicate).toBe(false);
      expect(appendEvent(db, { streamType: 'agent-node', payload: fixture('agent-node') }).duplicate).toBe(false);
      expect(appendEvent(db, { streamType: 'agent-run', payload: fixture('agent-run') }).duplicate).toBe(false);
    });
  });

  describe('tolerant reader (ADR-0095 §6)', () => {
    it('tolerates unknown fields and unknown kinds, preserving them byte-for-byte', () => {
      const exotic = transcriptFixture({
        eventId: 'evt_exotic',
        sequence: 99,
        kind: 'quantum_entanglement_report', // unknown kind: open string
        futureField: { nested: ['unknown', 'data'] },
        source: {},
      });
      const result = appendEvent(db, { streamType: 'transcript-event', payload: exotic });
      expect(result.duplicate).toBe(false);

      const rows = readEvents(db, { sessionId: 'session_01JZFIX0001' });
      const stored = JSON.parse(rows[rows.length - 1].payload_json);
      expect(stored.futureField).toEqual({ nested: ['unknown', 'data'] });
      expect(stored.kind).toBe('quantum_entanglement_report');
    });
  });

  describe('replay reads', () => {
    it('reads events in global ledger order with filters', () => {
      appendEvent(db, { streamType: 'agent-node', payload: fixture('agent-node') });
      appendEvent(db, { streamType: 'transcript-event', payload: transcriptFixture({ source: {} }) });
      appendEvent(db, { streamType: 'cost-accrual-event', payload: fixture('cost-accrual-event') });

      const all = readEvents(db);
      expect(all.map((r) => r.ledger_seq)).toEqual([1, 2, 3]);
      expect(readEvents(db, { streamType: 'cost-accrual-event' })).toHaveLength(1);
      expect(readEvents(db, { afterSeq: 2 })).toHaveLength(1);
    });
  });
});
