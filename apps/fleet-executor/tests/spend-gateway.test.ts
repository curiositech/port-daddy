/**
 * EXECUTOR-side fleet monetization (ADR-0116/0117):
 *   1. AI Gateway routing — when env.AI_GATEWAY_ID is set, every env.AI.run(...)
 *      is passed { gateway: { id } } (merged with the existing x-session-affinity
 *      extraHeaders); unset ⇒ no gateway key at all.
 *   2. Per-run spend recording — one fleet_run_spend row per ship that ran, with
 *      the ship's tokens + a cost derived from the model's $/M rate.
 *   3. Spend circuit-breaker — a spent credit_ledger (SUM(delta_usd) <= 0 with
 *      rows present) skips the run NEUTRAL before any AI spend; absent table /
 *      no rows / no DB fail OPEN (the run proceeds).
 *
 * All three surfaces are best-effort against the shared relay D1 and can never
 * change the merge gate beyond the explicit neutral circuit-breaker skip.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeFleet } from '../src/execute.js';
import {
  freshState,
  installGitHubFetch,
  memoryKV,
  memoryD1,
  aiStub,
  makeEnv,
  makeJob,
  type GitHubState,
  type AiStub,
} from './harness.js';

/** Minimal well-formed pd-fleet.yml the deterministic parser reads directly. */
function fleetYaml(ships: Array<{ name: string; blocking?: boolean }>): string {
  const body = ships
    .map(s => {
      const lines = [`    ${s.name}:`, `      trigger: pull_request:opened`];
      if (s.blocking) lines.push('      blocking: true');
      // No `@cf/` model pin ⇒ deriveCfModel uses the ROLE default: code-reviewer
      // → gpt-oss-120b, every other ship → qwen3-30b (both priced).
      lines.push('      fallbacks:');
      lines.push('        - backend: cloudflare');
      lines.push('      prompt: |');
      lines.push(`        ${s.name} ship: review the diff and report findings.`);
      return lines.join('\n');
    })
    .join('\n');
  return `fleet:\n  name: test\n  agents:\n${body}\n`;
}

// code-reviewer resolves (by ROLE, isReviewBot) to @cf/openai/gpt-oss-120b —
// a PRICED model ($0.35/1M in, $0.75/1M out).
const REVIEWER_YAML = fleetYaml([{ name: 'code-reviewer', blocking: true }]);

function seedToken(kv: KVNamespace, installationId: number): void {
  void kv.put(
    `github_inst_${installationId}`,
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 3_600_000 }),
  );
}

/** Every third arg (AiOptions) passed to env.AI.run across the run. */
function runOptions(ai: AiStub): Array<{ extraHeaders?: Record<string, string>; gateway?: { id: string } }> {
  const mock = (ai.ai.run as unknown as { mock: { calls: unknown[][] } }).mock;
  return mock.calls.map(c => c[2] as { extraHeaders?: Record<string, string>; gateway?: { id: string } });
}

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI Gateway routing (env.AI_GATEWAY_ID)', () => {
  it('AI_GATEWAY_ID set ⇒ every env.AI.run gets { gateway: { id } } alongside extraHeaders', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });

    await executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: memoryD1().db, AI_GATEWAY_ID: 'pd-fleet-gw' }),
    );

    const opts = runOptions(ai);
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      expect(o.gateway).toEqual({ id: 'pd-fleet-gw' });
      // The prefix-cache affinity header is preserved, not clobbered.
      expect(o.extraHeaders?.['x-session-affinity']).toBe('pd-fleet-code-reviewer');
    }
  });

  it('AI_GATEWAY_ID set ⇒ gateway option threaded on BOTH map and reduce calls', async () => {
    // Force a multi-chunk fan-out so a REDUCE manager call also happens.
    const file = (name: string) =>
      `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n` + '+line\n'.repeat(1500);
    state.prDiff = file('a.ts') + file('b.ts');
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: { 'code-reviewer': 'partial\n\nFLEET-VERDICT: PASS' },
      managerOutput: 'merged\n\nFLEET-VERDICT: PASS',
    });

    await executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: memoryD1().db, AI_GATEWAY_ID: 'gw-1' }),
    );

    expect(ai.calls.filter(c => c.phase === 'reduce')).toHaveLength(1);
    const opts = runOptions(ai);
    expect(opts.length).toBe(3); // 2 map + 1 reduce
    for (const o of opts) expect(o.gateway).toEqual({ id: 'gw-1' });
  });

  it('AI_GATEWAY_ID UNSET ⇒ no gateway key (exactly today\'s behavior)', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });

    await executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: memoryD1().db }),
    );

    const opts = runOptions(ai);
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      expect(o.gateway).toBeUndefined();
      expect(o.extraHeaders?.['x-session-affinity']).toBe('pd-fleet-code-reviewer');
    }
  });
});

describe('per-run spend recording (fleet_run_spend)', () => {
  it('records one row per ship with the ship model, tokens, and a sane cost_usd', async () => {
    // code-reviewer → gpt-oss-120b (priced), qa → qwen3-30b (priced).
    state.files.set(
      'main:pd-fleet.yml',
      fleetYaml([{ name: 'code-reviewer', blocking: true }, { name: 'qa', blocking: false }]),
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: {
        'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS',
        'qa': 'thin tests\n\nFLEET-VERDICT: PASS',
      },
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    const d1 = memoryD1();

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    expect(d1.spend).toHaveLength(2);
    const reviewer = d1.spend.find(s => s.ship === 'code-reviewer')!;
    expect(reviewer.runId).toBe('run:delivery-abc');
    expect(reviewer.installationId).toBe(42);
    expect(reviewer.model).toBe('@cf/openai/gpt-oss-120b');
    expect(reviewer.inputTokens).toBe(100);
    expect(reviewer.outputTokens).toBe(20);
    // 100/1e6*0.35 + 20/1e6*0.75 = 0.00005
    expect(reviewer.costUsd).toBeCloseTo(0.00005, 8);

    const qa = d1.spend.find(s => s.ship === 'qa')!;
    expect(qa.model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    // 100/1e6*0.051 + 20/1e6*0.335 = 0.0000118, rounded to 6 decimals ⇒ 0.000012
    expect(qa.costUsd).toBeCloseTo(0.000012, 7);
  });

  it('a ship whose model reports no usage records tokens 0 and cost 0', async () => {
    // No usage block on the AI response ⇒ ShipMetrics stays 0 ⇒ cost 0. (The
    // unpriced-model → 0 branch is covered directly in spend.test.ts.)
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } }); // no usage
    const d1 = memoryD1();

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    expect(d1.spend).toHaveLength(1);
    expect(d1.spend[0].inputTokens).toBe(0);
    expect(d1.spend[0].outputTokens).toBe(0);
    expect(d1.spend[0].costUsd).toBe(0);
  });

  it('a failed spend insert is swallowed and never changes the gate', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'HIGH\n\nFLEET-VERDICT: BLOCK' } });
    const d1 = memoryD1();
    d1.failAll = true; // every .run() (spend + transcript) throws

    await expect(
      executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db })),
    ).resolves.toBeUndefined();

    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('failure'); // blocking BLOCK still fails closed
    expect(d1.spend).toHaveLength(0); // insert threw, nothing captured
  });
});

describe('spend circuit-breaker (credit_ledger)', () => {
  it('negative balance with ledger rows ⇒ run SKIPPED, check neutral, zero AI spend', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const d1 = memoryD1();
    d1.ledger = [
      { installationId: 42, deltaUsd: 5 },
      { installationId: 42, deltaUsd: -7.5 }, // net -2.5
    ];

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls).toHaveLength(0);
    expect(state.commentPosts).toBe(0);
    expect(d1.spend).toHaveLength(0);
    expect(state.checkRunsCreated).toBe(1);
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('neutral');
    expect(state.completed[0].summary.toLowerCase()).toContain('top up credits');
    expect(d1.runs[0].conclusion).toBe('neutral');
  });

  it('zero balance with ledger rows ⇒ SKIPPED neutral (<= 0 is exhausted)', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const d1 = memoryD1();
    d1.ledger = [{ installationId: 42, deltaUsd: 3 }, { installationId: 42, deltaUsd: -3 }];

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls).toHaveLength(0);
    expect(state.completed[0].conclusion).toBe('neutral');
  });

  it('positive balance ⇒ run PROCEEDS normally + records spend', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    const d1 = memoryD1();
    d1.ledger = [{ installationId: 42, deltaUsd: 10 }];

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.completed[0].conclusion).toBe('success');
    expect(d1.spend).toHaveLength(1);
  });

  it('NO ledger rows for this install ⇒ FAIL-OPEN (run proceeds — trial / billing off)', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const d1 = memoryD1();
    // A DIFFERENT installation is out of credit; ours (42) has no rows.
    d1.ledger = [{ installationId: 99, deltaUsd: -100 }];

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('credit_ledger table absent ⇒ FAIL-OPEN (breaker inert until billing ships)', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const d1 = memoryD1();
    d1.creditTableMissing = true; // SELECT throws "no such table"

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('no DB binding ⇒ FAIL-OPEN (run proceeds)', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai }));

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.completed[0].conclusion).toBe('success');
  });
});
