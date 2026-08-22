/**
 * Purser contract for #6048, obligation 7 (chain integrity under load) — many
 * interleaved transcript appends for one agent must yield unique, gapless,
 * incrementing sequence numbers and an unbroken hash chain.
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol). Defects in the authored
 * draft, each fixed while keeping the adversarial intent:
 *
 *   1. UNDISCOVERABLE + NAME CLASH. tests/purser/test-concurrency.js matched
 *      no jest testMatch pattern — and the draft OVERWROTE a pre-existing,
 *      unrelated roadmap-snapshot test of the same name already on this
 *      branch. The clobbered original is restored at its old path; this
 *      repair lives here under a name that says what it tests.
 *   2. WRONG MODULE SYSTEM + DEPTH. CommonJS `require('../lib/...')` in a
 *      `"type": "module"` repo, one `../` short of the repo root.
 *   3. FANTASY FIXTURE + COLUMN. Shared `db` from a nonexistent
 *      './test-utils'; a `streamType` column (real: stream_type).
 *   4. FAKE CONCURRENCY, HONESTLY LABELED. The draft wrapped appends in
 *      Promise.all — but appendTranscriptEvent is SYNCHRONOUS (returns void),
 *      so Promise.all over its return values awaits nothing and adds no
 *      concurrency. What the obligation can honestly mean in-process is
 *      interleaving across microtasks against one bridge, which is what the
 *      repair does: the sequence counter and the ledger must stay collision-
 *      free regardless of the tick each append lands on. (True cross-process
 *      races are the integration suite's jurisdiction, not a unit test's.)
 *
 * Kept obligations: 11 appends → 11 events; sequences are exactly 1..11 with
 * no duplicates and no gaps. Strengthened with the ledger's own verifier:
 * the per-agent hash chain must still verify end-to-end afterwards.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { initDatabase, closeDatabase } from '../../../lib/db.js';
import { createSpawnerHarborBridge } from '../../../lib/agent-harbor/spawner-bridge.js';
import { verifySessionChain } from '../../../lib/agent-harbor/event-ledger.js';

describe('purser #6048 — concurrency safety', () => {
  let db;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('interleaved appends keep sequences unique, gapless, and the chain verifiable', async () => {
    const bridge = createSpawnerHarborBridge(db);
    const agentId = 'purser-agent-123';
    const t0 = Date.now();
    bridge.appendTranscriptEvent(agentId, 'spawn-start', t0);

    // Interleave 10 more appends across separate microtasks — each lands on
    // its own tick, in whatever order the scheduler dictates.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        Promise.resolve().then(() =>
          bridge.appendTranscriptEvent(agentId, 'delta', t0 + 1 + i),
        ),
      ),
    );

    const events = db
      .prepare(
        "SELECT sequence FROM harbor_events WHERE stream_type = 'transcript-event' AND session_id = ? ORDER BY ledger_seq ASC",
      )
      .all(agentId);
    expect(events).toHaveLength(11);

    // Unique and incrementing: exactly 1..11, no duplicate grabbed under
    // interleaving, no gap left by a dropped write.
    const seqs = events.map((e) => e.sequence).sort((a, b) => a - b);
    expect(seqs).toEqual([...Array(11).keys()].map((i) => i + 1));

    // And the ledger's own verifier still finds the chain unbroken.
    expect(verifySessionChain(db, agentId)).toBeNull();
  });
});
