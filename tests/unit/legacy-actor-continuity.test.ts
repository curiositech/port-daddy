import { createHash } from 'node:crypto';
import { afterEach, describe, expect, test } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createActorSouls } from '../../lib/actor-souls.js';
import { createClaimForest } from '../../lib/claim-forest.js';
import { resolveWriteIdentity } from '../../lib/identity-write-boundary.js';
import { createSessions } from '../../lib/sessions.js';
import {
  LegacyActorContinuityError,
  repairSyntheticMigratedAlias,
} from '../../lib/legacy-actor-continuity.js';

const WORKTREE = {
  id: 'legacy-world',
  root: '/Users/example/coding/tmp/legacy-world',
  name: 'legacy-world',
  branch: 'codex/legacy-world',
  isMain: false,
  repoId: 'github.com/example/port-daddy',
  head: 'd885273355b00000000000000000000000000000',
  base: '412a88e000000000000000000000000000000000',
  worktreeRealpath: '/Users/example/coding/tmp/legacy-world',
  worktreePhysicalId: 'dev:1:ino:2',
  gitDirRealpath: '/Users/example/coding/port-daddy/.git/worktrees/legacy-world',
  gitDirPhysicalId: 'dev:1:ino:3',
  repoCommonDir: '/Users/example/coding/port-daddy/.git',
  remote: 'git@github.com:example/port-daddy.git',
};
const CLAIM_SET = {
  count: 0,
  sha256: createHash('sha256').update('[]').digest('hex'),
};

const databases: any[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function dbFixture() {
  const db = createTestDb();
  databases.push(db);
  createSessions(db);
  const souls = createActorSouls(db);
  return { db, souls };
}

describe('synthetic migrated alias CAS', () => {
  function splitFixture() {
    const { db, souls } = dbFixture();
    const owner = souls.mint();
    const alias = 'legacy-worker-label';
    const synthetic = souls.mint({
      alias,
      explicitActorId: alias,
      credentialKind: 'migrated',
      operatorTrusted: true,
    });
    const predecessorSessionId = 'legacy-predecessor';
    const successorSessionId = 'legacy-successor';
    db.prepare(`
      INSERT INTO sessions (
        id, purpose, status, phase, agent_id, agent_node_id,
        worktree_id, created_at, updated_at, metadata, is_durable
      ) VALUES (?, 'legacy predecessor', 'abandoned', 'abandoned', ?, NULL, ?, 1, 2, ?, 1)
    `).run(predecessorSessionId, alias, WORKTREE.id, JSON.stringify({
      identity: { verified: true, actorId: owner.actorId },
      worktree: {
        id: WORKTREE.id, root: WORKTREE.root, name: WORKTREE.name,
        branch: WORKTREE.branch, isMain: WORKTREE.isMain,
      },
      actorOnlyContinuation: {
        successorSessionId,
        actorId: owner.actorId,
        continuedAt: 2,
        claimsTransferred: 0,
        worktree: WORKTREE,
        claimSet: CLAIM_SET,
      },
    }));
    db.prepare(`
      INSERT INTO sessions (
        id, purpose, status, phase, agent_id, agent_node_id,
        worktree_id, created_at, updated_at, metadata, is_durable
      ) VALUES (?, 'legacy successor', 'active', 'in_progress', ?, NULL, ?, 2, 2, ?, 1)
    `).run(successorSessionId, alias, WORKTREE.id, JSON.stringify({
      identity: { verified: true, actorId: owner.actorId },
      predecessorSessionId,
      actorOnlyWorktreeWitness: WORKTREE,
      actorOnlyClaimSetWitness: CLAIM_SET,
      actorOnlyContinuation: true,
      durableOwnershipTransferred: false,
      agentNodeUpgradeRequired: true,
    }));
    return { db, souls, owner, alias, synthetic, predecessorSessionId, successorSessionId };
  }

  function repairInput(h: ReturnType<typeof splitFixture>) {
    return {
      harbor: 'local',
      alias: h.alias,
      actorId: h.owner.actorId,
      repairedAt: 2,
      predecessorSessionId: h.predecessorSessionId,
      successorSessionId: h.successorSessionId,
      worktree: WORKTREE,
      claimSet: CLAIM_SET,
    };
  }

  function protectedIdentityRows(db: any) {
    return {
      souls: db.prepare('SELECT * FROM actor_souls ORDER BY harbor, actor_id').all(),
      aliases: db.prepare('SELECT * FROM actor_alias ORDER BY harbor, alias').all(),
      retirements: db.prepare(`
        SELECT * FROM legacy_actor_alias_retirements
        ORDER BY harbor, alias, synthetic_actor_id
      `).all(),
      sessions: db.prepare('SELECT * FROM sessions ORDER BY id').all(),
      forestNodes: db.prepare('SELECT * FROM claim_forest_nodes ORDER BY id').all(),
      forestClaims: db.prepare('SELECT * FROM claim_forest_claims ORDER BY id').all(),
    };
  }

  function currentVerifierHash(h: ReturnType<typeof splitFixture>): string {
    return (h.db.prepare(`
      SELECT credential_hash FROM actor_souls
      WHERE harbor = 'local' AND actor_id = ?
    `).get(h.alias) as { credential_hash: string }).credential_hash;
  }

  function insertExactReceipt(h: ReturnType<typeof splitFixture>, hash = currentVerifierHash(h)) {
    h.db.prepare(`INSERT INTO legacy_actor_alias_retirements (
      harbor, alias, synthetic_actor_id, successor_actor_id,
      retired_credential_hash, retired_at, reason
    ) VALUES ('local', ?, ?, ?, ?, 1, 'grandfather-migration-split-alias')`)
      .run(h.alias, h.alias, h.owner.actorId, hash);
  }

  function retireVerifier(h: ReturnType<typeof splitFixture>) {
    h.db.prepare(`
      UPDATE actor_souls
      SET credential_hash = NULL, credential_salt = NULL, operator_trusted = 0
      WHERE harbor = 'local' AND actor_id = ?
    `).run(h.alias);
  }

  test('requires a caller-owned transaction and retains the synthetic soul as history', () => {
    const h = splitFixture();
    const verifierBefore = h.db.prepare(`
      SELECT credential_hash, credential_salt, operator_trusted
      FROM actor_souls WHERE harbor = 'local' AND actor_id = ?
    `).get(h.alias) as {
      credential_hash: string;
      credential_salt: string;
      operator_trusted: number;
    };
    const secret = h.synthetic.credential.slice(h.synthetic.credential.indexOf('.') + 1);
    expect(createHash('sha256')
      .update(verifierBefore.credential_salt)
      .update('|')
      .update(secret)
      .digest('hex')).toBe(verifierBefore.credential_hash);
    expect(() => repairSyntheticMigratedAlias(h.db, repairInput(h)))
      .toThrow(expect.objectContaining({ code: 'LEGACY_ALIAS_CONFLICT' }));

    const result = h.db.transaction(() => repairSyntheticMigratedAlias(h.db, repairInput(h))).immediate();
    expect(result).toMatchObject({ status: 'repaired', replacedActorId: h.alias });
    expect(h.souls.resolveAlias(h.alias)).toBe(h.owner.actorId);
    expect(h.souls.getSoul(h.alias)).toMatchObject({
      actorId: h.alias,
      credentialKind: 'migrated',
      operatorTrusted: false,
    });
    expect(h.souls.resolveActor(h.alias)).toMatchObject({ actorId: h.owner.actorId });
    expect(h.db.prepare(`
      SELECT synthetic_actor_id, successor_actor_id, retired_credential_hash, reason
      FROM legacy_actor_alias_retirements
      WHERE harbor = 'local' AND alias = ?
    `).get(h.alias)).toEqual({
      synthetic_actor_id: h.alias,
      successor_actor_id: h.owner.actorId,
      retired_credential_hash: verifierBefore.credential_hash,
      reason: 'grandfather-migration-split-alias',
    });
    const verifierAfter = h.db.prepare(`
      SELECT credential_hash, credential_salt, operator_trusted
      FROM actor_souls WHERE harbor = 'local' AND actor_id = ?
    `).get(h.alias);
    expect(verifierAfter).toEqual({
      credential_hash: null,
      credential_salt: null,
      operator_trusted: 0,
    });
    const retirementJson = JSON.stringify(h.db.prepare(`
      SELECT * FROM legacy_actor_alias_retirements
      WHERE harbor = 'local' AND alias = ?
    `).get(h.alias));
    expect(retirementJson).not.toContain(h.synthetic.credential);
    expect(retirementJson).not.toContain(secret);
    expect(retirementJson).not.toContain(verifierBefore.credential_salt);
    // A pre-retirement verifier that only understands the soul row cannot
    // authenticate after rollback to an older daemon: both verifier inputs
    // are absent at the data boundary.
    expect((verifierAfter as { credential_hash: string | null }).credential_hash).toBeNull();
    expect((verifierAfter as { credential_salt: string | null }).credential_salt).toBeNull();
    expect(h.souls.verifyCredential(h.synthetic.credential)).toBeNull();
    expect(resolveWriteIdentity({
      souls: h.souls,
      credential: h.synthetic.credential,
      assertedAgentId: null,
      route: 'hostile retired synthetic credential',
      requireIdentity: true,
    })).toMatchObject({ ok: false, code: 'IDENTITY_CREDENTIAL_INVALID' });
    expect(resolveWriteIdentity({
      souls: h.souls,
      credential: h.owner.credential,
      assertedAgentId: h.alias,
      route: 'successor credential with repaired label',
      requireIdentity: true,
    })).toMatchObject({ ok: true, kind: 'verified', actorId: h.owner.actorId });
  });

  test('retirement authority records are insert-only while the retired soul remains queryable', () => {
    const h = splitFixture();
    h.db.transaction(() => repairSyntheticMigratedAlias(h.db, repairInput(h))).immediate();
    const attacker = h.souls.mint();

    expect(h.souls.getSoul(h.alias)).toMatchObject({ actorId: h.alias, credentialKind: 'migrated' });
    expect(() => h.db.prepare(`
      UPDATE legacy_actor_alias_retirements SET retired_at = 3
      WHERE harbor = 'local' AND alias = ?
    `).run(h.alias)).toThrow(/immutable/);
    expect(() => h.db.prepare(`
      DELETE FROM legacy_actor_alias_retirements
      WHERE harbor = 'local' AND alias = ?
    `).run(h.alias)).toThrow(/immutable/);
    expect(() => h.db.prepare(`
      UPDATE actor_souls SET operator_trusted = 1
      WHERE harbor = 'local' AND actor_id = ?
    `).run(h.alias)).toThrow(/cannot be reactivated/);
    expect(() => h.db.prepare(`
      DELETE FROM actor_souls WHERE harbor = 'local' AND actor_id = ?
    `).run(h.alias)).toThrow(/evidence is immutable/);
    expect(() => h.db.prepare(`
      UPDATE actor_alias SET actor_id = ?
      WHERE harbor = 'local' AND alias = ?
    `).run(attacker.actorId, h.alias)).toThrow(/cannot be rebound/);
    expect(() => h.db.prepare(`
      DELETE FROM actor_alias WHERE harbor = 'local' AND alias = ?
    `).run(h.alias)).toThrow(/alias is immutable/);
  });

  test('repairs an absent synthetic alias only through the guarded retirement transaction', () => {
    const h = splitFixture();
    h.db.prepare('DELETE FROM actor_alias WHERE harbor = ? AND alias = ?').run('local', h.alias);
    expect(h.souls.resolveActor(h.alias)).toMatchObject({ actorId: h.alias });

    expect(h.db.transaction(() => repairSyntheticMigratedAlias(h.db, repairInput(h))).immediate())
      .toMatchObject({ status: 'repaired' });
    expect(h.souls.resolveAlias(h.alias)).toBe(h.owner.actorId);
    expect(h.souls.resolveActor(h.alias)).toMatchObject({ actorId: h.owner.actorId });
  });

  test('an exact retired tuple is the sole idempotent no-op state', () => {
    const h = splitFixture();
    h.db.transaction(() => repairSyntheticMigratedAlias(h.db, repairInput(h))).immediate();
    const before = protectedIdentityRows(h.db);

    expect(h.db.transaction(() => repairSyntheticMigratedAlias(h.db, repairInput(h))).immediate())
      .toEqual({ status: 'not-needed', alias: h.alias, actorId: h.owner.actorId });
    expect(protectedIdentityRows(h.db)).toEqual(before);
  });

  test('an already canonical alias without a synthetic artifact needs no retirement', () => {
    const h = splitFixture();
    h.db.prepare('UPDATE actor_alias SET actor_id = ? WHERE harbor = ? AND alias = ?')
      .run(h.owner.actorId, 'local', h.alias);
    h.db.prepare('DELETE FROM actor_souls WHERE harbor = ? AND actor_id = ?')
      .run('local', h.alias);
    const before = protectedIdentityRows(h.db);

    expect(h.db.transaction(() => repairSyntheticMigratedAlias(h.db, repairInput(h))).immediate())
      .toEqual({ status: 'not-needed', alias: h.alias, actorId: h.owner.actorId });
    expect(protectedIdentityRows(h.db)).toEqual(before);
  });

  test.each([
    ['receipt plus live self alias', (h: ReturnType<typeof splitFixture>) => {
      insertExactReceipt(h);
    }],
    ['receipt plus live absent alias', (h: ReturnType<typeof splitFixture>) => {
      h.db.prepare('DELETE FROM actor_alias WHERE harbor = ? AND alias = ?').run('local', h.alias);
      insertExactReceipt(h);
    }],
    ['receipt plus live successor alias', (h: ReturnType<typeof splitFixture>) => {
      h.db.prepare('UPDATE actor_alias SET actor_id = ? WHERE harbor = ? AND alias = ?')
        .run(h.owner.actorId, 'local', h.alias);
      insertExactReceipt(h);
    }],
    ['rebound alias without receipt', (h: ReturnType<typeof splitFixture>) => {
      h.db.prepare('UPDATE actor_alias SET actor_id = ? WHERE harbor = ? AND alias = ?')
        .run(h.owner.actorId, 'local', h.alias);
    }],
    ['foreign alias binding', (h: ReturnType<typeof splitFixture>) => {
      const attacker = h.souls.mint();
      h.db.prepare('UPDATE actor_alias SET actor_id = ? WHERE harbor = ? AND alias = ?')
        .run(attacker.actorId, 'local', h.alias);
    }],
    ['missing live salt', (h: ReturnType<typeof splitFixture>) => {
      h.db.prepare('UPDATE actor_souls SET credential_salt = NULL WHERE harbor = ? AND actor_id = ?')
        .run('local', h.alias);
    }],
    ['missing live hash', (h: ReturnType<typeof splitFixture>) => {
      h.db.prepare('UPDATE actor_souls SET credential_hash = NULL WHERE harbor = ? AND actor_id = ?')
        .run('local', h.alias);
    }],
    ['demoted trust with live verifier', (h: ReturnType<typeof splitFixture>) => {
      h.db.prepare('UPDATE actor_souls SET operator_trusted = 0 WHERE harbor = ? AND actor_id = ?')
        .run('local', h.alias);
    }],
    ['retired verifier without receipt and self alias', (h: ReturnType<typeof splitFixture>) => {
      retireVerifier(h);
    }],
    ['retired verifier without receipt and absent alias', (h: ReturnType<typeof splitFixture>) => {
      retireVerifier(h);
      h.db.prepare('DELETE FROM actor_alias WHERE harbor = ? AND alias = ?').run('local', h.alias);
    }],
    ['retired verifier without receipt and successor alias', (h: ReturnType<typeof splitFixture>) => {
      retireVerifier(h);
      h.db.prepare('UPDATE actor_alias SET actor_id = ? WHERE harbor = ? AND alias = ?')
        .run(h.owner.actorId, 'local', h.alias);
    }],
    ['exact retirement with self alias', (h: ReturnType<typeof splitFixture>) => {
      const hash = currentVerifierHash(h);
      retireVerifier(h);
      insertExactReceipt(h, hash);
    }],
    ['exact retirement with absent alias', (h: ReturnType<typeof splitFixture>) => {
      const hash = currentVerifierHash(h);
      retireVerifier(h);
      h.db.prepare('DELETE FROM actor_alias WHERE harbor = ? AND alias = ?').run('local', h.alias);
      insertExactReceipt(h, hash);
    }],
    ['exact retirement with foreign alias', (h: ReturnType<typeof splitFixture>) => {
      const hash = currentVerifierHash(h);
      const attacker = h.souls.mint();
      retireVerifier(h);
      h.db.prepare('UPDATE actor_alias SET actor_id = ? WHERE harbor = ? AND alias = ?')
        .run(attacker.actorId, 'local', h.alias);
      insertExactReceipt(h, hash);
    }],
    ['conflicting retirement successor', (h: ReturnType<typeof splitFixture>) => {
      const hash = currentVerifierHash(h);
      const attacker = h.souls.mint();
      retireVerifier(h);
      h.db.prepare('UPDATE actor_alias SET actor_id = ? WHERE harbor = ? AND alias = ?')
        .run(h.owner.actorId, 'local', h.alias);
      h.db.prepare(`INSERT INTO legacy_actor_alias_retirements (
        harbor, alias, synthetic_actor_id, successor_actor_id,
        retired_credential_hash, retired_at, reason
      ) VALUES ('local', ?, ?, ?, ?, 1, 'grandfather-migration-split-alias')`)
        .run(h.alias, h.alias, attacker.actorId, hash);
    }],
    ['receipt plus partial verifier', (h: ReturnType<typeof splitFixture>) => {
      const hash = currentVerifierHash(h);
      h.db.prepare('UPDATE actor_souls SET credential_salt = NULL WHERE harbor = ? AND actor_id = ?')
        .run('local', h.alias);
      insertExactReceipt(h, hash);
    }],
    ['mismatched continuation witness', (h: ReturnType<typeof splitFixture>) => {
      h.db.prepare("UPDATE sessions SET metadata = '{}' WHERE id = ?").run(h.successorSessionId);
    }],
    ['mismatched predecessor worktree column', (h: ReturnType<typeof splitFixture>) => {
      h.db.prepare("UPDATE sessions SET worktree_id = 'other-world' WHERE id = ?")
        .run(h.predecessorSessionId);
    }],
    ['mismatched successor worktree column', (h: ReturnType<typeof splitFixture>) => {
      h.db.prepare("UPDATE sessions SET worktree_id = 'other-world' WHERE id = ?")
        .run(h.successorSessionId);
    }],
    ['mismatched predecessor physical worktree witness', (h: ReturnType<typeof splitFixture>) => {
      const row = h.db.prepare('SELECT metadata FROM sessions WHERE id = ?')
        .get(h.predecessorSessionId) as { metadata: string };
      const metadata = JSON.parse(row.metadata);
      metadata.actorOnlyContinuation.worktree.head = 'a'.repeat(40);
      h.db.prepare('UPDATE sessions SET metadata = ? WHERE id = ?')
        .run(JSON.stringify(metadata), h.predecessorSessionId);
    }],
    ['mismatched successor claim-set witness', (h: ReturnType<typeof splitFixture>) => {
      const row = h.db.prepare('SELECT metadata FROM sessions WHERE id = ?')
        .get(h.successorSessionId) as { metadata: string };
      const metadata = JSON.parse(row.metadata);
      metadata.actorOnlyClaimSetWitness.sha256 = 'b'.repeat(64);
      h.db.prepare('UPDATE sessions SET metadata = ? WHERE id = ?')
        .run(JSON.stringify(metadata), h.successorSessionId);
    }],
    ['claim set changed after the continuation witness', (h: ReturnType<typeof splitFixture>) => {
      createClaimForest(h.db).claim({
        repoId: WORKTREE.repoId,
        world: { kind: 'worktree', id: WORKTREE.id, gitOid: WORKTREE.head },
        selector: { kind: 'file', path: 'lib/late-claim.ts' },
      }, {
        sessionId: h.predecessorSessionId,
        agentId: h.alias,
      });
    }],
  ])('rejects mixed alias retirement state: %s', (_name, mutate) => {
    const h = splitFixture();
    mutate(h);
    const before = protectedIdentityRows(h.db);

    expect(() => h.db.transaction(() => repairSyntheticMigratedAlias(h.db, repairInput(h))).immediate())
      .toThrow(expect.objectContaining({ code: 'LEGACY_ALIAS_CONFLICT' }));
    expect(protectedIdentityRows(h.db)).toEqual(before);
  });

  test('missing continuation witness ids produce a domain error without raw TypeErrors', () => {
    const h = splitFixture();
    const before = protectedIdentityRows(h.db);
    expect(() => h.db.transaction(() => repairSyntheticMigratedAlias(h.db, {
      harbor: 'local', alias: h.alias, actorId: h.owner.actorId, repairedAt: 2,
    } as any)).immediate()).toThrow(expect.objectContaining({
      name: 'LegacyActorContinuityError',
      code: 'LEGACY_ALIAS_CONFLICT',
    }));
    expect(protectedIdentityRows(h.db)).toEqual(before);
  });

  test('does not redirect a synthetic direct id when an unrelated actor hijacks its absent alias', () => {
    const h = splitFixture();
    h.db.prepare('DELETE FROM actor_alias WHERE harbor = ? AND alias = ?').run('local', h.alias);
    const attacker = h.souls.mint({ alias: h.alias });

    expect(h.souls.resolveAlias(h.alias)).toBe(attacker.actorId);
    expect(h.souls.resolveActor(h.alias)).toMatchObject({ actorId: h.alias });
    expect(() => h.db.transaction(() => repairSyntheticMigratedAlias(h.db, repairInput(h))).immediate())
      .toThrow(expect.objectContaining({ code: 'LEGACY_ALIAS_CONFLICT' }));
    expect(h.db.prepare(`
      SELECT COUNT(*) AS count FROM legacy_actor_alias_retirements
      WHERE harbor = 'local' AND alias = ?
    `).get(h.alias)).toEqual({ count: 0 });
  });

  test('ordinary direct actor ids still win over a conflicting alias pointer', () => {
    const { db, souls } = dbFixture();
    const ordinary = souls.mint({
      alias: 'ordinary-direct-id',
      explicitActorId: 'ordinary-direct-id',
      credentialKind: 'soul-secret',
    });
    const other = souls.mint();
    db.prepare(`
      UPDATE actor_alias SET actor_id = ?
      WHERE harbor = 'local' AND alias = 'ordinary-direct-id'
    `).run(other.actorId);

    expect(souls.resolveActor('ordinary-direct-id')).toMatchObject({
      actorId: ordinary.actorId,
      soulClass: 'newcomer',
    });
  });

  test('rejects a self-bound ordinary soul instead of treating it as migration residue', () => {
    const { db, souls } = dbFixture();
    const owner = souls.mint();
    const alias = 'independent-worker';
    souls.mint({ alias, explicitActorId: alias, credentialKind: 'soul-secret' });
    const predecessorSessionId = 'ordinary-predecessor';
    const successorSessionId = 'ordinary-successor';
    db.prepare(`INSERT INTO sessions (
      id, purpose, status, agent_id, agent_node_id, worktree_id, created_at, updated_at, metadata
    ) VALUES (?, 'ordinary predecessor', 'abandoned', ?, NULL, ?, 1, 2, ?)`).run(
      predecessorSessionId,
      alias,
      WORKTREE.id,
      JSON.stringify({
        identity: { verified: true, actorId: owner.actorId },
        worktree: {
          id: WORKTREE.id, root: WORKTREE.root, name: WORKTREE.name,
          branch: WORKTREE.branch, isMain: false,
        },
        actorOnlyContinuation: {
          successorSessionId,
          actorId: owner.actorId,
          worktree: WORKTREE,
          claimSet: CLAIM_SET,
        },
      }),
    );
    db.prepare(`INSERT INTO sessions (
      id, purpose, status, agent_id, agent_node_id, worktree_id, created_at, updated_at, metadata
    ) VALUES (?, 'ordinary successor', 'active', ?, NULL, ?, 2, 2, ?)`).run(
      successorSessionId,
      alias,
      WORKTREE.id,
      JSON.stringify({
        identity: { verified: true, actorId: owner.actorId },
        predecessorSessionId,
        actorOnlyWorktreeWitness: WORKTREE,
        actorOnlyClaimSetWitness: CLAIM_SET,
        actorOnlyContinuation: true,
        durableOwnershipTransferred: false,
        agentNodeUpgradeRequired: true,
      }),
    );
    expect(() => db.transaction(() => repairSyntheticMigratedAlias(db, {
      harbor: 'local', alias, actorId: owner.actorId, repairedAt: 2,
      predecessorSessionId, successorSessionId, worktree: WORKTREE, claimSet: CLAIM_SET,
    })).immediate()).toThrow(expect.objectContaining({ code: 'LEGACY_ALIAS_NOT_SYNTHETIC' }));
    expect(souls.resolveAlias(alias)).toBe(alias);
    expect(souls.resolveActor(alias)).toMatchObject({ actorId: alias });
  });

  test('rejects an ordinary direct-id collision even when the alias row points at the successor', () => {
    const h = splitFixture();
    h.db.prepare('UPDATE actor_souls SET credential_kind = ? WHERE harbor = ? AND actor_id = ?')
      .run('soul-secret', 'local', h.alias);
    h.db.prepare('UPDATE actor_alias SET actor_id = ? WHERE harbor = ? AND alias = ?')
      .run(h.owner.actorId, 'local', h.alias);
    const before = protectedIdentityRows(h.db);

    expect(() => h.db.transaction(() => repairSyntheticMigratedAlias(h.db, repairInput(h))).immediate())
      .toThrow(expect.objectContaining({ code: 'LEGACY_ALIAS_NOT_SYNTHETIC' }));
    expect(protectedIdentityRows(h.db)).toEqual(before);
    expect(h.souls.resolveActor(h.alias)).toMatchObject({ actorId: h.alias });
  });

  test('rejects a migrated actor with its own verified session stamp', () => {
    const h = splitFixture();
    h.db.prepare(`
      INSERT INTO sessions (
        id, purpose, status, agent_id, created_at, updated_at, metadata, is_durable
      ) VALUES ('synthetic-live', 'independent use', 'active', ?, 1, 1, ?, 1)
    `).run(h.alias, JSON.stringify({ identity: { verified: true, actorId: h.alias } }));
    expect(() => h.db.transaction(() => repairSyntheticMigratedAlias(h.db, repairInput(h))).immediate())
      .toThrow(expect.objectContaining({ code: 'LEGACY_ALIAS_LIVE_ACTOR' }));
    expect(h.souls.resolveAlias(h.alias)).toBe(h.alias);
  });

  test('a competing non-self alias binding is never overwritten', () => {
    const h = splitFixture();
    const independent = h.souls.mint();
    h.db.prepare('UPDATE actor_alias SET actor_id = ? WHERE harbor = ? AND alias = ?')
      .run(independent.actorId, 'local', h.alias);
    const before = protectedIdentityRows(h.db);
    expect(() => h.db.transaction(() => repairSyntheticMigratedAlias(h.db, repairInput(h))).immediate())
      .toThrow(LegacyActorContinuityError);
    expect(h.souls.resolveAlias(h.alias)).toBe(independent.actorId);
    expect(protectedIdentityRows(h.db)).toEqual(before);
  });
});
