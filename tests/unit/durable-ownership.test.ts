import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { closeDatabase, initDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import { createClaimForest } from '../../lib/claim-forest.js';
import { appendEvent } from '../../lib/agent-harbor/event-ledger.js';
import {
  createDurableOwnershipService,
  DurableOwnershipError,
  type ExactWorkBinding,
  type RequestedClaimDisposition,
} from '../../lib/durable-ownership.js';

const PREDECESSOR = 'agent_node_11111111-1111-4111-8111-111111111111';
const SUCCESSOR = 'agent_node_22222222-2222-4222-8222-222222222222';
const SIBLING = 'agent_node_33333333-3333-4333-8333-333333333333';
const OWNER_ACTOR = '01OWNERACTOR00000000000000';
const SUCCESSOR_ACTOR = '01SUCCESSORACTOR000000000';
const OPERATOR_ACTOR = '01OPERATORACTOR0000000000';
const ROADMAP_ID = 'roadmap-ownership-test';
const ROADMAP_SLUG = 'durable-ownership-test';
const HARBOR = 'port-daddy';
const WORKTREE = 'worktree-old';
const ROOT = '/Users/operator/coding/tmp/port-daddy-old-work';

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function work(): ExactWorkBinding {
  return {
    repoId: 'github.com/port-daddy/port-daddy',
    worktreeId: WORKTREE,
    worktreeRoot: ROOT,
    worktreeRealpath: ROOT,
    worktreePhysicalId: hash('1'),
    gitDirRealpath: '/Users/operator/coding/port-daddy/.git/worktrees/port-daddy-old-work',
    gitDirPhysicalId: hash('2'),
    repoCommonDir: '/Users/operator/coding/port-daddy/.git',
    branch: 'agent/unfinished-work',
    remote: 'git@github.com:port-daddy/port-daddy.git',
    head: 'a'.repeat(40),
    base: 'b'.repeat(40),
    dirtyTreeHash: hash('c'),
    dirtyPaths: ['lib/unfinished.ts'],
    prUrls: ['https://github.com/port-daddy/port-daddy/pull/1234'],
  };
}

function metadata(actorId: string): string {
  return JSON.stringify({
    identity: { verified: true, actorId, soulClass: 'graduated' },
    worktree: { id: WORKTREE, root: ROOT },
    transcriptRef: `logbook://session/${actorId}`,
  });
}

describe('canonical durable ownership epochs and delayed takeover', () => {
  let db: DatabaseInstance;
  let clock: number;
  let service: ReturnType<typeof createDurableOwnershipService>;
  let predecessorClaimNodeId: string;
  let siblingClaimNodeId: string;
  let consumedPresenceProofs: Set<string>;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    clock = 1_788_000_000_000;
    db.prepare(`
      INSERT INTO roadmap_items (
        id, slug, summary_md, status, last_touched_at, dependencies_json,
        notes_json, harbor, created_at, assignee_id, description_md
      ) VALUES (?, ?, ?, 'now', ?, '[]', ?, ?, ?, ?, ?)
    `).run(
      ROADMAP_ID,
      ROADMAP_SLUG,
      'Durable ownership test item',
      clock,
      JSON.stringify([
        { id: 'roadmap-plan', text: 'Finish the exact ownership seam.', sourceRef: 'logbook://roadmap/plan' },
      ]),
      HARBOR,
      clock,
      PREDECESSOR,
      'Canonical AgentNode ownership and exact delayed takeover.',
    );
    const nodes = new Set([PREDECESSOR, SUCCESSOR, SIBLING]);
    const nodeSessions = new Map([
      [PREDECESSOR, { sessionId: 'session-old', bodyId: 'body-old' }],
      [SUCCESSOR, { sessionId: 'session-new', bodyId: 'body-new' }],
      [SIBLING, { sessionId: 'session-sibling', bodyId: 'body-sibling' }],
    ]);
    consumedPresenceProofs = new Set();
    service = createDurableOwnershipService(db, {
      signer: {
        keyId: 'daemon-test-key',
        signDigest: async digest => `ed25519-test-${digest}`,
        verifyDigest: (digest, signature) => signature === `ed25519-test-${digest}`,
      },
      agentNodeExists: agentNodeId => nodes.has(agentNodeId),
      getAgentNode: agentNodeId => {
        const lineage = nodeSessions.get(agentNodeId);
        return lineage ? {
          agentNodeId,
          ledgerSeq: 1,
          profile: {
            remit: `Remit for ${agentNodeId}`,
            lifecycle: 'ready' as const,
            revision: 1,
            scope: { key: 'system', repoRoot: null },
            origin: {
              kind: 'session-promotion',
              sourceSessionId: lineage.sessionId,
              sourceAgentId: lineage.bodyId,
              sourceAdapter: 'codex-cli',
              handoffEpisodeId: 41,
            },
          },
        } : null;
      },
      repoRoot: ROOT,
      workBindingProbe: () => work(),
      readSessionNotes: sessionId => sessionId === 'session-old'
        ? [
            { id: 1, type: 'plan', createdAt: clock - 3_000, content: 'Complete the transaction seam.' },
            { id: 2, type: 'decision', createdAt: clock - 2_000, content: 'Keep one constitutional owner. porthole://capture/42' },
            { id: 3, type: 'question', createdAt: clock - 1_000, content: 'Does the exact PR head still match? logbook://session/old' },
          ]
        : [],
      gitleaksRunner: () => ({ findings: [] }),
      verifyAndConsumeOperatorPresence: (proof, intent) => {
        if (proof !== 'recent-human-presence' || consumedPresenceProofs.has(proof)) return null;
        consumedPresenceProofs.add(proof);
        return {
          receiptId: 'opresence-test-1',
          daemonGeneration: 'daemon-test-generation',
          actorId: intent.actorId,
          action: 'durable-ownership-takeover',
          harbor: intent.harbor,
          roadmapSlug: intent.roadmapSlug,
          predecessorEpochId: intent.predecessorEpochId,
          sourceSessionId: intent.sourceSessionId,
          successorSessionId: intent.successorSessionId,
          successorActorId: intent.successorActorId,
          claimSetHash: intent.claimSetHash,
          verifiedAt: clock - 1_000,
          expiresAt: clock + 60_000,
        };
      },
      staleAfterMs: 24 * 60 * 60_000,
      now: () => clock,
    });

    const insertSession = db.prepare(`
      INSERT INTO sessions (
        id, purpose, status, phase, agent_id, agent_node_id, worktree_id,
        identity_project, created_at, updated_at, completed_at, metadata, is_durable
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `);
    insertSession.run(
      'session-old', 'Unfinished roadmap work', 'active', 'in_progress', 'body-old',
      PREDECESSOR, WORKTREE, 'port-daddy', clock - 100_000, clock - 100_000,
      metadata(OWNER_ACTOR), 1,
    );
    insertSession.run(
      'session-new', 'Continue unfinished roadmap work', 'active', 'in_progress', 'body-new',
      SUCCESSOR, WORKTREE, 'port-daddy', clock - 5_000, clock - 5_000,
      metadata(SUCCESSOR_ACTOR), 1,
    );
    insertSession.run(
      'session-sibling', 'Independent sibling work', 'active', 'in_progress', 'body-sibling',
      SIBLING, WORKTREE, 'port-daddy', clock - 4_000, clock - 4_000,
      metadata('01SIBLINGACTOR000000000000'), 1,
    );

    for (const [sessionId, agentNodeId, bodyId, startedAt] of [
      ['session-old', PREDECESSOR, 'body-old', clock - 100_000],
      ['session-new', SUCCESSOR, 'body-new', clock - 5_000],
      ['session-sibling', SIBLING, 'body-sibling', clock - 4_000],
    ] as const) {
      appendEvent(db, {
        streamType: 'agent-run',
        payload: {
          schema: 'pd.agent-harbor.agent-run.v0',
          runId: `run-${sessionId}`,
          agentNodeId,
          sessionId,
          bodyId,
          body: {
            kind: 'codex-cli',
            provider: 'test',
            modelTier: 'custom',
            launchMode: 'native',
          },
          workspace: {
            repo: ROOT,
            repoId: work().repoId,
            repoScopeKey: 'system',
            repoCommonDir: work().repoCommonDir,
            worktree: ROOT,
            worktreeId: work().worktreeId,
            worktreeRealpath: work().worktreeRealpath,
            worktreePhysicalId: work().worktreePhysicalId,
            gitDirRealpath: work().gitDirRealpath,
            gitDirPhysicalId: work().gitDirPhysicalId,
            branch: work().branch,
            headCommit: work().head,
            baseCommit: work().base,
          },
          admission: {
            kind: 'verified-session-promotion',
            authorizedActorId: sessionId === 'session-old'
              ? OWNER_ACTOR
              : sessionId === 'session-new'
                ? SUCCESSOR_ACTOR
                : '01SIBLINGACTOR000000000000',
            harbor: HARBOR,
            sourceAdapter: 'codex-cli',
            handoffEpisodeId: 41,
            profileRevision: 1,
            profileLedgerSeq: 1,
          },
          status: 'running',
          startedAt: new Date(startedAt).toISOString(),
        },
      });
    }

    const forest = createClaimForest(db);
    predecessorClaimNodeId = forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: WORKTREE },
      selector: { kind: 'file', path: 'lib/unfinished.ts', contentHash: hash('d') },
    }, {
      sessionId: 'session-old',
      agentId: 'body-old',
      agentNodeId: PREDECESSOR,
      claimedAt: clock - 80_000,
      observedBy: 'test',
    }).nodeId;
    siblingClaimNodeId = forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: WORKTREE },
      selector: { kind: 'file', path: 'lib/sibling.ts', contentHash: hash('e') },
    }, {
      sessionId: 'session-sibling',
      agentId: 'body-sibling',
      agentNodeId: SIBLING,
      claimedAt: clock - 70_000,
      observedBy: 'test',
    }).nodeId;
  });

  afterEach(() => closeDatabase(db));

  async function bootstrap() {
    return service.bootstrapCanonical({
      roadmapSlug: ROADMAP_SLUG,
      harbor: HARBOR,
      sourceSessionId: 'session-old',
      reason: 'Initial canonical assignment.',
    }, { actorId: OWNER_ACTOR, soulClass: 'graduated' });
  }

  function dispositions(...extra: RequestedClaimDisposition[]): RequestedClaimDisposition[] {
    return [{ claimNodeId: predecessorClaimNodeId, disposition: 'transfer' }, ...extra];
  }

  test('bootstraps one signed epoch from the same AgentNode used by roadmap and claims', async () => {
    const first = await bootstrap();
    const second = await bootstrap();

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(first.epoch.ownerAgentNodeId).toBe(PREDECESSOR);
    expect(first.epoch.authoredByAgentNodeId).toBe(PREDECESSOR);
    expect(first.epoch.claimBindings).toEqual([
      expect.objectContaining({ claimNodeId: predecessorClaimNodeId, disposition: 'retain' }),
    ]);
    expect(first.epoch.signature.keyId).toBe('daemon-test-key');
    expect(db.prepare('SELECT COUNT(*) AS count FROM roadmap_ownership_epochs').get()).toEqual({ count: 1 });
  });

  test('issues and accepts an exact two-actor handoff while retaining prior owner history', async () => {
    await bootstrap();
    const issued = await service.prepareTakeover({
      roadmapSlug: ROADMAP_SLUG,
      harbor: HARBOR,
      successorSessionId: 'session-new',
      reason: 'Current owner explicitly hands off unfinished work.',
      claimDispositions: dispositions(),
    }, { actorId: OWNER_ACTOR, soulClass: 'graduated' });

    expect(issued.grant.predecessorAgentNodeId).toBe(PREDECESSOR);
    expect(issued.grant.successorAgentNodeId).toBe(SUCCESSOR);
    expect(issued.grant.authorizedActorId).toBe(OWNER_ACTOR);
    expect(issued.grant.successorActorId).toBe(SUCCESSOR_ACTOR);
    expect(issued.grant.briefing.hiddenReasoningAvailable).toBe(false);
    expect(issued.grant.briefing.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'porthole', ref: 'porthole://capture/42' }),
      expect.objectContaining({ source: 'logbook', ref: 'logbook://session/old' }),
    ]));

    const accepted = await service.acceptTakeover({
      sourceSessionId: 'session-old',
      grantId: issued.grant.grantId,
      nonce: issued.nonce,
    }, { actorId: SUCCESSOR_ACTOR, soulClass: 'graduated' });

    expect(accepted.epoch.ownerAgentNodeId).toBe(SUCCESSOR);
    expect(accepted.epoch.priorOwnerAgentNodeId).toBe(PREDECESSOR);
    expect(accepted.disposition.transferredClaimNodeIds).toEqual([predecessorClaimNodeId]);
    expect(service.getProjection(ROADMAP_SLUG, HARBOR).priorOwners).toEqual([
      expect.objectContaining({ agentNodeId: PREDECESSOR }),
    ]);
    expect(db.prepare('SELECT assignee_id FROM roadmap_items WHERE id = ?').get(ROADMAP_ID))
      .toEqual({ assignee_id: SUCCESSOR });
    expect(db.prepare('SELECT status FROM sessions WHERE id = ?').get('session-old'))
      .toEqual({ status: 'abandoned' });
    expect(db.prepare(`
      SELECT agent_node_id FROM claim_forest_claims
      WHERE node_id = ? AND session_id = 'session-new' AND released_at IS NULL
    `).get(predecessorClaimNodeId)).toEqual({ agent_node_id: SUCCESSOR });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM claim_forest_claims
      WHERE node_id = ? AND session_id = 'session-sibling' AND released_at IS NULL
    `).get(siblingClaimNodeId)).toEqual({ count: 1 });
  });

  test('refuses caller-selected durable identity for an unbound successor with zero mutation', async () => {
    await bootstrap();
    db.prepare(`
      INSERT INTO sessions (
        id, purpose, status, phase, agent_id, agent_node_id, worktree_id,
        identity_project, created_at, updated_at, completed_at, metadata, is_durable
      ) VALUES ('session-unbound', 'Attempt identity selection', 'active', 'in_progress',
                'body-owner', NULL, ?, 'port-daddy', ?, ?, NULL, ?, 1)
    `).run(WORKTREE, clock - 2_000, clock - 2_000, metadata(OWNER_ACTOR));
    const before = {
      runs: (db.prepare("SELECT COUNT(*) AS count FROM harbor_events WHERE stream_type = 'agent-run'").get() as { count: number }).count,
      grants: (db.prepare('SELECT COUNT(*) AS count FROM durable_takeover_grants').get() as { count: number }).count,
      claims: (db.prepare('SELECT COUNT(*) AS count FROM claim_forest_claims WHERE released_at IS NULL').get() as { count: number }).count,
    };

    await expect(service.prepareTakeover({
      roadmapSlug: ROADMAP_SLUG,
      harbor: HARBOR,
      successorSessionId: 'session-unbound',
      // Deliberate runtime forgery: older callers may still send this removed field.
      successorAgentNodeId: SIBLING,
      reason: 'Try to impersonate an existing durable node.',
      claimDispositions: dispositions(),
    } as Parameters<typeof service.prepareTakeover>[0] & { successorAgentNodeId: string }, {
      actorId: OWNER_ACTOR,
      soulClass: 'graduated',
    })).rejects.toMatchObject({ code: 'SUCCESSOR_ADMISSION_REQUIRED' });

    expect(db.prepare("SELECT agent_node_id FROM sessions WHERE id = 'session-unbound'").get())
      .toEqual({ agent_node_id: null });
    expect(db.prepare("SELECT COUNT(*) AS count FROM harbor_events WHERE stream_type = 'agent-run'").get())
      .toEqual({ count: before.runs });
    expect(db.prepare('SELECT COUNT(*) AS count FROM durable_takeover_grants').get())
      .toEqual({ count: before.grants });
    expect(db.prepare('SELECT COUNT(*) AS count FROM claim_forest_claims WHERE released_at IS NULL').get())
      .toEqual({ count: before.claims });
    expect(db.prepare('SELECT assignee_id FROM roadmap_items WHERE id = ?').get(ROADMAP_ID))
      .toEqual({ assignee_id: PREDECESSOR });
  });

  test.each([
    ['missing admission contract', (payload: Record<string, any>) => { delete payload.admission; }],
    ['wrong admitted actor', (payload: Record<string, any>) => { payload.admission.authorizedActorId = OWNER_ACTOR; }],
    ['same actor admitted in another harbor', (payload: Record<string, any>) => { payload.admission.harbor = 'other-harbor'; }],
    ['recreated physical worktree', (payload: Record<string, any>) => { payload.workspace.worktreePhysicalId = hash('9'); }],
  ])('rejects a successor AgentRun with %s', async (_caseName, mutate) => {
    await bootstrap();
    const row = db.prepare(`
      SELECT payload_json FROM harbor_events
      WHERE stream_type = 'agent-run' AND session_id = 'session-new'
    `).get() as { payload_json: string };
    const payload = JSON.parse(row.payload_json) as Record<string, any>;
    mutate(payload);
    payload.runId = `${payload.runId}-conflicting-admission`;
    appendEvent(db, { streamType: 'agent-run', payload });

    await expect(service.prepareTakeover({
      roadmapSlug: ROADMAP_SLUG,
      harbor: HARBOR,
      successorSessionId: 'session-new',
      reason: 'Reject a non-canonical successor admission.',
      claimDispositions: dispositions(),
    }, { actorId: OWNER_ACTOR, soulClass: 'graduated' }))
      .rejects.toMatchObject({ code: 'SUCCESSOR_ADMISSION_INVALID' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM durable_takeover_grants').get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT assignee_id FROM roadmap_items WHERE id = ?').get(ROADMAP_ID))
      .toEqual({ assignee_id: PREDECESSOR });
  });

  test('requires a complete explicit claim disposition and rejects claim drift at acceptance', async () => {
    await bootstrap();
    await expect(service.prepareTakeover({
      roadmapSlug: ROADMAP_SLUG,
      harbor: HARBOR,
      successorSessionId: 'session-new',
      reason: 'Incomplete request.',
      claimDispositions: [],
    }, { actorId: OWNER_ACTOR, soulClass: 'graduated' })).rejects.toMatchObject({ code: 'CLAIM_SET_MISMATCH' });

    const issued = await service.prepareTakeover({
      roadmapSlug: ROADMAP_SLUG,
      harbor: HARBOR,
      successorSessionId: 'session-new',
      reason: 'Exact request before drift.',
      claimDispositions: dispositions(),
    }, { actorId: OWNER_ACTOR, soulClass: 'graduated' });
    createClaimForest(db).claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: WORKTREE },
      selector: { kind: 'file', path: 'lib/late.ts', contentHash: hash('f') },
    }, {
      sessionId: 'session-old',
      agentId: 'body-old',
      agentNodeId: PREDECESSOR,
      claimedAt: clock - 10,
      observedBy: 'test-drift',
    });

    await expect(service.acceptTakeover({
      sourceSessionId: 'session-old',
      grantId: issued.grant.grantId,
      nonce: issued.nonce,
    }, { actorId: SUCCESSOR_ACTOR, soulClass: 'graduated' })).rejects.toMatchObject({ code: 'CLAIM_SET_MISMATCH' });
    expect(service.getGrant(issued.grant.grantId)?.state).toBe('active');
  });

  test('rejects authority-shaped surplus fields inside claim dispositions with zero mutation', async () => {
    await bootstrap();
    const before = {
      grants: (db.prepare('SELECT COUNT(*) AS count FROM durable_takeover_grants').get() as { count: number }).count,
      events: (db.prepare('SELECT COUNT(*) AS count FROM roadmap_ownership_events').get() as { count: number }).count,
      claims: (db.prepare('SELECT COUNT(*) AS count FROM claim_forest_claims WHERE released_at IS NULL').get() as { count: number }).count,
    };
    for (const surplus of [
      { issuerAgentNodeId: SIBLING },
      { authorizedActorId: OPERATOR_ACTOR },
      { successorSessionId: 'session-sibling' },
      { worktreeId: 'attacker-worktree' },
      { head: 'f'.repeat(40) },
      { filePath: 'lib/attacker-selected.ts' },
    ]) {
      await expect(service.prepareTakeover({
        roadmapSlug: ROADMAP_SLUG,
        harbor: HARBOR,
        successorSessionId: 'session-new',
        reason: 'Attempt nested authority injection.',
        claimDispositions: [{
          claimNodeId: predecessorClaimNodeId,
          disposition: 'transfer',
          ...surplus,
        } as RequestedClaimDisposition],
      }, { actorId: OWNER_ACTOR, soulClass: 'graduated' }))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(db.prepare('SELECT COUNT(*) AS count FROM durable_takeover_grants').get())
      .toEqual({ count: before.grants });
    expect(db.prepare('SELECT COUNT(*) AS count FROM roadmap_ownership_events').get())
      .toEqual({ count: before.events });
    expect(db.prepare('SELECT COUNT(*) AS count FROM claim_forest_claims WHERE released_at IS NULL').get())
      .toEqual({ count: before.claims });
    expect(db.prepare('SELECT assignee_id FROM roadmap_items WHERE id = ?').get(ROADMAP_ID))
      .toEqual({ assignee_id: PREDECESSOR });
  });

  test('permits delayed operator recovery of a stale legacy predecessor only with signed gap evidence', async () => {
    await bootstrap();
    db.prepare(`
      UPDATE sessions
      SET agent_node_id = NULL, is_durable = 0, updated_at = ?, metadata = ?
      WHERE id = 'session-old'
    `).run(clock - 3 * 24 * 60 * 60_000, JSON.stringify({ worktree: { id: WORKTREE, root: ROOT } }));
    db.prepare(`
      UPDATE claim_forest_claims SET agent_node_id = NULL
      WHERE session_id = 'session-old' AND released_at IS NULL
    `).run();

    await expect(service.prepareTakeover({
      roadmapSlug: ROADMAP_SLUG,
      harbor: HARBOR,
      successorSessionId: 'session-new',
      reason: 'Persistent operator identity alone is not recent presence.',
      claimDispositions: dispositions(),
    }, { actorId: OPERATOR_ACTOR, soulClass: 'operator' }))
      .rejects.toMatchObject({ code: 'OPERATOR_PRESENCE_REQUIRED' });

    const issued = await service.prepareTakeover({
      roadmapSlug: ROADMAP_SLUG,
      harbor: HARBOR,
      successorSessionId: 'session-new',
      reason: 'Operator recovers stale legacy ownership after three days.',
      claimDispositions: dispositions(),
      operatorPresenceProof: 'recent-human-presence',
    }, { actorId: OPERATOR_ACTOR, soulClass: 'operator' });

    expect(issued.grant.authorityKind).toBe('operator');
    expect(issued.grant.issuerAgentNodeId).toBeNull();
    expect(issued.grant.sourceWitnessCanonical).toBe(false);
    expect(issued.grant.operatorPresenceReceipt).toEqual(expect.objectContaining({
      receiptId: 'opresence-test-1',
      actorId: OPERATOR_ACTOR,
    }));
    expect(issued.grant.predecessorEvidenceGap).toEqual(expect.objectContaining({
      sourceSessionId: 'session-old',
      recordedByActorId: OPERATOR_ACTOR,
    }));
    const accepted = await service.acceptTakeover({
      sourceSessionId: 'session-old',
      grantId: issued.grant.grantId,
      nonce: issued.nonce,
    }, { actorId: SUCCESSOR_ACTOR, soulClass: 'graduated' });
    expect(accepted.epoch.cause).toBe('operator-takeover');
  });

  test('keeps signed grants immutable and derives expiry only from append-only receipts', async () => {
    await bootstrap();
    const issued = await service.prepareTakeover({
      roadmapSlug: ROADMAP_SLUG,
      harbor: HARBOR,
      successorSessionId: 'session-new',
      reason: 'Short-lived exact handoff.',
      claimDispositions: dispositions(),
      ttlMs: 10_000,
    }, { actorId: OWNER_ACTOR, soulClass: 'graduated' });

    expect(() => db.prepare('UPDATE durable_takeover_grants SET reason = ? WHERE grant_id = ?')
      .run('mutated', issued.grant.grantId)).toThrow(/immutable/);
    clock += 10_001;
    await service.expireDue();
    await service.expireDue();
    expect(service.getGrant(issued.grant.grantId)?.state).toBe('expired');
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM durable_takeover_receipts
      WHERE grant_id = ? AND kind = 'expired'
    `).get(issued.grant.grantId)).toEqual({ count: 1 });
    await expect(service.acceptTakeover({
      sourceSessionId: 'session-old',
      grantId: issued.grant.grantId,
      nonce: issued.nonce,
    }, { actorId: SUCCESSOR_ACTOR, soulClass: 'graduated' }))
      .rejects.toBeInstanceOf(DurableOwnershipError);
  });

  test('re-verifies stored hashes and daemon signatures before projecting or authorizing', async () => {
    await bootstrap();
    const issued = await service.prepareTakeover({
      roadmapSlug: ROADMAP_SLUG,
      harbor: HARBOR,
      successorSessionId: 'session-new',
      reason: 'Verify immutable storage before use.',
      claimDispositions: dispositions(),
    }, { actorId: OWNER_ACTOR, soulClass: 'graduated' });

    db.exec('DROP TRIGGER durable_takeover_grants_no_update');
    const original = db.prepare('SELECT * FROM durable_takeover_grants WHERE grant_id = ?')
      .get(issued.grant.grantId) as Record<string, unknown>;
    for (const [column, tampered] of [
      ['reason', 'tampered scalar'],
      ['briefing_json', '{"tampered":true}'],
      ['content_hash', hash('0')],
      ['signature_key_id', 'unknown-daemon-key'],
      ['signature_value', 'forged-signature'],
    ] as const) {
      db.prepare(`UPDATE durable_takeover_grants SET ${column} = ? WHERE grant_id = ?`)
        .run(tampered, issued.grant.grantId);
      expect(() => service.getGrant(issued.grant.grantId)).toThrow(expect.objectContaining({
        code: 'SIGNED_FACT_INVALID',
      }));
      db.prepare(`UPDATE durable_takeover_grants SET ${column} = ? WHERE grant_id = ?`)
        .run(original[column], issued.grant.grantId);
    }

    db.exec('DROP TRIGGER durable_takeover_receipts_no_update');
    const receipt = db.prepare(`
      SELECT receipt_id, details_json FROM durable_takeover_receipts
      WHERE grant_id = ? AND kind = 'issued'
    `).get(issued.grant.grantId) as { receipt_id: string; details_json: string };
    db.prepare('UPDATE durable_takeover_receipts SET details_json = ? WHERE receipt_id = ?')
      .run('{"tampered":true}', receipt.receipt_id);
    expect(() => service.getGrant(issued.grant.grantId)).toThrow(expect.objectContaining({
      code: 'SIGNED_FACT_INVALID',
    }));
    db.prepare('UPDATE durable_takeover_receipts SET details_json = ? WHERE receipt_id = ?')
      .run(receipt.details_json, receipt.receipt_id);

    db.exec('DROP TRIGGER roadmap_ownership_epochs_no_update');
    db.prepare('UPDATE roadmap_ownership_epochs SET reason = ? WHERE epoch_id = ?')
      .run('tampered epoch', issued.grant.predecessorEpochId);
    expect(() => service.getProjection(ROADMAP_SLUG, HARBOR)).toThrow(expect.objectContaining({
      code: 'SIGNED_FACT_INVALID',
    }));
    expect(db.prepare('SELECT assignee_id FROM roadmap_items WHERE id = ?').get(ROADMAP_ID))
      .toEqual({ assignee_id: PREDECESSOR });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM durable_takeover_receipts
      WHERE grant_id = ? AND kind = 'consumed'
    `).get(issued.grant.grantId)).toEqual({ count: 0 });
  });
});
