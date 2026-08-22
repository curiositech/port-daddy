/**
 * Purser contract for #6048, obligation 2 — appendTranscriptEvent must feed
 * the EXISTING hash-chained event ledger (harbor_events content_hash /
 * prev_hash), so each event's prev_hash equals the previous event's
 * content_hash and the whole per-agent chain verifies.
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol). Defects in the authored
 * draft, each fixed while keeping the adversarial intent:
 *
 *   1. UNDISCOVERABLE. tests/purser/test-transcript-events.js matches no jest
 *      testMatch pattern (`tests/unit/**\/*.test.{js,ts}`); it never ran.
 *      Moved here as *.test.js.
 *   2. WRONG MODULE SYSTEM + DEPTH. CommonJS `require('../lib/...')` in a
 *      `"type": "module"` repo, and one `../` short of the repo root even
 *      from its old directory. Now ESM imports at the correct depth.
 *   3. FANTASY FIXTURE. `require('./test-utils')` for a shared `db`; the real
 *      pattern is a fresh `initDatabase({ inMemory: true })` per test.
 *   4. FANTASY COLUMN NAMES. The draft filtered on a `streamType` column and
 *      relied on implicit ordering. The real harbor_events columns are
 *      snake_case (stream_type, content_hash, prev_hash, ledger_seq,
 *      session_id) and order must be pinned with ORDER BY ledger_seq.
 *
 * Kept obligations: (a) consecutive events genuinely hash-chain — the second
 * event's prev_hash IS the first event's content_hash, straight out of the
 * ledger the bridge feeds (the bridge computes no hash of its own); (b) two
 * events of the same kind for the same agent are both recorded without error
 * (each gets its own eventId and the next per-agent sequence — "duplicate"
 * kinds are normal transcript traffic, not an idempotency collision).
 * Strengthened with the ledger's own verifier: verifySessionChain must report
 * the chain unbroken (null), so the assertion is against the real chain rule,
 * not this test's private idea of it.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { initDatabase, closeDatabase } from '../../../lib/db.js';
import { createSpawnerHarborBridge } from '../../../lib/agent-harbor/spawner-bridge.js';
import { verifySessionChain } from '../../../lib/agent-harbor/event-ledger.js';

describe('purser #6048 — appendTranscriptEvent', () => {
  let db;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('creates valid hash-chained events (prev_hash = previous content_hash, chain verifies)', () => {
    const bridge = createSpawnerHarborBridge(db);
    const t0 = Date.now();
    bridge.appendTranscriptEvent('purser-agent-123', 'spawn-start', t0);
    bridge.appendTranscriptEvent('purser-agent-123', 'assistant-message', t0 + 1000);

    const events = db
      .prepare(
        "SELECT content_hash, prev_hash FROM harbor_events WHERE stream_type = 'transcript-event' AND session_id = ? ORDER BY ledger_seq ASC",
      )
      .all('purser-agent-123');
    expect(events).toHaveLength(2);
    expect(events[0].content_hash).toBeTruthy();
    expect(events[1].prev_hash).toBe(events[0].content_hash);

    // The ledger's own verifier agrees the chain is unbroken (sessionId is
    // the agentId by the bridge's design: one spawn = one session).
    expect(verifySessionChain(db, 'purser-agent-123')).toBeNull();
  });

  it('records repeated kinds for the same agent without error (distinct events, advancing sequence)', () => {
    const bridge = createSpawnerHarborBridge(db);
    const t0 = Date.now();
    bridge.appendTranscriptEvent('purser-agent-123', 'spawn-start', t0);
    bridge.appendTranscriptEvent('purser-agent-123', 'spawn-start', t0 + 1000);

    const events = db
      .prepare(
        "SELECT sequence FROM harbor_events WHERE stream_type = 'transcript-event' AND session_id = ? ORDER BY ledger_seq ASC",
      )
      .all('purser-agent-123');
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.sequence)).toEqual([1, 2]);
    expect(verifySessionChain(db, 'purser-agent-123')).toBeNull();
  });
});
