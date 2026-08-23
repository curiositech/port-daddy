/**
 * The heartbeat plane must not reach through into the enforced lock plane.
 *
 * ADR-0040 classifies `agents.id` as a DISPLAY handle: anyone can create one
 * with a single uncredentialed `POST /agents/:id/heartbeat` (which
 * auto-registers when no row exists), and the identity-write-boundary audit
 * justified leaving that plane open on the grounds that "nothing above the
 * newcomer floor keys on it".
 *
 * Locks ARE above that floor. `routes/locks.ts` makes ownership unforgeable
 * by stamping the acquirer's MINTED actorId into the lock's metadata and
 * comparing it on release (403 `LOCK_OWNER_MISMATCH`) — knowing the display
 * string is deliberately not ownership.
 *
 * `lib/agents.ts` `cleanup()` — the reaper, called from `server.ts` — did not
 * consult that stamp. It matched `locks.list({ owner: agent.id })` on the
 * display STRING and called `release(..., { force: true })`, which skips the
 * soul check entirely. So the potent primitive was never forging a heartbeat;
 * it was WITHHOLDING one: register a handle equal to a lock's owner string,
 * stop heartbeating, and the reaper destroys a lock held by a different,
 * credentialed soul.
 *
 * These tests are the regression oracle. They are deliberately NOT heuristics.
 * A column-name audit or a ULID-shape audit could never have caught this: the
 * defect is a READ that joins the display plane to the authority plane, not a
 * mis-typed durable write. That distinction is the honest answer to "can you
 * write a test that catches the next projection keying on a display handle?"
 * — see the note at the bottom of this file.
 */
import { createTestDb } from '../setup-unit.js';
import { createAgents, DEAD_THRESHOLDS } from '../../lib/agents.js';
import { createLocks } from '../../lib/locks.js';
import { createSessions } from '../../lib/sessions.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';
import { stampIdentityMetadata, resolveWriteIdentity } from '../../lib/identity-write-boundary.js';
import { resolveSessionSoul } from '../../lib/agent-soul-binding.js';

/**
 * Backdate an agent's heartbeat past its status's dead threshold, so the next
 * `cleanup()` treats it as a reap candidate. This is the "stop heartbeating"
 * half of the attack, compressed.
 */
function ageAgentPastDeath(db, agentId, status) {
  const threshold = DEAD_THRESHOLDS[status] ?? 4 * 60 * 60 * 1000;
  db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?')
    .run(Date.now() - threshold - 60_000, agentId);
}

describe("heartbeat plane cannot reap another soul's locks", () => {
  let db;
  let agents;
  let locks;
  let sessions;
  let souls;

  beforeEach(() => {
    db = createTestDb();
    agents = createAgents(db);
    locks = createLocks(db);
    sessions = createSessions(db);
    souls = createTestActorSouls(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Open a session the way the daemon does: a verified credential, and the
   * daemon's own verdict stamped into `metadata.identity` where no request
   * body can reach it. This is the ONLY binding from a display agentId to a
   * minted soul that the reaper accepts.
   */
  function beginSessionAs(actor, agentId) {
    const verdict = resolveWriteIdentity({
      souls,
      credential: actor.credential,
      assertedAgentId: null,
      route: 'POST /sessions',
      requireIdentity: true,
    });
    expect(verdict.ok).toBe(true);
    const started = sessions.start('holding a lock', {
      agentId,
      metadata: stampIdentityMetadata(null, verdict),
    });
    expect(started.success).toBe(true);
    return started.id;
  }

  /** A credentialed acquire, exactly as routes/locks.ts performs it. */
  function acquireAs(actor, lockName, owner) {
    const acquired = locks.acquire(lockName, {
      owner,
      pid: process.pid,
      ttl: 10 * 60 * 1000,
      metadata: { actorId: actor.actorId },
    });
    expect(acquired.success).toBe(true);
  }

  test('a lock stamped with soul A survives when the dying handle binds to NO soul', () => {
    // The pure attack, with no legitimising session for the squatted name:
    // the lock's owner STRING is one an attacker can produce at will, and the
    // holder never opened a session under it (it acquired the lock under a
    // different display id). Before the fix this force-released the lock.
    const holder = mintTestActor(souls);
    beginSessionAs(holder, 'port-daddy:release:holder');
    acquireAs(holder, 'release:promote', 'port-daddy:release:cutter');

    const forged = agents.heartbeat('port-daddy:release:cutter', { status: 'draining' });
    expect(forged.success).toBe(true);
    expect(resolveSessionSoul(sessions, 'port-daddy:release:cutter', { includeClosed: true })).toBeNull();

    ageAgentPastDeath(db, 'port-daddy:release:cutter', 'draining');
    const result = agents.cleanup(locks, { sessions });

    expect(result.cleaned).toBe(1);
    // THE INVARIANT: the reaper may bury the display handle, but it must not
    // destroy a lock whose stamped soul it never verified.
    expect(result.releasedLocks).toBe(0);
    const status = locks.check('release:promote');
    expect(status.held).toBe(true);
    expect(status.metadata.actorId).toBe(holder.actorId);
  });

  test("an attacker's own session does not let them reap the victim's lock", () => {
    // The subtler version: the attacker DOES hold a credential and DOES open
    // a session under the victim's display name (legal — `pd begin` binds no
    // alias, so the name is not reserved). The binding then resolves — to the
    // ATTACKER's soul, which is not the lock's stamped soul. Still refused.
    const victim = mintTestActor(souls);
    acquireAs(victim, 'release:promote', 'port-daddy:release:cutter');

    const attacker = mintTestActor(souls);
    agents.register('port-daddy:release:cutter', { pid: process.pid, status: 'draining' });
    beginSessionAs(attacker, 'port-daddy:release:cutter');
    expect(resolveSessionSoul(sessions, 'port-daddy:release:cutter', { includeClosed: true }))
      .toBe(attacker.actorId);

    ageAgentPastDeath(db, 'port-daddy:release:cutter', 'draining');
    const result = agents.cleanup(locks, { sessions });

    expect(result.releasedLocks).toBe(0);
    expect(locks.check('release:promote').held).toBe(true);
    expect(locks.check('release:promote').metadata.actorId).toBe(victim.actorId);
  });

  test("the reaper DOES release a lock the dead agent's own soul holds", () => {
    // The invariant must not be satisfied by never releasing anything:
    // reaping a genuinely dead agent's own locks is the reaper's whole job.
    const owner = mintTestActor(souls);
    // `pd begin` registers the agent AND starts the stamped session.
    agents.register('port-daddy:build:worker', { pid: process.pid, status: 'draining' });
    beginSessionAs(owner, 'port-daddy:build:worker');
    acquireAs(owner, 'build:artifacts', 'port-daddy:build:worker');

    ageAgentPastDeath(db, 'port-daddy:build:worker', 'draining');
    const result = agents.cleanup(locks, { sessions });

    expect(result.cleaned).toBe(1);
    expect(result.releasedLocks).toBe(1);
    expect(locks.check('build:artifacts').held).toBe(false);
  });

  test('an UNSTAMPED lock is still reaped by owner string (no soul, nothing to protect)', () => {
    // Locks written by an in-process path that has no soul carry no actorId.
    // There is no ownership claim to honour, so the historical string-match
    // behaviour is correct for them — asserting it keeps this suite from
    // silently degrading into "the reaper never releases anything".
    agents.register('legacy-agent', { pid: process.pid, status: 'draining' });
    locks.acquire('legacy:resource', { owner: 'legacy-agent', pid: process.pid, ttl: 600000 });
    expect(locks.check('legacy:resource').metadata?.actorId).toBeUndefined();

    ageAgentPastDeath(db, 'legacy-agent', 'draining');
    const result = agents.cleanup(locks, { sessions });

    expect(result.releasedLocks).toBe(1);
    expect(locks.check('legacy:resource').held).toBe(false);
  });

  test('with no sessions store wired, a stamped lock is left to its TTL rather than force-released', () => {
    // Fail closed. A daemon running without the sessions store cannot tell
    // whether the dying handle is the stamped soul, and destroying a
    // credentialed lock on a guess is the exact failure this closes. The
    // lock's TTL is the backstop, so nothing leaks forever.
    const holder = mintTestActor(souls);
    acquireAs(holder, 'release:promote', 'port-daddy:release:cutter');
    agents.heartbeat('port-daddy:release:cutter', { status: 'draining' });
    ageAgentPastDeath(db, 'port-daddy:release:cutter', 'draining');

    const result = agents.cleanup(locks); // no sessions passed
    expect(result.releasedLocks).toBe(0);
    expect(locks.check('release:promote').held).toBe(true);
  });

  test('the display handle itself is still reaped — this is not a stay of execution', () => {
    const holder = mintTestActor(souls);
    acquireAs(holder, 'release:promote', 'port-daddy:release:cutter');
    agents.heartbeat('port-daddy:release:cutter', { status: 'draining' });
    ageAgentPastDeath(db, 'port-daddy:release:cutter', 'draining');

    const result = agents.cleanup(locks, { sessions });
    expect(result.cleanedAgentIds).toEqual(['port-daddy:release:cutter']);
    expect(agents.get('port-daddy:release:cutter').success).toBe(false);
    // …and the lock is untouched, because the reaped handle never was the soul.
    expect(locks.check('release:promote').held).toBe(true);
  });
});

describe('the display handle never launders into a minted-shaped id', () => {
  /**
   * A tripwire, not a proof. `ActorId` is a phantom brand and `asActorId()` is
   * an unchecked cast, so `tsc` cannot tell a handle from a mint — and
   * `resolveActor()` returns an un-souled handle BRANDED as an ActorId. That
   * makes ULID shape neither necessary (migrated souls take an explicit id)
   * nor sufficient (a handle can be laundered through the unknown branch) for
   * "came from the mint". Membership in `actor_souls` is the strongest runtime
   * signal available, and it only speaks about rows that exist right now.
   *
   * This test therefore guards ONE thing precisely: that the unknown branch
   * keeps refusing to mint. If someone "fixes" it, the newcomer pool-flooring
   * breaks and every display handle starts looking like a principal downstream.
   */
  test('resolveActor returns unknown (and a non-ULID) for an un-souled handle', () => {
    const db = createTestDb();
    const souls = createTestActorSouls(db);
    const resolved = souls.resolveActor('port-daddy:release:cutter');
    expect(resolved.soulClass).toBe('unknown');
    expect(/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(resolved.actorId)).toBe(false);

    // …whereas a real mint IS ULID-shaped and IS in actor_souls.
    const minted = mintTestActor(souls, 'port-daddy:release:cutter');
    expect(/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(minted.actorId)).toBe(true);
    expect(souls.resolveActor('port-daddy:release:cutter').actorId).toBe(minted.actorId);
    expect(db.prepare('SELECT 1 FROM actor_souls WHERE actor_id = ?').get(minted.actorId)).toBeTruthy();
    db.close();
  });
});

// ─── What this suite does NOT claim ──────────────────────────────────────────
//
// It does not enforce the general rule "no durable projection keys on a
// display handle". That rule cannot be mechanically enforced here, and saying
// otherwise would be the theater this slice exists to remove:
//
//   1. The type system gives no signal — `asActorId(req.body.agentId)`
//      compiles, and no `tsc` setting rejects it. This is not a case of a
//      typecheck being skipped; a typecheck genuinely cannot see it.
//   2. Column names are not evidence. In this repo `dispatches.worker_actor_id`
//      holds 'daemon:dispatch-worker', `commitments.owner_actor_id` holds a raw
//      alias, and `sessions.agent_id` is a handle on purpose. Any name-based
//      rule produces both false positives and false negatives on the CURRENT
//      schema.
//   3. Values are not reliably distinguishable, per the tripwire above.
//   4. The dangerous couplings are READS, not writes. The bug these tests pin
//      is `locks.list({ owner: agent.id })`. No schema-classification test
//      sees that; detecting it is a dataflow/taint question across server.ts'
//      event wiring, and nothing in this repo has that machinery.
//
// So the rule remains a REVIEW DISCIPLINE. What is enforced here is the one
// concrete violation that was live, plus the tripwire on the laundering branch
// that would make new ones invisible.
