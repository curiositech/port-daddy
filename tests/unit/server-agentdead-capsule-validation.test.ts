/**
 * Unit Tests: capsule validation at the server.ts agent:dead call site (PR #2596 follow-up).
 *
 * pd-qa flagged (MEDIUM, PR #2596 review): server.ts's agent:dead handler passed
 * `resurrection.getSalvageCapsule(agent.id)` straight into `custodian.onAgentDead()`
 * without validating the capsule's shape first. `getSalvageCapsule` only guarantees the
 * value is *some* plain object (see resurrection.ts — it checks `typeof === 'object'`,
 * nothing more), never that it matches the `SelfSalvageCapsule` contract defined in
 * telos-salvage.ts. server.ts now runs the raw capsule through the existing
 * `normalizeSelfSalvage()` producer contract (the same normalizer telos-salvage-wiring
 * .test.ts already exercises for the *attach* path) before handing it to the custodian.
 *
 * This file proves that fix holds: a malformed or corrupted capsule read back from the
 * resurrection queue's metadata (e.g. legacy shape, hand-edited DB row, a future bug in
 * whatever eventually calls attachSalvageCapsule) never crashes normalizeSelfSalvage,
 * never crashes the downstream custodian.onAgentDead() call, and never lets a forged
 * field (like a spoofed identityProject) leak through into the resurrect flow's messaging
 * output.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createResurrection } from '../../lib/resurrection.js';
import { normalizeSelfSalvage } from '../../lib/telos-salvage.js';
import { KnowledgeCustodian } from '../../lib/knowledge-custodian.js';

let db: any;
let resurrection: ReturnType<typeof createResurrection>;
let messages: Array<{ channel: string; payload: any }>;

function makeCustodian() {
  messages = [];
  return new KnowledgeCustodian({
    db,
    logger: { info() {}, error() {} },
    episodicMemory: { archiveExpired() { return 0; }, remember() { return { id: 1 }; } } as any,
    operatorPermissions: {
      check() { return 'auto'; },
      record() {},
    } as any,
    messaging: { publish(channel: string, payload: any) { messages.push({ channel, payload }); } },
  });
}

function queueDead(agentId: string) {
  const res = resurrection.check({ id: agentId, name: agentId, lastHeartbeat: 0, status: 'ready' });
  expect(res.status).toBe('dead');
}

// Mirrors the exact server.ts agent:dead call-site fix: read the raw capsule, normalize
// it, and only ever hand the *normalized* result to the custodian.
async function runAgentDeadCallSite(agentId: string, scope: string, custodian: KnowledgeCustodian) {
  const rawCapsule = resurrection.getSalvageCapsule(agentId);
  const salvage = normalizeSelfSalvage(rawCapsule);
  await custodian.onAgentDead(agentId, scope, salvage.capsule as Record<string, unknown> | undefined);
  return salvage;
}

beforeEach(() => {
  db = createTestDb();
  resurrection = createResurrection(db);
});
afterEach(() => { db.close(); });

describe('normalizeSelfSalvage — never throws on malformed input', () => {
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['empty object', {}],
    ['array masquerading as an object', ['not', 'a', 'capsule']],
    ['wrong-typed fields', { telosVerdict: 42, doable: {}, nextPlan: 'a bare string, not an array', evidence: 12345 }],
    ['invalid enum string', { telosVerdict: 'gibberish', doable: 'yes', nextPlan: ['x'] }],
    ['deeply nested garbage', { telosVerdict: { nested: { deep: true } } }],
    ['oversized fields', { whyStopped: 'x'.repeat(50_000), nextPlan: Array(50).fill('y'.repeat(2000)) }],
  ])('%s does not throw and returns a well-formed result', (_label, input) => {
    expect(() => normalizeSelfSalvage(input)).not.toThrow();
    const result = normalizeSelfSalvage(input);
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.shouldQueue).toBe('boolean');
    if (result.success && result.capsule) {
      expect(['fulfilled', 'partial', 'not-fulfilled']).toContain(result.capsule.telosVerdict);
      expect(['yes', 'no', 'unknown']).toContain(result.capsule.doable);
      expect(Array.isArray(result.capsule.nextPlan)).toBe(true);
      expect(Array.isArray(result.capsule.evidence)).toBe(true);
    }
  });
});

describe('server.ts agent:dead call-site fix — malformed capsule never reaches the custodian raw', () => {
  test('undefined capsule (nothing ever attached) flows through as undefined, no crash', async () => {
    queueDead('agent-no-capsule');
    const custodian = makeCustodian();

    await expect(runAgentDeadCallSite('agent-no-capsule', 'acme/api', custodian)).resolves.toBeTruthy();

    const inbox = messages.find(m => m.channel === 'agent:agent-no-capsule:inbox');
    expect(inbox).toBeTruthy();
    expect(inbox!.payload.type).toBe('resurrection_context');
  });

  test('malformed capsule (wrong-typed fields written directly to metadata) is normalized, not passed raw', async () => {
    queueDead('agent-malformed');
    // Simulate corrupted/legacy metadata that bypassed normalizeSelfSalvage entirely —
    // e.g. a hand-edited row, an older schema, or a future producer bug.
    resurrection.attachSalvageCapsule('agent-malformed', {
      telosVerdict: 123 as any,
      doable: { weird: true } as any,
      nextPlan: 'not an array, a bare string',
    } as any);

    const custodian = makeCustodian();
    const salvage = await runAgentDeadCallSite('agent-malformed', 'acme/api', custodian);

    // normalizeSelfSalvage degrades the garbage into a well-typed default rather than
    // erroring out entirely (a non-string/invalid telosVerdict falls back to 'partial').
    expect(salvage.success).toBe(true);
    expect(salvage.capsule?.telosVerdict).toBe('partial');
    expect(Array.isArray(salvage.capsule?.nextPlan)).toBe(true);

    const inbox = messages.find(m => m.channel === 'agent:agent-malformed:inbox');
    expect(inbox).toBeTruthy();
    // The capsule handed to the custodian (and republished to the agent inbox) is the
    // normalized shape, never the raw `{ telosVerdict: 123, doable: {...}, nextPlan: '...' }`.
    expect(inbox!.payload.capsule.telosVerdict).toBe('partial');
    expect(Array.isArray(inbox!.payload.capsule.nextPlan)).toBe(true);
  });

  test('capsule with a genuinely invalid enum value degrades to undefined respawn context, never throws', async () => {
    queueDead('agent-invalid-enum');
    resurrection.attachSalvageCapsule('agent-invalid-enum', { telosVerdict: 'not-a-real-verdict' } as any);

    const custodian = makeCustodian();
    const salvage = await runAgentDeadCallSite('agent-invalid-enum', 'acme/api', custodian);

    expect(salvage.success).toBe(false);
    expect(salvage.capsule).toBeUndefined();

    const inbox = messages.find(m => m.channel === 'agent:agent-invalid-enum:inbox');
    expect(inbox).toBeTruthy();
    expect(inbox!.payload.capsule).toBeUndefined();
  });

  test('capsule is never treated as identity — a forged identityProject field cannot smuggle a fake scope through', async () => {
    queueDead('agent-spoofed-scope');
    resurrection.attachSalvageCapsule('agent-spoofed-scope', {
      identityProject: 'evil/global',
      telosVerdict: 'not-fulfilled',
      doable: 'yes',
      nextPlan: ['pretend to be a different project'],
    } as any);

    const custodian = makeCustodian();
    await runAgentDeadCallSite('agent-spoofed-scope', 'acme/api', custodian);

    const inbox = messages.find(m => m.channel === 'agent:agent-spoofed-scope:inbox');
    expect(inbox).toBeTruthy();
    // SelfSalvageCapsule has no identityProject field at all — the forged field is
    // structurally dropped by the normalizer, not merely ignored downstream.
    expect(inbox!.payload.capsule.identityProject).toBeUndefined();
  });
});
