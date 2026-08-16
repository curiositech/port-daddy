import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeFleet, mapWithConcurrency, mapChunkCharLimit } from '../src/execute.js';
import { MODEL_CONTEXT_TOKENS } from '../src/spend.js';
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
    temperature?: number;
  }>,
): string {
  const body = ships
    .map(s => {
      const lines = [
        `    ${s.name}:`,
        `      trigger: ${s.trigger ?? 'pull_request:opened'}`,
      ];
      if (s.blocking) lines.push('      blocking: true');
      if (s.temperature !== undefined) lines.push(`      temperature: ${s.temperature}`);
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

/**
 * A reviewer-ship output carrying a REAL findings block, so it renders to a
 * posted comment. Reviewer ships with no findings now render to silence (the
 * red-team `[]` fix), so tests that assert a comment WAS posted must give the
 * ship something to find.
 */
function reviewWithFinding(verdict: 'PASS' | 'BLOCK' = 'PASS', body = 'finding'): string {
  return [
    '```json',
    // Must cite a path the harness actually reports as changed (`src/x.ts`).
    // Findings pinned to a file outside the diff are dropped before rendering,
    // so a fixture citing an untouched file would silently post nothing and
    // these verdict/check assertions would fail for an unrelated reason.
    JSON.stringify([{ path: 'src/x.ts', line: 1, severity: 'MEDIUM', body }]),
    '```',
    '',
    `FLEET-VERDICT: ${verdict}`,
  ].join('\n');
}

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

describe('PR lifecycle gate — a finished PR is not reviewed', () => {
  /** Installation token, so the run reaches the gate rather than dying at mint. */
  function tokenKv(): ReturnType<typeof memoryKV> {
    const kv = memoryKV();
    seedToken(kv, 42);
    return kv;
  }

  // A queue can deliver a job long after it was enqueued. Observed live:
  // #5456 authored five adversarial test files for #5372 a hundred minutes
  // AFTER #5372 merged. A test branch stacked under a merged PR can never be
  // merged through, so the whole run is waste.

  it('a MERGED pr runs ZERO ships but still completes the required check', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_QA_YAML);
    state.prState = 'closed';
    state.prMerged = true;
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding(), qa: reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: tokenKv(), AI: ai.ai }));

    expect(ai.calls).toHaveLength(0);
    expect(state.reviews).toHaveLength(0);
    expect(state.commentPosts).toBe(0);
    // The required check must never be left hanging — that blocks a branch forever.
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('neutral');
    expect(state.completed[0].summary).toMatch(/already merged/);
    // The summary is the ONLY explanation an author gets for a neutral required
    // check, so it must not assert something we never checked. We do not know
    // when the job was enqueued relative to the merge — a delivery can be
    // raised for a PR that had already finished.
    expect(state.completed[0].summary).not.toMatch(/enqueued while/i);
    expect(state.completed[0].summary).not.toMatch(/has since (merged|closed)/i);
  });

  it('a CLOSED-unmerged pr is skipped too', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    state.prState = 'closed';
    state.prMerged = false;
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: tokenKv(), AI: ai.ai }));

    expect(ai.calls).toHaveLength(0);
    expect(state.completed[0].summary).toMatch(/is closed/);
  });

  it('an OPEN pr is reviewed normally — the gate does not fire', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: tokenKv(), AI: ai.ai }));

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.completed[0].summary).not.toMatch(/already merged|is closed/);
  });

  it('FAILS OPEN when GitHub omits the lifecycle fields entirely', async () => {
    // The load-bearing case. Skipping a live PR silently removes its review
    // gate and reports neutral, which reads exactly like a clean run.
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    state.prState = undefined;
    state.prMerged = undefined;
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: tokenKv(), AI: ai.ai }));

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.reviews.length).toBeGreaterThan(0);
  });
});

describe('self-review guard — the fleet does not review its own branches', () => {
  /** Seed the App-login cache so authorship resolves on the STRONG signal. */
  function fleetKv(): ReturnType<typeof memoryKV> {
    const kv = memoryKV();
    seedToken(kv, 42);
    void kv.put('fleet_app_login', 'port-daddy[bot]');
    return kv;
  }

  it('a fleet-authored purser branch completes the required check and runs ZERO ships', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_QA_YAML);
    state.prAuthor = { login: 'port-daddy[bot]', type: 'Bot' };
    state.prHeadRef = 'purser/pr-4763-tests';
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding(), qa: reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: fleetKv(), AI: ai.ai }));

    // No AI spend, no review, no comments — the whole point.
    expect(ai.calls).toHaveLength(0);
    expect(state.reviews).toHaveLength(0);
    expect(state.commentPosts).toBe(0);

    // …but the REQUIRED "Port Daddy Fleet" check is still completed, never left
    // in_progress. An absent/hanging required check blocks the branch forever.
    expect(state.checkRunsCreated).toBe(1);
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('neutral');
    expect(state.completed[0].summary).toContain('Fleet-authored branch — not self-reviewed');
  });

  it('the same skip applies to an ideation `fleet/` stacked-fix branch', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    state.prAuthor = { login: 'port-daddy[bot]', type: 'Bot' };
    state.prHeadRef = 'fleet/qa-pr-7-add-guard';
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: fleetKv(), AI: ai.ai }));

    expect(ai.calls).toHaveLength(0);
    expect(state.completed[0].conclusion).toBe('neutral');
  });

  it("a HUMAN's PR is still reviewed normally — ships run, review posted", async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    state.prAuthor = { login: 'erichowens', type: 'User' };
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: fleetKv(), AI: ai.ai }));

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.reviews.length).toBeGreaterThan(0);
    expect(state.completed[0].summary).not.toContain('not self-reviewed');
  });

  it("a HUMAN on a `purser/` branch is STILL reviewed — a branch name grants nothing", async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    state.prAuthor = { login: 'mallory', type: 'User' };
    state.prHeadRef = 'purser/pr-1-tests';
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: fleetKv(), AI: ai.ai }));

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.completed[0].summary).not.toContain('not self-reviewed');
  });

  it('a DIFFERENT bot is reviewed normally when the fleet App login is known', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    state.prAuthor = { login: 'dependabot[bot]', type: 'Bot' };
    state.prHeadRef = 'dependabot/npm_and_yarn/x';
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: fleetKv(), AI: ai.ai }));

    expect(ai.calls.length).toBeGreaterThan(0);
  });
});

describe('pull_request action routing', () => {
  it('acks an obsolete synchronize delivery before creating a check or spending AI', async () => {
    state.prHeadSha = 'NEWESTSHA';
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: { 'code-reviewer': 'should not run\n\nFLEET-VERDICT: PASS' },
    });

    await executeFleet(
      makeJob({ action: 'synchronize' }),
      makeEnv({ FLEET_TOKENS: kv, AI: ai.ai }),
    );

    expect(state.checkRunsCreated).toBe(0);
    expect(state.completed).toHaveLength(0);
    expect(ai.calls).toHaveLength(0);
  });

  it.each(['opened', 'synchronize', 'reopened', 'ready_for_review'] as const)(
    'runs the fleet for %s deliveries',
    async action => {
      state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
      const kv = memoryKV();
      seedToken(kv, 42);
      const ai = aiStub({
        perShip: { 'code-reviewer': 'looks ok\n\nFLEET-VERDICT: PASS' },
      });

      await executeFleet(
        makeJob({ action, deliveryId: `delivery-${action}` }),
        makeEnv({ FLEET_TOKENS: kv, AI: ai.ai }),
      );

      expect(state.checkRunsCreated).toBe(1);
      expect(state.completed[0].conclusion).toBe('success');
      expect(ai.calls.some(c => c.ship === 'code-reviewer')).toBe(true);
    },
  );

  it.each(['edited', null] as Array<string | null>)(
    'skips non-reviewable pull_request action %s without touching GitHub or AI',
    async action => {
      const ai = aiStub({
        perShip: { 'code-reviewer': 'should not run\n\nFLEET-VERDICT: PASS' },
      });

      await executeFleet(
        makeJob({ action, deliveryId: `delivery-${action ?? 'null'}` }),
        makeEnv({ AI: ai.ai }),
      );

      expect(state.records).toHaveLength(0);
      expect(state.checkRunsCreated).toBe(0);
      expect(ai.calls).toHaveLength(0);
    },
  );
});

describe('MAP fan-out', () => {
  it('preserves result order while enforcing the in-flight cap', async () => {
    let active = 0;
    let maxActive = 0;
    const values = Array.from({ length: 19 }, (_, index) => index);

    const result = await mapWithConcurrency(values, 4, async value => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, (value % 3) + 1));
      active -= 1;
      return value * 2;
    });

    expect(maxActive).toBe(4);
    expect(result).toEqual(values.map(value => value * 2));
  });

  it('rejects a non-positive concurrency limit', async () => {
    await expect(mapWithConcurrency([1], 0, async value => value)).rejects.toThrow(/positive integer/);
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
      perShip: { 'code-reviewer': 'x', 'qa': reviewWithFinding('PASS', 'gap') },
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

  it('runs Spark as an ideation ship, passes its temperature, and renders actionable proposals', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      fleetYaml([
        {
          name: 'spark',
          blocking: false,
          allowedTools: 'Read,Grep,Glob',
          temperature: 1.25,
        },
      ]),
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: {
        spark: [
          '```json',
          JSON.stringify([
            {
              title: 'Stream harbor events to the roster',
              rationale: 'The new event ledger makes live roster updates buildable.',
              evidence: ['lib/agent-harbor/event-ledger.ts'],
              action: 'assign',
              prompt: 'Wire the harbor event ledger into the roster pane so rows update live.',
            },
          ]),
          '```',
          '',
          'FLEET-VERDICT: PASS',
        ].join('\n'),
      },
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai }));

    // Creative temperature is still passed through to the model call.
    expect(ai.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ ship: 'spark', phase: 'map', temperature: 1.25 }),
    ]));

    const commentBodies = state.records
      .filter(r => r.method === 'POST' && /\/issues\/\d+\/comments$/.test(r.url))
      .map(r => (r.body as { body?: string }).body ?? '');
    // The comment is tagged as spark and carries a REAL actionable command.
    expect(commentBodies.some(body => body.includes('pd-ship:spark'))).toBe(true);
    expect(commentBodies.some(body => body.includes('pd dispatch propose'))).toBe(true);
    expect(commentBodies.some(body => body.includes('Stream harbor events to the roster'))).toBe(true);
    // Ideation ships never gate: the check concludes success (no findings, no block).
    expect(state.completed[0].conclusion).toBe('success');
  });
});

describe('map-reduce fan-out', () => {
  it('chunks a large diff into N map calls + exactly 1 manager reduce call', async () => {
    // Sized RELATIVE to the real budget, not to a number typed here. These
    // fixtures used to hard-code ~9KB files against a 12KB budget; when the
    // budget became derived from the MAP model's context window they silently
    // stopped testing fan-out at all -- one chunk, no REDUCE, and an assertion
    // about "2 map calls" failing for a reason with nothing to do with
    // map-reduce. A fixture that encodes a constant is a fixture that expires.
    //
    // Sized against the LARGEST budget any known model yields, so the diff
    // fans out whichever model the ship under test resolves to -- and stays
    // correct if a model with a bigger window is added later.
    const budget = Math.max(...Object.keys(MODEL_CONTEXT_TOKENS).map(mapChunkCharLimit));
    const linesPerFile = Math.ceil((budget * 0.6) / '+line\n'.length);
    const file = (name: string) =>
      `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n` +
      '+line\n'.repeat(linesPerFile);
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
    // This fixture is a BLOCKING ship returning BLOCK with a HIGH finding —
    // the one case the fleet now rejects outright rather than commenting
    // beside. See reviewEventFor() and tests/review-event.test.ts for the
    // restraints (advisory ships, non-HIGH findings, errored ships and empty
    // finding lists all stay COMMENT).
    expect(review.event).toBe('REQUEST_CHANGES');
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
        'code-reviewer': reviewWithFinding('PASS', 'clean-ish nit'),
        'qa': reviewWithFinding('BLOCK', 'missing tests'),
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

describe('idempotent re-run — a redelivery must not re-spend', () => {
  // WHAT CHANGED AND WHY. These two cases used to pin "a re-run does the work
  // again, then edits the comment in place instead of duplicating it." The
  // edit-in-place half was right. The "does the work again" half was costing
  // real money: comment posting was idempotent, but the MODEL CALLS behind the
  // comment were not — every ship re-ran to produce text it then overwrote.
  //
  // On 2026-08-06 that became visible in production. Runs exceeding the Worker
  // wall-clock were redelivered (max_retries = 3), dead-lettered, completed as
  // `failure` by the DLQ handler — and then kept re-running ships for HOURS
  // against a check run that could never be reopened. Identical output, paid
  // for repeatedly, changing nothing an operator could see.
  //
  // So the property these now pin is stronger: a redelivery against a COMPLETED
  // check spends NOTHING. `in_progress` is deliberately not covered by that —
  // it is the genuine retry of a run that died mid-flight and must proceed.

  it('a redelivery after completion makes ZERO further model calls', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);

    const first = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const job = makeJob();
    await executeFleet(job, makeEnv({ FLEET_TOKENS: kv, AI: first.ai }));
    expect(first.calls.length).toBeGreaterThan(0);

    // Re-deliver the SAME job. The check for this head SHA is now completed.
    const second = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    await executeFleet(job, makeEnv({ FLEET_TOKENS: kv, AI: second.ai }));

    // The assertion that is about money.
    expect(second.calls.length).toBe(0);
    expect(state.checkRunsCreated).toBe(1);
    expect(state.completed.length).toBe(1); // completed once, not re-completed
  });

  it('a redelivery posts no comment at all — not even an edit', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const mkAi = () =>
      aiStub({ perShip: { 'code-reviewer': reviewWithFinding('PASS') } }).ai;

    const job = makeJob();
    await executeFleet(job, makeEnv({ FLEET_TOKENS: kv, AI: mkAi() }));
    // Simulate the comment now existing on GitHub.
    state.existingComments = [{ id: 555, body: 'old\n\n<!-- pd-ship:code-reviewer -->' }];
    await executeFleet(job, makeEnv({ FLEET_TOKENS: kv, AI: mkAi() }));

    expect(state.commentPosts).toBe(1); // only the first run created
    // Previously 1 — the re-run edited in place, having paid to regenerate
    // identical text. Now it never gets that far.
    expect(state.commentPatches).toBe(0);
  });

  it('a redelivery while the check is still IN PROGRESS does proceed', async () => {
    // The retry that must still work: a run that died mid-flight leaves the
    // check `in_progress`, and the queue redelivering it is the only thing that
    // finishes the gate. Skipping here would strand the PR blocked forever.
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);

    // Pre-seed an in-progress check, as an interrupted first attempt would.
    state.existingCheckRuns = [{ id: 4242, name: 'Port Daddy Fleet', status: 'in_progress' }];

    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai }));

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.checkRunsCreated).toBe(0); // reused the existing one
    expect(state.completed.map(c => c.id)).toEqual([4242]);
  });
});

// ---------------------------------------------------------------------------
// Ideation ships (spark / spider / lookout / snipe): end-to-end proof that each
// can do the job we ask — validate the Proposal schema and post REAL actionable
// Port Daddy syntax, while never gating a merge.

/** A pd-fleet.yml with one ideation ship, prompt embedding its name for routing. */
function ideationYaml(name: string, temperature = 0.8): string {
  return [
    'fleet:',
    '  name: test',
    '  agents:',
    `    ${name}:`,
    '      trigger: pull_request:opened',
    '      class: ideation',
    `      temperature: ${temperature}`,
    '      allowedTools: "Read,Grep,Glob"',
    '      fallbacks:',
    '        - backend: cloudflare',
    "          model: '@cf/openai/gpt-oss-120b'",
    '      prompt: |',
    `        ${name} ship: propose forward work for this diff.`,
    '',
  ].join('\n');
}

function commentBodiesOf(state: GitHubState): string[] {
  return state.records
    .filter(r => r.method === 'POST' && /\/issues\/\d+\/comments$/.test(r.url))
    .map(r => (r.body as { body?: string }).body ?? '');
}

describe('ideation ships — schema-validated, actionable, non-gating', () => {
  it('spider posts a syllogism proposal rendered into a runnable assign command', async () => {
    state.files.set('main:pd-fleet.yml', ideationYaml('spider', 0.95));
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: {
        spider: [
          '```json',
          JSON.stringify([
            {
              title: 'Roster-driven parley routing',
              rationale: 'A: the roster knows agent state. B: parley needs parties. Therefore C: auto-pick parties.',
              evidence: ['lib/actor-roster.ts', 'cli/commands/parley.ts'],
              action: 'assign',
              prompt: 'Add roster-driven default --with selection to pd parley call.',
            },
          ]),
          '```',
          'FLEET-VERDICT: PASS',
        ].join('\n'),
      },
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    const bodies = commentBodiesOf(state);
    expect(bodies.some(b => b.includes('pd-ship:spider'))).toBe(true);
    expect(bodies.some(b => b.includes('Roster-driven parley routing'))).toBe(true);
    expect(bodies.some(b => b.includes('pd dispatch propose'))).toBe(true);
    // Ideation never gates.
    expect(state.completed[0].conclusion).toBe('success');
    // Ideation ships contribute no inline review comments.
    for (const rev of state.reviews) expect(rev.comments).toHaveLength(0);
  });

  it('lookout is given cross-PR + branch context and posts a roadmap proposal with severity', async () => {
    state.files.set('main:pd-fleet.yml', ideationYaml('lookout', 0.4));
    state.openPRs = [
      { number: 700, title: 'C8 setup', draft: false, head: { ref: 'wave2-c8' }, base: { ref: 'main' } },
    ];
    state.branches = [{ name: 'wave2-c8' }, { name: 'wave2-c3' }];
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: {
        lookout: [
          '```json',
          JSON.stringify([
            {
              title: 'Route triangle: GET /agent-nodes ownership',
              rationale: 'This PR calls a route PR #700 also assumes but nobody owns.',
              evidence: ['cli/commands/diagnostics.ts'],
              action: 'roadmap',
              severity: 'HIGH',
            },
          ]),
          '```',
          'FLEET-VERDICT: PASS',
        ].join('\n'),
      },
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    // The model was actually handed the fleet context (other open PRs / branches).
    const aiCalls = (ai.run as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const userMsgs = aiCalls
      .map(c => (c[1] as { messages: Array<{ role: string; content: string }> }).messages)
      .flat()
      .filter(m => m.role === 'user')
      .map(m => m.content);
    expect(userMsgs.some(m => m.includes('Fleet context'))).toBe(true);
    expect(userMsgs.some(m => m.includes('#700'))).toBe(true);
    expect(userMsgs.some(m => m.includes('wave2-c3'))).toBe(true);

    const bodies = commentBodiesOf(state);
    expect(bodies.some(b => b.includes('pd-ship:lookout'))).toBe(true);
    expect(bodies.some(b => b.includes('`HIGH`'))).toBe(true);
    expect(bodies.some(b => b.includes('pd roadmap upsert'))).toBe(true);
    // A HIGH trouble-ahead alert is still advisory — never fails the check.
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('snipe proposes a skill-architect skill with a runnable dispatch command', async () => {
    state.files.set('main:pd-fleet.yml', ideationYaml('snipe', 0.7));
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: {
        snipe: [
          '```json',
          JSON.stringify([
            {
              title: 'Harbor fixture authoring skill',
              rationale: 'Every harbor PR hand-rolls fixture daemons; a skill would remove that friction.',
              evidence: ['core/pd-console/scripts/harbor-fixture-daemon.py'],
              action: 'skill',
              prompt: 'author F0-shaped harbor fixture daemons and capture scripts in one step',
            },
          ]),
          '```',
          'FLEET-VERDICT: PASS',
        ].join('\n'),
      },
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    const bodies = commentBodiesOf(state);
    expect(bodies.some(b => b.includes('pd-ship:snipe'))).toBe(true);
    expect(bodies.some(b => b.includes('Use the skill-architect skill'))).toBe(true);
    expect(bodies.some(b => b.includes('--tags skill,from-fleet,pd-snipe'))).toBe(true);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('an ideation ship that proposes nothing ([]) posts no comment (silence)', async () => {
    state.files.set('main:pd-fleet.yml', ideationYaml('spark', 1.25));
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: { spark: '```json\n[]\n```\n\nFLEET-VERDICT: PASS' },
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    expect(commentBodiesOf(state)).toHaveLength(0);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('malformed proposal JSON on an ideation ship falls back to raw output and never gates', async () => {
    state.files.set('main:pd-fleet.yml', ideationYaml('spark', 1.25));
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: { spark: 'I think we could build stuff.\n```json\n{ broken\n```\n\nFLEET-VERDICT: PASS' },
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    const bodies = commentBodiesOf(state);
    // Raw prose is preserved rather than dropped.
    expect(bodies.some(b => b.includes('I think we could build stuff.'))).toBe(true);
    // Malformed ideation output must NOT flip the check to neutral/failure.
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('ideation ships run alongside a blocking reviewer without affecting its gate', async () => {
    // spider is ideation by identity (IDEATION_SHIPS), so no `class:` field needed.
    state.files.set(
      'main:pd-fleet.yml',
      fleetYaml([
        { name: 'code-reviewer', blocking: true, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
        { name: 'spider', temperature: 0.95 },
      ]),
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: {
        'code-reviewer': reviewWithFinding('BLOCK', 'HIGH bug'),
        spider: '```json\n' + JSON.stringify([
          { title: 'Adjacent work', rationale: 'why', evidence: ['x'], action: 'roadmap' },
        ]) + '\n```\nFLEET-VERDICT: PASS',
      },
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    // The blocking reviewer still fails the gate; spider's PASS doesn't rescue it.
    expect(state.completed[0].conclusion).toBe('failure');
    const bodies = commentBodiesOf(state);
    expect(bodies.some(b => b.includes('pd-ship:spider'))).toBe(true);
    expect(bodies.some(b => b.includes('pd-ship:code-reviewer'))).toBe(true);
  });
});

describe('cloud telemetry emission (cost + failure surface)', () => {
  const SINK = 'https://sink.example/telemetry/cloud-app';

  /**
   * Wrap the installed GitHub fetch so telemetry POSTs are captured here and
   * everything else falls through to the harness. Returns the captured payloads.
   */
  function captureTelemetry(): unknown[] {
    const posted: unknown[] = [];
    const ghFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/telemetry/cloud-app')) {
          posted.push(JSON.parse(init?.body as string));
          return new Response(null, { status: 202 });
        }
        return ghFetch(input as RequestInfo, init);
      }) as unknown as typeof fetch,
    );
    return posted;
  }

  it('emits one ship-run event per ship with usage tokens on the success path', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: { 'code-reviewer': 'looks ok\n\nFLEET-VERDICT: PASS' },
    }).ai;
    // The stub returns { response }; give it a usage envelope so tokens flow.
    (ai.run as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      response: 'looks ok\n\nFLEET-VERDICT: PASS',
      usage: { prompt_tokens: 500, completion_tokens: 42 },
    }));
    const posted = captureTelemetry();

    await executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, AI: ai, PORT_DADDY_TELEMETRY_URL: SINK }),
    );

    const shipRuns = posted.filter(
      (p): p is Record<string, unknown> =>
        !!p && typeof p === 'object' && (p as Record<string, unknown>).event === 'ship-run',
    );
    expect(shipRuns).toHaveLength(1);
    expect(shipRuns[0]).toMatchObject({
      ship: 'code-reviewer',
      status: 'ok',
      conclusion: 'success',
      backend: 'cloudflare',
      inputTokens: 500,
      outputTokens: 42,
    });
  });

  it('flags a blacked-out ship (ran but all-empty output) as status:error / conclusion:failure', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': '' } }).ai;
    (ai.run as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      response: '',
      usage: { prompt_tokens: 500, completion_tokens: 0 },
    }));
    const posted = captureTelemetry();

    await executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, AI: ai, PORT_DADDY_TELEMETRY_URL: SINK }),
    );

    const shipRun = posted.find(
      (p): p is Record<string, unknown> =>
        !!p && typeof p === 'object' && (p as Record<string, unknown>).event === 'ship-run',
    );
    expect(shipRun).toMatchObject({ status: 'error', conclusion: 'failure' });
    expect((shipRun as { metadata?: { blackout?: boolean } }).metadata?.blackout).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MERGE QUEUE pass-through.
//
// `Port Daddy Fleet` is a REQUIRED context on the merge queue. The executor
// used to fall straight out of `!job.prNumber` for a merge_group delivery (that
// payload has no pull_request at all), so the context was never produced and the
// queue deadlocked: observed 2026-08-10 with `main` frozen since 2026-08-06 and
// the queue head AWAITING_CHECKS for 9+ hours.

describe('executeFleet — merge_group (merge-queue gate)', () => {
  const QUEUE_SHA = 'b8ae3f4202aeb2b25d7be69b7a3ed6898957c8c1';

  // The harness's app key is a placeholder that cannot sign a JWT, so a live
  // mint is impossible here. Seeding the cache keeps these tests about the
  // pass-through behaviour; the token layer has its own tests.
  function envWithToken(ai: unknown) {
    const kv = memoryKV();
    void kv.put(
      'github_inst_42',
      JSON.stringify({ token: 'tok-seeded', expiresAt: Date.now() + 3_600_000 }),
    );
    return makeEnv({ AI: ai as never, FLEET_TOKENS: kv });
  }

  function mergeGroupJob(over: Record<string, unknown> = {}) {
    return makeJob({
      eventType: 'merge_group',
      action: 'checks_requested',
      prNumber: null,
      payloadMinimal: {
        merge_group: { head_sha: QUEUE_SHA },
        ...(over.payloadMinimal as Record<string, unknown> | undefined),
      },
      ...over,
    } as Partial<ReturnType<typeof makeJob>>);
  }

  it('posts a SUCCESS check on the queue-branch head sha', async () => {
    const { ai } = aiStub({ perShip: {} });
    const state = freshState();
    installGitHubFetch(state);

    await executeFleet(mergeGroupJob(), envWithToken(ai));

    const created = state.records.filter(r => r.url.endsWith('/check-runs') && r.method === 'POST');
    expect(created).toHaveLength(1);
    expect((created[0].body as { name: string; head_sha: string }).name).toBe('Port Daddy Fleet');
    // The QUEUE branch sha is the only one GitHub is waiting on.
    expect((created[0].body as { head_sha: string }).head_sha).toBe(QUEUE_SHA);

    const completed = state.records.filter(r => r.url.includes('/check-runs/') && r.method === 'PATCH');
    expect(completed).toHaveLength(1);
    expect((completed[0].body as { conclusion: string }).conclusion).toBe('success');
  });

  it('spends NOTHING on models — it is a pass-through, not a re-review', async () => {
    const { ai } = aiStub({ perShip: { 'code-reviewer': 'x\n\nFLEET-VERDICT: PASS' } });
    const state = freshState();
    installGitHubFetch(state);

    await executeFleet(mergeGroupJob(), envWithToken(ai));

    // Re-reviewing every queue permutation would re-spend the whole review
    // budget per entry, per reorder, to re-derive a verdict already published.
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('posts nothing when the payload carries no head_sha (never invents one)', async () => {
    const { ai } = aiStub({ perShip: {} });
    const state = freshState();
    installGitHubFetch(state);

    await executeFleet(mergeGroupJob({ payloadMinimal: { merge_group: {} } }), envWithToken(ai));

    expect(state.records.filter(r => r.url.includes('/check-runs'))).toHaveLength(0);
  });
});
