/**
 * The begin-retry session-loss bug.
 *
 * `pd begin` → the daemon creates and COMMITS a session → the response is
 * lost on the wire (socket reset, 10s client timeout) → the client's
 * transport re-sends the identical body (cli/utils/fetch.ts singleRequest
 * socket→TCP fallback on ECONNRESET / timeout; lib/client.ts _request does
 * the same). Before this fix the daemon treated the re-send as a brand-new
 * begin:
 *
 *   - without an identity (or with --agent / --force) it MINTED a second
 *     agent + session; the first stayed active with its claims and rent,
 *     driven by nobody;
 *   - with an identity the resume path found the first session but the
 *     retry carried no credential (it was in the lost response), so the
 *     daemon answered 403 SESSION_OWNER_UNVERIFIABLE. The credential is
 *     returned exactly once, so the agent could never drive or close the
 *     session it had just created.
 *
 * The fix: the client sends an `idempotencyKey` on every re-send of the same
 * logical begin, the daemon records (key → session) with the session, and a
 * retry carrying a known key returns the ORIGINAL session (same ids, same
 * credential) flagged `replayed: true` instead of minting again.
 *
 * These tests model "the response was lost" faithfully: the first response
 * is discarded and the byte-identical request is sent again.
 */
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createAgents } from '../../lib/agents.js';
import { createSessions } from '../../lib/sessions.js';
import { createActivityLog } from '../../lib/activity.js';
import { createSugar } from '../../lib/sugar.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';
import { createBeginIdempotency } from '../../lib/begin-idempotency.js';
import { sugarPlugin } from '../../routes/sugar.js';

const silentLogger = { info() {}, warn() {}, error() {} };

async function buildApp() {
  const db = createTestDb();
  const agents = createAgents(db);
  const sessions = createSessions(db);
  const activityLog = createActivityLog(db);
  sessions.setActivityLog(activityLog);
  const souls = createTestActorSouls(db);
  const sugar = createSugar({
    agents,
    sessions,
    activityLog,
    gitOriginChecker: {
      checkBranchOnOrigin: () => ({ ok: true, branch: 'x', upstream: 'origin/x', ahead: 0 }),
      checkLedgerOnly: () => ({ ok: true, dirtyEntries: 0, unpublishedCommits: 0 }),
    },
  });
  const beginIdempotency = createBeginIdempotency(db, { ttlMs: 60_000 });
  const app = Fastify();
  await app.register(sugarPlugin, {
    deps: { sugar, sessions, metrics: { errors: 0 }, logger: silentLogger, actorSouls: souls, beginIdempotency },
  });
  await app.ready();
  return { app, db, sessions, souls, beginIdempotency };
}

function beginBody(overrides = {}) {
  return {
    purpose: 'fix the begin retry gap',
    lifecycle: 'ephemeral',
    idempotencyKey: '0c1d4a7e-5f2b-4c3d-9e8f-1a2b3c4d5e6f',
    ...overrides,
  };
}

describe('begin retry after a lost response — idempotency key', () => {
  let app;
  let db;
  let sessions;

  beforeEach(async () => {
    ({ app, db, sessions } = await buildApp());
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  test('the byte-identical re-send (no identity) returns the ORIGINAL session, not a second one', async () => {
    const payload = beginBody();
    const first = await app.inject({ method: 'POST', url: '/sugar/begin', payload });
    expect(first.statusCode).toBe(200);
    const committed = first.json();
    expect(typeof committed.sessionId).toBe('string');
    expect(typeof committed.credential).toBe('string');
    // The response is lost here. The transport re-sends the same bytes.

    const retry = await app.inject({ method: 'POST', url: '/sugar/begin', payload });
    expect(retry.statusCode).toBe(200);
    const replayed = retry.json();
    expect(replayed.sessionId).toBe(committed.sessionId);
    expect(replayed.agentId).toBe(committed.agentId);
    expect(replayed.replayed).toBe(true);
    // The once-returned credential comes back to the holder of the key.
    expect(replayed.credential).toBe(committed.credential);

    const active = sessions.list({ status: 'active', allWorktrees: true });
    expect(active.sessions).toHaveLength(1);
  });

  test('the re-send WITH an identity is not answered 403 SESSION_OWNER_UNVERIFIABLE', async () => {
    const payload = beginBody({ identity: 'demo:api:retry' });
    const first = await app.inject({ method: 'POST', url: '/sugar/begin', payload });
    expect(first.statusCode).toBe(200);
    const committed = first.json();

    const retry = await app.inject({ method: 'POST', url: '/sugar/begin', payload });
    expect(retry.statusCode).toBe(200);
    const replayed = retry.json();
    expect(replayed.code).toBeUndefined();
    expect(replayed.sessionId).toBe(committed.sessionId);
    expect(replayed.agentId).toBe(committed.agentId);
    expect(replayed.replayed).toBe(true);
    expect(replayed.credential).toBe(committed.credential);
  });

  test('a re-send with --force still replays (force must not defeat the key)', async () => {
    const payload = beginBody({ identity: 'demo:api:forced', force: true });
    const first = await app.inject({ method: 'POST', url: '/sugar/begin', payload });
    const retry = await app.inject({ method: 'POST', url: '/sugar/begin', payload });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().sessionId).toBe(first.json().sessionId);
    expect(sessions.list({ status: 'active', allWorktrees: true }).sessions).toHaveLength(1);
  });

  test('the key also rides the idempotency-key header', async () => {
    const { idempotencyKey, ...payload } = beginBody();
    const headers = { 'idempotency-key': idempotencyKey };
    const first = await app.inject({ method: 'POST', url: '/sugar/begin', payload, headers });
    const retry = await app.inject({ method: 'POST', url: '/sugar/begin', payload, headers });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().replayed).toBe(true);
    expect(retry.json().sessionId).toBe(first.json().sessionId);
  });

  test('a replay carries the original response shape (no second mint, same actor)', async () => {
    const payload = beginBody({ identity: 'demo:api:shape' });
    const first = (await app.inject({ method: 'POST', url: '/sugar/begin', payload })).json();
    const replayed = (await app.inject({ method: 'POST', url: '/sugar/begin', payload })).json();
    expect(replayed.actorId).toBe(first.actorId);
    expect(replayed.actorIdentity).toEqual(first.actorIdentity);
    expect(replayed.agentRegistered).toBe(first.agentRegistered);
    expect(replayed.sessionStarted).toBe(first.sessionStarted);
    expect(replayed.idempotencyKeyRecorded).toBe(true);
    expect(replayed.resumed).toBeUndefined();
  });
});

describe('begin idempotency key — boundaries', () => {
  let app;
  let db;
  let sessions;
  let souls;

  beforeEach(async () => {
    ({ app, db, sessions, souls } = await buildApp());
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  test('a DIFFERENT key creates a new session (the key, not the body, is the identity of the attempt)', async () => {
    const first = await app.inject({ method: 'POST', url: '/sugar/begin', payload: beginBody({ agentId: 'demo-agent-a' }) });
    const second = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: beginBody({ agentId: 'demo-agent-b', idempotencyKey: 'ffffffff-1111-4222-8333-444444444444' }),
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBeUndefined();
    expect(second.json().sessionId).not.toBe(first.json().sessionId);
    expect(sessions.list({ status: 'active', allWorktrees: true }).sessions).toHaveLength(2);
  });

  test('a malformed key is a 400 before anything is created', async () => {
    const res = await app.inject({ method: 'POST', url: '/sugar/begin', payload: beginBody({ idempotencyKey: 'short' }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IDEMPOTENCY_KEY_INVALID');
    expect(sessions.list({ allWorktrees: true }).sessions).toHaveLength(0);
  });

  test('a key from ANOTHER identity is refused without disclosing the session', async () => {
    const first = await app.inject({ method: 'POST', url: '/sugar/begin', payload: beginBody({ identity: 'demo:api:owner' }) });
    expect(first.statusCode).toBe(200);
    const hijack = await app.inject({ method: 'POST', url: '/sugar/begin', payload: beginBody({ identity: 'evil:api:thief' }) });
    expect(hijack.statusCode).toBe(409);
    expect(hijack.json().code).toBe('IDEMPOTENCY_KEY_SCOPE_MISMATCH');
    expect(hijack.json().sessionId).toBeUndefined();
    expect(hijack.json().agentId).toBeUndefined();
    expect(JSON.stringify(hijack.json())).not.toContain(first.json().sessionId);
    // Nothing was minted for the thief either.
    expect(sessions.list({ status: 'active', allWorktrees: true }).sessions).toHaveLength(1);
  });

  test('the same key for a DIFFERENT begin in the same context is refused, naming the recorded session', async () => {
    const first = await app.inject({ method: 'POST', url: '/sugar/begin', payload: beginBody({ identity: 'demo:api:reuse' }) });
    const reused = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: beginBody({ identity: 'demo:api:reuse', purpose: 'something else entirely' }),
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(reused.json().sessionId).toBe(first.json().sessionId);
    expect(sessions.list({ status: 'active', allWorktrees: true }).sessions).toHaveLength(1);
  });

  test('a replay presenting the ORIGINAL credential succeeds; another actor\'s is 403; a forged one is 401', async () => {
    const payload = beginBody({ identity: 'demo:api:cred' });
    const first = (await app.inject({ method: 'POST', url: '/sugar/begin', payload })).json();

    const withOwn = await app.inject({ method: 'POST', url: '/sugar/begin', payload, headers: { 'x-actor-credential': first.credential } });
    expect(withOwn.statusCode).toBe(200);
    expect(withOwn.json().replayed).toBe(true);
    expect(withOwn.json().sessionId).toBe(first.sessionId);

    const other = mintTestActor(souls, 'someone:else:entirely');
    const withOther = await app.inject({ method: 'POST', url: '/sugar/begin', payload, headers: other.headers });
    expect(withOther.statusCode).toBe(403);
    expect(withOther.json().code).toBe('IDEMPOTENCY_KEY_ACTOR_MISMATCH');

    const forged = await app.inject({ method: 'POST', url: '/sugar/begin', payload, headers: { 'x-actor-credential': 'FORGED.nope' } });
    expect(forged.statusCode).toBe(401);
    expect(sessions.list({ status: 'active', allWorktrees: true }).sessions).toHaveLength(1);
  });

  test('once the recorded session is closed, the same key starts a NEW begin and re-records', async () => {
    const payload = beginBody({ identity: 'demo:api:closed' });
    const first = (await app.inject({ method: 'POST', url: '/sugar/begin', payload })).json();
    db.prepare("UPDATE sessions SET status = 'completed', completed_at = ? WHERE id = ?").run(Date.now(), first.sessionId);

    // The identity-resume gate would otherwise answer this with a takeover
    // hint (closed history); the key path never intercepts a closed session,
    // and the fresh begin goes through the normal gates.
    const after = await app.inject({ method: 'POST', url: '/sugar/begin', payload });
    expect(after.json().replayed).toBeUndefined();
    if (after.statusCode === 200) {
      expect(after.json().sessionId).not.toBe(first.sessionId);
      const replay = await app.inject({ method: 'POST', url: '/sugar/begin', payload });
      expect(replay.json().replayed).toBe(true);
      expect(replay.json().sessionId).toBe(after.json().sessionId);
    } else {
      // The normal gates spoke (closed history requires explicit takeover);
      // the point is that the closed session was NOT silently replayed.
      expect(after.json().code).toBe('CLOSED_SESSION_REQUIRES_EXPLICIT_TAKEOVER');
    }
  });

  test('without the store the key is accepted and ignored (older daemon behaviour, no crash)', async () => {
    const bare = createTestDb();
    const agents = createAgents(bare);
    const bareSessions = createSessions(bare);
    const activityLog = createActivityLog(bare);
    bareSessions.setActivityLog(activityLog);
    const sugar = createSugar({
      agents,
      sessions: bareSessions,
      activityLog,
      gitOriginChecker: { checkBranchOnOrigin: () => ({ ok: true, branch: 'x', upstream: 'origin/x', ahead: 0 }) },
    });
    const legacy = Fastify();
    await legacy.register(sugarPlugin, {
      deps: { sugar, sessions: bareSessions, metrics: { errors: 0 }, logger: silentLogger, actorSouls: createTestActorSouls(bare) },
    });
    await legacy.ready();
    try {
      const res = await legacy.inject({ method: 'POST', url: '/sugar/begin', payload: beginBody() });
      expect(res.statusCode).toBe(200);
      expect(res.json().idempotencyKeyRecorded).toBeUndefined();
    } finally {
      await legacy.close();
      bare.close();
    }
  });
});

describe('GET /sugar/find — successor discovery', () => {
  let app;
  let db;
  let sessions;

  beforeEach(async () => {
    ({ app, db, sessions } = await buildApp());
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  test('by key: returns the session and re-opens the sealed credential for the key holder', async () => {
    const payload = beginBody({ identity: 'demo:api:findkey' });
    const committed = (await app.inject({ method: 'POST', url: '/sugar/begin', payload })).json();

    const found = await app.inject({ method: 'GET', url: `/sugar/find?key=${payload.idempotencyKey}` });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual(expect.objectContaining({
      success: true,
      foundBy: 'key',
      sessionId: committed.sessionId,
      agentId: committed.agentId,
      actorId: committed.actorId,
      status: 'active',
      driveable: true,
      identity: 'demo:api:findkey',
      lifecycle: 'ephemeral',
      credential: committed.credential,
    }));

    const wrong = await app.inject({ method: 'GET', url: '/sugar/find?key=ffffffff-1111-4222-8333-444444444444' });
    expect(wrong.statusCode).toBe(404);
    expect(wrong.json().code).toBe('IDEMPOTENCY_KEY_UNKNOWN');

    const malformed = await app.inject({ method: 'GET', url: '/sugar/find?key=nope' });
    expect(malformed.statusCode).toBe(400);
  });

  test('by key: a closed session comes back not driveable with the takeover hint', async () => {
    const payload = beginBody({ identity: 'demo:api:findclosed' });
    const committed = (await app.inject({ method: 'POST', url: '/sugar/begin', payload })).json();
    db.prepare("UPDATE sessions SET status = 'abandoned' WHERE id = ?").run(committed.sessionId);
    const found = await app.inject({ method: 'GET', url: `/sugar/find?key=${payload.idempotencyKey}` });
    expect(found.statusCode).toBe(200);
    expect(found.json().driveable).toBe(false);
    expect(found.json().status).toBe('abandoned');
    expect(found.json().hint).toContain(`pd session takeover ${committed.sessionId}`);
  });

  test('by key: a deleted session is 410 with the ids it had', async () => {
    const payload = beginBody({ identity: 'demo:api:findgone' });
    const committed = (await app.inject({ method: 'POST', url: '/sugar/begin', payload })).json();
    db.prepare('DELETE FROM sessions WHERE id = ?').run(committed.sessionId);
    const found = await app.inject({ method: 'GET', url: `/sugar/find?key=${payload.idempotencyKey}` });
    expect(found.statusCode).toBe(410);
    expect(found.json().code).toBe('IDEMPOTENCY_SESSION_GONE');
    expect(found.json().sessionId).toBe(committed.sessionId);
  });

  test('by identity: newest live session first, scoped to the worktree, ids only', async () => {
    const one = (await app.inject({ method: 'POST', url: '/sugar/begin', payload: beginBody({ identity: 'demo:api:one', purpose: 'first' }) })).json();
    const two = (await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: beginBody({ identity: 'demo:api:two', purpose: 'second', idempotencyKey: 'ffffffff-1111-4222-8333-444444444444' }),
    })).json();
    expect(one.sessionId).not.toBe(two.sessionId);
    const worktreeId = sessions.get(one.sessionId).session.worktreeId;

    const found = await app.inject({ method: 'GET', url: '/sugar/find?identity=demo:api:one&allWorktrees=1' });
    expect(found.statusCode).toBe(200);
    const body = found.json();
    expect(body.foundBy).toBe('identity');
    expect(body.count).toBe(1);
    expect(body.sessionId).toBe(one.sessionId);
    expect(body.sessions[0]).toEqual(expect.objectContaining({ sessionId: one.sessionId, agentId: one.agentId, status: 'active', purpose: 'first' }));
    // Identity search never yields a credential — not at the top level, not per row.
    expect(body.credential).toBeUndefined();
    expect(body.sessions.every((row) => row.credential === undefined)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(one.credential);
    expect(body.hint).toContain('pd session find --key');

    if (worktreeId) {
      const scoped = await app.inject({ method: 'GET', url: `/sugar/find?identity=demo:api:one&worktreeId=${encodeURIComponent(worktreeId)}` });
      expect(scoped.json().sessionId).toBe(one.sessionId);
      const elsewhere = await app.inject({ method: 'GET', url: '/sugar/find?identity=demo:api:one&worktreeId=no-such-worktree' });
      expect(elsewhere.json().count).toBe(0);
    }

    // Closed sessions are hidden by default and surfaced with includeClosed.
    db.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(one.sessionId);
    const hidden = await app.inject({ method: 'GET', url: '/sugar/find?identity=demo:api:one&allWorktrees=1' });
    expect(hidden.json().count).toBe(0);
    expect(hidden.json().hint).toContain('pd session find --all');
    const shown = await app.inject({ method: 'GET', url: '/sugar/find?identity=demo:api:one&allWorktrees=1&includeClosed=1' });
    expect(shown.json().count).toBe(1);
    expect(shown.json().hint).toContain(`pd session takeover ${one.sessionId}`);
  });

  test('neither key nor identity is a 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/sugar/find' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });
});
