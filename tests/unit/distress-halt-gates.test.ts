/**
 * ADR-0132 phase 0 — "silence during HALT is not a trigger".
 *
 * Every daemon-side organ that turns a missed heartbeat into an action must
 * consult the halt sentinel first and do NOTHING while it is hoisted:
 *
 *   - the reaper       (lib/agents.ts cleanup)            — no deletes, no lock releases
 *   - resurrection     (lib/resurrection.ts check/claim)  — no queueing, no claiming
 *   - the death handler (lib/agent-heartbeat-death.ts)    — no abandon, no respawn
 *   - the custodian    (lib/knowledge-custodian.ts)       — no auto-resurrect, no approval ask
 *
 * Each organ takes an injectable `haltActive` (tested both ways) and defaults
 * to the real sentinel in lib/distress.ts — the last block proves that
 * default wiring against a real sentinel file under a scratch PD_HOME. No
 * daemon is started.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import { createAgents, DEAD_THRESHOLDS } from '../../lib/agents.js';
import { createLocks } from '../../lib/locks.js';
import { createResurrection, RESURRECTION_HALTED_ERROR } from '../../lib/resurrection.js';
import { createHeartbeatDeathHandler } from '../../lib/agent-heartbeat-death.js';
import { KnowledgeCustodian } from '../../lib/knowledge-custodian.js';

const DEAD_AGO = (DEAD_THRESHOLDS.ready ?? 4 * 60 * 60 * 1000) + 60_000;

function agePastDeath(db: any, agentId: string) {
  db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?').run(Date.now() - DEAD_AGO, agentId);
}

let db: any;
beforeEach(() => { db = createTestDb(); });
afterEach(() => { db.close(); });

// ─── Reaper ──────────────────────────────────────────────────────────────────

describe('reaper (agents.cleanup)', () => {
  test('no sentinel: a dead agent is reaped and its unstamped lock released (the ladder still works)', () => {
    const agents = createAgents(db, { haltActive: () => false });
    const locks = createLocks(db);
    agents.register('quiet-one');
    expect(locks.acquire('build', { owner: 'quiet-one' }).success).toBe(true);
    agePastDeath(db, 'quiet-one');

    const result = agents.cleanup(locks);
    expect(result).toMatchObject({ cleaned: 1, cleanedAgentIds: ['quiet-one'], releasedLocks: 1, halted: false });
    expect(agents.get('quiet-one').success).toBe(false);
  });

  test('sentinel hoisted: the same dead agent is left alone — no delete, no lock release', () => {
    const agents = createAgents(db, { haltActive: () => true });
    const locks = createLocks(db);
    agents.register('quiet-one');
    expect(locks.acquire('build', { owner: 'quiet-one' }).success).toBe(true);
    agePastDeath(db, 'quiet-one');

    const result = agents.cleanup(locks);
    expect(result).toMatchObject({ cleaned: 0, cleanedAgentIds: [], retainedAgentIds: [], releasedLocks: 0, halted: true });
    expect(result.message).toMatch(/halted/i);
    expect(agents.get('quiet-one').success).toBe(true);
    expect(locks.list({ owner: 'quiet-one' }).locks).toHaveLength(1);
  });

  test('the halt is consulted on every sweep, so lowering it resumes the ladder with the same facts', () => {
    let halted = true;
    const agents = createAgents(db, { haltActive: () => halted });
    agents.register('quiet-one');
    agePastDeath(db, 'quiet-one');
    expect(agents.cleanup().halted).toBe(true);
    expect(agents.get('quiet-one').success).toBe(true);
    halted = false;
    expect(agents.cleanup()).toMatchObject({ cleaned: 1, halted: false });
    expect(agents.get('quiet-one').success).toBe(false);
  });
});

// ─── Resurrection ────────────────────────────────────────────────────────────

describe('resurrection (check / claim)', () => {
  const deadAgent = () => ({ id: 'a1', name: 'a1', lastHeartbeat: Date.now() - DEAD_AGO, status: 'ready', identityProject: 'acme' });

  test('no sentinel: a dead agent is queued, announced, and claimable', () => {
    const resurrection = createResurrection(db, { haltActive: () => false });
    const dead = jest.fn();
    resurrection.on('agent:dead', dead);
    expect(resurrection.check(deadAgent())).toEqual({ status: 'dead', queued: true });
    expect(dead).toHaveBeenCalledTimes(1);
    expect(resurrection.pending().count).toBe(1);
    expect(resurrection.claim('a1').success).toBe(true);
  });

  test('sentinel hoisted: check() queues nothing and emits nothing', () => {
    const resurrection = createResurrection(db, { haltActive: () => true });
    const dead = jest.fn();
    const stale = jest.fn();
    resurrection.on('agent:dead', dead);
    resurrection.on('agent:stale', stale);
    expect(resurrection.check(deadAgent())).toEqual({ status: 'halted', queued: false, halted: true });
    expect(dead).not.toHaveBeenCalled();
    expect(stale).not.toHaveBeenCalled();
    expect(resurrection.pending().count).toBe(0);
    expect(resurrection.list().count).toBe(0);
  });

  test('sentinel hoisted: claim() refuses an already-pending entry and leaves it pending', () => {
    let halted = false;
    const resurrection = createResurrection(db, { haltActive: () => halted });
    resurrection.check(deadAgent());
    halted = true;
    expect(resurrection.claim('a1')).toEqual({ success: false, error: RESURRECTION_HALTED_ERROR, halted: true });
    expect(resurrection.pending().agents[0]).toMatchObject({ id: 'a1', status: 'pending' });
    // Reading the queue is still allowed — listening is not spending.
    expect(resurrection.list().count).toBe(1);
    halted = false;
    expect(resurrection.claim('a1').success).toBe(true);
  });
});

// ─── Heartbeat-death handler ─────────────────────────────────────────────────

describe('heartbeat death handler', () => {
  function harness(haltActive: () => boolean) {
    const abandonByAgent = jest.fn(() => ['s1']);
    const leaveAll = jest.fn(() => 1);
    const holdForDurableSessions = jest.fn(() => ({ held: false, changed: false, replacementAlreadyAdmitted: false }));
    const publish = jest.fn();
    const onAgentDead = jest.fn(async () => {});
    const onSessionEnd = jest.fn(async () => {});
    const handler = createHeartbeatDeathHandler({
      sessions: { abandonByAgent, activeDurableSessionIdsByAgent: () => [] },
      harbors: { leaveAll },
      resurrection: { holdForDurableSessions, getSalvageCapsule: () => undefined },
      messaging: { publish },
      logger: { warn: () => {} },
      activityLog: { log: () => {} },
      custodian: { onSessionEnd, onAgentDead },
      haltActive,
    });
    return { handler, abandonByAgent, leaveAll, holdForDurableSessions, publish, onAgentDead, onSessionEnd };
  }
  const expired = { id: 'a1', name: 'a1', purpose: null, lastHeartbeat: 0, staleSince: 1, identityProject: 'acme' };

  test('no sentinel: sessions are abandoned, harbors left, and the custodian asked to resurrect', () => {
    const h = harness(() => false);
    const result = h.handler(expired);
    expect(result).toMatchObject({ abandonedSessionIds: ['s1'], queuedForReplacement: true });
    expect(h.abandonByAgent).toHaveBeenCalledWith('a1');
    expect(h.leaveAll).toHaveBeenCalledWith('a1');
    expect(h.onAgentDead).toHaveBeenCalledWith('a1', 'acme', undefined);
    expect(h.publish).toHaveBeenCalled();
  });

  test('sentinel hoisted: nothing is abandoned, left, published, or resurrected', () => {
    const h = harness(() => true);
    const result = h.handler(expired);
    expect(result).toEqual({
      abandonedSessionIds: [], preservedDurableSessionIds: [], queuedForReplacement: false,
      replacementAlreadyAdmitted: false, halted: true,
    });
    expect(h.abandonByAgent).not.toHaveBeenCalled();
    expect(h.leaveAll).not.toHaveBeenCalled();
    expect(h.holdForDurableSessions).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.onAgentDead).not.toHaveBeenCalled();
    expect(h.onSessionEnd).not.toHaveBeenCalled();
  });
});

// ─── Custodian ───────────────────────────────────────────────────────────────

describe('custodian resurrect duty', () => {
  function custodian(haltActive: () => boolean, policy = 'auto') {
    const messages: Array<{ channel: string; payload: any }> = [];
    const logs: string[] = [];
    const instance = new KnowledgeCustodian({
      db,
      logger: { info: (m: string) => { logs.push(m); }, error() {} },
      episodicMemory: { archiveExpired() { return 0; }, remember() { return { id: 1 }; } } as any,
      operatorPermissions: {
        check: () => policy, record() {}, accept() {}, denyMeta() {}, listCandidates: () => [], list: () => [],
      } as any,
      messaging: { publish(channel: string, payload: any) { messages.push({ channel, payload }); } },
      haltActive,
    });
    return { instance, messages, logs };
  }

  test('no sentinel, policy auto: the resurrection context is delivered (baseline)', async () => {
    const c = custodian(() => false);
    await c.instance.onAgentDead('agent-a', 'acme/api', { nextPlan: ['resume'] });
    expect(c.messages.map((m) => m.channel)).toContain('agent:agent-a:inbox');
  });

  test('sentinel hoisted, policy auto: no resurrection context, no approval request, one log line', async () => {
    const c = custodian(() => true);
    await c.instance.onAgentDead('agent-a', 'acme/api', { nextPlan: ['resume'] });
    expect(c.messages).toEqual([]);
    expect(c.logs.some((l) => /halted/.test(l))).toBe(true);
  });

  test('sentinel hoisted, policy ask: not even the approval request goes out', async () => {
    const c = custodian(() => true, 'ask');
    await c.instance.onAgentDead('agent-a', 'acme/api', { nextPlan: ['resume'] });
    expect(c.messages).toEqual([]);
  });
});

// ─── Default wiring: the real sentinel ───────────────────────────────────────

describe('default wiring reads the real sentinel under PD_HOME', () => {
  let scratch: string;
  const savedHome = process.env.PD_HOME;
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'pd-halt-gate-'));
    process.env.PD_HOME = join(scratch, 'home');
    mkdirSync(process.env.PD_HOME, { recursive: true });
  });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.PD_HOME; else process.env.PD_HOME = savedHome;
    rmSync(scratch, { recursive: true, force: true });
  });

  test('with no HALT file every organ acts; after `touch $PD_HOME/HALT` every organ stands down', () => {
    const agents = createAgents(db);
    const resurrection = createResurrection(db);
    agents.register('quiet-one');
    agePastDeath(db, 'quiet-one');

    // Hoist by hand, exactly as the A0 runbook does: existence is the signal.
    writeFileSync(join(process.env.PD_HOME!, 'HALT'), '2026-09-05T14:02:11Z operator:erich SECURITE HALT reason=spend-runaway\n');
    expect(agents.cleanup().halted).toBe(true);
    expect(agents.get('quiet-one').success).toBe(true);
    expect(resurrection.check({ id: 'quiet-one', name: 'q', lastHeartbeat: Date.now() - DEAD_AGO })).toMatchObject({ halted: true });
    expect(resurrection.pending().count).toBe(0);

    rmSync(join(process.env.PD_HOME!, 'HALT'));
    expect(resurrection.check({ id: 'quiet-one', name: 'q', lastHeartbeat: Date.now() - DEAD_AGO })).toEqual({ status: 'dead', queued: true });
    expect(agents.cleanup()).toMatchObject({ cleaned: 1, halted: false });
  });
});
