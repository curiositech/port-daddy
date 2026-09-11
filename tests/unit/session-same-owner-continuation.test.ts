import Fastify from 'fastify';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createActorSouls } from '../../lib/actor-souls.js';
import { createClaimForest } from '../../lib/claim-forest.js';
import { createLegacySessionContinuation } from '../../lib/legacy-session-continuation.js';
import { createSessions } from '../../lib/sessions.js';
import { sessionsPlugin } from '../../routes/sessions.js';

const LABEL = 'agent-legacy-chartroom-worker';
const WORKTREE = 'chartroom-world';
const WORKTREE_CONTEXT = {
  id: WORKTREE,
  root: '/Users/example/coding/tmp/chartroom-world',
  name: 'chartroom-world',
  branch: 'codex/chartroom-world',
  isMain: false,
};
const WORKTREE_WITNESS = {
  id: WORKTREE,
  root: WORKTREE_CONTEXT.root,
  name: WORKTREE_CONTEXT.name,
  branch: WORKTREE_CONTEXT.branch,
  isMain: false,
  repoId: 'github.com/example/port-daddy',
  head: 'd885273355b00000000000000000000000000000',
  base: '412a88e000000000000000000000000000000000',
  worktreeRealpath: WORKTREE_CONTEXT.root,
  worktreePhysicalId: 'dev:1:ino:2',
  gitDirRealpath: '/Users/example/coding/port-daddy/.git/worktrees/chartroom-world',
  gitDirPhysicalId: 'dev:1:ino:3',
  repoCommonDir: '/Users/example/coding/port-daddy/.git',
  remote: 'git@github.com:example/port-daddy.git',
};
const openApps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  for (const app of openApps.splice(0)) await app.close();
});

function fixture(options: { abandoned?: boolean; splitAlias?: boolean } = {}) {
  const db = createTestDb();
  const souls = createActorSouls(db, { defaultHarbor: 'local' });
  const owner = souls.mint({ alias: LABEL });
  const sessions = createSessions(db, undefined, { requireAgentForFileClaims: true });
  const continuation = createLegacySessionContinuation(db);
  const started = sessions.start('Harden Chartroom', {
    agentId: LABEL,
    project: 'port-daddy',
    worktreeId: WORKTREE,
    durable: true,
    metadata: {
      identity: { verified: true, actorId: owner.actorId, soulClass: 'graduated' },
      worktree: WORKTREE_CONTEXT,
    },
  });
  if (!started.success || typeof started.id !== 'string') throw new Error('fixture session did not start');
  const sourceId = started.id;
  expect(sessions.claimFiles(sourceId, ['lib/whole.ts'], { agentId: LABEL }).success).toBe(true);
  expect(sessions.claimFiles(sourceId, [], {
    agentId: LABEL,
    regions: [
      { path: 'lib/symbol.ts', symbol: 'write', symbolPath: 'Chartroom.write', startLine: 4, endLine: 9 },
      { path: 'lib/range.ts', startLine: 11, endLine: 18 },
    ],
  }).success).toBe(true);
  if (options.abandoned) {
    db.prepare("UPDATE sessions SET status = 'abandoned', phase = 'abandoned' WHERE id = ?").run(sourceId);
  }
  if (options.splitAlias !== false) {
    db.prepare('DELETE FROM actor_alias WHERE harbor = ? AND alias = ?').run('local', LABEL);
    const synthetic = souls.mint({
      harbor: 'local',
      alias: LABEL,
      explicitActorId: LABEL,
      credentialKind: 'migrated',
      operatorTrusted: true,
    });
    expect(souls.resolveAlias(LABEL, 'local')).toBe(LABEL);
    return { db, souls, owner, synthetic, sessions, continuation, sourceId };
  }
  return { db, souls, owner, synthetic: null, sessions, continuation, sourceId };
}

function continueOptions(owner: { actorId: string }) {
  return {
    verifiedActorId: owner.actorId,
    verifiedSoulClass: 'graduated',
    harbor: 'local',
    worktree: WORKTREE_WITNESS,
    note: 'Resume the exact unpublished checkpoint.',
    durable: true,
  };
}

function protectedRows(db: any) {
  return {
    sessions: db.prepare('SELECT * FROM sessions ORDER BY id').all(),
    notes: db.prepare('SELECT * FROM session_notes ORDER BY id').all(),
    legacy: db.prepare('SELECT * FROM session_files ORDER BY id').all(),
    forest: db.prepare('SELECT * FROM claim_forest_claims ORDER BY id').all(),
    aliases: db.prepare('SELECT * FROM actor_alias ORDER BY harbor, alias').all(),
    souls: db.prepare('SELECT * FROM actor_souls ORDER BY harbor, actor_id').all(),
    aliasRetirements: db.prepare(`
      SELECT * FROM legacy_actor_alias_retirements
      ORDER BY harbor, alias, synthetic_actor_id
    `).all(),
  };
}

describe('pre-AgentNode actor-only continuation', () => {
  test.each([false, true])(
    'atomically transfers/read-backs every selector from an %s predecessor and preserves the legacy label',
    abandoned => {
      const h = fixture({ abandoned });
      const sourceNodes = h.sessions.get(h.sourceId).files
        .filter((claim: any) => claim.releasedAt === null)
        .map((claim: any) => claim.nodeId)
        .sort();

      const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));
      expect(result).toMatchObject({
        success: true,
        predecessorId: h.sourceId,
        predecessorStatus: 'abandoned',
        actorId: h.owner.actorId,
        predecessorAgentId: LABEL,
        successorAgentId: LABEL,
        actorOnlyContinuation: true,
        durableOwnershipTransferred: false,
        agentNodeId: null,
        agentNodeUpgradeRequired: true,
        claimsTransferred: 3,
        claimReadback: { compatibilityRows: 3, forestRows: 3, nodeIds: sourceNodes },
        aliasRepair: { status: 'repaired', alias: LABEL, actorId: h.owner.actorId },
      });
      const successor = h.sessions.get(result.successorId as string);
      expect(successor.session).toMatchObject({
        status: 'active',
        agentId: LABEL,
        worktreeId: WORKTREE,
        fileCount: 3,
        metadata: {
          predecessorAgentId: LABEL,
          predecessorActorId: h.owner.actorId,
          actorOnlyContinuation: true,
          durableOwnershipTransferred: false,
          agentNodeUpgradeRequired: true,
        },
      });
      expect(h.db.prepare('SELECT agent_node_id FROM sessions WHERE id = ?').get(result.successorId))
        .toEqual({ agent_node_id: null });
      expect(successor.files.filter((claim: any) => claim.releasedAt === null).map((claim: any) => claim.nodeId).sort())
        .toEqual(sourceNodes);
      expect(h.sessions.get(h.sourceId).files.every((claim: any) => claim.releasedAt !== null)).toBe(true);
      expect(h.souls.resolveAlias(LABEL, 'local')).toBe(h.owner.actorId);
      expect(h.souls.getSoul(LABEL, 'local')).not.toBeNull(); // retained evidence, not deleted
      expect(h.souls.verifyCredential(h.synthetic!.credential)).toBeNull();
      h.db.close();
    },
  );

  test('rejects a mismatched credential actor without consulting the current alias', () => {
    const h = fixture();
    const attacker = h.souls.mint({ alias: 'attacker' });
    const before = protectedRows(h.db);
    const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(attacker));
    expect(result).toMatchObject({ success: false, code: 'SAME_OWNER_ACTOR_MISMATCH' });
    expect(protectedRows(h.db)).toEqual(before);
    h.db.close();
  });

  test('continues when the historical label is already exactly bound to the credential actor', () => {
    const h = fixture({ abandoned: true, splitAlias: false });
    const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));
    expect(result).toMatchObject({
      success: true,
      successorAgentId: LABEL,
      actorId: h.owner.actorId,
      aliasRepair: { status: 'not-needed', alias: LABEL, actorId: h.owner.actorId },
    });
    expect(h.souls.resolveActor(LABEL)).toMatchObject({ actorId: h.owner.actorId });
    h.db.close();
  });

  test('rolls back when the historical label has neither an exact binding nor a synthetic artifact', () => {
    const h = fixture({ abandoned: true, splitAlias: false });
    h.db.prepare('DELETE FROM actor_alias WHERE harbor = ? AND alias = ?').run('local', LABEL);
    const before = protectedRows(h.db);
    const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));
    expect(result).toMatchObject({ success: false, code: 'LEGACY_ALIAS_NOT_SYNTHETIC' });
    expect(protectedRows(h.db)).toEqual(before);
    h.db.close();
  });

  test('keeps AgentNode-bound sessions on the signed durable-ownership path', () => {
    const h = fixture();
    h.db.prepare('UPDATE sessions SET agent_node_id = ? WHERE id = ?')
      .run('agent_node_real_owner', h.sourceId);
    const before = protectedRows(h.db);
    const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));
    expect(result).toMatchObject({ success: false, code: 'AGENT_NODE_CONTINUATION_REQUIRED' });
    expect(protectedRows(h.db)).toEqual(before);
    h.db.close();
  });

  test('fails closed when compatibility and forest claim snapshots differ', () => {
    const h = fixture();
    h.db.prepare(`
      UPDATE claim_forest_claims SET released_at = 1
      WHERE id = (SELECT MIN(id) FROM claim_forest_claims WHERE session_id = ?)
    `).run(h.sourceId);
    const before = protectedRows(h.db);
    const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));
    expect(result).toMatchObject({ success: false, code: 'CLAIM_SNAPSHOT_MISMATCH' });
    expect(protectedRows(h.db)).toEqual(before);
    h.db.close();
  });

  test('preserves every predecessor claim authority field and merges continuation provenance into metadata', () => {
    const h = fixture({ abandoned: true });
    const legacy = h.db.prepare(`
      SELECT sf.id, sf.claimed_at, c.id AS old_claim_id
      FROM session_files sf
      JOIN claim_forest_claims c ON c.legacy_session_file_id = sf.id
      WHERE sf.session_id = ? AND sf.file_path = 'lib/whole.ts'
        AND sf.released_at IS NULL AND c.released_at IS NULL
    `).get(h.sourceId) as { id: number; claimed_at: number; old_claim_id: number };
    h.db.prepare('DELETE FROM claim_forest_claims WHERE id = ?').run(legacy.old_claim_id);
    const created = createClaimForest(h.db).claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: WORKTREE, gitOid: 'd885273355b' },
      selector: { kind: 'file', path: 'lib/whole.ts', contentHash: 'historical-claim-hash' },
    }, {
      sessionId: h.sourceId,
      agentId: LABEL,
      mode: 'SIX',
      intent: 'preserve-unpublished-checkpoint',
      claimedAt: legacy.claimed_at,
      observedBy: 'legitimate-source-fixture',
      confidence: 0.42,
      legacySessionFileId: legacy.id,
      metadata: {
        provenance: { source: 'legacy-worker', ordinal: 7 },
        retained: true,
      },
    });
    const sourceClaim = { id: created.claimId, node_id: created.nodeId };
    // A later observer may know a newer node hash while the historical claim
    // remains pinned to its own claim-local hash. Both are legitimate facts.
    h.db.prepare('UPDATE claim_forest_nodes SET content_hash = ? WHERE id = ?')
      .run('current-node-hash', sourceClaim.node_id);
    const nodeBefore = h.db.prepare('SELECT * FROM claim_forest_nodes WHERE id = ?')
      .get(sourceClaim.node_id);

    const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));
    expect(result.success).toBe(true);
    const successor = h.db.prepare(`
      SELECT c.agent_id, c.agent_node_id, c.mode, c.intent, c.confidence,
             c.claim_content_hash, c.metadata, n.repo_id, n.world_kind,
             n.world_id, n.git_oid, n.content_hash
      FROM claim_forest_claims c
      JOIN claim_forest_nodes n ON n.id = c.node_id
      WHERE c.session_id = ? AND c.node_id = ? AND c.released_at IS NULL
    `).get(result.successorId, sourceClaim.node_id) as Record<string, unknown>;
    expect(successor).toMatchObject({
      agent_id: LABEL,
      agent_node_id: null,
      mode: 'SIX',
      intent: 'preserve-unpublished-checkpoint',
      confidence: 0.42,
      claim_content_hash: 'historical-claim-hash',
      repo_id: 'port-daddy',
      world_kind: 'worktree',
      world_id: WORKTREE,
      git_oid: 'd885273355b',
      content_hash: 'current-node-hash',
    });
    expect(JSON.parse(successor.metadata as string)).toMatchObject({
      provenance: { source: 'legacy-worker', ordinal: 7 },
      retained: true,
      actorOnlyContinuation: {
        predecessorSessionId: h.sourceId,
        predecessorClaimId: sourceClaim.id,
        predecessorClaimNodeId: sourceClaim.node_id,
      },
    });
    expect(h.db.prepare('SELECT * FROM claim_forest_nodes WHERE id = ?').get(sourceClaim.node_id))
      .toEqual(nodeBefore);
    h.db.close();
  });

  test('rejects a predecessor whose stored address no longer hashes to its canonical claim node id', () => {
    const h = fixture({ abandoned: true });
    h.db.prepare(`
      UPDATE claim_forest_nodes
      SET git_oid = 'tampered-source-address'
      WHERE id = (
        SELECT node_id FROM claim_forest_claims
        WHERE session_id = ? AND released_at IS NULL
        ORDER BY id LIMIT 1
      )
    `).run(h.sourceId);
    const before = protectedRows(h.db);
    const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));
    expect(result).toMatchObject({ success: false, code: 'CLAIM_SNAPSHOT_MISMATCH' });
    expect(protectedRows(h.db)).toEqual(before);
    h.db.close();
  });

  test('rejects a conflicting raw predecessor claim actor without converting its attribution', () => {
    const h = fixture({ abandoned: true });
    h.db.prepare(`
      UPDATE claim_forest_claims
      SET agent_id = 'attacker'
      WHERE id = (
        SELECT id FROM claim_forest_claims
        WHERE session_id = ? AND released_at IS NULL
        ORDER BY id LIMIT 1
      )
    `).run(h.sourceId);
    const before = protectedRows(h.db);
    const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));
    expect(result).toMatchObject({ success: false, code: 'CLAIM_SNAPSHOT_MISMATCH' });
    expect(protectedRows(h.db)).toEqual(before);
    h.db.close();
  });

  test('accepts a null historical claim actor only with an exact explicit legacy witness', () => {
    const h = fixture({ abandoned: true });
    const row = h.db.prepare(`
      SELECT id, metadata FROM claim_forest_claims
      WHERE session_id = ? AND released_at IS NULL
      ORDER BY id LIMIT 1
    `).get(h.sourceId) as { id: number; metadata: string | null };
    h.db.prepare('UPDATE claim_forest_claims SET agent_id = NULL, metadata = ? WHERE id = ?').run(
      JSON.stringify({
        legacyActorClaimActor: {
          state: 'historically-missing',
          predecessorAgentId: LABEL,
          stampedActorId: h.owner.actorId,
        },
      }),
      row.id,
    );

    const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));
    expect(result.success).toBe(true);
    expect(h.db.prepare(`
      SELECT COUNT(*) AS count FROM claim_forest_claims
      WHERE session_id = ? AND released_at IS NULL AND agent_id = ?
    `).get(result.successorId, LABEL)).toEqual({ count: 3 });
    h.db.close();
  });

  test.each([
    ['claim actor', "UPDATE claim_forest_claims SET agent_id = 'tampered-actor' WHERE id = NEW.id"],
    ['claim mode', "UPDATE claim_forest_claims SET mode = 'S' WHERE id = NEW.id"],
    ['claim intent', "UPDATE claim_forest_claims SET intent = 'tampered-intent' WHERE id = NEW.id"],
    ['claim confidence', 'UPDATE claim_forest_claims SET confidence = 0.125 WHERE id = NEW.id'],
    ['claim metadata', "UPDATE claim_forest_claims SET metadata = '{\"tampered\":true}' WHERE id = NEW.id"],
    ['claim content hash', "UPDATE claim_forest_claims SET claim_content_hash = 'tampered-claim-hash' WHERE id = NEW.id"],
    ['node world', "UPDATE claim_forest_nodes SET world_id = 'tampered-world' WHERE id = NEW.node_id"],
    ['node git oid', "UPDATE claim_forest_nodes SET git_oid = 'tampered-git-oid' WHERE id = NEW.node_id"],
    ['node content hash', "UPDATE claim_forest_nodes SET content_hash = 'tampered-node-hash' WHERE id = NEW.node_id"],
  ])('rolls back the complete continuation when post-write readback detects hostile %s tampering', (_name, sql) => {
    const h = fixture({ abandoned: true });
    h.db.exec(`
      CREATE TRIGGER tamper_actor_only_forest_insert
      AFTER INSERT ON claim_forest_claims
      WHEN NEW.observed_by = 'sessions.actor-only-continuation'
      BEGIN ${sql}; END
    `);
    const before = protectedRows(h.db);
    const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));
    expect(result).toMatchObject({ success: false, code: 'CLAIM_SNAPSHOT_MISMATCH' });
    expect(protectedRows(h.db)).toEqual(before);
    h.db.close();
  });

  test.each([
    ['successor historical label', "UPDATE sessions SET agent_id = 'attacker-label' WHERE id = NEW.session_id"],
    ['successor canonical actor stamp', `UPDATE sessions
      SET metadata = json_set(metadata, '$.identity.actorId', 'attacker-actor')
      WHERE id = NEW.session_id`],
    ['successor worktree witness', `UPDATE sessions
      SET metadata = json_set(metadata, '$.actorOnlyWorktreeWitness.head', '${'a'.repeat(40)}')
      WHERE id = NEW.session_id`],
    ['successor claim-set witness', `UPDATE sessions
      SET metadata = json_set(metadata, '$.actorOnlyClaimSetWitness.sha256', '${'b'.repeat(64)}')
      WHERE id = NEW.session_id`],
    ['predecessor continuation marker', `UPDATE sessions
      SET metadata = json_set(metadata, '$.actorOnlyContinuation.actorId', 'attacker-actor')
      WHERE id = json_extract(
        (SELECT metadata FROM sessions WHERE id = NEW.session_id),
        '$.predecessorSessionId'
      )`],
    ['repaired label binding', `UPDATE actor_alias
      SET actor_id = '${LABEL}'
      WHERE harbor = 'local' AND alias = '${LABEL}'`],
  ])('rolls back when final authority readback detects hostile %s tampering', (_name, sql) => {
    const h = fixture({ abandoned: true });
    h.db.exec(`
      CREATE TRIGGER tamper_actor_only_authority_readback
      AFTER INSERT ON claim_forest_claims
      WHEN NEW.observed_by = 'sessions.actor-only-continuation'
      BEGIN ${sql}; END
    `);
    const before = protectedRows(h.db);
    const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));
    expect(result).toMatchObject({ success: false, code: 'ACTOR_ONLY_CONTINUATION_FAILED' });
    expect(protectedRows(h.db)).toEqual(before);
    h.db.close();
  });

  test('rolls back successor, notes, session state, alias CAS, and both claim stores on injected claim failure', () => {
    const h = fixture({ abandoned: true });
    h.db.exec(`
      CREATE TRIGGER fail_actor_only_forest_insert
      BEFORE INSERT ON claim_forest_claims
      WHEN NEW.observed_by = 'sessions.actor-only-continuation'
      BEGIN SELECT RAISE(ABORT, 'hostile claim write fault'); END
    `);
    const before = protectedRows(h.db);
    const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));
    expect(result).toMatchObject({ success: false, code: 'ACTOR_ONLY_CONTINUATION_FAILED' });
    expect(protectedRows(h.db)).toEqual(before);
    expect(h.souls.verifyCredential(h.synthetic!.credential)).toBe(h.synthetic!.actorId);
    h.db.close();
  });

  test('serializes competing/replayed continuations with the predecessor consumption marker', () => {
    const h = fixture({ abandoned: true });
    const contender = createLegacySessionContinuation(h.db);
    const first = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));
    const second = contender.continueSameOwner(h.sourceId, continueOptions(h.owner));
    expect(first.success).toBe(true);
    expect(second).toMatchObject({
      success: false,
      code: 'ACTOR_ONLY_CONTINUATION_ALREADY_CONSUMED',
    });
    expect(h.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE json_extract(metadata, '$.predecessorSessionId') = ?")
      .get(h.sourceId).count).toBe(1);
    h.db.close();
  });

  test.each([
    ['false', false],
    ['null', null],
  ])('fails closed when a predecessor already has an %s continuation marker', (_name, marker) => {
    const h = fixture({ abandoned: true });
    h.db.prepare(`
      UPDATE sessions
      SET metadata = json_set(metadata, '$.actorOnlyContinuation', json(?))
      WHERE id = ?
    `).run(JSON.stringify(marker), h.sourceId);
    const before = protectedRows(h.db);

    const result = h.continuation.continueSameOwner(h.sourceId, continueOptions(h.owner));

    expect(result).toMatchObject({
      success: false,
      code: 'ACTOR_ONLY_CONTINUATION_ALREADY_CONSUMED',
    });
    expect(protectedRows(h.db)).toEqual(before);
    h.db.close();
  });

  test('refuses to move the legacy claim world', () => {
    const h = fixture();
    const before = protectedRows(h.db);
    const result = h.continuation.continueSameOwner(h.sourceId, {
      ...continueOptions(h.owner),
      worktree: { ...WORKTREE_WITNESS, id: 'different-world' },
    });
    expect(result).toMatchObject({ success: false, code: 'ACTOR_ONLY_WORKTREE_MISMATCH' });
    expect(protectedRows(h.db)).toEqual(before);
    h.db.close();
  });
});

describe('credential-only HTTP admission and cleanup', () => {
  function routeFixture(options: { workspaceIdentity?: Record<string, unknown> } = {}) {
    const h = fixture({ abandoned: true });
    const worktree = WORKTREE_CONTEXT;
    const durableOwnership = {
      getGrant: jest.fn(() => null),
      acceptTakeover: jest.fn(),
    };
    const logger = { info: jest.fn(), error: jest.fn() };
    const app = Fastify();
    openApps.push(app);
    app.addHook('onClose', () => h.db.close());
    app.register(sessionsPlugin, {
      deps: {
        sessions: h.sessions,
        legacySessionContinuation: h.continuation,
        metrics: { errors: 0 },
        logger,
        activityLog: { log() {} },
        actorSouls: h.souls,
        durableOwnership: durableOwnership as any,
        sessionWorktreeProbe: root => ({
          ...(root === worktree.root ? worktree : {
            id: 'other-world',
            root,
            name: 'other-world',
            branch: 'codex/other-world',
            isMain: false,
          }),
          commonDir: '/Users/example/coding/port-daddy/.git',
        }),
        sessionWorkspaceIdentityProbe: root => ({
          repoId: root === worktree.root ? WORKTREE_WITNESS.repoId : 'github.com/example/other',
          worktreeId: root === worktree.root ? WORKTREE_WITNESS.id : 'other-world',
          worktreeRoot: root,
          worktreeRealpath: root,
          worktreePhysicalId: root === worktree.root
            ? WORKTREE_WITNESS.worktreePhysicalId
            : 'dev:1:ino:20',
          gitDirRealpath: root === worktree.root
            ? WORKTREE_WITNESS.gitDirRealpath
            : '/Users/example/coding/port-daddy/.git/worktrees/other-world',
          gitDirPhysicalId: root === worktree.root
            ? WORKTREE_WITNESS.gitDirPhysicalId
            : 'dev:1:ino:30',
          repoCommonDir: WORKTREE_WITNESS.repoCommonDir,
          branch: root === worktree.root ? WORKTREE_WITNESS.branch : 'codex/other-world',
          remote: WORKTREE_WITNESS.remote,
          head: WORKTREE_WITNESS.head,
          base: WORKTREE_WITNESS.base,
          ...(options.workspaceIdentity ?? {}),
        } as any),
      },
    });
    return { ...h, app, durableOwnership, logger, worktree };
  }

  test('admits --same-owner with only the matching credential and never enters AgentNode takeover', async () => {
    const h = routeFixture();
    const response = await h.app.inject({
      method: 'POST',
      url: `/sessions/${h.sourceId}/takeover`,
      headers: { 'x-actor-credential': h.owner.credential },
      payload: { sameOwner: true, note: 'Resume checkpoint', worktree: h.worktree },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      actorId: h.owner.actorId,
      actorOnlyContinuation: true,
      durableOwnershipTransferred: false,
      claimsTransferred: 3,
    });
    expect(h.durableOwnership.getGrant).not.toHaveBeenCalled();
    expect(h.durableOwnership.acceptTakeover).not.toHaveBeenCalled();

    const successorId = response.json().successorId as string;
    const attributedWrite = await h.app.inject({
      method: 'POST',
      url: `/sessions/${successorId}/notes`,
      headers: { 'x-actor-credential': h.owner.credential },
      payload: { agentId: LABEL, content: 'Successor retained its attributed write identity.' },
    });
    expect(attributedWrite.statusCode).toBe(200);
    expect(attributedWrite.json()).toMatchObject({
      success: true,
      identity: { actorId: h.owner.actorId },
    });
    expect(h.sessions.getNotes(successorId)).toMatchObject({
      success: true,
      notes: expect.arrayContaining([
        expect.objectContaining({ content: 'Successor retained its attributed write identity.' }),
      ]),
    });
  });

  test.each([
    ['missing credential', {}, {}, 401, 'IDENTITY_CREDENTIAL_REQUIRED'],
    ['forged credential', { 'x-actor-credential': 'forged.bad' }, {}, 401, 'IDENTITY_CREDENTIAL_INVALID'],
    ['mismatched credential', null, {}, 403, 'SAME_OWNER_ACTOR_MISMATCH'],
    ['X-Agent-Id assertion', null, { 'x-agent-id': LABEL }, 400, 'SESSION_AGENT_ASSERTION_FORBIDDEN'],
    ['body agentId assertion', null, {}, 400, 'SESSION_AGENT_ASSERTION_FORBIDDEN'],
  ])('rejects %s without changing the predecessor', async (name, rawHeaders, extraHeaders, status, code) => {
    const h = routeFixture();
    const attacker = h.souls.mint({ alias: `attacker-${name}` });
    const headers = rawHeaders === null
      ? { 'x-actor-credential': name === 'mismatched credential' ? attacker.credential : h.owner.credential, ...extraHeaders }
      : rawHeaders;
    const payload = name === 'body agentId assertion'
      ? { sameOwner: true, agentId: LABEL, worktree: h.worktree }
      : { sameOwner: true, worktree: h.worktree };
    const before = protectedRows(h.db);
    const response = await h.app.inject({ method: 'POST', url: `/sessions/${h.sourceId}/takeover`, headers, payload });
    expect(response.statusCode).toBe(status);
    expect(response.json().code).toBe(code);
    expect(protectedRows(h.db)).toEqual(before);
  });

  test('cleanup mutations reject IPC-style unauthenticated use and accept only the stamped actor credential', async () => {
    const missing = routeFixture();
    const before = protectedRows(missing.db);
    const refused = await missing.app.inject({ method: 'DELETE', url: `/sessions/${missing.sourceId}` });
    expect(refused.statusCode).toBe(401);
    expect(refused.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    expect(protectedRows(missing.db)).toEqual(before);

    const allowed = routeFixture();
    const archived = await allowed.app.inject({
      method: 'DELETE',
      url: `/sessions/${allowed.sourceId}`,
      headers: { 'x-actor-credential': allowed.owner.credential },
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({ success: true, archived: true, notesPreserved: true });
  });

  test.each(['PUT', 'DELETE'] as const)(
    '%s exact-session cleanup rejects every forged or ambiguous authority carrier',
    async method => {
      for (const scenario of [
        ['missing credential', 401, 'IDENTITY_CREDENTIAL_REQUIRED'],
        ['forged credential', 401, 'IDENTITY_CREDENTIAL_INVALID'],
        ['mismatched actor', 403, 'SAME_OWNER_ACTOR_MISMATCH'],
        ['X-Agent-Id assertion', 400, 'SESSION_AGENT_ASSERTION_FORBIDDEN'],
        ['body agentId assertion', 400, 'SESSION_AGENT_ASSERTION_FORBIDDEN'],
        ['unstamped session', 409, 'SESSION_OWNER_STAMP_REQUIRED'],
      ] as const) {
        const [name, status, code] = scenario;
        const h = routeFixture();
        const attacker = name === 'mismatched actor' ? h.souls.mint({ alias: `cleanup-attacker-${method}` }) : null;
        if (name === 'unstamped session') {
          h.db.prepare("UPDATE sessions SET metadata = '{}' WHERE id = ?").run(h.sourceId);
        }
        const headers: Record<string, string> = {};
        if (name !== 'missing credential') {
          headers['x-actor-credential'] = name === 'forged credential'
            ? 'forged.cleanup-credential'
            : attacker?.credential ?? h.owner.credential;
        }
        if (name === 'X-Agent-Id assertion') headers['x-agent-id'] = LABEL;
        const payload: Record<string, unknown> = method === 'PUT' ? { status: 'completed' } : {};
        if (name === 'body agentId assertion') payload.agentId = LABEL;
        const before = protectedRows(h.db);
        const response = await h.app.inject({
          method,
          url: `/sessions/${h.sourceId}`,
          headers,
          ...(Object.keys(payload).length > 0 ? { payload } : {}),
        });
        expect(response.statusCode).toBe(status);
        expect(response.json().code).toBe(code);
        expect(protectedRows(h.db)).toEqual(before);
        await h.app.close();
        openApps.splice(openApps.indexOf(h.app), 1);
      }
    },
  );

  test('rejects body credential transport without echoing the credential into the response or logs', async () => {
    const h = routeFixture();
    const secret = h.owner.credential;
    const response = await h.app.inject({
      method: 'POST',
      url: `/sessions/${h.sourceId}/takeover`,
      payload: { sameOwner: true, credential: secret, worktree: h.worktree },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'ACTOR_CREDENTIAL_HEADER_REQUIRED' });
    expect(response.body).not.toContain(secret);
    expect(JSON.stringify(h.logger.info.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toContain(secret);
  });

  test.each([
    ['missing worktree evidence', undefined, 400, 'WORKTREE_REQUIRED'],
    ['mismatched worktree evidence', {
      id: 'other-world',
      root: '/Users/example/coding/tmp/other-world',
      name: 'other-world',
      branch: 'codex/other-world',
    }, 409, 'ACTOR_ONLY_WORKTREE_MISMATCH'],
  ])('rejects %s before actor-only claim transfer', async (_name, override, status, code) => {
    const h = routeFixture();
    const worktree = override === undefined ? undefined : { ...h.worktree, ...override };
    const before = protectedRows(h.db);
    const response = await h.app.inject({
      method: 'POST',
      url: `/sessions/${h.sourceId}/takeover`,
      headers: { 'x-actor-credential': h.owner.credential },
      payload: { sameOwner: true, ...(worktree ? { worktree } : {}) },
    });
    expect(response.statusCode).toBe(status);
    expect(response.json().code).toBe(code);
    expect(protectedRows(h.db)).toEqual(before);
  });

  test.each([
    ['second probe changes worktree id', { worktreeId: 'recreated-world' }],
    ['second probe returns malformed HEAD', { head: 'not-a-commit' }],
    ['second probe omits physical identity', { worktreePhysicalId: '' }],
  ])('rejects %s before opening the continuation transaction', async (_name, workspaceIdentity) => {
    const h = routeFixture({ workspaceIdentity });
    const before = protectedRows(h.db);
    const response = await h.app.inject({
      method: 'POST',
      url: `/sessions/${h.sourceId}/takeover`,
      headers: { 'x-actor-credential': h.owner.credential },
      payload: { sameOwner: true, worktree: h.worktree },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'ACTOR_ONLY_WORKTREE_MISMATCH' });
    expect(protectedRows(h.db)).toEqual(before);
  });

  test('rejects predecessor metadata that disagrees with the daemon-probed worktree', async () => {
    const h = routeFixture();
    const source = h.sessions.get(h.sourceId).session as { metadata: Record<string, unknown> };
    h.db.prepare('UPDATE sessions SET metadata = ? WHERE id = ?').run(
      JSON.stringify({
        ...source.metadata,
        worktree: { ...WORKTREE_CONTEXT, branch: 'codex/foreign-branch' },
      }),
      h.sourceId,
    );
    const before = protectedRows(h.db);
    const response = await h.app.inject({
      method: 'POST',
      url: `/sessions/${h.sourceId}/takeover`,
      headers: { 'x-actor-credential': h.owner.credential },
      payload: { sameOwner: true, worktree: h.worktree },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'ACTOR_ONLY_WORKTREE_MISMATCH' });
    expect(protectedRows(h.db)).toEqual(before);
  });

  test('rejects ignored gate bypasses instead of implying they grant authority', async () => {
    const h = routeFixture();
    const before = protectedRows(h.db);
    const response = await h.app.inject({
      method: 'POST',
      url: `/sessions/${h.sourceId}/takeover`,
      headers: { 'x-actor-credential': h.owner.credential },
      payload: { sameOwner: true, worktree: h.worktree, bypassCrowdedGate: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'UNKNOWN_FIELD' });
    expect(protectedRows(h.db)).toEqual(before);
  });
});
