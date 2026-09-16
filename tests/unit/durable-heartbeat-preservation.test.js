import { afterEach, beforeEach, describe, expect, test, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';
import { createAgents, getDeadThresholdForStatus } from '../../lib/agents.js';
import { createSessions } from '../../lib/sessions.js';
import { createLocks } from '../../lib/locks.js';
import { createResurrection } from '../../lib/resurrection.js';
import { createHeartbeatDeathHandler } from '../../lib/agent-heartbeat-death.js';
import { ActivityType } from '../../lib/activity.js';
import { triageSalvageAgents, selectNextSalvageWork } from '../../cli/commands/resurrection.js';
import { resurrectionPlugin } from '../../routes/resurrection.js';

describe('heartbeat death preserves work, not execution readiness', () => {
  let db, sessions, agents, locks, resurrection;
  const body = 'fixture-shared-body';
  const actor = 'fixture-verified-actor';

  beforeEach(() => {
    db = createTestDb();
    agents = createAgents(db);
    sessions = createSessions(db);
    locks = createLocks(db);
    resurrection = createResurrection(db, { sessions });
    agents.register(body, { status: 'ready', name: 'Fixture body' });
  });
  afterEach(() => db.close());

  function start(purpose, { durable = false, agentId = body, identity = { verified: true, actorId: actor } } = {}) {
    const result = sessions.start(purpose, {
      agentId, durable, metadata: { identity }, files: [purpose + '.ts'],
    });
    expect(result.success).toBe(true);
    sessions.addNote(result.id, 'Retain this evidence', { type: 'decision' });
    return result.id;
  }
  function age() {
    const at = Date.now() - getDeadThresholdForStatus('ready') - 1_000;
    db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?').run(at, body);
    return at;
  }
  const raw = id => db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);

  test('mixed-body abandonment returns only actual ephemeral IDs and preserves durable bytes and claims', () => {
    const durable = start('durable', { durable: true });
    const ephemeral = start('ephemeral');
    const other = start('other-body', { agentId: 'another-body' });
    const before = sessions.get(durable);
    const durableRow = raw(durable);
    expect(sessions.abandonByAgent(body)).toEqual([ephemeral]);
    expect(raw(durable)).toEqual(durableRow);
    expect(sessions.get(durable)).toEqual(before);
    expect(sessions.get(ephemeral).session).toMatchObject({ status: 'abandoned', phase: 'abandoned' });
    expect(sessions.get(other).session.status).toBe('active');
    expect(sessions.abandonByAgent(body)).toEqual([]);
  });

  test('even an unverified durable context is not automatically abandoned', () => {
    const durable = start('unverified-durable', { durable: true, identity: { verified: false, actorId: actor } });
    const before = sessions.get(durable);
    expect(sessions.abandonByAgent(body)).toEqual([]);
    expect(sessions.get(durable)).toEqual(before);
  });

  test('omitted lifecycle remains ephemeral', () => {
    const ephemeral = start('legacy');
    expect(raw(ephemeral).is_durable).toBe(0);
    expect(sessions.abandonByAgent(body)).toEqual([ephemeral]);
  });

  test('general active-session lookup still includes both lifecycles for identity callers', () => {
    const durable = start('durable', { durable: true });
    const ephemeral = start('ephemeral');
    expect(sessions.activeSessionIdsByAgent(body).sort()).toEqual([durable, ephemeral].sort());
  });

  test('explicit durable end and abandon remain effective and release claims', () => {
    const complete = start('complete', { durable: true });
    const abandoned = start('abandon', { durable: true });
    expect(sessions.end(complete).success).toBe(true);
    expect(sessions.abandon(abandoned).success).toBe(true);
    expect(sessions.get(complete).session.status).toBe('completed');
    expect(sessions.get(abandoned).session.status).toBe('abandoned');
    for (const id of [complete, abandoned]) expect(sessions.get(id).files.every(f => f.releasedAt !== null)).toBe(true);
  });

  test('verified active durable row survives repeated cleanup without heartbeat or readiness refresh', () => {
    start('durable', { durable: true });
    const at = age();
    const before = db.prepare('SELECT * FROM agents WHERE id = ?').get(body);
    for (let i = 0; i < 2; i++) {
      const result = agents.cleanup(locks, { sessions });
      expect(result.cleaned).toBe(0);
      expect(result.cleanedAgentIds).toEqual([]);
      expect(result.retainedAgentIds).toEqual([body]);
      expect(db.prepare('SELECT * FROM agents WHERE id = ?').get(body)).toEqual(before);
      expect(agents.get(body).agent).toMatchObject({ isActive: false, isReady: false, lastHeartbeat: at });
      expect(agents.list({ activeOnly: true }).agents).toEqual([]);
    }
  });

  test.each([
    ['false verification', { verified: false, actorId: actor }],
    ['string verification', { verified: 'true', actorId: actor }],
    ['absent actor', { verified: true }],
    ['empty actor', { verified: true, actorId: '' }],
    ['whitespace actor', { verified: true, actorId: '   ' }],
  ])('directory retention requires a verified stamp: %s', (_label, identity) => {
    const id = start('unverified', { durable: true, identity });
    age();
    expect(agents.cleanup(locks, { sessions }).cleanedAgentIds).toEqual([body]);
    expect(sessions.get(id).session.status).toBe('active');
  });

  test('closed durable work does not retain a stale directory row', () => {
    const id = start('done', { durable: true });
    sessions.end(id);
    age();
    expect(agents.cleanup(locks, { sessions }).cleanedAgentIds).toEqual([body]);
  });

  test('retaining durable presence does not bypass stamped-lock ownership or expiration', () => {
    start('durable', { durable: true });
    locks.acquire('owned', { owner: body, ttl: 60_000, metadata: { actorId: actor } });
    locks.acquire('foreign', { owner: body, ttl: 60_000, metadata: { actorId: 'other-actor' } });
    age();
    const result = agents.cleanup(locks, { sessions });
    expect(result.cleaned).toBe(0);
    expect(result.releasedLocks).toBe(1);
    expect(locks.check('owned').held).toBe(false);
    expect(locks.check('foreign').held).toBe(true);
    db.prepare('UPDATE locks SET expires_at = ? WHERE name = ?').run(Date.now() - 1, 'foreign');
    expect(locks.check('foreign').held).toBe(false);
  });

  test('stale ephemeral directory cleanup remains unchanged', () => {
    start('ephemeral');
    age();
    expect(agents.cleanup(locks, { sessions }).cleanedAgentIds).toEqual([body]);
  });

  const dead = () => ({ id: body, name: 'Fixture body', lastHeartbeat: 0, status: 'ready' });
  const queueRow = () => db.prepare('SELECT * FROM resurrection_queue WHERE agent_id = ?').get(body);

  test('durable-only heartbeat expiry does not create a replacement queue entry', () => {
    start('durable', { durable: true });
    expect(resurrection.check(dead())).toMatchObject({ status: 'dormant', queued: false, holdReason: 'durable_session_active' });
    expect(queueRow()).toBeUndefined();
    expect(resurrection.pending().count).toBe(0);
  });

  test('a healthy durable process with no queue entry stays healthy', () => {
    start('durable', { durable: true });
    expect(resurrection.check({ ...dead(), lastHeartbeat: Date.now() })).toEqual({ status: 'healthy' });
    expect(queueRow()).toBeUndefined();
  });

  test.each(['claim', 'abandon', 'dismiss', 'complete'])('direct %s holds pending durable work before a sweep can run', method => {
    resurrection.check(dead());
    const before = queueRow();
    start('durable', { durable: true });
    expect(resurrection[method](body, 'replacement')).toMatchObject({ success: false, code: 'DURABLE_SESSION_ACTIVE' });
    expect(queueRow()).toEqual({ ...before, status: 'dormant', hold_reason: 'durable_session_active' });
  });

  test.each([false, true])('credentialed HTTP claim preserves the hold refusal and admitted flag (%s)', async admitted => {
    resurrection.check(dead());
    resurrection.attachSalvageCapsule(body, { nextPlan: ['Keep the original capsule'] });
    if (admitted) expect(resurrection.claim(body).success).toBe(true);
    const before = queueRow();
    start('durable', { durable: true });
    const actorSouls = createTestActorSouls(db);
    const caller = mintTestActor(actorSouls, 'fixture-http-claimer');
    const publish = jest.fn(() => ({ success: true }));
    const info = jest.fn();
    const app = Fastify();
    await app.register(resurrectionPlugin, { deps: {
      resurrection, actorSouls, messaging: { publish },
      logger: { info, error: jest.fn() }, metrics: { errors: 0 },
      activityLog: { log: jest.fn() },
    } });
    try {
      for (const prefix of ['salvage', 'resurrection']) {
        const response = await app.inject({
          method: 'POST', url: `/${prefix}/claim/${body}`,
          headers: caller.headers, payload: { newAgentId: 'fixture-http-claimer' },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({
          success: false, code: 'DURABLE_SESSION_ACTIVE',
          replacementAlreadyAdmitted: admitted,
        });
        expect(response.json().error).toContain('not implemented');
      }
      expect(publish).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(queueRow()).toEqual({
        ...before, status: admitted ? 'resurrecting' : 'dormant', hold_reason: 'durable_session_active',
      });
    } finally { await app.close(); }
  });

  test('preexisting pending queue is held without changing its capsule, ID, or attempts', () => {
    resurrection.check(dead());
    resurrection.attachSalvageCapsule(body, { nextPlan: ['Preserve me'], evidence: ['fixture'] });
    const before = queueRow();
    start('durable', { durable: true });
    expect(resurrection.check(dead())).toMatchObject({ status: 'dormant', queued: false });
    expect(queueRow()).toEqual({ ...before, status: 'dormant', hold_reason: 'durable_session_active' });
    expect(resurrection.pending().count).toBe(0);
    expect(resurrection.list().agents[0]).toMatchObject({ status: 'dormant', holdReason: 'durable_session_active', replacementAlreadyAdmitted: false });
    const held = queueRow();
    resurrection.check(dead());
    resurrection.check({ ...dead(), lastHeartbeat: Date.now() });
    resurrection.cleanup(-1);
    expect(queueRow()).toEqual(held);
  });

  test('retention running first after restart holds old pending evidence instead of deleting it', () => {
    resurrection.check(dead());
    db.prepare('UPDATE resurrection_queue SET metadata = ? WHERE agent_id = ?').run('{unparseable but preserved', body);
    const before = queueRow();
    start('durable', { durable: true });
    expect(resurrection.cleanup(-1).cleaned).toBe(0);
    expect(queueRow()).toEqual({ ...before, status: 'dormant', hold_reason: 'durable_session_active' });
  });

  test.each(['claim', 'abandon', 'dismiss', 'complete'])('%s cannot reopen or erase dormant recovery evidence', method => {
    resurrection.check(dead());
    start('durable', { durable: true });
    resurrection.check(dead());
    const before = queueRow();
    expect(resurrection[method](body, 'replacement')).toMatchObject({ success: false, code: 'DURABLE_SESSION_ACTIVE' });
    expect(queueRow()).toEqual(before);
  });

  test('already-admitted replacement retains status and attempt ownership, without claiming cancellation', () => {
    resurrection.check(dead());
    expect(resurrection.claim(body).success).toBe(true);
    const before = queueRow();
    start('durable', { durable: true });
    expect(resurrection.check(dead())).toMatchObject({ status: 'resurrecting', queued: false, replacementAlreadyAdmitted: true });
    expect(queueRow()).toEqual({ ...before, hold_reason: 'durable_session_active' });
    expect(resurrection.complete(body, 'replacement')).toMatchObject({ success: false, code: 'DURABLE_SESSION_ACTIVE' });
    expect(queueRow().status).toBe('resurrecting');
  });

  test('explicitly ending durable work and a healthy heartbeat do not silently re-enable held work', () => {
    resurrection.check(dead());
    const id = start('durable', { durable: true });
    resurrection.check(dead());
    sessions.end(id);
    const before = queueRow();
    resurrection.check({ ...dead(), lastHeartbeat: Date.now() });
    expect(resurrection.claim(body).success).toBe(false);
    expect(queueRow()).toEqual(before);
  });

  test('a caller-supplied durability hint is not proof for holding a queue', () => {
    expect(resurrection.check({ ...dead(), durable: true, identity: { verified: true, actorId: actor } }).status).toBe('dead');
    expect(resurrection.pending().count).toBe(1);
  });

  function actualServerSweep() {
    const messages = [], activity = [];
    const custodian = { onSessionEnd: jest.fn(async () => {}), onAgentDead: jest.fn(async () => {}) };
    const harbors = { leaveAll: jest.fn().mockReturnValueOnce(1).mockReturnValue(0) };
    const logger = { warn: jest.fn(), info: jest.fn() };
    const messaging = { cleanup() {}, publish: (channel, payload) => messages.push({ channel, payload: JSON.parse(payload) }) };
    const activityLog = { log: (type, entry) => activity.push({ type, ...entry }), cleanup() {} };
    const handler = createHeartbeatDeathHandler({ sessions, harbors, resurrection, messaging, logger, activityLog, custodian });
    // Execute the actual production cleanup function in an isolated dependency
    // context, not a copied approximation or the side-effectful full daemon.
    const source = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
    const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'cleanupStale');
    expect(fn).toBeTruthy();
    const registration = ast.statements.find(node => ts.isExpressionStatement(node)
      && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'resurrection.on'
      && node.expression.arguments[0]?.getText(ast) === "'agent:dead'");
    expect(registration.expression.arguments[1].getText(ast)).toBe('handleAgentHeartbeatDeath');
    resurrection.on('agent:dead', handler);
    const code = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const sweep = runInNewContext(code + '\ncleanupStale', {
      db, agents, sessions, locks, resurrection, messaging, activityLog, logger, ActivityType,
      getDeadThresholdForStatus, handleAgentHeartbeatDeath: handler, isInSleepGracePeriod: () => false,
      services: { cleanup: () => ({ cleaned: 0 }) }, obligationMonitor: { checkOverdue: () => ({ count: 0 }) },
      webhooks: { cleanup() {} }, agentInbox: { cleanup() {} }, observabilityMaintenance: { tick() {} },
      governor: { governed: () => { throw Error('Unexpected maintenance error'); } }, metrics: { total_cleanups: 0 },
    });
    return { sweep, messages, activity, custodian, harbors, handler };
  }

  test('actual server cleanup preserves mixed-body work and harvests only truly abandoned ephemeral IDs', () => {
    const durable = start('durable', { durable: true });
    const ephemeral = start('ephemeral');
    const before = sessions.get(durable);
    age();
    const h = actualServerSweep();
    h.sweep();
    expect(sessions.get(durable)).toEqual(before);
    expect(sessions.get(ephemeral).session.status).toBe('abandoned');
    expect(h.custodian.onSessionEnd.mock.calls).toEqual([[ephemeral]]);
    expect(h.custodian.onAgentDead).not.toHaveBeenCalled();
    expect(h.harbors.leaveAll).toHaveBeenCalledWith(body);
    expect(queueRow()).toBeUndefined();
    expect(agents.get(body).agent).toMatchObject({ isActive: false, isReady: false });
    expect(h.messages.every(m => m.payload.event === 'dormant')).toBe(true);
    expect(h.messages[0].payload).toMatchObject({ abandonedSessionIds: [ephemeral], preservedDurableSessionIds: [durable] });
    expect(h.activity.filter(e => e.type === ActivityType.SESSION_END).map(e => e.metadata.abandonedSessionIds)).toEqual([[ephemeral]]);
    h.sweep();
    expect(h.custodian.onSessionEnd).toHaveBeenCalledTimes(1);
    expect(h.messages).toHaveLength(2);
  });

  test('actual server ephemeral-only death still requests existing policy-controlled recovery', () => {
    const ephemeral = start('ephemeral');
    age();
    const h = actualServerSweep();
    h.sweep();
    expect(h.custodian.onSessionEnd.mock.calls).toEqual([[ephemeral]]);
    expect(h.custodian.onAgentDead).toHaveBeenCalledTimes(1);
    expect(resurrection.pending().count).toBe(1);
    expect(h.messages[0].payload).toMatchObject({ event: 'dead', abandonedSessionIds: [ephemeral], preservedDurableSessionIds: [] });
    expect(agents.get(body).success).toBe(false);
  });

  test('actual server note selection never puts durable notes in replacement context', () => {
    // Unverified durable records are not trusted proof of directory ownership
    // or a queue hold, but even their notes must not become replacement work.
    const durable = start('durable', { durable: true, identity: { verified: false } });
    const ephemeral = start('ephemeral');
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now() + 1_000, durable);
    age();
    actualServerSweep().sweep();
    expect(queueRow().session_id).toBe(ephemeral);
    expect(sessions.get(durable).session.status).toBe('active');
  });

  test('held entries are visible in triage without an executable claim or dismiss recommendation', () => {
    resurrection.check(dead());
    start('durable', { durable: true });
    resurrection.check(dead());
    const plan = triageSalvageAgents(resurrection.list().agents);
    const bucket = plan.buckets.find(b => b.id === 'durable-held');
    expect(bucket.count).toBe(1);
    expect(bucket.agents[0].command).not.toMatch(/pd salvage (claim|dismiss|complete|abandon)/);
    expect(plan.summary.statuses.dormant).toBe(1);
    expect(selectNextSalvageWork(plan)).toBeNull();
  });
});
