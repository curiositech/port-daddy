/**
 * Unit tests for lib/actor-souls.ts — ADR-0040 daemon-minted actor identity.
 *
 * Proves the three keystone properties:
 *   (a) a minted id verifies against its credential;
 *   (b) a self-asserted / forged / mismatched credential is REJECTED (never mints);
 *   (c) the exhaustive register() outcome table + fail-mode semantics hold.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import {
  createActorSouls,
  LegacyActorCredentialRetirementError,
  MAX_ACTIVE_BODY_CREDENTIALS,
  retireLegacyActorCredentialFiles,
} from '../../lib/actor-souls.js';

function createLegacyActorSoulsTable(db) {
  db.prepare(`
    CREATE TABLE actor_souls (
      actor_id TEXT NOT NULL, harbor TEXT NOT NULL,
      credential_hash TEXT, credential_salt TEXT,
      credential_kind TEXT NOT NULL, display_alias TEXT,
      clean_exits INTEGER NOT NULL, operator_trusted INTEGER NOT NULL,
      created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (harbor, actor_id)
    )
  `).run();
}

describe('actor-souls: mint + verify (property a)', () => {
  let db, souls;
  beforeEach(() => { db = createTestDb(); souls = createActorSouls(db); });
  afterEach(() => db.close());

  test('a minted credential verifies back to the same actor_id', () => {
    const { actorId, credential } = souls.mint({ alias: 'proj:stack:ctx' });
    expect(actorId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID (Crockford base32)
    expect(credential.startsWith(`pdab1.${actorId}.`)).toBe(true);

    const verified = souls.verifyCredential(credential);
    expect(verified).toBe(actorId);
  });

  test('the credential is a selector.verifier lookup token (O(1) by selector)', () => {
    const a = souls.mint();
    const b = souls.mint();
    // Each verifies only to its own id.
    expect(souls.verifyCredential(a.credential)).toBe(a.actorId);
    expect(souls.verifyCredential(b.credential)).toBe(b.actorId);
    expect(a.actorId).not.toBe(b.actorId);
  });
});

describe('actor-souls: forged / self-asserted rejection (property b)', () => {
  let db, souls;
  beforeEach(() => { db = createTestDb(); souls = createActorSouls(db); });
  afterEach(() => db.close());

  test('a mismatched verifier for a REAL selector is rejected', () => {
    const { actorId } = souls.mint();
    expect(souls.verifyCredential(`${actorId}.not-the-secret`)).toBeNull();
  });

  test('an unknown selector (self-asserted id) is rejected', () => {
    expect(souls.verifyCredential('01SELFASSERTEDFORGEDID00000.anything')).toBeNull();
  });

  test('a malformed credential is rejected', () => {
    expect(souls.verifyCredential('no-dot-here')).toBeNull();
    expect(souls.verifyCredential('.leadingdot')).toBeNull();
    expect(souls.verifyCredential('trailingdot.')).toBeNull();
  });

  test('register() with an invalid credential rejects 401 and mints NOTHING', () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM actor_souls').get().n;
    const out = souls.register({ credential: 'unknownid.secret' });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('CREDENTIAL_INVALID');
    expect(out.httpStatus).toBe(401);
    const after = db.prepare('SELECT COUNT(*) AS n FROM actor_souls').get().n;
    expect(after).toBe(before); // never mint from a failed credential
  });
});

describe('actor-souls: register() outcome table (property c)', () => {
  let db, souls;
  beforeEach(() => {
    db = createTestDb();
    souls = createActorSouls(db, { operatorSecret: 'operator-shibboleth' });
  });
  afterEach(() => db.close());

  test('unknown alias, no credential ⇒ mints a fresh newcomer + returns credential once', () => {
    const out = souls.register({ alias: 'proj:stack:new' });
    expect(out.ok && out.status).toBe('minted');
    expect(out.soulClass).toBe('newcomer');
    expect(typeof out.credential).toBe('string');
    // Re-presenting the issued credential is idempotent → same id, resolved.
    const again = souls.register({ credential: out.credential });
    expect(again.ok && again.status).toBe('resolved');
    expect(again.actorId).toBe(out.actorId);
  });

  test('known alias WITHOUT credential fails closed to a NEW newcomer (F2 impersonation guard)', () => {
    const first = souls.register({ alias: 'proj:stack:shared' });
    const second = souls.register({ alias: 'proj:stack:shared' });
    expect(first.actorId).not.toBe(second.actorId); // never resolves to the existing id
    expect(second.soulClass).toBe('newcomer');
  });

  test('a legacy operatorToken has no authority and mints only a metered newcomer', () => {
    const out = souls.register({ operatorToken: 'operator-shibboleth', alias: 'proj:stack:op' });
    expect(out.ok && out.status).toBe('minted');
    expect(out.soulClass).toBe('newcomer');
    expect(souls.classify(out.actorId)).toBe('newcomer');
  });

  test('more than 25 project and projectless newcomers mint unique credentials without changing the legacy counter', () => {
    const day = '2026-07-15';
    db.prepare(`
      INSERT INTO newcomer_pool (project, day, spend_usd, souls_seen)
      VALUES ('proj', ?, 0.25, 25), ('__projectless__', ?, 0.5, 25)
    `).run(day, day);

    const projectMints = Array.from({ length: 30 }, (_, i) => (
      souls.register({ alias: `p:s:${i}`, project: 'proj', day })
    ));
    const projectlessMints = Array.from({ length: 30 }, () => souls.register({ day }));
    const allMints = [...projectMints, ...projectlessMints];

    for (const outcome of allMints) {
      expect(outcome).toMatchObject({ ok: true, status: 'minted', soulClass: 'newcomer' });
      expect(typeof outcome.credential).toBe('string');
    }
    expect(new Set(allMints.map((outcome) => outcome.actorId)).size).toBe(60);
    expect(new Set(allMints.map((outcome) => outcome.credential)).size).toBe(60);
    expect(db.prepare(`
      SELECT project, spend_usd, souls_seen
      FROM newcomer_pool
      WHERE day = ?
      ORDER BY project
    `).all(day)).toEqual([
      { project: '__projectless__', spend_usd: 0.5, souls_seen: 25 },
      { project: 'proj', spend_usd: 0.25, souls_seen: 25 },
    ]);
  });

  // ── Defect C (round 2): the register/alias-bind door is the SECOND way to
  // acquire a reserved authority name, poisoning /sugar/begin's guard. A
  // self-service caller may never bind a reserved alias; only an operator may.
  test('DEFECT C door 2: an UNCREDENTIALED register cannot bind a reserved alias', () => {
    const out = souls.register({ alias: 'system' });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('RESERVED_ALIAS');
    expect(out.httpStatus).toBe(403);
    // Nothing was bound: `system` still resolves to no minted soul.
    expect(souls.resolveActor('system').soulClass).toBe('unknown');
  });

  test('DEFECT C door 2: a valid NON-OPERATOR credential cannot bind a reserved alias it does not own', () => {
    // Mint a plain newcomer, then re-present its credential asking to bind
    // `coxswain`. A newcomer soul is still self-service — refused.
    const minted = souls.register({ alias: 'proj:stack:worker' });
    expect(minted.ok).toBe(true);
    const out = souls.register({ credential: minted.credential, alias: 'coxswain' });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('RESERVED_ALIAS');
    expect(souls.resolveActor('coxswain').soulClass).toBe('unknown');
  });

  test('a daemon-provisioned operator soul MAY own and retain a reserved alias', () => {
    const operator = souls.mint({ operatorTrusted: true, credentialKind: 'operator', alias: 'system' });
    expect(souls.classify(operator.actorId)).toBe('operator');
    expect(souls.resolveActor('system').actorId).toBe(operator.actorId);
    const again = souls.register({ credential: operator.credential, alias: 'system' });
    expect(again.ok).toBe(true);
    expect(again.status).toBe('resolved');
  });

  test('a namespaced alias still binds in every path (the guard is bare-word only)', () => {
    expect(souls.register({ alias: 'proj:node:dev' }).ok).toBe(true);
    const cred = souls.register({ alias: 'proj:node:other' });
    expect(souls.register({ credential: cred.credential, alias: 'proj:node:renamed' }).ok).toBe(true);
  });
});

describe('actor-souls: durable actor + disposable body credentials', () => {
  let db;
  let clock;
  let souls;
  let actor;
  const sessionScope = (overrides = {}) => ({
    intendedAgentId: 'port-daddy:test:body',
    successorSessionId: 'session-successor-1',
    project: 'port-daddy',
    canonicalWorktree: '/Users/example/coding/tmp/body-worktree',
    branch: 'codex/body-work',
    recoveryId: 'recovery-1',
    contextSlot: 'slot-a',
    issuedDaemonGeneration: 'daemon-before-restart',
    ...overrides,
  });
  const useContext = (overrides = {}) => ({
    action: 'session.note.write',
    resource: {
      sessionId: 'session-successor-1',
      intendedAgentId: 'port-daddy:test:body',
      project: 'port-daddy',
      canonicalWorktree: '/Users/example/coding/tmp/body-worktree',
      branch: 'codex/body-work',
      status: 'active',
      ...(overrides.resource ?? {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'resource')),
  });

  beforeEach(() => {
    db = createTestDb();
    clock = 1_800_000_000_000;
    souls = createActorSouls(db, { now: () => clock });
    actor = souls.mint({ alias: 'port-daddy:test:body' });
  });
  afterEach(() => db.close());

  test('two simultaneous bodies authenticate as one durable actor and survive store reconstruction', () => {
    const first = souls.issueBodyCredential({
      actorId: actor.actorId,
      profile: 'session-body-v1',
      scope: sessionScope(),
      expiresAt: clock + 60_000,
    });
    const second = souls.issueBodyCredential({
      actorId: actor.actorId,
      profile: 'session-body-v1',
      scope: sessionScope({ successorSessionId: 'session-successor-2' }),
      expiresAt: clock + 60_000,
    });

    expect(first.bodyCredentialId).not.toBe(second.bodyCredentialId);
    expect(souls.verifyCredentialUse(first.credential, { context: useContext() }))
      .toEqual(expect.objectContaining({ ok: true, actorId: actor.actorId }));
    expect(souls.verifyCredentialUse(second.credential, {
      context: useContext({ resource: { sessionId: 'session-successor-2' } }),
    })).toEqual(expect.objectContaining({ ok: true, actorId: actor.actorId }));

    const afterRestart = createActorSouls(db, { now: () => clock });
    expect(afterRestart.verifyCredential(actor.credential)).toBe(actor.actorId);
    expect(afterRestart.verifyCredentialUse(first.credential, { context: useContext() }))
      .toEqual(expect.objectContaining({ ok: true, actorId: actor.actorId }));
  });

  test('session body requires an allowed action, exact five resource coordinates, and active status', () => {
    const body = souls.issueBodyCredential({
      actorId: actor.actorId,
      profile: 'session-body-v1',
      scope: sessionScope(),
      expiresAt: clock + 60_000,
    });
    expect(souls.verifyCredential(body.credential)).toBeNull();
    expect(souls.verifyCredentialUse(body.credential)).toEqual({
      ok: false,
      code: 'CREDENTIAL_SCOPE_MISMATCH',
    });
    for (const resource of [
      { sessionId: 'other' },
      { intendedAgentId: 'other' },
      { project: 'other' },
      { canonicalWorktree: '/other' },
      { branch: 'other' },
      { status: 'completed' },
    ]) {
      expect(souls.verifyCredentialUse(body.credential, { context: useContext({ resource }) }))
        .toEqual({ ok: false, code: 'CREDENTIAL_SCOPE_MISMATCH' });
    }
    expect(souls.verifyCredentialUse(body.credential, {
      context: useContext({ action: 'locks.acquire' }),
    })).toEqual({ ok: false, code: 'CREDENTIAL_SCOPE_MISMATCH' });
  });

  test('expiry is exact: valid one millisecond before, expired at now >= expiresAt', () => {
    const expiresAt = clock + 10;
    const body = souls.issueBodyCredential({
      actorId: actor.actorId,
      profile: 'session-body-v1',
      scope: sessionScope(),
      expiresAt,
    });
    clock = expiresAt - 1;
    expect(souls.verifyCredentialUse(body.credential, { context: useContext() }).ok).toBe(true);
    clock = expiresAt;
    expect(souls.verifyCredentialUse(body.credential, { context: useContext() }))
      .toEqual({ ok: false, code: 'CREDENTIAL_EXPIRED' });
  });

  test('revocation is exact, idempotent, and participates in an existing transaction', () => {
    let rolledBack;
    expect(() => db.transaction(() => {
      rolledBack = souls.issueBodyCredential({
        actorId: actor.actorId,
        profile: 'session-body-v1',
        scope: sessionScope(),
        expiresAt: clock + 60_000,
      });
      throw new Error('rollback');
    })()).toThrow('rollback');
    expect(souls.verifyCredentialUse(rolledBack.credential, { context: useContext() }))
      .toEqual({ ok: false, code: 'CREDENTIAL_INVALID' });

    const body = souls.issueBodyCredential({
      actorId: actor.actorId,
      profile: 'session-body-v1',
      scope: sessionScope(),
      expiresAt: clock + 60_000,
    });
    db.transaction(() => {
      expect(souls.revokeBodyCredential({
        actorId: actor.actorId,
        bodyCredentialId: body.bodyCredentialId,
      })).toBe(true);
    })();
    expect(souls.verifyCredentialUse(body.credential, { context: useContext() }))
      .toEqual({ ok: false, code: 'CREDENTIAL_REVOKED' });
    expect(souls.revokeBodyCredential({
      actorId: actor.actorId,
      bodyCredentialId: body.bodyCredentialId,
    })).toBe(false);
  });

  test('the 16-body cap counts only roots and bodies for live successor sessions', () => {
    const bodies = [];
    const addSession = (id, status = 'active') => db.prepare(`
      INSERT INTO sessions (
        id, purpose, status, phase, agent_id, worktree_id, identity_project,
        created_at, updated_at, completed_at, metadata
      ) VALUES (?, 'body-cap-test', ?, ?, 'body-agent', NULL, 'port-daddy', ?, ?, ?, '{}')
    `).run(
      id,
      status,
      status === 'active' ? 'in_progress' : status,
      clock,
      clock,
      status === 'active' ? null : clock,
    );
    // mint() already issued the actor-root, leaving 15 active slots.
    for (let i = 1; i < MAX_ACTIVE_BODY_CREDENTIALS; i++) {
      addSession(`session-successor-${i}`);
      bodies.push(souls.issueBodyCredential({
        actorId: actor.actorId,
        profile: 'session-body-v1',
        scope: sessionScope({ successorSessionId: `session-successor-${i}` }),
        expiresAt: clock + 60_000,
      }));
    }
    addSession('overflow');
    expect(() => souls.issueBodyCredential({
      actorId: actor.actorId,
      profile: 'session-body-v1',
      scope: sessionScope({ successorSessionId: 'overflow' }),
      expiresAt: clock + 60_000,
    })).toThrow(expect.objectContaining({ code: 'BODY_CREDENTIAL_LIMIT' }));

    db.prepare(`
      UPDATE sessions
      SET status = 'completed', phase = 'completed', completed_at = ?, updated_at = ?
      WHERE id = 'session-successor-1'
    `).run(clock, clock);
    expect(souls.issueBodyCredential({
      actorId: actor.actorId,
      profile: 'session-body-v1',
      scope: sessionScope({ successorSessionId: 'overflow' }),
      expiresAt: clock + 60_000,
    }).actorId).toBe(actor.actorId);
    expect(souls.verifyCredentialUse(bodies[0].credential, {
      context: useContext({ resource: { status: 'completed' } }),
    })).toEqual({ ok: false, code: 'CREDENTIAL_SCOPE_MISMATCH' });
  });

  test('actor-root remains unrestricted but is verified only from the body table', () => {
    expect(souls.verifyCredentialUse(actor.credential, {
      context: useContext({ action: 'locks.acquire', resource: { status: 'completed' } }),
    })).toEqual(expect.objectContaining({
      ok: true,
      actorId: actor.actorId,
      profile: 'actor-root',
      intendedAgentId: null,
    }));
    const soulAuthority = db.prepare(
      'SELECT credential_hash, credential_salt FROM actor_souls WHERE actor_id = ?',
    ).get(actor.actorId);
    expect(soulAuthority).toEqual({ credential_hash: null, credential_salt: null });
  });
});

describe('actor-souls: legacy root authority retirement', () => {
  test('deletes both historical selectors and rejects the old plaintext token', () => {
    const db = createTestDb();
    const salt = 'legacy-salt';
    const secret = 'legacy-secret';
    const hash = createHash('sha256').update(salt).update('|').update(secret).digest('hex');
    createLegacyActorSoulsTable(db);
    db.prepare(`
      INSERT INTO actor_souls VALUES (?, 'local', ?, ?, 'migrated', ?, 3, 1, 10, 10)
    `).run('legacy-actor', hash, salt, 'legacy-actor');

    const souls = createActorSouls(db, { now: () => 20 });
    expect(souls.verifyCredential(`legacy-actor.${secret}`)).toBeNull();
    expect(db.prepare(
      'SELECT credential_hash, credential_salt FROM actor_souls WHERE actor_id = ?',
    ).get('legacy-actor')).toEqual({ credential_hash: null, credential_salt: null });
    expect(db.prepare(
      'SELECT COUNT(*) AS count FROM actor_body_credentials WHERE actor_id = ?',
    ).get('legacy-actor').count).toBe(0);

    expect(db.prepare(`
      INSERT INTO actor_body_credentials
        (harbor, actor_id, body_credential_id, credential_hash, credential_salt,
         profile, issued_at, expires_at, revoked_at)
      VALUES ('local', ?, 'legacy-root', ?, ?, 'actor-root', 10, NULL, NULL)
    `).run('legacy-actor', hash, salt).changes).toBe(1);
    createActorSouls(db, { now: () => 30 });
    expect(db.prepare(
      'SELECT COUNT(*) AS count FROM actor_body_credentials WHERE actor_id = ?',
    ).get('legacy-actor').count).toBe(0);
    db.close();
  });

  test('removes only owner-controlled legacy credential leaves from the exact state root', () => {
    mkdirSync(join(process.cwd(), '.scratch'), { recursive: true });
    const scratch = mkdtempSync(join(process.cwd(), '.scratch', 'legacy-actor-creds-'));
    try {
      const selectedRoot = join(scratch, 'selected');
      const otherRoot = join(scratch, 'other');
      const selectedDirectory = join(selectedRoot, 'actor-credentials');
      const otherDirectory = join(otherRoot, 'actor-credentials');
      mkdirSync(selectedDirectory, { recursive: true });
      mkdirSync(otherDirectory, { recursive: true });
      writeFileSync(join(selectedDirectory, 'actor-a.cred'), 'retired-a', { mode: 0o600 });
      writeFileSync(join(selectedDirectory, 'actor-b.cred'), 'retired-b', { mode: 0o600 });
      writeFileSync(join(otherDirectory, 'actor-c.cred'), 'must-remain', { mode: 0o600 });

      expect(retireLegacyActorCredentialFiles(selectedRoot)).toEqual({
        directory: selectedDirectory,
        removedFiles: 2,
        directoryRemoved: true,
      });
      expect(existsSync(selectedDirectory)).toBe(false);
      expect(existsSync(join(otherDirectory, 'actor-c.cred'))).toBe(true);
      expect(retireLegacyActorCredentialFiles(selectedRoot)).toEqual({
        directory: selectedDirectory,
        removedFiles: 0,
        directoryRemoved: false,
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('refuses a symlinked legacy credential directory without touching its target', () => {
    mkdirSync(join(process.cwd(), '.scratch'), { recursive: true });
    const scratch = mkdtempSync(join(process.cwd(), '.scratch', 'legacy-actor-creds-link-'));
    try {
      const selectedRoot = join(scratch, 'selected');
      const target = join(scratch, 'target');
      mkdirSync(selectedRoot, { recursive: true });
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, 'actor.cred'), 'must-remain', { mode: 0o600 });
      symlinkSync(target, join(selectedRoot, 'actor-credentials'));

      expect(() => retireLegacyActorCredentialFiles(selectedRoot))
        .toThrow(LegacyActorCredentialRetirementError);
      expect(existsSync(join(target, 'actor.cred'))).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('actor-souls: graduation on clean exits', () => {
  let db, souls;
  beforeEach(() => { db = createTestDb(); souls = createActorSouls(db, { graduationThreshold: 3 }); });
  afterEach(() => db.close());

  test('a newcomer graduates only after THRESHOLD daemon-witnessed clean exits', () => {
    const { actorId } = souls.mint();
    expect(souls.classify(actorId)).toBe('newcomer');
    souls.recordCleanExit(actorId);
    souls.recordCleanExit(actorId);
    expect(souls.classify(actorId)).toBe('newcomer'); // 2 < 3
    souls.recordCleanExit(actorId);
    expect(souls.classify(actorId)).toBe('graduated'); // 3 >= 3
  });
});
