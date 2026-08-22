/**
 * Purser contract for #6048, obligation 1 — registerNode must create a REAL
 * Agent Harbor node for a spawner agent, honestly self-claimed at C0 (the
 * level is only ever upgraded later by a witnessed probe, never by the claim).
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol). The authored draft had
 * four defects, each fixed here while keeping every honest obligation:
 *
 *   1. UNDISCOVERABLE. It lived at tests/purser/test-register-node.js — jest's
 *      testMatch is `tests/{unit,integration}/**\/*.test.{js,ts}`, so the file
 *      never ran anywhere. Moved to tests/unit/purser/ with a *.test.js name,
 *      the same place earlier repaired purser suites live.
 *   2. WRONG MODULE SYSTEM + WRONG DEPTH. `require('../lib/agent-harbor/
 *      spawner-bridge')` — this repo is `"type": "module"` (require is not
 *      defined in a .js test), and even the path was one `../` short of the
 *      repo root from tests/purser/, let alone from here (../../../ now).
 *   3. FANTASY FIXTURE. `require('./test-utils')` for a shared `db` — no such
 *      helper exports a db for this suite. The real pattern (used by the PR's
 *      own tests/unit/agent-harbor-spawner-bridge.test.ts) is a fresh
 *      `initDatabase({ inMemory: true })` per test.
 *   4. FANTASY SCHEMA. It queried a `agent_node` TABLE with a
 *      `complianceLevel` column. Neither exists: the bridge appends an
 *      `agent-node` FACT to the `harbor_events` ledger (columns stream_type /
 *      payload_json / ...), and the roster is a projection
 *      (lib/agent-harbor/projections.ts getRoster → compliance_level).
 *
 * One assertion was also a fantasy CONTRACT, not just fantasy plumbing: the
 * draft asserted `registerNode('')` leaves ZERO rows. The real ledger's
 * validateRequired() rejects only null/undefined payload fields — an empty
 * string id is accepted and recorded, and the bridge's actual promise is
 * narrower and better: best-effort, never throws, and never a level above the
 * honest C0. The empty-id test below asserts the real contract (no throw, and
 * whatever lands in the ledger still self-claims only C0 — no path to a free
 * upgrade through a degenerate id).
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { initDatabase, closeDatabase } from '../../../lib/db.js';
import { createSpawnerHarborBridge } from '../../../lib/agent-harbor/spawner-bridge.js';
import { projectPending, getRoster } from '../../../lib/agent-harbor/projections.js';

describe('purser #6048 — registerNode', () => {
  let db;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
  });

  afterEach(() => {
    closeDatabase(db);
  });

  function rosterRow(agentId) {
    projectPending(db);
    return getRoster(db).rows.find((r) => r.agent_node_id === agentId);
  }

  it('registers a valid agent as a real, non-placeholder roster row at honest C0', () => {
    const bridge = createSpawnerHarborBridge(db);
    bridge.registerNode('purser-agent-123', 'purser:test-identity', Date.now());

    // The fact lands in the real ledger, not a bespoke table.
    const facts = db
      .prepare("SELECT payload_json FROM harbor_events WHERE stream_type = 'agent-node'")
      .all();
    expect(facts).toHaveLength(1);
    expect(JSON.parse(facts[0].payload_json).complianceLevel).toBe('C0');

    // And the projected roster row is real: not a placeholder, honestly C0.
    const row = rosterRow('purser-agent-123');
    expect(row).toBeDefined();
    expect(row.placeholder).toBe(0);
    expect(row.compliance_level).toBe('C0');
  });

  it('handles an empty agentId gracefully — never throws, never claims above C0', () => {
    const bridge = createSpawnerHarborBridge(db);
    expect(() => bridge.registerNode('', null, Date.now())).not.toThrow();

    // Real contract: the ledger accepts the degenerate id (validateRequired
    // rejects only null/undefined), but nothing about it can smuggle in a
    // level above the honest C0 self-claim.
    for (const fact of db
      .prepare("SELECT payload_json FROM harbor_events WHERE stream_type = 'agent-node'")
      .all()) {
      expect(JSON.parse(fact.payload_json).complianceLevel).toBe('C0');
    }
  });

  it('does not throw on database errors (best-effort posture)', () => {
    const badDb = {
      prepare: () => {
        throw new Error('DB error');
      },
    };
    const bridge = createSpawnerHarborBridge(badDb);
    expect(() => bridge.registerNode('purser-agent-123', 'id', Date.now())).not.toThrow();
  });
});
