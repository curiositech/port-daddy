import { afterEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendEvent } from '../../lib/agent-harbor/event-ledger.js';
import { createClaimForest } from '../../lib/claim-forest.js';
import { closeDatabase, initDatabase } from '../../lib/db.js';
import {
  captureCanonicalGitWorkspace,
  createDurableOwnershipService,
  exactClaimSetHash,
  type ExactWorkBinding,
  type PrepareSameOwnerAnchorRepairRequest,
} from '../../lib/durable-ownership.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';

const OWNER = 'agent_node_11111111-1111-4111-8111-111111111111';
const PEER = 'agent_node_22222222-2222-4222-8222-222222222222';
const ACTOR = '01EXACTOWNERACTOR000000000';
const SOURCE = 'session-anchor-source';
const TARGET = 'session-anchor-target';
const RECORDED_WORLD = '64704560';
const ACTUAL_WORLD = '45d063e0';
const ROOT = '/Users/operator/coding/tmp/unfinished-anchor-work';
const ROADMAP = 'anchor-repair-test';
const hash = (digit: string) => `sha256:${digit.repeat(64)}`;
const databases: DatabaseInstance[] = [];
const scratchDirectories: string[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db);
  for (const directory of scratchDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function work(): ExactWorkBinding {
  return {
    repoId: 'github.com/example/anchor-fixture', worktreeId: ACTUAL_WORLD,
    worktreeRoot: ROOT, worktreeRealpath: ROOT, worktreePhysicalId: hash('1'),
    gitDirRealpath: '/Users/operator/coding/anchor-fixture/.git/worktrees/anchor',
    gitDirPhysicalId: hash('2'), repoCommonDir: '/Users/operator/coding/anchor-fixture/.git',
    branch: 'test/unfinished', remote: 'https://github.com/example/anchor-fixture.git',
    head: 'a'.repeat(40), base: 'b'.repeat(40), dirtyTreeHash: hash('3'),
    dirtyPaths: ['lib/piece-00.ts'], prUrls: ['https://github.com/example/anchor-fixture/pull/61'],
  };
}

async function fixture(probe: () => ExactWorkBinding = work) {
  const db = initDatabase({ inMemory: true });
  databases.push(db);
  let clock = 1_788_360_000_000;
  let liveWork = probe;
  let retired = false;
  let onSign: () => void | Promise<void> = () => {};
  const initial = liveWork();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const service = createDurableOwnershipService(db, {
    repoRoot: initial.worktreeRoot,
    now: () => clock,
    signer: {
      keyId: 'hermetic-ed25519-key',
      signDigest: async digest => {
        await onSign();
        return sign(null, Buffer.from(digest, 'hex'), privateKey).toString('base64');
      },
      verifyDigest: (digest, signature) => verify(null, Buffer.from(digest, 'hex'), publicKey, Buffer.from(signature, 'base64')),
    },
    agentNodeExists: id => id === OWNER || id === PEER,
    getAgentNode: id => id === OWNER ? {
      agentNodeId: OWNER, ledgerSeq: 1,
      profile: {
        lifecycle: retired ? 'retired' : 'ready', revision: 1,
        remit: 'Own the exact unfinished roadmap work.', scope: { key: 'system', repoRoot: null },
        // The destination is an already admitted body of this durable node.
        // The source is a subsequent run of that SAME node, not a new identity.
        origin: {
          kind: 'session-promotion', sourceSessionId: TARGET, sourceAgentId: 'body-target',
          sourceAdapter: 'codex-cli', handoffEpisodeId: 61,
        },
      },
    } : null,
    workBindingProbe: id => id === SOURCE ? { ...initial, worktreeId: RECORDED_WORLD } : liveWork(),
    readSessionNotes: () => [
      { id: 1, type: 'plan', content: 'Finish the tested ownership seam.', createdAt: clock - 3000 },
      { id: 2, type: 'decision', content: 'Keep original claim history. porthole://capture/61', createdAt: clock - 2000 },
      { id: 3, type: 'question', content: 'Confirm the exact PR head. logbook://session/anchor', createdAt: clock - 1000 },
    ],
    gitleaksRunner: () => ({ findings: [] }),
  });
  db.prepare(`INSERT INTO roadmap_items (
    id, slug, summary_md, status, last_touched_at, dependencies_json, notes_json,
    harbor, created_at, assignee_id, description_md
  ) VALUES (?, ?, 'Repair an exact owner lease', 'now', ?, '[]', '[]', 'port-daddy', ?, ?, 'Preserve the original world.')`)
    .run('roadmap-anchor-id', ROADMAP, clock, clock, OWNER);
  for (const [id, bodyId, node, world] of [
    [SOURCE, 'body-source', OWNER, RECORDED_WORLD],
    [TARGET, 'body-target', OWNER, initial.worktreeId],
    ['session-peer', 'body-peer', PEER, RECORDED_WORLD],
  ]) {
    db.prepare(`INSERT INTO sessions (
      id, purpose, status, phase, agent_id, agent_node_id, worktree_id, identity_project,
      created_at, updated_at, metadata, is_durable
    ) VALUES (?, 'Continue exact unfinished work', 'active', 'in_progress', ?, ?, ?, 'port-daddy', ?, ?, ?, 1)`)
      .run(id, bodyId, node, world, clock - 8 * 86400_000, clock - 8 * 86400_000, JSON.stringify({
        identity: { verified: true, actorId: node === OWNER ? ACTOR : 'peer-actor', soulClass: 'graduated' },
        worktree: { id: world, root: initial.worktreeRoot, branch: initial.branch },
      }));
    if (node !== OWNER) continue;
    const captured = { ...initial, worktreeId: world };
    appendEvent(db, {
      streamType: 'agent-run',
      payload: {
        schema: 'pd.agent-harbor.agent-run.v0', runId: `run-${id}`, sessionId: id, agentNodeId: node, bodyId,
        body: { kind: 'codex-cli', provider: 'test', modelTier: 'custom', launchMode: 'native' },
        workspace: {
          repo: captured.worktreeRoot, repoId: captured.repoId, repoScopeKey: 'system',
          repoCommonDir: captured.repoCommonDir, worktree: captured.worktreeRoot,
          worktreeId: captured.worktreeId, worktreeRealpath: captured.worktreeRealpath,
          worktreePhysicalId: captured.worktreePhysicalId, gitDirRealpath: captured.gitDirRealpath,
          gitDirPhysicalId: captured.gitDirPhysicalId, branch: captured.branch,
          headCommit: captured.head, baseCommit: captured.base,
        },
        admission: {
          kind: 'verified-session-promotion', authorizedActorId: ACTOR, harbor: 'port-daddy',
          sourceAdapter: 'codex-cli', handoffEpisodeId: 61, profileRevision: 1, profileLedgerSeq: 1,
        },
        status: 'running', startedAt: new Date(clock - 8 * 86400_000).toISOString(),
      },
    });
  }
  const forest = createClaimForest(db);
  const claimIds: string[] = [];
  for (let index = 0; index < 61; index++) {
    const path = `lib/piece-${String(index).padStart(2, '0')}.ts`;
    const selector = index % 3 === 0
      ? { kind: 'file' as const, path }
      : index % 3 === 1
        ? { kind: 'range' as const, path, startLine: 2, endLine: 8 }
        : { kind: 'symbol' as const, path, symbol: 'write', symbolPath: `module${index}.write`, startLine: 2, endLine: 8 };
    const legacy = db.prepare(`INSERT INTO session_files (
      session_id, file_path, start_line, end_line, symbol, symbol_path, claimed_at, agent_node_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(SOURCE, path, selector.startLine ?? null, selector.endLine ?? null,
        selector.symbol ?? null, selector.symbolPath ?? null, clock - 100_000, OWNER);
    claimIds.push(forest.claim({
      repoId: 'port-daddy', world: { kind: 'worktree', id: RECORDED_WORLD },
      selector: { ...selector, contentHash: hash('4') },
    }, {
      sessionId: SOURCE, agentId: 'body-source', agentNodeId: OWNER,
      claimedAt: clock - 100_000, legacySessionFileId: Number(legacy.lastInsertRowid),
    }).nodeId);
  }
  const peer = forest.claim({
    repoId: 'port-daddy', world: { kind: 'worktree', id: RECORDED_WORLD },
    selector: { kind: 'file', path: 'lib/peer-only.ts' },
  }, { sessionId: 'session-peer', agentId: 'body-peer', agentNodeId: PEER }).nodeId;
  const bootstrap = await service.bootstrapCanonical({
    roadmapSlug: ROADMAP, harbor: 'port-daddy', sourceSessionId: SOURCE, reason: 'Initial canonical ownership.',
  }, { actorId: ACTOR, soulClass: 'graduated' });
  const request: PrepareSameOwnerAnchorRepairRequest = {
    roadmapSlug: ROADMAP, harbor: 'port-daddy', successorSessionId: TARGET,
    reason: 'Operator returned to unfinished work; repair the exact same-owner anchor without rewriting history.',
    claimDispositions: claimIds.map((claimNodeId, index) => ({ claimNodeId, disposition: index === 60 ? 'release' : 'transfer' })),
    idempotencyKey: 'anchor-fixture-logical-request', nonce: randomBytes(32).toString('base64url'), ttlMs: 10_000,
  };
  const actor = { actorId: ACTOR, soulClass: 'graduated' as const };
  const prepare = (overrides: Partial<PrepareSameOwnerAnchorRepairRequest> = {}) => service.prepareSameOwnerAnchorRepair({ ...request, ...overrides }, actor);
  const accept = (grantId: string, nonce = request.nonce) => service.acceptSameOwnerAnchorRepair({ sourceSessionId: SOURCE, grantId, nonce }, actor);
  return {
    db, forest, service, bootstrap, actor, request, prepare, accept, claimIds, peer,
    advance: (ms: number) => { clock += ms; },
    setProbe: (next: () => ExactWorkBinding) => { liveWork = next; },
    setSigningHook: (hook: () => void | Promise<void>) => { onSign = hook; },
    retire: () => { retired = true; },
  };
}

function protectedState(db: DatabaseInstance) {
  return {
    sessions: db.prepare('SELECT * FROM sessions ORDER BY id').all(),
    legacy: db.prepare('SELECT * FROM session_files ORDER BY id').all(),
    claims: db.prepare('SELECT * FROM claim_forest_claims ORDER BY id').all(),
    nodes: db.prepare('SELECT * FROM claim_forest_nodes ORDER BY id').all(),
    edges: db.prepare('SELECT * FROM claim_forest_edges ORDER BY parent_node_id, child_node_id').all(),
    roadmap: db.prepare('SELECT * FROM roadmap_items ORDER BY id').all(),
    epochs: db.prepare('SELECT * FROM roadmap_ownership_epochs ORDER BY epoch_number').all(),
  };
}

describe('same-owner anchor repair in the canonical ownership writer', () => {
  test('signs the exact 61-of-61 mapping, preserves old worlds and atomically appends a new lease epoch', async () => {
    const h = await fixture();
    const before = protectedState(h.db);
    const prepared = await h.prepare();
    expect(protectedState(h.db)).toEqual(before);
    expect(prepared.grant).toMatchObject({
      authorityKind: 'current-owner', predecessorAgentNodeId: OWNER, successorAgentNodeId: OWNER,
      authorizedActorId: ACTOR, successorActorId: ACTOR, sourceWitnessCanonical: true,
      predecessorEvidenceGap: null, operatorPresenceReceipt: null,
      anchorRepair: { sourceWorktreeId: RECORDED_WORLD, targetWorktreeId: ACTUAL_WORLD },
      briefing: { hiddenReasoningAvailable: false },
    });
    expect(prepared.grant.anchorRepair?.claimNodeMappings).toHaveLength(61);
    expect(prepared.grant.briefing.unresolvedQuestions).toHaveLength(1);
    expect(prepared.grant.briefing.evidence.map(citation => citation.source)).toEqual(expect.arrayContaining(['porthole', 'logbook']));
    const result = await h.accept(prepared.grant.grantId);
    expect(result.epoch).toMatchObject({
      ownerAgentNodeId: OWNER, priorOwnerAgentNodeId: OWNER, priorEpochId: h.bootstrap.epoch.epochId,
      epochNumber: 2, sourceSessionId: SOURCE, successorSessionId: TARGET,
      workBinding: { worktreeId: ACTUAL_WORLD },
    });
    expect(result.disposition.transferredClaimNodeIds).toHaveLength(60);
    expect(result.disposition.releasedClaimNodeIds).toHaveLength(1);
    expect(result.disposition.preservedClaimNodeIds).toEqual([]);
    const sourceHistory = h.forest.listClaimsForSession(SOURCE, { includeReleased: true });
    const successor = h.forest.listClaimsForSession(TARGET);
    expect(sourceHistory).toHaveLength(61);
    expect(sourceHistory.every(claim => claim.worldId === RECORDED_WORLD && claim.releasedAt === result.receipt.at)).toBe(true);
    expect(successor).toHaveLength(60);
    expect(successor.every(claim => claim.worldId === ACTUAL_WORLD && claim.agentNodeId === OWNER && !h.claimIds.includes(claim.nodeId))).toBe(true);
    expect(result.epoch.claimBindings.map(claim => claim.claimNodeId).sort()).toEqual(successor.map(claim => claim.nodeId).sort());
    expect(result.epoch.claimSetHash).toBe(exactClaimSetHash(result.epoch.claimBindings));
    expect(result.receipt.details.successorClaimSetHash).toBe(result.epoch.claimSetHash);
    expect(result.epoch.claimBindings.every(claim => claim.claimedAt === result.receipt.at && claim.worldId === ACTUAL_WORLD)).toBe(true);
    for (const node of before.nodes as Array<{ id: string }>) {
      expect(h.db.prepare('SELECT * FROM claim_forest_nodes WHERE id = ?').get(node.id)).toEqual(node);
    }
    expect(h.forest.listClaimsForSession('session-peer').map(claim => claim.nodeId)).toEqual([h.peer]);
    const source = h.db.prepare('SELECT worktree_id, metadata, status FROM sessions WHERE id = ?').get(SOURCE) as any;
    expect(source.worktree_id).toBe(RECORDED_WORLD);
    expect(JSON.parse(source.metadata).worktree.id).toBe(RECORDED_WORLD);
    expect(source.status).toBe('abandoned');
    expect(h.service.getProjection(ROADMAP, 'port-daddy').priorOwners).toEqual([
      { agentNodeId: OWNER, epochId: h.bootstrap.epoch.epochId, epochNumber: 1 },
    ]);
  });

  test('identical preparation and acceptance replay their signed receipts without creating a second transition', async () => {
    const h = await fixture();
    const prepared = await h.prepare();
    expect(await h.prepare()).toMatchObject({ idempotent: true, grant: prepared.grant, nonce: prepared.nonce, receipt: prepared.receipt });
    const accepted = await h.accept(prepared.grant.grantId);
    const state = protectedState(h.db);
    const receiptCount = h.db.prepare('SELECT COUNT(*) AS n FROM durable_takeover_receipts').get();
    expect(await h.accept(prepared.grant.grantId)).toEqual({ ...accepted, idempotent: true });
    expect(await h.prepare()).toMatchObject({ idempotent: true, state: 'consumed', grant: prepared.grant });
    expect(protectedState(h.db)).toEqual(state);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM durable_takeover_receipts').get()).toEqual(receiptCount);
    await expect(h.prepare({ reason: 'Different consent with the same key.' })).rejects.toMatchObject({ code: 'GRANT_CONFLICT' });
    await expect(h.accept(prepared.grant.grantId, randomBytes(32).toString('base64url'))).rejects.toMatchObject({ code: 'AUTHORITY_REQUIRED' });
  });

  test('concurrent duplicate preparation and consumption converge on one signed outcome', async () => {
    const h = await fixture();
    const [a, b] = await Promise.all([h.prepare(), h.prepare()]);
    expect(a.grant.grantId).toBe(b.grant.grantId);
    const [first, second] = await Promise.all([h.accept(a.grant.grantId), h.accept(a.grant.grantId)]);
    expect(first.receipt.receiptId).toBe(second.receipt.receiptId);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM roadmap_ownership_epochs').get()).toEqual({ n: 2 });
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM durable_takeover_receipts WHERE kind = 'consumed'").get()).toEqual({ n: 1 });
  });

  test.each(['worktreeId', 'actorId', 'authorityKind', 'anchorRepair'])('rejects caller-supplied %s authority without any state change', async field => {
    const h = await fixture();
    const before = protectedState(h.db);
    await expect(h.prepare({ [field]: 'forged' } as any)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(protectedState(h.db)).toEqual(before);
  });

  test('refuses a different actor, a different node, or a merely named roster identity', async () => {
    const h = await fixture();
    await expect(h.service.prepareSameOwnerAnchorRepair(h.request, { actorId: 'other-actor', soulClass: 'operator' }))
      .rejects.toMatchObject({ code: 'AUTHORITY_REQUIRED' });
    h.db.prepare('UPDATE sessions SET agent_node_id = NULL WHERE id = ?').run(TARGET);
    const before = protectedState(h.db);
    await expect(h.prepare()).rejects.toMatchObject({ code: 'AUTHORITY_REQUIRED' });
    expect(protectedState(h.db)).toEqual(before);
    h.db.prepare('UPDATE sessions SET agent_node_id = ? WHERE id = ?').run(PEER, TARGET);
    await expect(h.prepare()).rejects.toMatchObject({ code: 'AUTHORITY_REQUIRED' });
  });

  test('operator-class owner still supplies same-owner consent, never an operator override', async () => {
    const h = await fixture();
    const result = await h.service.prepareSameOwnerAnchorRepair(h.request, { actorId: ACTOR, soulClass: 'operator' });
    expect(result.grant.authorityKind).toBe('current-owner');
    expect(result.grant.operatorPresenceReceipt).toBeNull();
    await expect(h.service.acceptTakeover({ sourceSessionId: SOURCE, grantId: result.grant.grantId, nonce: result.nonce }, h.actor))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test.each(['missing', 'duplicate', 'extra'] as const)('rejects a %s claim in the complete 61-claim consent', async variant => {
    const h = await fixture();
    const dispositions = [...h.request.claimDispositions];
    if (variant === 'missing') dispositions.pop();
    if (variant === 'duplicate') dispositions.push(dispositions[0]);
    if (variant === 'extra') dispositions.push({ claimNodeId: h.peer, disposition: 'release' });
    const before = protectedState(h.db);
    await expect(h.prepare({ claimDispositions: dispositions })).rejects.toThrow();
    expect(protectedState(h.db)).toEqual(before);
  });

  test.each(['signer', 'receipt', 'claim', 'silent-claim', 'silent-legacy', 'silent-receipt', 'silent-epoch', 'silent-event', 'session'] as const)('rolls back the complete transition on %s failure', async fault => {
    const h = await fixture();
    const prepared = await h.prepare();
    if (fault === 'signer') h.setSigningHook(() => { throw new Error('local signer unavailable'); });
    if (fault === 'receipt') h.db.exec(`CREATE TRIGGER fail_receipt BEFORE INSERT ON durable_takeover_receipts
      WHEN NEW.kind = 'consumed' BEGIN SELECT RAISE(ABORT, 'receipt failure'); END;`);
    if (fault === 'claim') h.db.exec(`CREATE TRIGGER fail_claim BEFORE INSERT ON claim_forest_claims
      WHEN NEW.session_id = '${TARGET}' AND (SELECT COUNT(*) FROM claim_forest_claims WHERE session_id = '${TARGET}') = 30
      BEGIN SELECT RAISE(ABORT, '31st claim failure'); END;`);
    if (fault === 'silent-claim') h.db.exec(`CREATE TRIGGER ignore_claim BEFORE INSERT ON claim_forest_claims
      WHEN NEW.session_id = '${TARGET}' BEGIN SELECT RAISE(IGNORE); END;`);
    if (fault === 'silent-legacy') h.db.exec(`CREATE TRIGGER ignore_legacy BEFORE INSERT ON session_files
      WHEN NEW.session_id = '${TARGET}' BEGIN SELECT RAISE(IGNORE); END;`);
    if (fault === 'silent-receipt') h.db.exec(`CREATE TRIGGER ignore_receipt BEFORE INSERT ON durable_takeover_receipts
      WHEN NEW.kind = 'consumed' BEGIN SELECT RAISE(IGNORE); END;`);
    if (fault === 'silent-epoch') h.db.exec(`CREATE TRIGGER ignore_epoch BEFORE INSERT ON roadmap_ownership_epochs
      WHEN NEW.epoch_number = 2 BEGIN SELECT RAISE(IGNORE); END;`);
    if (fault === 'silent-event') h.db.exec(`CREATE TRIGGER ignore_event BEFORE INSERT ON roadmap_ownership_events
      WHEN NEW.kind = 'taken-over' BEGIN SELECT RAISE(IGNORE); END;`);
    if (fault === 'session') h.db.exec(`CREATE TRIGGER fail_session BEFORE UPDATE ON sessions
      WHEN NEW.id = '${SOURCE}' BEGIN SELECT RAISE(IGNORE); END;`);
    const before = protectedState(h.db);
    await expect(h.accept(prepared.grant.grantId)).rejects.toThrow();
    expect(protectedState(h.db)).toEqual(before);
    expect(h.forest.listClaimsForSession(SOURCE)).toHaveLength(61);
    expect(h.forest.listClaimsForSession(TARGET)).toEqual([]);
    expect(h.service.getGrant(prepared.grant.grantId)?.state).toBe('active');
  });

  test('expiry is checked after asynchronous signing, not just before it', async () => {
    const h = await fixture();
    const prepared = await h.prepare();
    const before = protectedState(h.db);
    h.setSigningHook(() => h.advance(11_000));
    await expect(h.accept(prepared.grant.grantId)).rejects.toMatchObject({ code: 'GRANT_EXPIRED' });
    expect(protectedState(h.db)).toEqual(before);
  });

  test('a preparation that expires while signing never publishes an active grant', async () => {
    const h = await fixture();
    h.setSigningHook(() => h.advance(11_000));
    const before = protectedState(h.db);
    await expect(h.prepare()).rejects.toMatchObject({ code: 'GRANT_EXPIRED' });
    expect(protectedState(h.db)).toEqual(before);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM durable_takeover_grants').get()).toEqual({ n: 0 });
  });

  test('AgentNode retirement between prepare and accept fails closed', async () => {
    const h = await fixture();
    const prepared = await h.prepare();
    h.retire();
    const before = protectedState(h.db);
    await expect(h.accept(prepared.grant.grantId)).rejects.toThrow();
    expect(protectedState(h.db)).toEqual(before);
  });

  test('source lineage changing while signatures are prepared aborts without overwriting that change', async () => {
    const h = await fixture();
    const prepared = await h.prepare();
    let afterExternalChange: ReturnType<typeof protectedState> | undefined;
    h.setSigningHook(() => {
      if (afterExternalChange) return;
      h.db.prepare('UPDATE sessions SET purpose = ? WHERE id = ?').run('Concurrent owner decision', SOURCE);
      afterExternalChange = protectedState(h.db);
    });
    await expect(h.accept(prepared.grant.grantId)).rejects.toMatchObject({ code: 'GRANT_BINDING_MISMATCH' });
    expect(protectedState(h.db)).toEqual(afterExternalChange);
  });

  test('physical identity changing during the claim transaction rolls back newly created claim nodes', async () => {
    const h = await fixture();
    const prepared = await h.prepare();
    const before = protectedState(h.db);
    h.db.function('recreate_anchor_root', () => {
      h.setProbe(() => ({ ...work(), worktreePhysicalId: hash('9') }));
      return 1;
    });
    h.db.exec(`CREATE TRIGGER recreate_root_after_claim AFTER INSERT ON claim_forest_claims
      WHEN NEW.session_id = '${TARGET}' BEGIN SELECT recreate_anchor_root(); END;`);
    await expect(h.accept(prepared.grant.grantId)).rejects.toMatchObject({ code: 'GRANT_BINDING_MISMATCH' });
    expect(protectedState(h.db)).toEqual(before);
  });

  test('a 62nd claim arriving during signing is not silently abandoned or preserved outside the grant', async () => {
    const h = await fixture();
    const prepared = await h.prepare();
    let added = false;
    h.setSigningHook(() => {
      if (added) return;
      added = true;
      h.forest.claim({ repoId: 'port-daddy', world: { kind: 'worktree', id: RECORDED_WORLD },
        selector: { kind: 'file', path: 'lib/late.ts' } },
      { sessionId: SOURCE, agentId: 'body-source', agentNodeId: OWNER });
    });
    await expect(h.accept(prepared.grant.grantId)).rejects.toThrow();
    expect(h.forest.listClaimsForSession(SOURCE)).toHaveLength(62);
    expect(h.forest.listClaimsForSession(TARGET)).toEqual([]);
    expect(h.service.getProjection(ROADMAP, 'port-daddy').currentEpoch?.epochId).toBe(h.bootstrap.epoch.epochId);
  });

  test('destination peer claims block repair without being released or transferred', async () => {
    const h = await fixture();
    const prepared = await h.prepare();
    h.forest.claim({ repoId: 'port-daddy', world: { kind: 'worktree', id: ACTUAL_WORLD },
      selector: { kind: 'directory', path: 'lib' } },
    { sessionId: 'session-peer', agentNodeId: PEER, agentId: 'body-peer' });
    const before = protectedState(h.db);
    await expect(h.accept(prepared.grant.grantId)).rejects.toThrow();
    expect(protectedState(h.db)).toEqual(before);
  });

  test('raw claim transfer outside the ownership transaction is refused', async () => {
    const h = await fixture();
    const prepared = await h.prepare();
    const before = protectedState(h.db);
    expect(() => h.forest.transferExactClaims({
      grantId: prepared.grant.grantId, sourceSessionId: SOURCE, successorSessionId: TARGET,
      predecessorAgentNodeId: OWNER, successorAgentNodeId: OWNER, successorAgentId: 'body-target',
      allowUnboundPredecessor: false, bindings: prepared.grant.claimBindings, anchorRepair: prepared.grant.anchorRepair,
    })).toThrow('ownership IMMEDIATE transaction');
    expect(protectedState(h.db)).toEqual(before);
  });

  test('a root recreated at the identical path/head/branch cannot consume the old physical grant', async () => {
    const scratchParent = join(homedir(), 'coding', 'tmp');
    mkdirSync(scratchParent, { recursive: true });
    const scratch = mkdtempSync(join(scratchParent, 'pd-anchor-recreated-root-test-'));
    scratchDirectories.push(scratch);
    const repo = join(scratch, 'repo');
    const root = join(scratch, 'worktree');
    mkdirSync(repo);
    const git = (args: string[], cwd = repo) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
    }).trim();
    git(['init', '-b', 'main']);
    git(['-c', 'user.name=Anchor Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'hermetic fixture']);
    git(['remote', 'add', 'origin', 'https://example.invalid/anchor-fixture.git']);
    git(['worktree', 'add', '-b', 'repair-test', root]);
    const capture = (): ExactWorkBinding => ({
      ...captureCanonicalGitWorkspace(root), dirtyTreeHash: hash('0'), dirtyPaths: [], prUrls: [],
    });
    const original = capture();
    const h = await fixture(capture);
    const prepared = await h.prepare();
    const before = protectedState(h.db);
    const gitPointer = readFileSync(join(root, '.git'));
    // Keep the old inode alive, so this is guaranteed to be a NEW directory.
    renameSync(root, `${root}-preserved`);
    mkdirSync(root);
    writeFileSync(join(root, '.git'), gitPointer);
    const recreated = capture();
    expect(recreated.worktreeId).toBe(original.worktreeId);
    expect(recreated.head).toBe(original.head);
    expect(recreated.branch).toBe(original.branch);
    expect(recreated.worktreePhysicalId).not.toBe(original.worktreePhysicalId);
    await expect(h.accept(prepared.grant.grantId)).rejects.toMatchObject({ code: 'SUCCESSOR_ADMISSION_INVALID' });
    expect(protectedState(h.db)).toEqual(before);
  });
});
