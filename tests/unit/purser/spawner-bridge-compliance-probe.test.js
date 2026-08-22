/**
 * Purser contract for #6048, obligation 3 — runProbeAndRecord must grant
 * EXACTLY C1 to an agent with a real, verifiable transcript (not C0, not
 * higher), grant only C0 to an agent with zero transcript events (no free
 * C1), and record the result in the event ledger.
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol). Defects in the authored
 * draft, each fixed while keeping the adversarial intent:
 *
 *   1. UNDISCOVERABLE. tests/purser/test-compliance-probe.js matched no jest
 *      testMatch pattern; it never ran. Moved here as *.test.js.
 *   2. WRONG MODULE SYSTEM + DEPTH. CommonJS `require('../lib/...')` in a
 *      `"type": "module"` repo, one `../` short of the repo root.
 *   3. DEAD FANTASY IMPORT. It required `runComplianceProbe` from
 *      lib/agent-harbor/compliance-probe and then never used it — the bridge
 *      runs the probe itself inside runProbeAndRecord. Dropped.
 *   4. FANTASY FIXTURE + SCHEMA. A shared `db` from a nonexistent
 *      './test-utils', and a `compliance_probe_result` TABLE with a
 *      `witnessedLevel` column. The real record is a
 *      'compliance-probe-result' FACT in harbor_events; witnessedLevel lives
 *      in its payload_json — read the way projections.ts itself reads it.
 *
 * Kept obligations, strengthened: the C1 grant must ALSO surface in the
 * projected roster (compliance_level advances to exactly C1 only via the
 * witnessed probe — ADR-0095 §8's "self-report is not evidence" posture), and
 * the zero-transcript agent's roster must stay at C0.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { initDatabase, closeDatabase } from '../../../lib/db.js';
import { createSpawnerHarborBridge } from '../../../lib/agent-harbor/spawner-bridge.js';
import { projectPending, getRoster } from '../../../lib/agent-harbor/projections.js';

describe('purser #6048 — runProbeAndRecord', () => {
  let db;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
  });

  afterEach(() => {
    closeDatabase(db);
  });

  /** Read the last-appended probe payload the way projections.ts does. */
  function lastProbePayload(agentId) {
    const row = db
      .prepare(
        "SELECT payload_json FROM harbor_events WHERE stream_type = 'compliance-probe-result' AND agent_node_id = ? ORDER BY ledger_seq DESC LIMIT 1",
      )
      .get(agentId);
    return row ? JSON.parse(row.payload_json) : null;
  }

  function rosterRow(agentId) {
    projectPending(db);
    return getRoster(db).rows.find((r) => r.agent_node_id === agentId);
  }

  it('grants exactly C1 for an agent with a real transcript — and the roster follows', async () => {
    const bridge = createSpawnerHarborBridge(db);
    bridge.registerNode('purser-agent-123', 'id', Date.now());
    bridge.appendTranscriptEvent('purser-agent-123', 'spawn-start', Date.now());

    await bridge.runProbeAndRecord('purser-agent-123');

    const results = db
      .prepare("SELECT payload_json FROM harbor_events WHERE stream_type = 'compliance-probe-result'")
      .all();
    expect(results).toHaveLength(1);

    const probe = lastProbePayload('purser-agent-123');
    expect(probe.witnessedLevel).toBe('C1');
    // Not merely witnessed C1 — granted exactly C1, no over-claim.
    expect(probe.complianceLevel).toBe('C1');
    expect(rosterRow('purser-agent-123').compliance_level).toBe('C1');
  });

  it('grants only C0 for an agent with no transcript events (no free C1)', async () => {
    const bridge = createSpawnerHarborBridge(db);
    bridge.registerNode('purser-agent-456', 'id', Date.now());

    await bridge.runProbeAndRecord('purser-agent-456');

    const results = db
      .prepare("SELECT payload_json FROM harbor_events WHERE stream_type = 'compliance-probe-result'")
      .all();
    expect(results).toHaveLength(1);

    const probe = lastProbePayload('purser-agent-456');
    expect(probe.witnessedLevel).toBe('C0');
    expect(rosterRow('purser-agent-456').compliance_level).toBe('C0');
  });
});
