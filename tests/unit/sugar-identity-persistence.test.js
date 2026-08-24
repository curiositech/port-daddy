import Fastify from 'fastify';
import { jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createAgents } from '../../lib/agents.js';
import { createSessions } from '../../lib/sessions.js';
import { createActivityLog } from '../../lib/activity.js';
import { createSugar } from '../../lib/sugar.js';
import { sugarPlugin } from '../../routes/sugar.js';
import { createTestActorSouls } from '../helpers/actor-credentials.js';

const silentLogger = { info() {}, warn() {}, error() {} };
const validResultNote = 'Result: canonical identity lifecycle verified. PR opened: https://github.com/curiositech/port-daddy/pull/999';

describe('Sugar canonical identity persistence', () => {
  let app;
  let db;
  let agents;
  let sessions;
  let sugar;
  let actorSouls;
  let semanticIndex;
  let semanticIndexTransactionStates;

  beforeEach(async () => {
    db = createTestDb();
    semanticIndexTransactionStates = [];
    semanticIndex = {
      index: jest.fn(() => semanticIndexTransactionStates.push(db.inTransaction)),
      unindexEntry: jest.fn(),
      find: jest.fn(() => []),
    };
    agents = createAgents(db, { semanticIndex });
    sessions = createSessions(db);
    const activityLog = createActivityLog(db);
    sessions.setActivityLog(activityLog);
    sugar = createSugar({
      agents,
      sessions,
      activityLog,
      gitOriginChecker: {
        checkBranchOnOrigin: () => ({ ok: true, branch: 'codex/test', upstream: 'origin/codex/test', ahead: 0 }),
        checkLedgerOnly: () => ({ ok: true, dirtyEntries: 0, unpublishedCommits: 0 }),
      },
    });
    actorSouls = createTestActorSouls(db);
    app = Fastify();
    await app.register(sugarPlugin, {
      deps: {
        sugar,
        metrics: { errors: 0 },
        logger: silentLogger,
        actorSouls,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  function injectBegin(payload, credential) {
    return app.inject({
      method: 'POST',
      url: '/sugar/begin',
      headers: credential ? { 'x-actor-credential': credential } : undefined,
      payload: {
        lifecycle: 'durable',
        metadata: {
          identity: { verified: true, actorId: 'FORGED' },
          actorInbox: {
            verified: true,
            actorId: 'FORGED',
            harbor: 'victim-harbor',
            inboxTarget: 'fresh-victim-agent',
          },
          callerMetadata: 'preserved',
        },
        ...payload,
      },
    });
  }

  function expectCanonicalSession(sessionId, actorId, semanticIdentity) {
    const stored = sessions.get(sessionId);
    expect(stored.success).toBe(true);
    expect(stored.session.agentId).toBe(actorId);
    expect(stored.session.metadata).toEqual(expect.objectContaining({
      callerMetadata: 'preserved',
      semanticIdentity,
      identity: expect.objectContaining({
        verified: true,
        actorId,
      }),
      actorInbox: {
        verified: true,
        actorId,
        harbor: 'local',
        inboxTarget: actorId,
      },
    }));
    expect(stored.session.metadata.identity.actorId).not.toBe('FORGED');
    expect(stored.session.metadata.actorInbox.inboxTarget).not.toBe('fresh-victim-agent');
    expect(agents.resolveLiveActorInbox(actorId, 'local')).toEqual({
      success: true,
      binding: expect.objectContaining({ actorId, harbor: 'local', inboxTarget: actorId }),
    });
    return stored.session;
  }

  function seedLegacySession({ purpose, identity, agentId, status = 'active' }) {
    expect(agents.register(agentId, { identity, purpose })).toEqual(expect.objectContaining({
      success: true,
    }));
    const started = sessions.start(purpose, {
      agentId,
      project: identity.split(':')[0],
      metadata: { identity },
      durable: true,
    });
    expect(started).toEqual(expect.objectContaining({ success: true }));
    if (status !== 'active') {
      expect(sessions.end(started.id, { status })).toEqual(expect.objectContaining({
        success: true,
        status,
      }));
    }
    return started.id;
  }

  test('fresh begin persists and reads back the daemon-minted actor, never raw agentId or metadata', async () => {
    const response = await injectBegin({
      purpose: 'fresh canonical session',
      identity: 'demo:test:fresh-canonical',
      agentId: 'caller-controlled-agent',
      harbor: 'victim-harbor',
      project: 'victim-project',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.agentRegistered).toBe(true);
    expect(body.sessionStarted).toBe(true);
    expect(body.resumed).toBeUndefined();
    expect(body.agentId).toBe(body.actorId);
    expect(body.agentId).not.toBe('caller-controlled-agent');
    expectCanonicalSession(body.sessionId, body.actorId, 'demo:test:fresh-canonical');
    expect(db.prepare("SELECT COUNT(*) AS count FROM newcomer_pool WHERE project IN ('demo', 'victim-project', 'victim-harbor')").get().count).toBe(0);
    expect(db.prepare("SELECT souls_seen FROM newcomer_pool WHERE project = 'local'").get()).toEqual({ souls_seen: 1 });
    expect(semanticIndex.index).toHaveBeenCalledWith(
      'demo:test:fresh-canonical',
      expect.objectContaining({ type: 'agent', id: body.actorId }),
      body.actorId,
    );
    expect(semanticIndexTransactionStates).toEqual([false]);
  });

  test('a failed fresh session start rolls back soul, inbox, alias, pool, and session rows', async () => {
    const originalStart = sessions.start;
    sessions.start = () => ({ success: false, error: 'injected fresh session failure' });
    try {
      const response = await injectBegin({
        purpose: 'fresh atomic rollback',
        identity: 'victim-project:test:fresh-rollback',
        agentId: 'fresh-victim-agent',
      });
      expect(response.statusCode).toBe(500);
      expect(response.json().code).toBe('SESSION_START_FAILED');
      expect(response.json().credential).toBeUndefined();
      expect(response.json().actorId).toBeUndefined();
    } finally {
      sessions.start = originalStart;
    }
    expect(db.prepare('SELECT COUNT(*) AS count FROM actor_souls').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM actor_alias').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM newcomer_pool').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM agents').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count).toBe(0);
    expect(semanticIndex.index).not.toHaveBeenCalled();
  });

  test('a deferred SQLite commit failure rolls back identity rows without publishing a ghost index entry', async () => {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE semantic_index_commit_parent (id TEXT PRIMARY KEY);
      CREATE TABLE semantic_index_commit_guard (
        agent_id TEXT,
        FOREIGN KEY (agent_id) REFERENCES semantic_index_commit_parent(id)
          DEFERRABLE INITIALLY DEFERRED
      );
      CREATE TRIGGER reject_actor_commit
      AFTER INSERT ON agents
      BEGIN
        INSERT INTO semantic_index_commit_guard (agent_id) VALUES (NEW.id);
      END;
    `);

    const response = await injectBegin({
      purpose: 'fresh commit rollback',
      identity: 'demo:test:commit-rollback',
      agentId: 'caller-commit-rollback',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('STORE_UNAVAILABLE');
    expect(db.prepare('SELECT COUNT(*) AS count FROM actor_souls').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM actor_alias').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM newcomer_pool').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM agents').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count).toBe(0);
    expect(semanticIndex.index).not.toHaveBeenCalled();
  });

  test('missing or invalid credentials cannot resume an existing canonical actor', async () => {
    const first = (await injectBegin({
      purpose: 'credential gate predecessor',
      identity: 'demo:test:credential-gate',
      agentId: 'caller-predecessor-display',
    })).json();

    const missing = await injectBegin({
      purpose: 'credentialless resume attempt',
      identity: 'demo:test:credential-gate',
      agentId: first.actorId,
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');

    const invalid = await injectBegin({
      purpose: 'forged credential resume attempt',
      identity: 'demo:test:credential-gate',
      agentId: first.actorId,
    }, 'FORGED.nope');
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');

    const active = sessions.list({ status: 'active', allWorktrees: true }).sessions;
    expect(active.filter((session) => session.agentId === first.actorId)).toHaveLength(1);
    expectCanonicalSession(first.sessionId, first.actorId, 'demo:test:credential-gate');
  });

  test('resume remains idempotent while canonical actor identity survives update and readback', async () => {
    const first = (await injectBegin({
      purpose: 'resume canonical session',
      identity: 'demo:test:resume-canonical',
      agentId: 'caller-first-display',
    })).json();

    // A lost process registry row must be restored only through the verified
    // Sugar boundary; historical session.agentId is not a delivery fallback.
    db.prepare('DELETE FROM agents WHERE id = ?').run(first.actorId);
    expect(agents.resolveLiveActorInbox(first.actorId, 'local')).toEqual(expect.objectContaining({
      success: false,
      code: 'ACTOR_INBOX_UNBOUND',
    }));

    const response = await injectBegin({
      purpose: 'resume canonical session again',
      identity: 'demo:test:resume-canonical',
      agentId: 'caller-second-display',
    }, first.credential);

    expect(response.statusCode).toBe(200);
    const resumed = response.json();
    expect(resumed.success).toBe(true);
    expect(resumed.resumed).toBe(true);
    expect(resumed.takeover).toBeUndefined();
    expect(resumed.agentRegistered).toBe(false);
    expect(resumed.sessionStarted).toBe(false);
    expect(resumed.sessionId).toBe(first.sessionId);
    expect(resumed.agentId).toBe(first.actorId);
    expect(resumed.agentId).not.toBe('caller-second-display');
    expectCanonicalSession(resumed.sessionId, first.actorId, 'demo:test:resume-canonical');
  });

  test('two display aliases bound to the same soul resume one canonical session', async () => {
    const first = (await injectBegin({
      purpose: 'same soul alias predecessor',
      identity: 'demo:test:same-soul-alias',
      agentId: 'caller-primary-alias',
    })).json();

    const rebound = actorSouls.register({
      credential: first.credential,
      alias: 'caller-secondary-alias',
    });
    expect(rebound).toEqual(expect.objectContaining({ ok: true, actorId: first.actorId }));

    const response = await injectBegin({
      purpose: 'same soul alias resume',
      identity: 'demo:test:same-soul-alias',
      agentId: 'caller-secondary-alias',
    }, first.credential);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      success: true,
      resumed: true,
      sessionId: first.sessionId,
      agentId: first.actorId,
    }));
    expect(sessions.list({ status: 'active', allWorktrees: true }).sessions
      .filter((session) => session.agentId === first.actorId)).toHaveLength(1);
  });

  test('a failed later session start cannot unregister an existing verified inbox binding', async () => {
    const first = (await injectBegin({
      purpose: 'binding rollback predecessor',
      identity: 'demo:test:binding-rollback-a',
    })).json();
    const originalStart = sessions.start;
    sessions.start = () => ({ success: false, error: 'injected session failure' });
    try {
      const response = await injectBegin({
        purpose: 'binding rollback failure',
        identity: 'demo:test:binding-rollback-b',
      }, first.credential);
      expect(response.statusCode).toBe(500);
      expect(response.json().code).toBe('SESSION_START_FAILED');
    } finally {
      sessions.start = originalStart;
    }
    expect(agents.resolveLiveActorInbox(first.actorId, 'local')).toEqual({
      success: true,
      binding: expect.objectContaining({ inboxTarget: first.actorId }),
    });
  });

  test('active legacy display identity cannot stand in for a verified ownership stamp', async () => {
    const legacySessionId = seedLegacySession({
      purpose: 'legacy active predecessor',
      identity: 'demo:test:legacy-active',
      agentId: 'legacy-active-display',
    });
    const principal = actorSouls.register({ project: 'demo' });
    expect(principal).toEqual(expect.objectContaining({ ok: true }));

    const response = await injectBegin({
      purpose: 'must not resume legacy active row',
      identity: 'demo:test:legacy-active',
      agentId: 'legacy-active-display',
    }, principal.credential);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(expect.objectContaining({
      success: false,
      code: 'SESSION_IDENTITY_UNVERIFIED',
      sessionId: legacySessionId,
    }));
    expect(sessions.get(legacySessionId).session.status).toBe('active');
  });

  test('an unrelated legacy row in the same project cannot block a canonical fresh identity', async () => {
    const legacySessionId = seedLegacySession({
      purpose: 'unrelated legacy predecessor',
      identity: 'demo:test:legacy-unrelated-a',
      agentId: 'legacy-unrelated-display',
    });
    const principal = actorSouls.register({ project: 'demo' });
    expect(principal).toEqual(expect.objectContaining({ ok: true }));

    const response = await injectBegin({
      purpose: 'different canonical identity',
      identity: 'demo:test:legacy-unrelated-b',
      agentId: 'different-display-name',
    }, principal.credential);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      success: true,
      sessionStarted: true,
      agentId: principal.actorId,
    }));
    expect(response.json().sessionId).not.toBe(legacySessionId);
    expectCanonicalSession(
      response.json().sessionId,
      principal.actorId,
      'demo:test:legacy-unrelated-b',
    );
  });

  test('takeover creates a canonical successor and preserves lifecycle response semantics', async () => {
    const first = (await injectBegin({
      purpose: 'takeover predecessor',
      identity: 'demo:test:takeover-canonical',
      agentId: 'caller-predecessor-display',
    })).json();
    const done = await app.inject({
      method: 'POST',
      url: '/sugar/done',
      headers: { 'x-actor-credential': first.credential },
      payload: {
        agentId: 'caller-close-display',
        note: validResultNote,
      },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual(expect.objectContaining({
      success: true,
      agentId: first.actorId,
      sessionId: first.sessionId,
    }));
    expect(agents.resolveLiveActorInbox(first.actorId, 'local')).toEqual(expect.objectContaining({
      success: false,
      code: 'ACTOR_INBOX_UNBOUND',
    }));

    const response = await injectBegin({
      purpose: 'takeover successor',
      identity: 'demo:test:takeover-canonical',
      agentId: 'caller-successor-display',
    }, first.credential);

    expect(response.statusCode).toBe(200);
    const successor = response.json();
    expect(successor.success).toBe(true);
    expect(successor.resumed).toBe(true);
    expect(successor.takeover).toBe(true);
    expect(successor.agentRegistered).toBe(false);
    expect(successor.sessionStarted).toBe(false);
    expect(successor.sessionId).not.toBe(first.sessionId);
    expect(successor.agentId).toBe(first.actorId);
    expect(successor.agentId).not.toBe('caller-successor-display');
    const stored = expectCanonicalSession(
      successor.sessionId,
      first.actorId,
      'demo:test:takeover-canonical',
    );
    expect(stored.metadata.predecessorSessionId).toBe(first.sessionId);
    expect(agents.resolveLiveActorInbox(first.actorId, 'local')).toEqual({
      success: true,
      binding: expect.objectContaining({ inboxTarget: first.actorId }),
    });
  });

  test('closed legacy display identity cannot authorize a canonical takeover', async () => {
    const legacySessionId = seedLegacySession({
      purpose: 'legacy takeover predecessor',
      identity: 'demo:test:legacy-takeover',
      agentId: 'legacy-takeover-display',
      status: 'completed',
    });
    const principal = actorSouls.register({ project: 'demo' });
    expect(principal).toEqual(expect.objectContaining({ ok: true }));

    const response = await injectBegin({
      purpose: 'must not take over legacy closed row',
      identity: 'demo:test:legacy-takeover',
      agentId: 'legacy-takeover-display',
    }, principal.credential);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(expect.objectContaining({
      success: false,
      code: 'SESSION_IDENTITY_UNVERIFIED',
      sessionId: legacySessionId,
    }));
    expect(sessions.get(legacySessionId).session.status).toBe('completed');
  });
});
