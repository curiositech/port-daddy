/**
 * Unit Tests: custodian.onAgentDead wiring + ADR-0040 trust-boundary fixes.
 *
 * Covers the security-critical behavior added when wiring the (previously dark)
 * auto-resurrect path live in server.ts's agent:dead handler:
 *   - scope is the AUTHENTICATED identityProject argument, never the forgeable capsule
 *   - an empty/unknown scope or a `high` projected tier can never silently auto-resurrect
 *   - the resurrect_request carries a REAL projected cost/tier, not a hardcoded $0.02
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { KnowledgeCustodian } from '../../lib/knowledge-custodian.js';

let db: any;
let messages: Array<{ channel: string; payload: any }>;

function makeStubPerms(policy: string, checkSink: any[]) {
  return {
    check(kind: string, identityProject: string, estimatedCostUsd: number) {
      checkSink.push({ kind, identityProject, estimatedCostUsd });
      return policy;
    },
    record() {},
    accept() {},
    denyMeta() {},
    listCandidates() { return []; },
    list() { return []; },
  };
}

function makeCustodian(policy: string, checkSink: any[] = []) {
  messages = [];
  return new KnowledgeCustodian({
    db,
    logger: { info() {}, error() {} },
    episodicMemory: { archiveExpired() { return 0; }, remember() { return { id: 1 }; } } as any,
    operatorPermissions: makeStubPerms(policy, checkSink) as any,
    messaging: { publish(channel: string, payload: any) { messages.push({ channel, payload }); } },
  });
}

// Seed the tables projectResurrectCost reads so it can project a real tier.
function seedAgentSpend(agentId: string, project: string, backend: string, costUsd: number) {
  db.prepare(
    `INSERT OR REPLACE INTO agents (id, name, registered_at, last_heartbeat, identity_project)
     VALUES (?, ?, ?, ?, ?)`
  ).run(agentId, agentId, Date.now(), Date.now(), project);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_events (
      id TEXT PRIMARY KEY, ts INTEGER NOT NULL, backend TEXT NOT NULL, model TEXT NOT NULL,
      project_name TEXT, cost_usd REAL NOT NULL DEFAULT 0
    )
  `);
  db.prepare(
    `INSERT INTO cost_events (id, ts, backend, model, project_name, cost_usd) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(`${agentId}-ce`, Date.now(), backend, 'm', project, costUsd);
}

beforeEach(() => { db = createTestDb(); });
afterEach(() => { db.close(); });

describe('onAgentDead — auto path', () => {
  test('non-empty scope + fast tier + policy auto → publishes resurrection_context to the agent inbox', async () => {
    const custodian = makeCustodian('auto');
    await custodian.onAgentDead('agent-a', 'acme/api', { nextPlan: ['resume'] });

    const inbox = messages.find(m => m.channel === 'agent:agent-a:inbox');
    expect(inbox).toBeTruthy();
    expect(inbox!.payload.type).toBe('resurrection_context');
    // No approval request when auto-resurrecting a trusted, low-cost spawn.
    expect(messages.find(m => m.channel === 'operator:approvals')).toBeFalsy();
  });
});

describe('onAgentDead — trust boundary (scope collapse regression)', () => {
  test('check() receives the AUTHENTICATED scope argument, never the forged capsule.identityProject', async () => {
    const checkSink: any[] = [];
    const custodian = makeCustodian('auto', checkSink);
    await custodian.onAgentDead('agent-b', 'acme/api', { identityProject: 'evil/global', nextPlan: ['x'] });

    expect(checkSink).toHaveLength(1);
    expect(checkSink[0].identityProject).toBe('acme/api');
    expect(checkSink[0].identityProject).not.toBe('evil/global');
  });
});

describe('onAgentDead — escalation guard', () => {
  test('empty scope downgrades policy auto → ask (no silent global auto-resurrect)', async () => {
    const custodian = makeCustodian('auto');
    await custodian.onAgentDead('agent-c', '', { nextPlan: ['x'] });

    expect(messages.find(m => m.channel === 'operator:approvals')).toBeTruthy();
    expect(messages.find(m => m.channel === 'agent:agent-c:inbox')).toBeFalsy();
  });

  test('high projected tier downgrades policy auto → ask even with a non-empty scope', async () => {
    seedAgentSpend('agent-d', 'acme/api', 'openai', 0.50); // metered, >= high threshold
    const custodian = makeCustodian('auto');
    await custodian.onAgentDead('agent-d', 'acme/api', { nextPlan: ['x'] });

    const approval = messages.find(m => m.channel === 'operator:approvals');
    expect(approval).toBeTruthy();
    expect(approval!.payload.tier).toBe('high');
    expect(messages.find(m => m.channel === 'agent:agent-d:inbox')).toBeFalsy();
  });
});

describe('onAgentDead — cost gate', () => {
  test('resurrect_request carries the REAL projected cost/tier, not the removed $0.02 constant', async () => {
    seedAgentSpend('agent-e', 'acme/api', 'openai', 0.50);
    const custodian = makeCustodian('ask');
    await custodian.onAgentDead('agent-e', 'acme/api', { nextPlan: ['x'] });

    const approval = messages.find(m => m.channel === 'operator:approvals');
    expect(approval).toBeTruthy();
    expect(approval!.payload.estimatedCostUsd).toBe(0.50);
    expect(approval!.payload.estimatedCostUsd).not.toBe(0.02);
    expect(approval!.payload.tier).toBe('high');
  });

  test('subscription backend projects ~$0 at fast tier', async () => {
    seedAgentSpend('agent-f', 'acme/api', 'cli:claude-code', 0.001);
    const custodian = makeCustodian('ask');
    await custodian.onAgentDead('agent-f', 'acme/api', { nextPlan: ['x'] });

    const approval = messages.find(m => m.channel === 'operator:approvals');
    expect(approval!.payload.tier).toBe('fast');
    expect(approval!.payload.estimatedCostUsd).toBe(0.001);
  });
});

describe('onAgentDead — ask / deny', () => {
  test('policy ask publishes a resurrect_request and no inbox message', async () => {
    const custodian = makeCustodian('ask');
    await custodian.onAgentDead('agent-g', 'acme/api', { nextPlan: ['x'] });
    expect(messages.find(m => m.channel === 'operator:approvals')).toBeTruthy();
    expect(messages.find(m => m.channel === 'agent:agent-g:inbox')).toBeFalsy();
  });

  test('policy deny publishes nothing', async () => {
    const custodian = makeCustodian('deny');
    await custodian.onAgentDead('agent-h', 'acme/api', { nextPlan: ['x'] });
    expect(messages).toHaveLength(0);
  });
});
