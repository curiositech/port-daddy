/**
 * Spawner -> Agent Harbor bridge tests (lib/agent-harbor/spawner-bridge.ts).
 *
 * This is Slice 1 of bridging the two disconnected agent-identity systems:
 * lib/spawner.ts (agentId, ungated kill) and Agent Harbor's C0-C6
 * compliance-gated control-command system (control-gate.ts). The bridge's
 * ONLY job here is honest C1 witnessing — no C2+, no attempt to make `kill`
 * succeed through the gate for spawner bodies.
 *
 * Gates covered:
 *   - a spawned agent gets a real, non-placeholder roster row after
 *     registerNode (ADR-0095 §8: no self-report upgrade — it stays C0 until
 *     a real probe result grants otherwise);
 *   - appendTranscriptEvent produces a real, verifiable hash chain
 *     (harbor_events content_hash/prev_hash via the existing event ledger —
 *     no new hashing code, just feeding it);
 *   - runProbeAndRecord produces a ComplianceProbeResult that the frozen
 *     witnessing invariant accepts, and the roster's compliance_level
 *     advances to exactly 'C1' — not C0 (under-claim), not beyond (over-claim);
 *   - authorizeControl still correctly DENIES kill (C4 required) against the
 *     resulting node — this is the actual point of the slice: real C1
 *     evidence, still an honest "no" for C4, never a forged grant;
 *   - every bridge method is best-effort: a broken/absent db must never throw
 *     out of registerNode/appendTranscriptEvent, matching the existing
 *     "audit write failure never aborts the run" posture used throughout
 *     lib/spawner.ts and lib/transcripts.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { initDatabase, closeDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import { verifySessionChain } from '../../lib/agent-harbor/event-ledger.js';
import { projectPending, getRoster } from '../../lib/agent-harbor/projections.js';
import { createSpawnerHarborBridge } from '../../lib/agent-harbor/spawner-bridge.js';
import { authorizeControl } from '../../lib/agent-harbor/control-gate.js';
import type { AgentNodeView, ComplianceProbeResult } from '../../lib/agent-harbor/types.js';
import { checkNodeWitnessing, checkProbeWitnessing } from '../../schemas/agent-harbor/v0/compliance-invariants.mjs';

function rosterRow(db: DatabaseInstance, agentId: string): Record<string, unknown> | undefined {
  projectPending(db);
  return getRoster(db).rows.find((r) => r.agent_node_id === agentId);
}

/** Read the last-appended compliance-probe-result payload for this agent,
 *  the way projections.ts itself does when granting the roster level. */
function lastProbePayload(db: DatabaseInstance, agentId: string): ComplianceProbeResult | null {
  const row = db
    .prepare(
      "SELECT payload_json FROM harbor_events WHERE stream_type = 'compliance-probe-result' AND agent_node_id = ? ORDER BY ledger_seq DESC LIMIT 1",
    )
    .get(agentId) as { payload_json: string } | undefined;
  return row ? (JSON.parse(row.payload_json) as ComplianceProbeResult) : null;
}

describe('spawner-bridge (slice 1: honest C1 transcript witnessing)', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('registerNode creates a non-placeholder roster row, honestly at C0', () => {
    const bridge = createSpawnerHarborBridge(db);
    const agentId = 'spawned-test-c0';
    bridge.registerNode(agentId, 'port-daddy:test:c0', Date.now());

    const row = rosterRow(db, agentId);
    expect(row).toBeDefined();
    expect(row?.placeholder).toBe(0);
    expect(row?.compliance_level).toBe('C0');
    expect(row?.authority).toBe('local');
    expect(row?.class).toBe('voyager');
  });

  it('appendTranscriptEvent produces a real, verifiable per-agent hash chain', () => {
    const bridge = createSpawnerHarborBridge(db);
    const agentId = 'spawned-test-chain';
    const t0 = Date.now();
    bridge.registerNode(agentId, null, t0);
    bridge.appendTranscriptEvent(agentId, 'spawn-start', t0);
    bridge.appendTranscriptEvent(agentId, 'assistant-message', t0 + 1);
    bridge.appendTranscriptEvent(agentId, 'finalize:completed', t0 + 2);

    // sessionId === agentId per the bridge's design (one spawn = one session).
    expect(verifySessionChain(db, agentId)).toBeNull();

    const row = db
      .prepare("SELECT content_hash, prev_hash FROM harbor_events WHERE stream_type='transcript-event' AND session_id = ? ORDER BY ledger_seq DESC LIMIT 1")
      .get(agentId) as { content_hash: string; prev_hash: string | null };
    expect(row.content_hash).toBeTruthy();
    // Third event's prevHash must chain to the second event's contentHash —
    // this IS the "real hash-chain, not new hashing code" claim: it comes
    // entirely from harbor_events, the bridge never computes a hash itself.
    const second = db
      .prepare("SELECT content_hash FROM harbor_events WHERE stream_type='transcript-event' AND session_id = ? ORDER BY ledger_seq ASC LIMIT 1 OFFSET 1")
      .get(agentId) as { content_hash: string };
    expect(row.prev_hash).toBe(second.content_hash);
  });

  it('the chain is structurally tamper-proof — the ledger rejects UPDATE outright (proves this is a real chain, not a fixture)', () => {
    const bridge = createSpawnerHarborBridge(db);
    const agentId = 'spawned-test-tamper';
    bridge.registerNode(agentId, null, Date.now());
    bridge.appendTranscriptEvent(agentId, 'spawn-start', Date.now());
    bridge.appendTranscriptEvent(agentId, 'assistant-message', Date.now());

    // A stronger guarantee than "tampering is detected after the fact":
    // harbor_events' own append-only trigger refuses the UPDATE entirely
    // (tests/unit/agent-harbor-event-ledger.test.ts covers the trigger
    // itself; this confirms the bridge's own rows are subject to it too,
    // not written through some side channel that bypasses it).
    expect(() =>
      db
        .prepare(
          "UPDATE harbor_events SET content_hash = 'tampered' WHERE stream_type='transcript-event' AND session_id = ? ORDER BY ledger_seq ASC LIMIT 1",
        )
        .run(agentId),
    ).toThrow(/append-only/);

    // The chain remains verifiably intact — nothing got through.
    expect(verifySessionChain(db, agentId)).toBeNull();
  });

  it('runProbeAndRecord grants exactly C1 — not C0, not beyond — and the result is witness-valid', async () => {
    const bridge = createSpawnerHarborBridge(db);
    const agentId = 'spawned-test-probe';
    bridge.registerNode(agentId, null, Date.now());
    bridge.appendTranscriptEvent(agentId, 'spawn-start', Date.now());
    bridge.appendTranscriptEvent(agentId, 'assistant-message', Date.now());
    bridge.appendTranscriptEvent(agentId, 'finalize:completed', Date.now());

    await bridge.runProbeAndRecord(agentId);

    const probe = lastProbePayload(db, agentId);
    expect(probe).not.toBeNull();
    expect(probe?.witnessedLevel).toBe('C1');
    expect(probe?.complianceLevel).toBe('C1');

    // Cross-check against the same frozen predicate control-gate.ts trusts —
    // this is not a self-consistency check, it's the actual normative rule.
    const { valid, violations } = checkProbeWitnessing(probe);
    expect(violations).toEqual([]);
    expect(valid).toBe(true);

    const row = rosterRow(db, agentId);
    expect(row?.compliance_level).toBe('C1');
    expect(row?.placeholder).toBe(0);
  });

  it('runProbeAndRecord with ZERO transcript events grants only C0 (no free C1)', async () => {
    const bridge = createSpawnerHarborBridge(db);
    const agentId = 'spawned-test-no-transcript';
    bridge.registerNode(agentId, null, Date.now());
    // No appendTranscriptEvent calls at all — emitVerifiedTranscript must
    // honestly report events:0, which the engine cannot witness C1 from.
    await bridge.runProbeAndRecord(agentId);

    const probe = lastProbePayload(db, agentId);
    expect(probe?.witnessedLevel).toBe('C0');
    const row = rosterRow(db, agentId);
    expect(row?.compliance_level).toBe('C0');
  });

  it('the real ComplianceProbeResult still fails checkNodeWitnessing for a node self-claiming above C1', () => {
    // Adversarial check: forge a node fact claiming C4 but link it to the
    // genuine C1-witnessed probe from the previous exercise. This is exactly
    // the self-report-upgrade attack the frozen predicate exists to block —
    // the bridge itself never does this, but this proves the invariant would
    // catch it if some future caller tried.
    const witnessedC1Probe: ComplianceProbeResult = {
      schema: 'pd.agent-harbor.compliance-probe-result.v0',
      probeId: 'probe_adversarial_test',
      agentNodeId: 'spawned-adversarial',
      probedAt: new Date().toISOString(),
      complianceLevel: 'C1',
      witnessedLevel: 'C1',
      transcriptFidelity: 'T4',
      checks: [
        { name: 'register-nonce-challenge', passed: true, daemonWitnessed: true, level: 'C0', details: '' },
        { name: 'transcript-verified', passed: true, daemonWitnessed: true, level: 'C1', details: '' },
      ],
      negativeProbes: [
        { kind: 'forged-level', targetLevel: 'C1', present: true, fired: false },
      ],
    } as unknown as ComplianceProbeResult;

    const forgingNode: AgentNodeView = {
      agentNodeId: 'spawned-adversarial',
      authority: 'local',
      complianceLevel: 'C4', // <-- the forge: claims C4, only C1 is witnessed
      complianceProbeId: 'probe_adversarial_test',
    } as unknown as AgentNodeView;

    const { valid, violations } = checkNodeWitnessing(forgingNode, witnessedC1Probe);
    expect(valid).toBe(false);
    expect(violations.join(' ')).toMatch(/exceeds linked probe witnessedLevel C1/);
  });

  it('authorizeControl correctly DENIES kill for a real C1-witnessed spawner node — the actual point of this slice', async () => {
    const bridge = createSpawnerHarborBridge(db);
    const agentId = 'spawned-test-kill-denied';
    bridge.registerNode(agentId, null, Date.now());
    bridge.appendTranscriptEvent(agentId, 'spawn-start', Date.now());
    bridge.appendTranscriptEvent(agentId, 'assistant-message', Date.now());
    await bridge.runProbeAndRecord(agentId);

    const probe = lastProbePayload(db, agentId)!;
    const row = rosterRow(db, agentId)!;
    const node: AgentNodeView = {
      agentNodeId: agentId,
      authority: 'local',
      complianceLevel: row.compliance_level as AgentNodeView['complianceLevel'],
      complianceProbeId: row.compliance_probe_id as string | undefined,
    } as unknown as AgentNodeView;

    const auth = authorizeControl(node, 'kill', probe, 'spawner-child');
    expect(auth.allowed).toBe(false);
    expect(auth.effectiveLevel).toBe('C1');
    expect(auth.requiredLevel).toBe('C4');
  });

  it('every public method is best-effort: a broken db never throws', async () => {
    const brokenDb = { prepare: () => { throw new Error('boom'); } } as unknown as DatabaseInstance;
    const bridge = createSpawnerHarborBridge(brokenDb);
    expect(() => bridge.registerNode('a', null, Date.now())).not.toThrow();
    expect(() => bridge.appendTranscriptEvent('a', 'x', Date.now())).not.toThrow();
    await expect(bridge.runProbeAndRecord('a')).resolves.toBeUndefined();
  });
});
