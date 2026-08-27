/**
 * Agent Harbor projection tests (binder ch18 Work Order C1; ADR-0095).
 *
 * Gates covered here:
 *   - projections rebuild from scratch (rebuild == incremental result);
 *   - duplicate application is idempotent (replaying events changes nothing);
 *   - unknown schema fields are tolerated;
 *   - stale views are labeled and NEVER used for command authorization;
 *   - compliance projection recomputes witnessing via the frozen
 *     compliance-invariants.mjs — an over-claiming (self-attested) probe is
 *     recorded invalid and never advances the roster.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initDatabase, closeDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import { appendEvent, type HarborPayload } from '../../lib/agent-harbor/event-ledger.js';
import {
  PROJECTIONS,
  projectPending,
  rebuildProjections,
  getProjectionStatus,
  assertProjectionFreshForCommand,
  isProjectionFresh,
  StaleProjectionError,
  getRoster,
  getTranscriptTimeline,
  getFilesTouched,
  getCostSummary,
  getCompliance,
  getWorkReceipts,
  getDoctrineProjection,
} from '../../lib/agent-harbor/projections.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', '..', 'schemas', 'agent-harbor', 'v0', 'fixtures');

function fixture(name: string): HarborPayload {
  return JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), 'utf8')) as HarborPayload;
}

const NODE_ID = 'agent_node_01JZFIX0001';
const SESSION_ID = 'session_01JZFIX0001';

function transcript(overrides: HarborPayload): HarborPayload {
  return {
    eventId: `evt_${String(overrides.sequence)}`,
    sessionId: SESSION_ID,
    agentNodeId: NODE_ID,
    occurredAt: '2026-07-05T12:00:00.000Z',
    schemaVersion: 1,
    kind: 'assistant_message',
    visibility: 'operator',
    payloadJson: {},
    ...overrides,
  };
}

/** Seed a realistic run: node fact, run fact, transcript, costs, probe, receipt. */
function seed(db: DatabaseInstance): void {
  appendEvent(db, { streamType: 'agent-node', payload: fixture('agent-node') });
  appendEvent(db, { streamType: 'agent-run', payload: fixture('agent-run') });
  appendEvent(db, { streamType: 'transcript-event', payload: transcript({ sequence: 1, kind: 'session_started' }) });
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcript({
      sequence: 2,
      kind: 'file_write',
      payloadJson: { path: 'lib/auth.ts', absolutePath: '/repo/lib/auth.ts' },
    }),
  });
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcript({
      sequence: 3,
      kind: 'file_write',
      payloadJson: { path: 'lib/auth.ts', absolutePath: '/repo/lib/auth.ts' },
    }),
  });
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcript({
      sequence: 4,
      kind: 'file_read',
      payloadJson: { path: 'lib/db.ts' },
    }),
  });
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcript({ sequence: 5, kind: 'heartbeat', occurredAt: '2026-07-05T12:05:00.000Z' }),
  });
  appendEvent(db, { streamType: 'cost-accrual-event', payload: fixture('cost-accrual-event') });
  appendEvent(db, {
    streamType: 'cost-accrual-event',
    payload: {
      ...fixture('cost-accrual-event'),
      costEventId: 'cost_02',
      idempotencyKey: 'cost:run:finalization:1',
      phase: 'finalization',
      quantity: 1000,
      estimatedCostUsd: 0.05,
      actualCostUsd: 0.04,
      budgetAction: 'warning',
    },
  });
  appendEvent(db, { streamType: 'compliance-probe-result', payload: fixture('compliance-probe-result') });
  appendEvent(db, { streamType: 'work-receipt', payload: fixture('work-receipt') });
}

/** Deterministic dump of every projection table for equality comparison. */
function dumpProjections(db: DatabaseInstance): Record<string, unknown[]> {
  const tables = [
    'harbor_proj_roster',
    'harbor_proj_timeline',
    'harbor_proj_files_touched',
    'harbor_proj_costs',
    'harbor_proj_compliance',
    'harbor_proj_work_receipts',
    'harbor_proj_doctrine',
  ];
  const dump: Record<string, unknown[]> = {};
  for (const table of tables) {
    dump[table] = db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all();
  }
  return dump;
}

describe('agent-harbor projections', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    seed(db);
    projectPending(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  describe('roster projection', () => {
    it('materializes the Agent Node with identity, compliance, and liveness', () => {
      const roster = getRoster(db);
      expect(roster.stale).toBe(false);
      expect(roster.rows).toHaveLength(1);
      const node = roster.rows[0] as Record<string, unknown>;
      expect(node.agent_node_id).toBe(NODE_ID);
      expect(node.identity).toBeTruthy();
      expect(node.placeholder).toBe(0);
      expect(node.event_count).toBe(5);
      expect(node.last_heartbeat_at).toBe('2026-07-05T12:05:00.000Z');
      expect(node.compliance_level).toBe('C2'); // witness-valid probe granted C2
      expect(node.compliance_probe_id).toBe('probe_01JZFIX0001');
    });

    it('creates an honest observed placeholder when a transcript arrives before any node fact', () => {
      const fresh = initDatabase({ inMemory: true });
      appendEvent(fresh, {
        streamType: 'transcript-event',
        payload: transcript({ sequence: 1, agentNodeId: 'agent_node_unknown', eventId: 'evt_orphan' }),
      });
      projectPending(fresh);
      const roster = getRoster(fresh);
      const row = roster.rows[0] as Record<string, unknown>;
      expect(row.agent_node_id).toBe('agent_node_unknown');
      expect(row.placeholder).toBe(1);
      expect(row.official_mode).toBe('observed');
      expect(row.compliance_level).toBe('C0');
      closeDatabase(fresh);
    });

    it('a node fact claiming a level above C0 without a ledgered witness-valid probe NEVER advances the roster', () => {
      const fresh = initDatabase({ inMemory: true });
      // The fixture self-reports C2 + a probe id, but the probe is NOT in the
      // ledger — checkNodeWitnessing fails and the claim is refused.
      appendEvent(fresh, { streamType: 'agent-node', payload: fixture('agent-node') });
      projectPending(fresh);
      const row = getRoster(fresh).rows[0] as Record<string, unknown>;
      expect(row.agent_node_id).toBe(NODE_ID);
      expect(row.compliance_level).toBe('C0');
      expect(row.compliance_probe_id).toBeNull();
      closeDatabase(fresh);
    });

    it('a node fact whose level is backed by an already-ledgered witness-valid probe is honored', () => {
      const fresh = initDatabase({ inMemory: true });
      appendEvent(fresh, { streamType: 'compliance-probe-result', payload: fixture('compliance-probe-result') });
      appendEvent(fresh, { streamType: 'agent-node', payload: fixture('agent-node') });
      projectPending(fresh);
      const row = getRoster(fresh).rows[0] as Record<string, unknown>;
      expect(row.compliance_level).toBe('C2');
      expect(row.compliance_probe_id).toBe('probe_01JZFIX0001');
      closeDatabase(fresh);
    });

    it('a node fact omitting the optional officialMode preserves the previously materialized value', () => {
      const fresh = initDatabase({ inMemory: true });
      // Placeholder first — official_mode defaults to the honest 'observed'.
      appendEvent(fresh, {
        streamType: 'transcript-event',
        payload: transcript({ sequence: 1, eventId: 'evt_pre_fact' }),
      });
      const fact = fixture('agent-node');
      delete fact.officialMode;
      appendEvent(fresh, { streamType: 'agent-node', payload: fact });
      projectPending(fresh);
      const row = getRoster(fresh).rows[0] as Record<string, unknown>;
      expect(row.official_mode).toBe('observed'); // not erased to NULL
      closeDatabase(fresh);
    });
  });

  describe('transcript timeline projection', () => {
    it('materializes the session timeline in sequence order with the hash chain', () => {
      const timeline = getTranscriptTimeline(db, SESSION_ID);
      expect(timeline.rows.map((r) => (r as Record<string, unknown>).sequence)).toEqual([1, 2, 3, 4, 5]);
      const first = timeline.rows[0] as Record<string, unknown>;
      const second = timeline.rows[1] as Record<string, unknown>;
      expect(first.prev_hash).toBeNull();
      expect(second.prev_hash).toBe(first.content_hash);
      expect(first.kind).toBe('session_started');
    });
  });

  describe('files-touched projection', () => {
    it('aggregates touches per (session, path, kind) with counts', () => {
      const files = getFilesTouched(db, { sessionId: SESSION_ID });
      expect(files.rows).toHaveLength(2);
      const write = files.rows.find((r) => (r as Record<string, unknown>).touch_kind === 'write') as Record<string, unknown>;
      const read = files.rows.find((r) => (r as Record<string, unknown>).touch_kind === 'read') as Record<string, unknown>;
      expect(write.path).toBe('lib/auth.ts');
      expect(write.touch_count).toBe(2);
      expect(write.absolute_path).toBe('/repo/lib/auth.ts');
      expect(read.path).toBe('lib/db.ts');
      expect(read.touch_count).toBe(1);
    });
  });

  describe('costs projection', () => {
    it('aggregates quantities per meter and dollar totals per (node, session, run)', () => {
      const costs = getCostSummary(db, { agentNodeId: NODE_ID });
      expect(costs.rows).toHaveLength(1);
      const row = costs.rows[0] as Record<string, unknown>;
      expect(row.event_count).toBe(2);
      expect(row.total_estimated_usd).toBeCloseTo(0.27);
      expect(row.total_actual_usd).toBeCloseTo(0.04);
      expect(row.last_budget_action).toBe('warning');
      const meters = JSON.parse(row.meters_json as string) as Record<string, number>;
      expect(meters['tokens:output-tokens']).toBe(19250);
    });
  });

  describe('compliance projection (daemon-witnessed, ADR-0095 §8)', () => {
    it('records a witness-valid probe with the recomputed level', () => {
      const compliance = getCompliance(db, NODE_ID);
      const row = compliance.rows[0] as Record<string, unknown>;
      expect(row.witness_valid).toBe(1);
      expect(row.asserted_level).toBe('C2');
      expect(row.recomputed_level).toBe('C2');
      expect(JSON.parse(row.violations_json as string)).toEqual([]);
    });

    it('an over-claiming (self-attested) probe is recorded invalid and NEVER advances the roster', () => {
      const forged = {
        ...fixture('compliance-probe-result'),
        probeId: 'probe_forged',
        complianceLevel: 'C6',
        witnessedLevel: 'C6',
      };
      appendEvent(db, { streamType: 'compliance-probe-result', payload: forged });
      projectPending(db);

      const compliance = getCompliance(db, NODE_ID);
      const row = compliance.rows[0] as Record<string, unknown>;
      expect(row.probe_id).toBe('probe_forged');
      expect(row.witness_valid).toBe(0);
      expect(row.recomputed_level).toBe('C2');
      expect((JSON.parse(row.violations_json as string) as string[]).length).toBeGreaterThan(0);

      // Roster keeps the last witness-valid grant.
      const roster = getRoster(db);
      const node = roster.rows[0] as Record<string, unknown>;
      expect(node.compliance_level).toBe('C2');
      expect(node.compliance_probe_id).toBe('probe_01JZFIX0001');
    });
  });

  describe('work-receipts projection', () => {
    it('materializes the receipt with strength and artifact-backing', () => {
      const receipts = getWorkReceipts(db, { agentNodeId: NODE_ID });
      expect(receipts.rows).toHaveLength(1);
      const row = receipts.rows[0] as Record<string, unknown>;
      expect(row.transcript_head_hash).toBeTruthy();
      expect(typeof row.strength).toBe('string');
    });
  });

  describe('doctrine projection', () => {
    it('materializes the current revision card from the immutable evidence stream', () => {
      appendEvent(db, {
        streamType: 'doctrine-evidence',
        payload: {
          schema: 'pd.agent-harbor.doctrine-evidence.v0',
          eventId: 'doctrine-projection-candidate',
          idempotencyKey: 'doctrine:projection:candidate',
          kind: 'doctrine_candidate_induced',
          entityId: 'candidate-projection',
          occurredAt: '2026-08-26T12:00:00.000Z',
          projectDir: '/repo/port-daddy',
          actorId: 'agent:steward',
          citations: ['receipt:case-13'],
          payload: {
            doctrineId: 'doctrine:projection',
            episodeId: 'episode-projection',
            decisionClass: 'integration.merge',
            title: 'Treat unresolved independent evidence as blocking',
          },
        },
      });
      projectPending(db, { projection: 'doctrine' });

      const initial = getDoctrineProjection(db);
      expect(initial.stale).toBe(false);
      expect(initial.rows).toHaveLength(1);
      expect(initial.rows[0]).toMatchObject({
        doctrine_id: 'doctrine:projection',
        candidate_id: 'candidate-projection',
        status: 'candidate',
      });

      appendEvent(db, {
        streamType: 'doctrine-evidence',
        payload: {
          schema: 'pd.agent-harbor.doctrine-evidence.v0',
          eventId: 'doctrine-projection-admitted',
          idempotencyKey: 'doctrine:projection:admitted',
          kind: 'doctrine_revision_admitted',
          entityId: 'doctrine:projection',
          occurredAt: '2026-08-26T12:01:00.000Z',
          projectDir: '/repo/port-daddy',
          actorId: 'agent:admiralty',
          citations: ['experiment:case-13'],
          payload: {
            candidateId: 'candidate-projection',
            experimentId: 'experiment-projection',
            reviewerId: 'agent:admiralty',
            status: 'provisional',
          },
        },
      });
      projectPending(db, { projection: 'doctrine' });

      const admitted = getDoctrineProjection(db);
      expect(admitted.stale).toBe(false);
      expect(admitted.rows[0]).toMatchObject({
        doctrine_id: 'doctrine:projection',
        experiment_id: 'experiment-projection',
        status: 'provisional',
      });
    });
  });

  describe('idempotence and replay (ch18 acceptance gates)', () => {
    it('projecting twice changes nothing', () => {
      const before = dumpProjections(db);
      const results = projectPending(db);
      expect(results.every((r) => r.applied === 0)).toBe(true);
      expect(dumpProjections(db)).toEqual(before);
    });

    it('re-applying already-applied events is a no-op (handler idempotence under forced replay)', () => {
      const before = dumpProjections(db);
      // Force the engine to re-read the whole ledger by resetting checkpoints,
      // WITHOUT clearing the applied-dedup rows: every event is re-delivered
      // and every delivery must be skipped.
      db.prepare('UPDATE harbor_proj_meta SET last_ledger_seq = 0').run();
      const results = projectPending(db);
      expect(results.every((r) => r.applied === 0)).toBe(true);
      expect(results.some((r) => r.skippedDuplicates > 0)).toBe(true);
      expect(dumpProjections(db)).toEqual(before);
    });

    it('projections rebuild from scratch to the identical read model', () => {
      const before = dumpProjections(db);
      const results = rebuildProjections(db);
      expect(results.every((r) => r.fromSeq === 0)).toBe(true);
      expect(results.every((r) => r.applied > 0)).toBe(true);
      expect(dumpProjections(db)).toEqual(before);
    });

    it('a single projection can be rebuilt independently', () => {
      const before = dumpProjections(db);
      rebuildProjections(db, { projection: 'costs' });
      expect(dumpProjections(db)).toEqual(before);
    });
  });

  describe('staleness: label always, authorize never', () => {
    it('labels every projection stale after a new event lands unprojected', () => {
      appendEvent(db, { streamType: 'transcript-event', payload: transcript({ sequence: 6, eventId: 'evt_late' }) });
      const status = getProjectionStatus(db);
      expect(status.every((p) => p.stale)).toBe(true);
      expect(status.every((p) => p.lagEvents === 1)).toBe(true);
      expect(getRoster(db).stale).toBe(true);
      expect(getTranscriptTimeline(db, SESSION_ID).stale).toBe(true);
    });

    it('refuses command authorization from a stale projection (fail closed)', () => {
      appendEvent(db, { streamType: 'transcript-event', payload: transcript({ sequence: 6, eventId: 'evt_late' }) });
      for (const projection of PROJECTIONS) {
        expect(isProjectionFresh(db, projection)).toBe(false);
        expect(() => assertProjectionFreshForCommand(db, projection)).toThrow(StaleProjectionError);
      }
      projectPending(db);
      for (const projection of PROJECTIONS) {
        expect(() => assertProjectionFreshForCommand(db, projection)).not.toThrow();
      }
    });
  });

  describe('tolerant reader (unknown fields / kinds)', () => {
    it('projects events carrying unknown fields and unknown kinds without error', () => {
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcript({
          sequence: 6,
          eventId: 'evt_future',
          kind: 'holographic_pair_programming',
          futureTopLevelField: { deeply: { unknown: true } },
        }),
      });
      expect(() => projectPending(db)).not.toThrow();
      const timeline = getTranscriptTimeline(db, SESSION_ID);
      const last = timeline.rows[timeline.rows.length - 1] as Record<string, unknown>;
      expect(last.kind).toBe('holographic_pair_programming');
    });
  });
});
