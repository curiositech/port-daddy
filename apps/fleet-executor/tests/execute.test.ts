import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeFleet } from '../src/execute.js';
import {
  freshState,
  installGitHubFetch,
  memoryKV,
  aiStub,
  makeEnv,
  makeJob,
  type GitHubState,
} from './harness.js';

/**
 * Build a real pd-fleet.yml body. The deterministic parser reads this directly
 * (no LLM), so the YAML must be well-formed. Each ship's prompt embeds its name
 * so the AI stub can route per-ship responses.
 */
function fleetYaml(
  ships: Array<{
    name: string;
    blocking?: boolean;
    model?: string;
    allowedTools?: string;
    trigger?: string;
  }>,
): string {
  const body = ships
    .map(s => {
      const lines = [
        `    ${s.name}:`,
        `      trigger: ${s.trigger ?? 'pull_request:opened'}`,
      ];
      if (s.blocking) lines.push('      blocking: true');
      if (s.allowedTools) lines.push(`      allowedTools: "${s.allowedTools}"`);
      lines.push('      fallbacks:');
      lines.push('        - backend: cloudflare');
      lines.push(`          model: '${s.model ?? '@cf/qwen/qwen3-30b-a3b-fp8'}'`);
      lines.push('      prompt: |');
      lines.push(`        ${s.name} ship: review the diff and report findings.`);
      return lines.join('\n');
    })
    .join('\n');
  return `fleet:\n  name: test\n  agents:\n${body}\n`;
}

const REVIEWER_YAML = fleetYaml([
  { name: 'code-reviewer', blocking: true, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
]);

const REVIEWER_PLUS_QA_YAML = fleetYaml([
  { name: 'code-reviewer', blocking: true, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
  { name: 'qa', blocking: false },
]);

/** Seed a KV cache hit so the orchestrator never mints (avoids real crypto). */
function seedToken(kv: KVNamespace, installationId: number): void {
  void (kv as KVNamespace).put(
    `github_inst_${installationId}`,
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 60 * 60 * 1000 }),
  );
}

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('zero-trust config + contract fetching', () => {
  it('fetches pd-fleet.yml and ship contracts from main, NEVER from PR head', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    state.files.set('main:fleet/ships/code-reviewer.md', '## contract');

    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: { 'code-reviewer': 'looks ok\n\nFLEET-VERDICT: PASS' },
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    // Every contents fetch must use the trusted 'main' ref. The PR head SHA is
    // 'HEADSHA' — assert it never appears as a contents ref.
    expect(state.contentsRefs.length).toBeGreaterThan(0);
    for (const { ref } of state.contentsRefs) {
      expect(ref).toBe('main');
      expect(ref).not.toBe('HEADSHA');
    }
    // And specifically the config + contract were read from main.
    expect(state.contentsRefs).toContainEqual({ path: 'pd-fleet.yml', ref: 'main' });
    expect(state.contentsRefs).toContainEqual({ path: 'fleet/ships/code-reviewer.md', ref: 'main' });
  });
});

describe('blocking-ship verdict → check conclusion', () => {
  it('blocking ship emitting BLOCK => check conclusion failure', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: { 'code-reviewer': 'HIGH: injection\n\nFLEET-VERDICT: BLOCK' },
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('failure');
  });

  it('blocking ship with NO verdict => failure (fail closed)', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      // No FLEET-VERDICT line at all.
      perShip: { 'code-reviewer': 'I looked and it seems fine, probably.' },
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    expect(state.completed[0].conclusion).toBe('failure');
  });

  it('blocking ship with malformed findings JSON => failure (fail closed)', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const malformed = ['```json', '{ not valid array', '```', '', 'FLEET-VERDICT: PASS'].join('\n');
    const ai = aiStub({ perShip: { 'code-reviewer': malformed } }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    // Unparseable findings on a BLOCKING ship => errored => failure, even though
    // the verdict line literally says PASS.
    expect(state.completed[0].conclusion).toBe('failure');
  });

  it('blocking ship that errors => failure (fail closed) and other ships still run', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_QA_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: { 'code-reviewer': 'x', 'qa': 'gaps\n\nFLEET-VERDICT: PASS' },
      throwForShip: 'code-reviewer',
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    expect(state.completed[0].conclusion).toBe('failure');
    // qa still posted a comment despite code-reviewer crashing.
    expect(state.commentPosts).toBeGreaterThanOrEqual(1);
  });

  it('createCheckRun failure REJECTS (job retries) and never completes a check — fail closed', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    state.failCreateCheckRun = 99; // every check-run create fails
    const ai = aiStub({
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;

    // Must throw so the queue handler calls message.retry() — never ack a job
    // whose gating check we could not even create.
    await expect(
      executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai })),
    ).rejects.toThrow(/createCheckRun failed|cannot establish/i);

    // No check was completed (no falsely-green or stray verdict on GitHub).
    expect(state.completed).toHaveLength(0);
  });
});

describe('deterministic ship resolution', () => {
  it('parses qa from real YAML and runs it as a cloud-static (non-execution) ship', async () => {
    // qa carries Bash(npm test*) historically, but is forced cloud-static.
    state.files.set(
      'main:pd-fleet.yml',
      fleetYaml([
        { name: 'code-reviewer', blocking: true, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
        { name: 'qa', blocking: false, allowedTools: 'Read,Grep,Bash(npm test*),Bash(gh*)' },
        // An execution ship: routes to GHA, must NOT run in the cloud.
        { name: 'test-author', blocking: false, allowedTools: 'Read,Write,Bash(npm test*)' },
      ]),
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: {
        'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS',
        'qa': 'qa: tests look thin\n\nFLEET-VERDICT: PASS',
        'test-author': 'should not run\n\nFLEET-VERDICT: PASS',
      },
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai }));

    const shipsRun = new Set(ai.calls.map(c => c.ship));
    expect(shipsRun.has('code-reviewer')).toBe(true);
    expect(shipsRun.has('qa')).toBe(true); // cloud-static, runs in the cloud
    expect(shipsRun.has('test-author')).toBe(false); // needsExecution → GHA, skipped here
  });
});

describe('map-reduce fan-out', () => {
  it('chunks a large diff into N map calls + exactly 1 manager reduce call', async () => {
    // Two files, each ~9KB, exceed the 12KB chunk budget combined → 2 chunks.
    const file = (name: string) =>
      `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n` + '+line\n'.repeat(1500);
    state.prDiff = file('a.ts') + file('b.ts');

    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: { 'code-reviewer': 'partial\n\nFLEET-VERDICT: PASS' },
      managerOutput: 'merged review\n\nFLEET-VERDICT: PASS',
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai }));

    const mapCalls = ai.calls.filter(c => c.ship === 'code-reviewer' && c.phase === 'map');
    const reduceCalls = ai.calls.filter(c => c.ship === 'code-reviewer' && c.phase === 'reduce');
    expect(mapCalls.length).toBe(2); // N chunks
    expect(reduceCalls.length).toBe(1); // 1 manager
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('a single-chunk diff makes one map call and no manager call', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai }));

    expect(ai.calls.filter(c => c.phase === 'map').length).toBe(1);
    expect(ai.calls.filter(c => c.phase === 'reduce').length).toBe(0);
  });
});

describe('inline GitHub review', () => {
  it('posts ONE review with [ship]-prefixed inline comments from structured findings', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const out = [
      '```json',
      '[{"path":"src/x.ts","line":4,"severity":"HIGH","body":"bad thing"}]',
      '```',
      '',
      'FLEET-VERDICT: BLOCK',
    ].join('\n');
    const ai = aiStub({ perShip: { 'code-reviewer': out } }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    expect(state.reviews).toHaveLength(1);
    const review = state.reviews[0];
    expect(review.event).toBe('COMMENT');
    expect(review.comments).toHaveLength(1);
    expect(review.comments[0]).toEqual({
      path: 'src/x.ts',
      line: 4,
      body: '[code-reviewer] bad thing',
    });
    // Blocking ship emitted BLOCK → the check still fails (gate is the check run).
    expect(state.completed[0].conclusion).toBe('failure');
  });
});

describe('non-blocking ship semantics', () => {
  it('non-blocking ship BLOCK => check still success-or-neutral (never failure) + comment posted', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_QA_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: {
        'code-reviewer': 'clean\n\nFLEET-VERDICT: PASS',
        'qa': 'missing tests\n\nFLEET-VERDICT: BLOCK',
      },
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    // A non-blocking BLOCK must NOT fail the merge gate.
    expect(state.completed[0].conclusion).not.toBe('failure');
    expect(state.completed[0].conclusion).toBe('neutral');
    // The advisory finding was still posted (per-ship history comment).
    expect(state.commentPosts).toBe(2);
  });
});

describe('idempotent re-run', () => {
  it('same deliveryId / head SHA does not double-create the check run', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const mkAi = () =>
      aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } }).ai;

    const job = makeJob();
    await executeFleet(job, makeEnv({ FLEET_TOKENS: kv, AI: mkAi() }));
    // Re-deliver the SAME job. The commit check-runs lookup now finds the run
    // created on the first pass, so no second check run is created.
    await executeFleet(job, makeEnv({ FLEET_TOKENS: kv, AI: mkAi() }));

    expect(state.checkRunsCreated).toBe(1);
    expect(state.completed.length).toBe(2); // completed both times, same id
    expect(state.completed[0].id).toBe(state.completed[1].id);
  });

  it('re-run edits the ship comment in place instead of posting a duplicate', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const mkAi = () =>
      aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } }).ai;

    const job = makeJob();
    await executeFleet(job, makeEnv({ FLEET_TOKENS: kv, AI: mkAi() }));
    // Simulate the comment now existing on GitHub.
    state.existingComments = [{ id: 555, body: 'old\n\n<!-- pd-ship:code-reviewer -->' }];
    await executeFleet(job, makeEnv({ FLEET_TOKENS: kv, AI: mkAi() }));

    expect(state.commentPosts).toBe(1); // only the first run created
    expect(state.commentPatches).toBe(1); // the re-run edited in place
  });
});
