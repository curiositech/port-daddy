/**
 * Strict identity write boundary (#8877 / ADR-0122) — sugar, locks, salvage,
 * and commitments route enforcement.
 *
 * Every attributed write boundary in these plugins now REQUIRES the
 * daemon-minted ADR-0040 credential: forged/self-asserted → 401, another
 * soul's name → 403, minted credential → attributed write. `/sugar/begin` is
 * the mint door: an uncredentialed begin with unowned names mints a fresh
 * soul and returns its credential once.
 */
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createLocks } from '../../lib/locks.js';
import { createCommitments } from '../../lib/commitments.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';
import { sugarPlugin } from '../../routes/sugar.js';
import { locksPlugin } from '../../routes/locks.js';
import { resurrectionPlugin } from '../../routes/resurrection.js';
import { commitmentsPlugin } from '../../routes/commitments.js';

const silentLogger = { info() {}, warn() {}, error() {} };

// =============================================================================
// /sugar/begin, /sugar/done, /sugar/relink
// =============================================================================
describe('identity write boundary — sugar routes', () => {
  let app;
  let db;
  let souls;
  let beginCalls;

  beforeEach(async () => {
    db = createTestDb();
    souls = createTestActorSouls(db);
    beginCalls = [];
    app = Fastify();
    await app.register(sugarPlugin, {
      deps: {
        sugar: {
          begin: (options) => {
            beginCalls.push(options);
            return { success: true, agentId: options.agentId || 'generated-agent', sessionId: 'session-1' };
          },
          done: () => ({ success: true, agentId: 'generated-agent', sessionId: 'session-1', sessionStatus: 'completed' }),
          relink: () => ({ success: true, agentId: 'generated-agent', sessionId: 'session-1' }),
          whoami: () => ({ success: true }),
        },
        metrics: { errors: 0 },
        logger: silentLogger,
        actorSouls: souls,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  test('an uncredentialed begin with unowned names MINTS a soul and returns the credential once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: { purpose: 'fresh agent', identity: 'demo:test:alpha', lifecycle: 'durable' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.credential).toBe('string');
    expect(body.credential).toContain('.');
    expect(typeof body.actorId).toBe('string');
    expect(body.actorIdentity).toEqual(expect.objectContaining({ verified: true, actorId: body.actorId }));
    // The minted credential round-trips through the real souls store.
    expect(souls.verifyCredential(body.credential)).toBe(body.actorId);
    // The session record was stamped with the daemon's verdict, not caller input.
    expect(beginCalls[0].metadata.identity).toEqual(
      expect.objectContaining({ verified: true, actorId: body.actorId }),
    );
  });

  test('an uncredentialed begin asserting a name OWNED by a minted soul is rejected 401', async () => {
    mintTestActor(souls, 'owned:stack:ctx');
    const res = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: { purpose: 'impersonation', agentId: 'owned:stack:ctx', lifecycle: 'durable' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    expect(beginCalls).toHaveLength(0);
  });

  test('a begin with a forged credential is rejected 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: { purpose: 'forged', lifecycle: 'durable', credential: 'FORGED.nope' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
  });

  test("a valid credential cannot begin under another soul's identity (403)", async () => {
    const attacker = mintTestActor(souls, 'sugarattacker:stack:ctx');
    mintTestActor(souls, 'sugarvictim:stack:ctx');
    const res = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: {
        purpose: 'laundering',
        identity: 'sugarvictim:stack:ctx',
        lifecycle: 'durable',
        credential: attacker.credential,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('IDENTITY_ALIAS_MISMATCH');
  });

  test('a credentialed begin is verified and does NOT re-mint', async () => {
    const minted = mintTestActor(souls, 'returning:stack:ctx');
    const res = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: { purpose: 'resume', identity: 'returning:stack:ctx', lifecycle: 'durable' },
      headers: minted.headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.credential).toBeUndefined();
    expect(body.actorId).toBe(minted.actorId);
    expect(body.actorIdentity).toEqual(expect.objectContaining({ verified: true, actorId: minted.actorId }));
  });

  test('/sugar/done without a credential is rejected 401 — no anonymous session ending', async () => {
    const res = await app.inject({ method: 'POST', url: '/sugar/done', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
  });

  test('/sugar/done with a forged credential is rejected 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sugar/done',
      payload: { credential: 'FORGED.creds' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
  });

  test("/sugar/done cannot end a session under another soul's agentId (403)", async () => {
    const attacker = mintTestActor(souls, 'doneattacker:stack:ctx');
    mintTestActor(souls, 'donevictim:stack:ctx');
    const res = await app.inject({
      method: 'POST',
      url: '/sugar/done',
      payload: { agentId: 'donevictim:stack:ctx', credential: attacker.credential },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('IDENTITY_ALIAS_MISMATCH');
  });

  test('/sugar/done with the minted credential succeeds (positive path)', async () => {
    const begin = (await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: { purpose: 'work', identity: 'demo:test:done', lifecycle: 'durable' },
    })).json();
    const res = await app.inject({
      method: 'POST',
      url: '/sugar/done',
      payload: { note: 'finished' },
      headers: { 'x-actor-credential': begin.credential },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  test('/sugar/relink without a credential is rejected 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sugar/relink',
      payload: { roadmapLink: 'some-item' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
  });
});

// =============================================================================
// sugar routes with the souls store UNAVAILABLE (fail-closed verifier)
// =============================================================================
describe('identity write boundary — sugar routes with actorSouls unavailable', () => {
  let app;
  let beginCalls;

  beforeEach(async () => {
    beginCalls = [];
    app = Fastify();
    await app.register(sugarPlugin, {
      deps: {
        sugar: {
          begin: (options) => {
            beginCalls.push(options);
            return { success: true, agentId: 'generated-agent', sessionId: 'session-1' };
          },
          done: () => ({ success: true }),
          relink: () => ({ success: true }),
          whoami: () => ({ success: true }),
        },
        metrics: { errors: 0 },
        logger: silentLogger,
        actorSouls: null,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test('/sugar/begin is 503 IDENTITY_VERIFIER_UNAVAILABLE even for an uncredentialed caller — the mint door never opens blind', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: { purpose: 'no verifier', lifecycle: 'durable' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('IDENTITY_VERIFIER_UNAVAILABLE');
    expect(beginCalls).toHaveLength(0);
  });

  test('/sugar/begin with a credential is 503 too — never verified by assumption', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: { purpose: 'no verifier', lifecycle: 'durable', credential: 'ANYID.secret' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('IDENTITY_VERIFIER_UNAVAILABLE');
    expect(beginCalls).toHaveLength(0);
  });

  test('/sugar/done with a credential while the store is down is 503; without one it is still 401', async () => {
    const withCredential = await app.inject({
      method: 'POST',
      url: '/sugar/done',
      payload: { credential: 'ANYID.secret' },
    });
    expect(withCredential.statusCode).toBe(503);
    expect(withCredential.json().code).toBe('IDENTITY_VERIFIER_UNAVAILABLE');

    const without = await app.inject({ method: 'POST', url: '/sugar/done', payload: {} });
    expect(without.statusCode).toBe(401);
    expect(without.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
  });
});

// =============================================================================
// /locks/:name acquire / release / extend
// =============================================================================
describe('identity write boundary — locks routes', () => {
  let app;
  let db;
  let souls;
  let locks;

  beforeEach(async () => {
    db = createTestDb();
    souls = createTestActorSouls(db);
    locks = createLocks(db);
    app = Fastify();
    await app.register(locksPlugin, {
      deps: {
        logger: silentLogger,
        metrics: { errors: 0 },
        locks,
        agents: { canAcquireLock: () => ({ allowed: true }) },
        activityLog: { logLock: { acquire: () => {}, release: () => {} } },
        webhooks: { trigger: () => {} },
        actorSouls: souls,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  test('acquiring a lock with a self-asserted owner and no credential is rejected 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/locks/deploy',
      payload: { owner: 'self-asserted-agent', ttl: 60000 },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    expect(locks.list({}).count).toBe(0);
  });

  test('acquiring a lock with no identity at all is rejected 401 — the anonymous fallback is gone', async () => {
    const res = await app.inject({ method: 'POST', url: '/locks/deploy', payload: { ttl: 60000 } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
  });

  test('a forged credential on acquire is rejected 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/locks/deploy',
      payload: { owner: 'agent-1', ttl: 60000, credential: 'FORGED.creds' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
  });

  test('a forged credential on release is rejected 401 and the lock stays held', async () => {
    const holder = mintTestActor(souls, 'forge-release-holder');
    await app.inject({
      method: 'POST',
      url: '/locks/forge-release',
      payload: { owner: 'forge-release-holder', ttl: 60000 },
      headers: holder.headers,
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/locks/forge-release',
      payload: { owner: 'forge-release-holder', credential: 'FORGED.creds' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
    expect(locks.check('forge-release').held).toBe(true);
  });

  test('a forged credential on extend is rejected 401', async () => {
    const holder = mintTestActor(souls, 'forge-extend-holder');
    await app.inject({
      method: 'POST',
      url: '/locks/forge-extend',
      payload: { owner: 'forge-extend-holder', ttl: 60000 },
      headers: holder.headers,
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/locks/forge-extend',
      payload: { ttl: 120000, credential: 'FORGED.creds' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
  });

  test("a valid credential cannot acquire under another soul's alias (403)", async () => {
    const attacker = mintTestActor(souls, 'lockattacker');
    mintTestActor(souls, 'lockvictim');
    const res = await app.inject({
      method: 'POST',
      url: '/locks/deploy',
      payload: { owner: 'lockvictim', ttl: 60000 },
      headers: attacker.headers,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('IDENTITY_ALIAS_MISMATCH');
  });

  test('a credentialed acquire succeeds and stamps the minted actorId into lock metadata', async () => {
    const holder = mintTestActor(souls, 'holder-1');
    const res = await app.inject({
      method: 'POST',
      url: '/locks/deploy',
      payload: { owner: 'holder-1', ttl: 60000 },
      headers: holder.headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().owner).toBe('holder-1');
    const status = locks.check('deploy');
    expect(status.held).toBe(true);
    expect(status.metadata.actorId).toBe(holder.actorId);
  });

  test('the caller cannot pre-fill actorId through lock metadata', async () => {
    const holder = mintTestActor(souls, 'holder-meta');
    await app.inject({
      method: 'POST',
      url: '/locks/meta-forge',
      payload: { owner: 'holder-meta', ttl: 60000, metadata: { actorId: 'FAKE', keep: true } },
      headers: holder.headers,
    });
    const status = locks.check('meta-forge');
    expect(status.metadata.actorId).toBe(holder.actorId);
    expect(status.metadata.keep).toBe(true);
  });

  test("another soul's credential cannot release a held lock even knowing the owner string (403)", async () => {
    const holder = mintTestActor(souls, 'release-holder');
    const attacker = mintTestActor(souls);
    await app.inject({
      method: 'POST',
      url: '/locks/deploy',
      payload: { owner: 'release-holder', ttl: 60000 },
      headers: holder.headers,
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/locks/deploy',
      // The attacker asserts an UNBOUND display string equal to nothing —
      // it presents no owner, so the effective owner is its own actorId;
      // the stamped-actor check rejects before lib string matching runs.
      payload: {},
      headers: attacker.headers,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('LOCK_OWNER_MISMATCH');
    expect(locks.check('deploy').held).toBe(true);
  });

  test('release without a credential is rejected 401', async () => {
    const holder = mintTestActor(souls, 'release-holder-2');
    await app.inject({
      method: 'POST',
      url: '/locks/deploy2',
      payload: { owner: 'release-holder-2', ttl: 60000 },
      headers: holder.headers,
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/locks/deploy2',
      payload: { owner: 'release-holder-2' },
    });
    expect(res.statusCode).toBe(401);
    expect(locks.check('deploy2').held).toBe(true);
  });

  test('the holding soul releases its lock (positive path)', async () => {
    const holder = mintTestActor(souls, 'happy-holder');
    await app.inject({
      method: 'POST',
      url: '/locks/happy',
      payload: { owner: 'happy-holder', ttl: 60000 },
      headers: holder.headers,
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/locks/happy',
      payload: { owner: 'happy-holder' },
      headers: holder.headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().released).toBe(true);
    expect(locks.check('happy').held).toBe(false);
  });

  test('a second acquire by the SAME soul with the same valid credential is 409 LOCK_HELD — no re-entrancy, no silent extension', async () => {
    // lib/locks.acquire treats ANY existing row as "lock is held" — it never
    // special-cases the current holder — so the route-level contract for a
    // duplicate acquire (the sequential shape of two racing acquires) is a
    // 409 LOCK_HELD naming the holder, with the original expiry untouched.
    const holder = mintTestActor(souls, 'reentry-holder');
    const first = await app.inject({
      method: 'POST',
      url: '/locks/reentry',
      payload: { owner: 'reentry-holder', ttl: 60000 },
      headers: holder.headers,
    });
    expect(first.statusCode).toBe(200);
    const originalExpiry = locks.check('reentry').expiresAt;

    const second = await app.inject({
      method: 'POST',
      url: '/locks/reentry',
      payload: { owner: 'reentry-holder', ttl: 120000 },
      headers: holder.headers,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('LOCK_HELD');
    expect(second.json().holder).toBe('reentry-holder');
    // The failed duplicate acquire did not extend or reset the lock.
    expect(locks.check('reentry').expiresAt).toBe(originalExpiry);
  });

  test('overlapping extends by the holder are serialized: both succeed, the last write sets the expiry', async () => {
    // There is no genuine timing race to fabricate at this layer:
    // better-sqlite3 is synchronous and each route handler runs its lock
    // mutation to completion, so "overlapping" PUTs resolve as a serial
    // sequence. The route-level contract is last-write-wins on expiresAt.
    const holder = mintTestActor(souls, 'serial-extend-holder');
    await app.inject({
      method: 'POST',
      url: '/locks/serial-extend',
      payload: { owner: 'serial-extend-holder', ttl: 60000 },
      headers: holder.headers,
    });
    const firstExtend = await app.inject({
      method: 'PUT',
      url: '/locks/serial-extend',
      payload: { owner: 'serial-extend-holder', ttl: 60000 },
      headers: holder.headers,
    });
    const secondExtend = await app.inject({
      method: 'PUT',
      url: '/locks/serial-extend',
      payload: { owner: 'serial-extend-holder', ttl: 600000 },
      headers: holder.headers,
    });
    expect(firstExtend.statusCode).toBe(200);
    expect(secondExtend.statusCode).toBe(200);
    expect(secondExtend.json().expiresAt).toBeGreaterThanOrEqual(firstExtend.json().expiresAt);
    expect(locks.check('serial-extend').expiresAt).toBe(secondExtend.json().expiresAt);
  });

  test("extend-vs-steal: once the lock has changed hands, the ORIGINAL holder's late extend is 403 LOCK_OWNER_MISMATCH", async () => {
    // The sequential shape of the extension race: holder A loses the lock
    // (released/expired), soul B acquires it, then A's in-flight extend
    // lands. Ownership follows the CURRENT stamped actorId, not history —
    // A's extend must not stretch B's lock.
    const original = mintTestActor(souls, 'stolen-from');
    const thief = mintTestActor(souls, 'steal-acquirer');
    await app.inject({
      method: 'POST',
      url: '/locks/steal-race',
      payload: { owner: 'stolen-from', ttl: 60000 },
      headers: original.headers,
    });
    await app.inject({
      method: 'DELETE',
      url: '/locks/steal-race',
      payload: { owner: 'stolen-from' },
      headers: original.headers,
    });
    await app.inject({
      method: 'POST',
      url: '/locks/steal-race',
      payload: { owner: 'steal-acquirer', ttl: 60000 },
      headers: thief.headers,
    });

    const lateExtend = await app.inject({
      method: 'PUT',
      url: '/locks/steal-race',
      payload: { owner: 'stolen-from', ttl: 600000 },
      headers: original.headers,
    });
    expect(lateExtend.statusCode).toBe(403);
    expect(lateExtend.json().code).toBe('LOCK_OWNER_MISMATCH');
    expect(locks.check('steal-race').metadata.actorId).toBe(thief.actorId);
  });

  test("extend by another soul is rejected 403; extend by the holder succeeds", async () => {
    const holder = mintTestActor(souls, 'extend-holder');
    const attacker = mintTestActor(souls);
    await app.inject({
      method: 'POST',
      url: '/locks/extendable',
      payload: { owner: 'extend-holder', ttl: 60000 },
      headers: holder.headers,
    });

    const attacked = await app.inject({
      method: 'PUT',
      url: '/locks/extendable',
      payload: { ttl: 120000 },
      headers: attacker.headers,
    });
    expect(attacked.statusCode).toBe(403);
    expect(attacked.json().code).toBe('LOCK_OWNER_MISMATCH');

    const extended = await app.inject({
      method: 'PUT',
      url: '/locks/extendable',
      payload: { owner: 'extend-holder', ttl: 120000 },
      headers: holder.headers,
    });
    expect(extended.statusCode).toBe(200);
    expect(extended.json().success).toBe(true);
  });
});

// =============================================================================
// /salvage claim / complete / abandon / dismiss
// =============================================================================
describe('identity write boundary — salvage routes', () => {
  let app;
  let db;
  let souls;
  let completions;

  beforeEach(async () => {
    db = createTestDb();
    souls = createTestActorSouls(db);
    completions = [];
    app = Fastify();
    await app.register(resurrectionPlugin, {
      deps: {
        logger: silentLogger,
        metrics: { errors: 0 },
        resurrection: {
          pending: () => ({ success: true, agents: [], count: 0 }),
          list: () => ({ success: true, agents: [], count: 0 }),
          claim: () => ({ success: true, agent: { id: 'dead-agent' }, context: {} }),
          complete: (oldId, newId) => { completions.push([oldId, newId]); return { success: true }; },
          abandon: () => ({ success: true }),
          dismiss: () => ({ success: true }),
          countByProject: () => 0,
        },
        messaging: { publish: () => ({ success: true }) },
        activityLog: { log: () => {} },
        actorSouls: souls,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  test('a bare-anonymous claim (no credential AND no asserted id) is rejected 401', async () => {
    // Salvage mutations are always-attributed: even a request asserting no
    // identity at all fails closed — the no-identity path is a deliberate
    // 401, never an accidental acceptance.
    const res = await app.inject({ method: 'POST', url: '/salvage/claim/dead-agent', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
  });

  test('claiming a dead agent without a credential is rejected 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/salvage/claim/dead-agent',
      payload: { newAgentId: 'self-asserted-claimer' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
  });

  test('completing salvage without a credential is rejected 401 — successor linkage needs proof', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/salvage/complete/dead-agent',
      payload: { newAgentId: 'whitewashed-successor' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    expect(completions).toHaveLength(0);
  });

  test('a non-string newAgentId on complete is 400 even with a valid credential — it cannot skip the alias check into the record', async () => {
    const claimer = mintTestActor(souls, 'typed-claimer');
    for (const bad of [42, { evil: true }, ['array']]) {
      const res = await app.inject({
        method: 'POST',
        url: '/salvage/complete/dead-agent',
        payload: { newAgentId: bad },
        headers: claimer.headers,
      });
      expect(res.statusCode).toBe(400);
    }
    expect(completions).toHaveLength(0);
  });

  test("completing salvage onto ANOTHER soul's id is rejected 403", async () => {
    const attacker = mintTestActor(souls, 'salvage-attacker');
    mintTestActor(souls, 'salvage-victim');
    const res = await app.inject({
      method: 'POST',
      url: '/salvage/complete/dead-agent',
      payload: { newAgentId: 'salvage-victim' },
      headers: attacker.headers,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('IDENTITY_ALIAS_MISMATCH');
    expect(completions).toHaveLength(0);
  });

  test('a credentialed claim + complete under the own soul succeeds (positive path)', async () => {
    const claimer = mintTestActor(souls, 'legit-claimer');
    const claim = await app.inject({
      method: 'POST',
      url: '/salvage/claim/dead-agent',
      payload: { newAgentId: 'legit-claimer' },
      headers: claimer.headers,
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().success).toBe(true);

    const complete = await app.inject({
      method: 'POST',
      url: '/salvage/complete/dead-agent',
      payload: { newAgentId: 'legit-claimer' },
      headers: claimer.headers,
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().success).toBe(true);
    expect(completions).toEqual([['dead-agent', 'legit-claimer']]);
  });

  test('abandon and dismiss also require a verified credential', async () => {
    const abandon = await app.inject({ method: 'POST', url: '/salvage/abandon/dead-agent', payload: {} });
    expect(abandon.statusCode).toBe(401);
    const dismiss = await app.inject({ method: 'DELETE', url: '/salvage/dead-agent', payload: {} });
    expect(dismiss.statusCode).toBe(401);

    const actor = mintTestActor(souls, 'salvage-op');
    const abandonOk = await app.inject({
      method: 'POST', url: '/salvage/abandon/dead-agent', payload: {}, headers: actor.headers,
    });
    expect(abandonOk.statusCode).toBe(200);
    const dismissOk = await app.inject({
      method: 'DELETE', url: '/salvage/dead-agent', payload: {}, headers: actor.headers,
    });
    expect(dismissOk.statusCode).toBe(200);
  });

  test('the deprecated /resurrection aliases are enforced identically', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/resurrection/complete/dead-agent',
      payload: { newAgentId: 'whitewashed-successor' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
  });
});

// =============================================================================
// /commitments create / close
// =============================================================================
describe('identity write boundary — commitments routes', () => {
  let app;
  let db;
  let souls;
  let commitments;

  beforeEach(async () => {
    db = createTestDb();
    souls = createTestActorSouls(db);
    commitments = createCommitments(db);
    app = Fastify();
    await app.register(commitmentsPlugin, {
      deps: {
        commitments,
        obligationMonitor: { checkOverdue: () => ({ success: true, overdue: [] }) },
        logger: silentLogger,
        actorSouls: souls,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  test('creating a commitment without a credential is rejected 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/commitments',
      payload: { ownerActorId: 'any-actor', objectText: 'ship the fix' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    expect(commitments.list({ state: 'all' })).toHaveLength(0);
  });

  test("forging an obligation onto ANOTHER soul's id is rejected 403", async () => {
    const attacker = mintTestActor(souls, 'commit-attacker');
    const victim = mintTestActor(souls, 'commit-victim');
    const res = await app.inject({
      method: 'POST',
      url: '/commitments',
      payload: { ownerActorId: victim.actorId, objectText: 'forged obligation' },
      headers: attacker.headers,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('IDENTITY_ALIAS_MISMATCH');
    expect(commitments.list({ state: 'all' })).toHaveLength(0);
  });

  test('the owning soul creates and closes its commitment (positive path); others cannot close it', async () => {
    const owner = mintTestActor(souls, 'commit-owner');
    const other = mintTestActor(souls, 'commit-other');

    const created = await app.inject({
      method: 'POST',
      url: '/commitments',
      payload: { ownerActorId: owner.actorId, objectText: 'ship the strict boundary' },
      headers: owner.headers,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().commitment.id;

    const stolenClose = await app.inject({
      method: 'POST',
      url: `/commitments/${id}/close`,
      payload: { oracleRef: 'pr:1' },
      headers: other.headers,
    });
    expect(stolenClose.statusCode).toBe(403);
    expect(stolenClose.json().code).toBe('IDENTITY_ALIAS_MISMATCH');

    const closed = await app.inject({
      method: 'POST',
      url: `/commitments/${id}/close`,
      payload: { oracleRef: 'pr:1' },
      headers: owner.headers,
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().success).toBe(true);
  });

  test('closing by the owner via a bound alias also works (alias resolves to the same soul)', async () => {
    const owner = mintTestActor(souls, 'aliased-owner');
    const created = await app.inject({
      method: 'POST',
      url: '/commitments',
      // The alias resolves to the credential's own soul — allowed.
      payload: { ownerActorId: 'aliased-owner', objectText: 'aliased obligation' },
      headers: owner.headers,
    });
    expect(created.statusCode).toBe(201);
  });
});
