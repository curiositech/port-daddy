import Fastify from 'fastify';
import { describe, expect, test } from '@jest/globals';
import { createActivityLog } from '../../lib/activity.js';
import { createAgentInbox, inboxMessageForMessaging } from '../../lib/agent-inbox.js';
import { createParleyAutoTrigger } from '../../lib/parley-auto-trigger.js';
import { createParley } from '../../lib/parley.js';
import { CONFLICT_SIGNAL_LIMITS } from '../../lib/parley-trigger.js';
import { createSessions } from '../../lib/sessions.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { sessionsPlugin } from '../../routes/sessions.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';
import { createTestDb } from '../setup-unit.js';

function buildHarness(options: { throwFromTrigger?: boolean } = {}) {
  const db = createTestDb();
  const sessions = createSessions(db, undefined, { requireAgentForFileClaims: true });
  const actorSouls = createTestActorSouls(db);
  const tuples = createTupleSpace(db);
  const published: Array<ReturnType<typeof inboxMessageForMessaging>> = [];
  const inbox = createAgentInbox(db, (_agentId, message) => {
    published.push(inboxMessageForMessaging(message));
  });
  const parley = createParley({ tuples, agentInbox: inbox });
  const activityLog = createActivityLog(db);
  const logs: Array<{ level: 'info' | 'error'; message: string; metadata?: Record<string, unknown> }> = [];
  const trigger = createParleyAutoTrigger({
    tuples,
    parley,
    activityLog,
    resolveLiveParty: (candidate) => {
      const active = sessions.list({ status: 'active', allWorktrees: true, limit: 1000 }) as {
        sessions?: Array<{ id?: unknown; agentId?: unknown }>;
      };
      for (const session of active.sessions ?? []) {
        if (typeof session.id !== 'string' || typeof session.agentId !== 'string') continue;
        const resolved = actorSouls.resolveActor(session.agentId);
        if (resolved.soulClass !== 'unknown' && resolved.actorId === candidate) {
          return {
            actorId: resolved.actorId,
            inboxTarget: session.agentId,
            sessionId: session.id,
            lineageRootSessionId: session.id,
          };
        }
      }
      return null;
    },
  });
  const app = Fastify();
  app.addHook('onClose', () => db.close());
  app.register(sessionsPlugin, {
    deps: {
      sessions,
      actorSouls,
      metrics: { errors: 0 },
      activityLog,
      logger: {
        info: (message, metadata) => logs.push({ level: 'info', message, metadata }),
        error: (message, metadata) => logs.push({ level: 'error', message, metadata }),
      },
      parleyAutoTrigger: options.throwFromTrigger
        ? { evaluate: () => { throw new Error('injected trigger outage'); } }
        : trigger,
    },
  });
  return { app, db, sessions, actorSouls, tuples, inbox, parley, logs, published };
}

async function establishConflict(harness: ReturnType<typeof buildHarness>) {
  const owner = mintTestActor(harness.actorSouls, 'claim-owner');
  const challenger = mintTestActor(harness.actorSouls, 'claim-challenger');
  const ownerSession = (await harness.app.inject({
    method: 'POST',
    url: '/sessions',
    headers: owner.headers,
    payload: { purpose: 'hold the shared file', files: ['lib/shared.ts'] },
  })).json();
  const challengerSession = (await harness.app.inject({
    method: 'POST',
    url: '/sessions',
    headers: challenger.headers,
    payload: { purpose: 'request the shared file' },
  })).json();
  return { owner, challenger, ownerSession, challengerSession };
}

describe('authenticated claim conflict automatic Parley', () => {
  test('creates exactly one tuple-backed Parley and one inbox summons per live actor across replay and force', async () => {
    const harness = buildHarness();
    const { owner, challenger, challengerSession } = await establishConflict(harness);
    const request = {
      method: 'POST' as const,
      url: `/sessions/${challengerSession.id}/files`,
      headers: challenger.headers,
      payload: { files: ['lib/shared.ts'] },
    };

    const first = await harness.app.inject(request);
    const replay = await harness.app.inject(request);
    expect(first.statusCode).toBe(409);
    expect(first.json().code).toBe('FILE_CONFLICT');
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toEqual(first.json());

    const forced = await harness.app.inject({
      ...request,
      payload: { files: ['lib/shared.ts'], force: true },
    });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().conflicts).toHaveLength(1);

    const parleys = harness.parley.list({ harbor: 'local' });
    expect(parleys).toHaveLength(1);
    const parleyId = parleys[0].parley.parleyId;
    expect(harness.tuples.rd(['parley:opened', parleyId, '*'], { harbor: 'local' })).toHaveLength(1);
    expect(harness.tuples.rd(['parley:summons', parleyId, '*', '*'], { harbor: 'local' })).toHaveLength(2);
    expect(harness.inbox.list(owner.actorId).messages).toHaveLength(1);
    expect(harness.inbox.list(challenger.actorId).messages).toHaveLength(1);
    expect(harness.inbox.list(owner.actorId).messages[0]).not.toHaveProperty('deliveryKey');
    expect(harness.inbox.list(challenger.actorId).messages[0]).not.toHaveProperty('deliveryKey');
    expect(harness.db.prepare('SELECT delivery_key FROM agent_inbox WHERE agent_id = ?')
      .get(owner.actorId)).toEqual({ delivery_key: `parley_summons:${parleyId}:${owner.actorId}` });
    expect(harness.db.prepare('SELECT delivery_key FROM agent_inbox WHERE agent_id = ?')
      .get(challenger.actorId)).toEqual({ delivery_key: `parley_summons:${parleyId}:${challenger.actorId}` });
    expect(harness.published).toHaveLength(2);
    expect(harness.published.every((message) => message.signal === 'report')).toBe(true);
    expect(harness.published.every((message) => !Object.prototype.hasOwnProperty.call(
      message,
      'deliveryKey',
    ))).toBe(true);
    await harness.app.close();
  });

  test('keeps canonical claim actors separate from live session inbox identities', async () => {
    const harness = buildHarness();
    const owner = mintTestActor(harness.actorSouls, 'claim-owner-delivery');
    const challenger = mintTestActor(harness.actorSouls, 'claim-challenger-delivery');
    const ownerSession = (await harness.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: owner.headers,
      payload: {
        purpose: 'hold actor-addressed file',
        agentId: 'claim-owner-delivery',
        files: ['lib/actor-addressed.ts'],
      },
    })).json();
    const challengerSession = (await harness.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: challenger.headers,
      payload: {
        purpose: 'challenge actor-addressed file',
        agentId: 'claim-challenger-delivery',
      },
    })).json();

    const response = await harness.app.inject({
      method: 'POST',
      url: `/sessions/${challengerSession.id}/files`,
      headers: challenger.headers,
      payload: { agentId: 'claim-challenger-delivery', files: ['lib/actor-addressed.ts'] },
    });

    expect(response.statusCode).toBe(409);
    const records = harness.parley.list({ harbor: 'local' });
    expect(records).toHaveLength(1);
    expect(records[0].parley.parties).toEqual([owner.actorId, challenger.actorId].sort());
    expect(records[0].parley.automatic?.participants).toEqual([
      {
        actorId: owner.actorId,
        inboxTarget: 'claim-owner-delivery',
        sessionId: ownerSession.id,
        lineageRootSessionId: ownerSession.id,
      },
      {
        actorId: challenger.actorId,
        inboxTarget: 'claim-challenger-delivery',
        sessionId: challengerSession.id,
        lineageRootSessionId: challengerSession.id,
      },
    ].sort((a, b) => a.actorId.localeCompare(b.actorId)));
    expect(harness.inbox.list(owner.actorId).messages).toHaveLength(0);
    expect(harness.inbox.list(challenger.actorId).messages).toHaveLength(0);
    expect(harness.inbox.list('claim-owner-delivery').messages).toHaveLength(1);
    expect(harness.inbox.list('claim-challenger-delivery').messages).toHaveLength(1);
    await harness.app.close();
  });

  test('preserves the original FILE_CONFLICT response and enforcement when the trigger fails', async () => {
    const harness = buildHarness({ throwFromTrigger: true });
    const { challenger, challengerSession } = await establishConflict(harness);
    const response = await harness.app.inject({
      method: 'POST',
      url: `/sessions/${challengerSession.id}/files`,
      headers: challenger.headers,
      payload: { files: ['lib/shared.ts'] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      success: false,
      error: 'File conflicts detected',
      code: 'FILE_CONFLICT',
      hint: 'Use force=true to claim files anyway',
    });
    expect(harness.sessions.getFileConflicts(['lib/shared.ts']).conflicts).toHaveLength(1);
    expect(harness.parley.list({ harbor: 'local' })).toHaveLength(0);
    expect(harness.logs).toContainEqual(expect.objectContaining({
      level: 'error',
      message: 'parley_auto_trigger_failed',
      metadata: expect.objectContaining({ reason: 'injected trigger outage' }),
    }));
    await harness.app.close();
  });

  test('fires once for a successful non-force region conflict and replays the same observation', async () => {
    const harness = buildHarness();
    const owner = mintTestActor(harness.actorSouls, 'region-owner');
    const challenger = mintTestActor(harness.actorSouls, 'region-challenger');
    const ownerSession = (await harness.app.inject({
      method: 'POST', url: '/sessions', headers: owner.headers, payload: { purpose: 'own region' },
    })).json();
    const challengerSession = (await harness.app.inject({
      method: 'POST', url: '/sessions', headers: challenger.headers, payload: { purpose: 'challenge region' },
    })).json();
    const ownerClaim = await harness.app.inject({
      method: 'POST',
      url: `/sessions/${ownerSession.id}/files`,
      headers: owner.headers,
      payload: { regions: [{ path: 'lib/region.ts', startLine: 10, endLine: 20 }] },
    });
    expect(ownerClaim.statusCode).toBe(200);

    const request = {
      method: 'POST' as const,
      url: `/sessions/${challengerSession.id}/files`,
      headers: challenger.headers,
      payload: { regions: [{ path: 'lib/region.ts', startLine: 15, endLine: 25 }] },
    };
    const first = await harness.app.inject(request);
    const replay = await harness.app.inject(request);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ success: true, claimed: ['lib/region.ts'] });
    expect(first.json().conflicts).toHaveLength(1);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().conflicts).toEqual(first.json().conflicts);

    const parleys = harness.parley.list({ harbor: 'local' });
    expect(parleys).toHaveLength(1);
    const parleyId = parleys[0].parley.parleyId;
    expect(harness.tuples.rd(['parley:opened', parleyId, '*'], { harbor: 'local' })).toHaveLength(1);
    expect(harness.tuples.rd(['parley:summons', parleyId, '*', '*'], { harbor: 'local' })).toHaveLength(2);
    expect(harness.inbox.list(owner.actorId).messages).toHaveLength(1);
    expect(harness.inbox.list(challenger.actorId).messages).toHaveLength(1);
    await harness.app.close();
  });

  test('keeps first-session FILE_CONFLICT at 409 without treating a credential as liveness', async () => {
    const harness = buildHarness();
    const owner = mintTestActor(harness.actorSouls, 'existing-owner');
    const newcomer = mintTestActor(harness.actorSouls, 'first-session-requester');
    await harness.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: owner.headers,
      payload: { purpose: 'existing claim', files: ['lib/first-session.ts'] },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: newcomer.headers,
      payload: { purpose: 'first request conflicts', files: ['lib/first-session.ts'] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('FILE_CONFLICT');
    expect(harness.tuples.rd(['parley:auto:reservation', '*', '*'], { harbor: 'local' })).toHaveLength(0);
    expect(harness.parley.list({ harbor: 'local' })).toHaveLength(0);
    expect(harness.logs).toContainEqual(expect.objectContaining({
      level: 'info',
      message: 'parley_auto_trigger_skipped',
      metadata: expect.objectContaining({
        actorId: newcomer.actorId,
        reason: 'verified requester has no active daemon session',
      }),
    }));
    await harness.app.close();
  });

  test('fires after a forced first-session claim makes the requester live and bounds replay', async () => {
    const harness = buildHarness();
    const owner = mintTestActor(harness.actorSouls, 'forced-create-owner');
    const newcomer = mintTestActor(harness.actorSouls, 'forced-create-newcomer');
    await harness.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: owner.headers,
      payload: { purpose: 'hold forced create file', files: ['lib/forced-create.ts'] },
    });

    const request = {
      method: 'POST' as const,
      url: '/sessions',
      headers: newcomer.headers,
      payload: {
        purpose: 'force conflicting first session',
        files: ['lib/forced-create.ts'],
        force: true,
      },
    };
    const first = await harness.app.inject(request);
    const replay = await harness.app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ success: true });
    expect(first.json().conflicts).toHaveLength(1);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ success: true });
    const liveActors = new Set(harness.sessions.list({
      status: 'active', allWorktrees: true, limit: 100,
    }).sessions.map((session) => session.agentId));
    expect(liveActors).toEqual(new Set([owner.actorId, newcomer.actorId]));

    const parleys = harness.parley.list({ harbor: 'local' });
    expect(parleys).toHaveLength(1);
    const parleyId = parleys[0].parley.parleyId;
    expect(harness.tuples.rd(['parley:opened', parleyId, '*'], { harbor: 'local' })).toHaveLength(1);
    expect(harness.tuples.rd(['parley:summons', parleyId, '*', '*'], { harbor: 'local' })).toHaveLength(2);
    expect(harness.inbox.list(owner.actorId).messages).toHaveLength(1);
    expect(harness.inbox.list(newcomer.actorId).messages).toHaveLength(1);
    await harness.app.close();
  });

  test('fails the whole claim observation closed when one conflict row is unresolvable', async () => {
    const harness = buildHarness();
    const { challenger, challengerSession } = await establishConflict(harness);
    const original = harness.sessions.getFileConflicts.bind(harness.sessions);
    (harness.sessions as unknown as { getFileConflicts: typeof original }).getFileConflicts = (files) => {
      const result = original(files);
      return {
        ...result,
        conflicts: [
          ...result.conflicts,
          {
            filePath: 'lib/shared.ts',
            sessionId: 'missing-daemon-session',
            claimedAt: Date.now(),
          },
        ],
      };
    };

    const response = await harness.app.inject({
      method: 'POST',
      url: `/sessions/${challengerSession.id}/files`,
      headers: challenger.headers,
      payload: { files: ['lib/shared.ts'] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('FILE_CONFLICT');
    expect(harness.tuples.rd(['parley:auto:reservation', '*', '*'], { harbor: 'local' })).toHaveLength(0);
    expect(harness.parley.list({ harbor: 'local' })).toHaveLength(0);
    expect(harness.logs).toContainEqual(expect.objectContaining({
      level: 'error',
      message: 'parley_auto_trigger_failed',
      metadata: expect.objectContaining({ conflictsCount: 2 }),
    }));
    await harness.app.close();
  });

  test('refuses an over-limit conflict set before G2 evaluation and preserves the 409', async () => {
    const harness = buildHarness();
    const { challenger, challengerSession } = await establishConflict(harness);
    const original = harness.sessions.getFileConflicts.bind(harness.sessions);
    (harness.sessions as unknown as { getFileConflicts: typeof original }).getFileConflicts = (files) => {
      const result = original(files);
      const conflict = result.conflicts[0];
      return {
        ...result,
        conflicts: Array.from(
          { length: CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs + 1 },
          () => ({ ...conflict }),
        ),
      };
    };

    const response = await harness.app.inject({
      method: 'POST',
      url: `/sessions/${challengerSession.id}/files`,
      headers: challenger.headers,
      payload: { files: ['lib/shared.ts'] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('FILE_CONFLICT');
    expect(response.json().conflicts).toHaveLength(CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs + 1);
    expect(harness.tuples.rd(['parley:auto:reservation', '*', '*'], { harbor: 'local' })).toHaveLength(0);
    expect(harness.parley.list({ harbor: 'local' })).toHaveLength(0);
    expect(harness.logs).toContainEqual(expect.objectContaining({
      level: 'error',
      message: 'parley_auto_trigger_failed',
      metadata: expect.objectContaining({
        reason: `claim conflict count exceeds bounded maximum ${CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs}`,
        conflictsCount: CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs + 1,
      }),
    }));
    await harness.app.close();
  });
});
