import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  executeFleet,
  buildSystemPrompt,
  mapWithConcurrency,
  mapChunkCharLimit,
  MAX_OUTPUT_TOKENS,
} from '../src/execute.js';
import { parseFleetShips } from '../src/fleet.js';
import {
  createCheckpointReviewInputSha256,
  createShipCheckpointBinding,
} from '../src/ship-checkpoint.js';
import { MODEL_CONTEXT_TOKENS } from '../src/spend.js';
import { assessContextAdmission } from '../src/context-admission.js';
import { MAX_DIFF_BYTES, PR_FILES_PAGE_SIZE, renderFleetContext } from '../src/github.js';
import {
  freshState,
  installGitHubFetch,
  memoryKV,
  memoryD1,
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

// Same parsed policy as REVIEWER_YAML, deliberately reordered at the YAML and
// fallback-map levels. Checkpoint reuse must bind effective policy, not source
// formatting or object insertion order.
const REORDERED_REVIEWER_YAML = [
  'fleet:',
  '  agents:',
  '    code-reviewer:',
  '      prompt: |',
  '        code-reviewer ship: review the diff and report findings.',
  '      fallbacks:',
  "        - model: '@cf/qwen/qwen2.5-coder-32b-instruct'",
  '          backend: cloudflare',
  '      blocking: true',
  '      trigger: pull_request:opened',
  '  name: test',
  '',
].join('\n');

const ADVISORY_REVIEWER_YAML = fleetYaml([
  { name: 'code-reviewer', blocking: false, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
]);

const REVIEWER_PLUS_QA_YAML = fleetYaml([
  { name: 'code-reviewer', blocking: true, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
  { name: 'qa', blocking: false },
]);

const REVIEWER_PLUS_RED_TEAM_YAML = fleetYaml([
  { name: 'code-reviewer', blocking: true, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
  { name: 'red-team', blocking: true, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
]);

const MEDIATOR_REVIEWER_PLUS_QA_YAML = REVIEWER_PLUS_QA_YAML.replace(
  '  name: test\n',
  '  name: test\n  mediator:\n    enabled: true\n    harbor: test-harbor\n',
);

const LOOKOUT_THEN_REVIEWER_QA_YAML = fleetYaml([
  { name: 'lookout', blocking: false, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
  { name: 'code-reviewer', blocking: true, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
  { name: 'qa', blocking: false, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
]);

const MEDIATOR_LOOKOUT_THEN_REVIEWER_QA_YAML = LOOKOUT_THEN_REVIEWER_QA_YAML.replace(
  '  name: test\n',
  '  name: test\n  mediator:\n    enabled: true\n    harbor: test-harbor\n',
);

const CONTRACT_MINIMAL_PASS = '```json\n[]\n```\nFLEET-VERDICT: PASS';

async function seedMediatorOrders(control: ReturnType<typeof memoryKV>, modifyText: string): Promise<void> {
  await control.put(
    'mediator:reinjection:erichowens/port-daddy:7',
    JSON.stringify({
      parleyId: '979f6940-e0b0-42b9-ab21-078bbb2acae6',
      repo: 'erichowens/port-daddy',
      pr: 7,
      action: 'merge',
      modifyText,
      decidedBy: 'operator',
      at: 1_756_320_000,
    }),
  );
}

/** Match the executor's live PR evidence digest for the shared GitHub harness. */
async function checkpointReviewInputForState(): Promise<string> {
  const diff = state.prDiff ?? 'diff --git a/src/x.ts b/src/x.ts\n+changed';
  return createCheckpointReviewInputSha256({
    owner: 'erichowens',
    repo: 'port-daddy',
    prNumber: 7,
    title: state.prTitle ?? 'Test PR',
    body: state.prBody ?? '',
    headSha: state.prHeadSha,
    headRef: state.prHeadRef ?? '',
    baseSha: 'BASESHA',
    baseRef: state.prBaseRef,
    isFork: state.prHeadRepo !== state.prBaseRepo,
    files: state.prFiles ?? [{ filename: 'src/x.ts', status: 'modified', additions: 3, deletions: 1 }],
    diff,
    diffBytes: new TextEncoder().encode(diff).byteLength,
    diffTruncated: false,
    filesTruncated: false,
  });
}

/** Build the exact checkpoint proof the current executor would persist. */
async function checkpointBindingForYaml(
  config: string,
  shipName: string,
  contract: string | null = null,
  graftText = '',
  mediatorOrders = '',
  lookoutProjection: string | null = null,
) {
  const ship = parseFleetShips(config, 'pull_request:opened')?.find(candidate => candidate.name === shipName);
  if (!ship) throw new Error(`fixture does not declare ${shipName}`);
  return createShipCheckpointBinding(
    ship,
    contract,
    graftText,
    buildSystemPrompt(ship, contract, graftText),
    await checkpointReviewInputForState(),
    mediatorOrders,
    lookoutProjection,
  );
}

const TEST_CHECKPOINT_BINDING = {
  bindingVersion: 3 as const,
  shipConfigSha256: `sha256:${'1'.repeat(64)}`,
  contractSha256: 'absent',
  graftSha256: `sha256:${'2'.repeat(64)}`,
  systemPromptSha256: `sha256:${'3'.repeat(64)}`,
  reviewInputSha256: `sha256:${'4'.repeat(64)}`,
  mediatorOrdersSha256: 'absent',
  lookoutProjectionSha256: 'not-applicable',
  executionReceiptKind: 'not-applicable' as const,
};

const PURSER_CHECKPOINT_BINDING = {
  ...TEST_CHECKPOINT_BINDING,
  executionReceiptKind: 'purser-sandbox-v1' as const,
};

const TEST_EXPECTED_CHECKPOINT_BINDINGS = new Map([
  ['code-reviewer', TEST_CHECKPOINT_BINDING],
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
  vi.useRealTimers();
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

    const disposition = await executeFleet(
      makeJob({ action: 'synchronize' }),
      makeEnv({ FLEET_TOKENS: kv, AI: ai.ai }),
    );

    expect(disposition).toEqual({ kind: 'stale-head' });
    expect(state.checkRunsCreated).toBe(0);
    expect(state.completed).toHaveLength(0);
    expect(ai.calls).toHaveLength(0);
  });

  it('cancels a run whose head changes during inference before publishing or checkpointing', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    // Eight individually-admitted file chunks require two waves at
    // MAP_CONCURRENCY=4. Moving the head during wave one must prevent wave two
    // from ever spending; this fixture must stay below the request admission
    // limit or it would prove only the context guard.
    state.prDiff = Array.from(
      { length: 8 },
      (_, i) =>
        `diff --git a/src/chunk-${i}.ts b/src/chunk-${i}.ts\n` +
        `--- a/src/chunk-${i}.ts\n` +
        `+++ b/src/chunk-${i}.ts\n` +
        `@@ -1 +1 @@\n-${'a'.repeat(8_000)}\n+${'b'.repeat(8_000)}\n`,
    ).join('');
    const kv = memoryKV();
    seedToken(kv, 42);
    let moved = false;
    const ai = aiStub({
      perShip: { 'code-reviewer': reviewWithFinding('BLOCK', 'obsolete finding') },
      onCall: () => {
        if (!moved) {
          moved = true;
          state.prHeadSha = 'NEWER-DURING-AI';
        }
      },
    });

    const disposition = await executeFleet(
      makeJob({ action: 'synchronize', deliveryId: 'delivery-midflight-stale' }),
      makeEnv({ FLEET_TOKENS: kv, AI: ai.ai }),
    );

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(ai.calls.length).toBeLessThanOrEqual(4);
    expect(disposition).toMatchObject({
      kind: 'stale-head',
      stage: 'mid-flight',
      expectedHead: 'HEADSHA',
      currentHead: 'NEWER-DURING-AI',
      modelSpendPossible: true,
    });
    expect((disposition as { boundary?: string }).boundary).toContain('after pd-code-reviewer MAP');
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('neutral');
    expect(state.completed[0].summary).toContain('Output computed for the superseded head was discarded');
    expect(state.commentPosts).toBe(0);
    expect(state.commentPatches).toBe(0);
    expect(state.reviews).toHaveLength(0);
    expect(state.issuesCreated).toHaveLength(0);
    expect(state.stackedPrs).toHaveLength(0);
    expect(state.prPatches).toHaveLength(0);
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
    // Sized below the full-request admission budget of the deliberately small
    // 32k MAP model, but above half of its per-file chunk limit. Two intact
    // files must therefore fan out without sending an over-window prompt.
    const budget = mapChunkCharLimit('@cf/qwen/qwen2.5-coder-32b-instruct');
    const linesPerFile = Math.ceil((budget * 0.35) / '+line\n'.length);
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

  it('the chunk budget is CEILINGED, whatever the model window (#7743 memory bound)', () => {
    // The unbounded window-derived budget (128k tokens → ~192KB chunks) was a
    // memory multiplier that killed runs; every known model's budget must now
    // sit within [floor, ceiling].
    for (const model of Object.keys(MODEL_CONTEXT_TOKENS)) {
      const budget = mapChunkCharLimit(model);
      expect(budget).toBeGreaterThanOrEqual(12_000);
      expect(budget).toBeLessThanOrEqual(48_000);
    }
    // Unknown models keep the historical fallback exactly.
    expect(mapChunkCharLimit('@cf/some/unknown-model')).toBe(12_000);
  });

  it('an oversized diff is capped at the per-ship chunk limit and the truncation is transcribed (#7743)', async () => {
    // 12 chunks' worth of diff (each file sized to fill one chunk) must fan
    // out to at most 8 MAP calls, with a map-truncated step naming the drop —
    // a partial review may never masquerade as a full one.
    const budget = mapChunkCharLimit('@cf/qwen/qwen2.5-coder-32b-instruct');
    const linesPerFile = Math.ceil((budget * 0.35) / '+line\n'.length);
    const file = (name: string) =>
      `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n` +
      '+line\n'.repeat(linesPerFile);
    state.prDiff = Array.from({ length: 12 }, (_, i) => file(`f${i}.ts`)).join('');

    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const ai = aiStub({
      perShip: { 'code-reviewer': 'partial\n\nFLEET-VERDICT: PASS' },
      managerOutput: 'merged review\n\nFLEET-VERDICT: PASS',
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: db.db }));

    const mapCalls = ai.calls.filter(c => c.ship === 'code-reviewer' && c.phase === 'map');
    expect(mapCalls.length).toBeLessThanOrEqual(8);
    const truncated = db.steps.filter((s: { kind: string }) => s.kind === 'map-truncated');
    expect(truncated).toHaveLength(1);
    expect(String(truncated[0].title)).toContain('chunks dropped');
    // Still reaches a verdict — degraded honestly, never dead, but the
    // required check cannot represent a partial source review as a clean PASS.
    expect(state.completed[0].conclusion).toBe('neutral');
    expect(state.completed[0].summary).toContain('PARTIAL REVIEW');
  });

  it('keeps raw terminal evidence out of MAP while still reviewing authored source', async () => {
    const artifact = (path: string, body: string) =>
      `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${body}`;
    state.prDiff = [
      artifact('docs/artifacts/porthole-harness-proof-v2/harness-proof-current.html', '+<div>derived</div>\n'.repeat(12_000)),
      artifact('website-v2/public/casts/porthole/parley-source.cast', '+\u001b[31mraw terminal evidence\u001b[0m\n'.repeat(12_000)),
      artifact('src/safe.ts', '+export const reviewable = true;\n'),
    ].join('');

    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: db.db }));

    const mapCalls = ai.calls.filter(call => call.phase === 'map');
    expect(mapCalls).toHaveLength(1);
    const prompt = mapCalls[0].messages.map(message => message.content).join('\n');
    expect(prompt).toContain('src/safe.ts');
    expect(prompt).not.toContain('parley-source.cast');
    expect(prompt).not.toContain('raw terminal evidence');
    expect(prompt).not.toContain('harness-proof-current.html');
    expect(db.steps.some(step => step.kind === 'map-context-omitted')).toBe(false);
    for (const call of ai.calls) {
      expect(assessContextAdmission(call.model, call.messages, MAX_OUTPUT_TOKENS).accepted).toBe(true);
    }
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('skips an evidence-only diff instead of falling back to raw terminal bytes', async () => {
    state.prDiff =
      'diff --git a/website-v2/public/casts/porthole/parley-source.cast ' +
      'b/website-v2/public/casts/porthole/parley-source.cast\n' +
      '--- a/website-v2/public/casts/porthole/parley-source.cast\n' +
      '+++ b/website-v2/public/casts/porthole/parley-source.cast\n' +
      '+\u001b[31mreal transcript evidence only\u001b[0m\n'.repeat(8_000);

    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: db.db }));

    expect(ai.calls).toHaveLength(0);
    const skipped = db.steps.find(
      step => step.kind === 'ship-skipped' && String(step.title).includes('no reviewable source'),
    );
    expect(skipped).toBeDefined();
    expect(String(skipped?.detail)).toContain('no-reviewable-source');
    expect(state.completed[0].conclusion).toBe('neutral');
    expect(state.completed[0].summary).toContain('not reviewed');
  });

  it('marks a GitHub-truncated diff partial even when its available prefix reviews cleanly', async () => {
    // The source prefix is reviewable, but GitHub cuts the response in a later
    // terminal-evidence section. A clean MAP result must remain neutral: bytes
    // after the fetch cap might contain authored source we never received.
    state.prDiff = [
      'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n+export const safe = true;\n',
      'diff --git a/website-v2/public/casts/porthole/proof.cast b/website-v2/public/casts/porthole/proof.cast\n',
      '+terminal evidence\n'.repeat(125_000),
    ].join('');
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: db.db }));

    expect(ai.calls.filter(call => call.phase === 'map')).toHaveLength(1);
    expect(db.steps.some(step => step.kind === 'source-fetch-truncated')).toBe(true);
    expect(state.completed[0].conclusion).toBe('neutral');
    expect(state.completed[0].summary).toContain('PARTIAL REVIEW');
    expect(state.completed[0].summary).toContain('GitHub stopped the diff read');
  });

  it('does not call an artifact-only truncated prefix a complete no-source review', async () => {
    // We cannot infer anything about source after the fetch cap, even when the
    // bytes we received are all evidence. This exercises the early no-source
    // branch, which must return partial rather than the ordinary `none` state.
    state.prDiff = [
      'diff --git a/website-v2/public/casts/porthole/proof.cast b/website-v2/public/casts/porthole/proof.cast\n',
      '+terminal evidence\n'.repeat(125_000),
    ].join('');
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: db.db }));

    expect(ai.calls).toHaveLength(0);
    expect(db.steps.some(step => step.kind === 'source-fetch-truncated')).toBe(true);
    expect(state.completed[0].conclusion).toBe('neutral');
    expect(state.completed[0].summary).toContain('PARTIAL REVIEW');
    expect(state.completed[0].summary).not.toContain('not reviewed');
  });

  describe('incomplete changed-file inventory never closes a surface gate', () => {
    async function expectGatedRedTeamToRun(arrangeInventory: () => void): Promise<void> {
      arrangeInventory();
      state.files.set('main:pd-fleet.yml', fleetYaml([
        { name: 'red-team', blocking: true, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
      ]));
      const kv = memoryKV();
      seedToken(kv, 42);
      const db = memoryD1();
      const ai = aiStub({ perShip: { 'red-team': reviewWithFinding('PASS') } });

      await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: db.db }));

      // The normal red-team surface gate would skip all three fixtures below:
      // malformed has no paths, exact-100 has only docs, and the diff-truncated
      // case changes an ordinary source file. Incomplete provenance must force
      // an actual review and keep a clean answer neutral.
      expect(ai.calls.filter(call => call.ship === 'red-team').length).toBeGreaterThan(0);
      expect(db.steps.some(step => step.kind === 'source-inventory-incomplete')).toBe(true);
      expect(state.completed[0].conclusion).toBe('neutral');
      expect(state.completed[0].summary).toContain('PARTIAL REVIEW');
    }

    it('runs a gated-only roster when GitHub returns malformed changed-file JSON', async () => {
      await expectGatedRedTeamToRun(() => {
        state.prFilesBody = '{not-json';
      });
    });

    it('runs a gated-only roster at the exact first-page boundary', async () => {
      await expectGatedRedTeamToRun(() => {
        state.prFiles = Array.from({ length: PR_FILES_PAGE_SIZE }, (_, index) => ({
          filename: `docs/proof-${index}.md`,
          status: 'modified',
          additions: 1,
          deletions: 0,
        }));
      });
    });

    it('runs a gated-only roster when GitHub truncates the raw diff', async () => {
      await expectGatedRedTeamToRun(() => {
        state.prDiff = [
          'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n+export const reviewedPrefix = true;\n',
          'diff --git a/docs/artifacts/proof.cast b/docs/artifacts/proof.cast\n',
          '+terminal evidence\n'.repeat(Math.ceil(MAX_DIFF_BYTES / '+terminal evidence\n'.length) + 1),
        ].join('');
      });
    });
  });

  it('re-packs a compound MAP candidate at file boundaries before omitting source', async () => {
    // A large trusted contract leaves a narrow but valid MAP budget. The first
    // two source sections fit the soft character cap together, but their real
    // numbered MAP prompt does not: scope prose is present only once a second
    // chunk exists. Older code dropped that whole compound candidate after
    // checking it too late, even though each file fits by itself.
    const file = (name: string) =>
      `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n` +
      '+contextSafeSource\n'.repeat(32);
    state.prDiff = [file('src/x.ts'), file('src/a.ts'), file('src/b.ts')].join('');
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    state.files.set('main:fleet/ships/code-reviewer.md', 'trusted contract\n'.repeat(1_575));

    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const ai = aiStub({
      perShip: { 'code-reviewer': reviewWithFinding() },
      managerOutput: reviewWithFinding(),
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: db.db }));

    const mapCalls = ai.calls.filter(call => call.phase === 'map');
    expect(mapCalls.length).toBeGreaterThan(1);
    const mapPrompts = mapCalls.map(call => call.messages.map(message => message.content).join('\n'));
    for (const path of ['src/x.ts', 'src/a.ts', 'src/b.ts']) {
      expect(mapPrompts.some(prompt => prompt.includes(path))).toBe(true);
    }
    expect(db.steps.some(step => step.kind === 'map-context-omitted')).toBe(false);
    for (const call of ai.calls) {
      expect(assessContextAdmission(call.model, call.messages, MAX_OUTPUT_TOKENS).accepted).toBe(true);
    }
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('records an indivisible over-budget source chunk and fails without provider dispatch', async () => {
    const giantSource = '+const unreviewableWithoutContext = true;\n'.repeat(2_000);
    state.prDiff =
      'diff --git a/src/giant.ts b/src/giant.ts\n--- a/src/giant.ts\n+++ b/src/giant.ts\n' + giantSource;

    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding() } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: db.db }));

    expect(ai.calls).toHaveLength(0);
    const omission = db.steps.find(step => step.kind === 'map-context-omitted');
    expect(omission).toBeDefined();
    expect(String(omission?.title)).toMatch(/omitted 1 indivisible chunk/i);
    expect(String(omission?.detail)).toContain('src/giant.ts');
    expect(state.completed[0].conclusion).toBe('failure');
  });

  it('partitions oversized MAP findings into admitted REDUCE groups', async () => {
    const budget = mapChunkCharLimit('@cf/qwen/qwen2.5-coder-32b-instruct');
    const linesPerFile = Math.ceil((budget * 0.35) / '+line\n'.length);
    const file = (name: string) =>
      `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n` +
      '+line\n'.repeat(linesPerFile);
    state.prDiff = ['src/x.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts']
      .map(file)
      .join('');

    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const ai = aiStub({
      perShip: { 'code-reviewer': reviewWithFinding('PASS', 'x'.repeat(12_000)) },
      managerOutput: reviewWithFinding(),
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: db.db }));

    expect(ai.calls.filter(call => call.phase === 'map')).toHaveLength(4);
    expect(ai.calls.filter(call => call.phase === 'reduce').length).toBeGreaterThan(1);
    expect(db.steps.some(step => step.kind === 'reduce-partitioned')).toBe(true);
    for (const call of ai.calls) {
      expect(assessContextAdmission(call.model, call.messages, MAX_OUTPUT_TOKENS).accepted).toBe(true);
    }
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
    const disposition = await executeFleet(job, makeEnv({ FLEET_TOKENS: kv, AI: second.ai }));

    // The assertion that is about money.
    expect(second.calls.length).toBe(0);
    expect(disposition).toEqual({ kind: 'already-decided', conclusion: 'success' });
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

  it('malformed proposal JSON on an ideation ship posts the raw output AND fails the run', async () => {
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
    // Broken-ship doctrine (2026-08-19): a malformed proposal block is not an
    // opinion — it is a broken ship, and a broken ship fails the run even
    // though ideation JUDGMENT never gates. The pd-snipe malformed block on
    // the 2026-08-19 run sailed through green; it must not again.
    expect(state.completed[0].conclusion).toBe('failure');
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

// ---------------------------------------------------------------------------
// Attempt checkpoints — retries RESUME instead of restarting (ship-checkpoint.ts).
// The platform-kill dead-letter class (#7743, run 103e3650: four attempts, all
// terminated uncatchably) is survivable only if attempt N+1 skips the ships
// attempt N finished. These tests drive resume through the REAL read/write
// code against the memoryD1 stub.
import {
  loadShipCheckpoints,
  saveShipCheckpoint,
  parseShipCheckpoint,
  SHIP_CHECKPOINT_KIND,
  SHIP_CHECKPOINT_SEQ_BASE,
  SHIP_CHECKPOINT_SCHEMA_VERSION,
  countShipCheckpoints,
} from '../src/ship-checkpoint.js';

describe('attempt checkpoints — retries resume, never re-spend', () => {
  it('returns an intentional continuation after one newly checkpointed ship', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_QA_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const ai = aiStub({
      perShip: {
        'code-reviewer': reviewWithFinding('PASS'),
        qa: 'FLEET-VERDICT: PASS',
      },
    });

    const disposition = await executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }),
      { queueAttempt: 1, maxNewShipsPerInvocation: 1 },
    );

    expect(disposition).toEqual({
      kind: 'continuation',
      completedShip: 'code-reviewer',
      remainingShips: ['qa'],
    });
    expect(ai.calls.filter(call => call.ship === 'code-reviewer').length).toBeGreaterThan(0);
    expect(ai.calls.filter(call => call.ship === 'qa')).toHaveLength(0);
    expect(state.completed).toHaveLength(0);
    expect(d1.steps.filter(step => step.kind === SHIP_CHECKPOINT_KIND).map(step => step.ship))
      .toEqual(['code-reviewer']);
  });

  it('makes monotonic one-ship progress past Lookout and terminates with every ship executed once', async () => {
    state.files.set('main:pd-fleet.yml', LOOKOUT_THEN_REVIEWER_QA_YAML);
    // An active Lookout can legitimately have no other work to report. Empty
    // context is still an exact projection and must hash as evidence, not be
    // confused with the non-Lookout `not-applicable` sentinel.
    state.openPRs = [];
    state.branches = [];
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const ai = aiStub({
      perShip: {
        lookout: CONTRACT_MINIMAL_PASS,
        'code-reviewer': CONTRACT_MINIMAL_PASS,
        qa: CONTRACT_MINIMAL_PASS,
      },
    });
    const env = makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db });

    await expect(executeFleet(makeJob(), env, {
      queueAttempt: 1,
      maxNewShipsPerInvocation: 1,
    })).resolves.toEqual({
      kind: 'continuation',
      completedShip: 'lookout',
      remainingShips: ['code-reviewer', 'qa'],
    });
    await expect(executeFleet(makeJob(), env, {
      queueAttempt: 2,
      maxNewShipsPerInvocation: 1,
    })).resolves.toEqual({
      kind: 'continuation',
      completedShip: 'code-reviewer',
      remainingShips: ['qa'],
    });
    await expect(executeFleet(makeJob(), env, {
      queueAttempt: 3,
      maxNewShipsPerInvocation: 1,
    })).resolves.toBeUndefined();

    expect(ai.calls.filter(call => call.ship === 'lookout')).toHaveLength(1);
    expect(ai.calls.filter(call => call.ship === 'code-reviewer')).toHaveLength(1);
    expect(ai.calls.filter(call => call.ship === 'qa')).toHaveLength(1);
    const lookoutCheckpoint = d1.steps.find(
      step => step.kind === SHIP_CHECKPOINT_KIND && step.ship === 'lookout',
    );
    const lookoutBinding = JSON.parse(String(lookoutCheckpoint?.detail)).checkpointBinding;
    expect(lookoutBinding.lookoutProjectionSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(lookoutBinding.lookoutProjectionSha256).not.toBe('not-applicable');
    expect(lookoutBinding).toEqual(
      await checkpointBindingForYaml(LOOKOUT_THEN_REVIEWER_QA_YAML, 'lookout', null, '', '', ''),
    );
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('freezes an exact empty Lookout projection when both GitHub context reads reject', async () => {
    state.files.set('main:pd-fleet.yml', LOOKOUT_THEN_REVIEWER_QA_YAML);
    const installedFetch = globalThis.fetch;
    const rejectedProjectionUrls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (/\/pulls\?/.test(url) || /\/branches\?/.test(url)) {
        rejectedProjectionUrls.push(url);
        throw new Error('Lookout context transport unavailable');
      }
      return installedFetch(input, init);
    });

    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const ai = aiStub({
      perShip: { lookout: CONTRACT_MINIMAL_PASS },
    });

    await expect(executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }),
      { queueAttempt: 1, maxNewShipsPerInvocation: 1 },
    )).resolves.toEqual({
      kind: 'continuation',
      completedShip: 'lookout',
      remainingShips: ['code-reviewer', 'qa'],
    });

    expect(rejectedProjectionUrls).toHaveLength(2);
    expect(rejectedProjectionUrls.some(url => /\/pulls\?/.test(url))).toBe(true);
    expect(rejectedProjectionUrls.some(url => /\/branches\?/.test(url))).toBe(true);
    const lookoutPrompt = ai.calls
      .find(call => call.ship === 'lookout')
      ?.messages.map(message => message.content).join('\n') ?? '';
    expect(lookoutPrompt).not.toContain('## Fleet context');
    const lookoutCheckpoint = d1.steps.find(
      step => step.kind === SHIP_CHECKPOINT_KIND && step.ship === 'lookout',
    );
    expect(JSON.parse(String(lookoutCheckpoint?.detail)).checkpointBinding).toEqual(
      await checkpointBindingForYaml(LOOKOUT_THEN_REVIEWER_QA_YAML, 'lookout', null, '', '', ''),
    );
  });

  it('keeps stable nonempty mediator orders resumable across one-ship slices', async () => {
    state.files.set('main:pd-fleet.yml', MEDIATOR_LOOKOUT_THEN_REVIEWER_QA_YAML);
    state.openPRs = [
      { number: 700, title: 'Stable peer work', draft: false, head: { ref: 'peer' }, base: { ref: 'main' } },
    ];
    state.branches = [{ name: 'peer' }];
    const kv = memoryKV();
    const control = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const ai = aiStub({
      perShip: {
        lookout: CONTRACT_MINIMAL_PASS,
        'code-reviewer': CONTRACT_MINIMAL_PASS,
        qa: CONTRACT_MINIMAL_PASS,
      },
    });
    const env = makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: control, AI: ai.ai, DB: d1.db });
    const stableOrder = 'Keep the release boundary exact and preserve the proof receipts.';

    await seedMediatorOrders(control, stableOrder);
    await expect(executeFleet(makeJob(), env, {
      queueAttempt: 1,
      maxNewShipsPerInvocation: 1,
    })).resolves.toMatchObject({ kind: 'continuation', completedShip: 'lookout' });
    await seedMediatorOrders(control, stableOrder);
    await expect(executeFleet(makeJob(), env, {
      queueAttempt: 2,
      maxNewShipsPerInvocation: 1,
    })).resolves.toMatchObject({ kind: 'continuation', completedShip: 'code-reviewer' });
    await seedMediatorOrders(control, stableOrder);
    await expect(executeFleet(makeJob(), env, {
      queueAttempt: 3,
      maxNewShipsPerInvocation: 1,
    })).resolves.toBeUndefined();

    expect(ai.calls.filter(call => call.ship === 'lookout')).toHaveLength(1);
    expect(ai.calls.filter(call => call.ship === 'code-reviewer')).toHaveLength(1);
    expect(ai.calls.filter(call => call.ship === 'qa')).toHaveLength(1);
    const mediatorDigests = d1.steps
      .filter(step => step.kind === SHIP_CHECKPOINT_KIND)
      .map(step => JSON.parse(String(step.detail)).checkpointBinding.mediatorOrdersSha256);
    expect(new Set(mediatorDigests).size).toBe(1);
    expect(mediatorDigests[0]).toMatch(/^sha256:/);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('binds and prompts Lookout with the identical frozen projection even if GitHub changes mid-call', async () => {
    state.files.set('main:pd-fleet.yml', LOOKOUT_THEN_REVIEWER_QA_YAML);
    state.openPRs = [
      { number: 700, title: 'Projection A', draft: false, head: { ref: 'projection-a' }, base: { ref: 'main' } },
    ];
    state.branches = [{ name: 'projection-a' }];
    const projectionA = renderFleetContext([
      { number: 700, title: 'Projection A', draft: false, headRef: 'projection-a', baseRef: 'main' },
    ], ['projection-a']);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const ai = aiStub({
      perShip: {
        lookout: CONTRACT_MINIMAL_PASS,
        'code-reviewer': CONTRACT_MINIMAL_PASS,
        qa: CONTRACT_MINIMAL_PASS,
      },
      onCall: call => {
        if (call.ship !== 'lookout') return;
        state.openPRs = [
          { number: 701, title: 'Projection B', draft: false, head: { ref: 'projection-b' }, base: { ref: 'main' } },
        ];
        state.branches = [{ name: 'projection-b' }];
      },
    });

    await executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }),
      { queueAttempt: 1, maxNewShipsPerInvocation: 1 },
    );

    const lookoutPrompt = ai.calls
      .find(call => call.ship === 'lookout')
      ?.messages.map(message => message.content).join('\n') ?? '';
    expect(lookoutPrompt).toContain('#700');
    expect(lookoutPrompt).toContain('projection-a');
    expect(lookoutPrompt).not.toContain('#701');
    expect(lookoutPrompt).not.toContain('projection-b');
    const checkpoint = d1.steps.find(
      step => step.kind === SHIP_CHECKPOINT_KIND && step.ship === 'lookout',
    );
    expect(JSON.parse(String(checkpoint?.detail)).checkpointBinding).toEqual(
      await checkpointBindingForYaml(
        LOOKOUT_THEN_REVIEWER_QA_YAML,
        'lookout',
        null,
        '',
        '',
        projectionA,
      ),
    );
  });

  it('invalidates only Lookout when its frozen projection changes, then converges', async () => {
    state.files.set('main:pd-fleet.yml', LOOKOUT_THEN_REVIEWER_QA_YAML);
    state.openPRs = [
      { number: 700, title: 'Projection A', draft: false, head: { ref: 'projection-a' }, base: { ref: 'main' } },
    ];
    state.branches = [{ name: 'projection-a' }];
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const ai = aiStub({
      perShip: {
        lookout: CONTRACT_MINIMAL_PASS,
        'code-reviewer': CONTRACT_MINIMAL_PASS,
        qa: CONTRACT_MINIMAL_PASS,
      },
    });
    const env = makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db });

    await executeFleet(makeJob(), env, { queueAttempt: 1, maxNewShipsPerInvocation: 1 });
    await executeFleet(makeJob(), env, { queueAttempt: 2, maxNewShipsPerInvocation: 1 });
    state.openPRs = [
      { number: 701, title: 'Projection B', draft: false, head: { ref: 'projection-b' }, base: { ref: 'main' } },
    ];
    state.branches = [{ name: 'projection-b' }];
    await expect(executeFleet(makeJob(), env, {
      queueAttempt: 3,
      maxNewShipsPerInvocation: 1,
    })).resolves.toEqual({
      kind: 'continuation',
      completedShip: 'lookout',
      remainingShips: ['qa'],
    });
    await expect(executeFleet(makeJob(), env, {
      queueAttempt: 4,
      maxNewShipsPerInvocation: 1,
    })).resolves.toBeUndefined();

    expect(ai.calls.filter(call => call.ship === 'lookout')).toHaveLength(2);
    expect(ai.calls.filter(call => call.ship === 'code-reviewer')).toHaveLength(1);
    expect(ai.calls.filter(call => call.ship === 'qa')).toHaveLength(1);
    const invalidatedShips = d1.steps
      .filter(step => step.kind === 'ship-checkpoint-invalidated')
      .map(step => step.ship);
    expect(new Set(invalidatedShips)).toEqual(new Set(['lookout']));
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('invalidates mediator-bound checkpoints on an order change and then converges', async () => {
    state.files.set('main:pd-fleet.yml', MEDIATOR_LOOKOUT_THEN_REVIEWER_QA_YAML);
    state.openPRs = [
      { number: 700, title: 'Stable peer work', draft: false, head: { ref: 'peer' }, base: { ref: 'main' } },
    ];
    state.branches = [{ name: 'peer' }];
    const kv = memoryKV();
    const control = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const ai = aiStub({
      perShip: {
        lookout: CONTRACT_MINIMAL_PASS,
        'code-reviewer': CONTRACT_MINIMAL_PASS,
        qa: CONTRACT_MINIMAL_PASS,
      },
    });
    const env = makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: control, AI: ai.ai, DB: d1.db });
    const orderA = 'Preserve the original release proof.';
    const orderB = 'Re-record the release proof against the new boundary.';

    await seedMediatorOrders(control, orderA);
    await executeFleet(makeJob(), env, { queueAttempt: 1, maxNewShipsPerInvocation: 1 });
    await seedMediatorOrders(control, orderA);
    await executeFleet(makeJob(), env, { queueAttempt: 2, maxNewShipsPerInvocation: 1 });
    await seedMediatorOrders(control, orderB);
    await expect(executeFleet(makeJob(), env, {
      queueAttempt: 3,
      maxNewShipsPerInvocation: 1,
    })).resolves.toEqual({
      kind: 'continuation',
      completedShip: 'lookout',
      remainingShips: ['code-reviewer', 'qa'],
    });
    await seedMediatorOrders(control, orderB);
    await expect(executeFleet(makeJob(), env, {
      queueAttempt: 4,
      maxNewShipsPerInvocation: 1,
    })).resolves.toEqual({
      kind: 'continuation',
      completedShip: 'code-reviewer',
      remainingShips: ['qa'],
    });
    await seedMediatorOrders(control, orderB);
    await expect(executeFleet(makeJob(), env, {
      queueAttempt: 5,
      maxNewShipsPerInvocation: 1,
    })).resolves.toBeUndefined();

    expect(ai.calls.filter(call => call.ship === 'lookout')).toHaveLength(2);
    expect(ai.calls.filter(call => call.ship === 'code-reviewer')).toHaveLength(2);
    expect(ai.calls.filter(call => call.ship === 'qa')).toHaveLength(1);
    const invalidatedShips = new Set(
      d1.steps
        .filter(step => step.kind === 'ship-checkpoint-invalidated')
        .map(step => step.ship),
    );
    expect(invalidatedShips).toEqual(new Set(['lookout', 'code-reviewer']));
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('does not schedule a continuation from a broken first ship with work remaining', async () => {
    // A checkpoint is the only authorization for a bounded invocation to leave
    // the rest of its roster for a later delivery. If a broken first ship were
    // checkpointed, maxNewShips=1 would create error → continuation → re-run
    // loops instead of reaching the current invocation's terminal adjudication.
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_QA_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const ai = aiStub({
      // Include the reviewer in the routed stub so throwForShip reaches its
      // actual model call rather than the generic fallback response.
      perShip: {
        'code-reviewer': 'unused because this call throws',
        qa: 'FLEET-VERDICT: PASS',
      },
      throwForShip: 'code-reviewer',
    });

    const disposition = await executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }),
      { queueAttempt: 1, maxNewShipsPerInvocation: 1 },
    );

    expect(disposition).toBeUndefined();
    expect(ai.calls.filter(call => call.ship === 'code-reviewer').length).toBeGreaterThan(0);
    expect(ai.calls.filter(call => call.ship === 'qa').length).toBeGreaterThan(0);
    expect(d1.steps.filter(step => step.kind === SHIP_CHECKPOINT_KIND && step.ship === 'code-reviewer'))
      .toHaveLength(0);
    expect(d1.steps.some(step => step.kind === 'ship-broken' && step.ship === 'code-reviewer')).toBe(true);
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('failure');
  });

  it('keeps an incomplete-inventory gated ship in the continuation roster', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_RED_TEAM_YAML);
    // An unparseable `/files` payload previously made red-team look gated out,
    // which let the continuation conclude cleanly after code-reviewer alone.
    state.prFilesBody = '{not-json';
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const ai = aiStub({
      perShip: {
        'code-reviewer': reviewWithFinding('PASS'),
        'red-team': reviewWithFinding('PASS'),
      },
    });

    const disposition = await executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }),
      { queueAttempt: 1, maxNewShipsPerInvocation: 1 },
    );

    expect(disposition).toEqual({
      kind: 'continuation',
      completedShip: 'code-reviewer',
      remainingShips: ['red-team'],
    });
    expect(ai.calls.filter(call => call.ship === 'red-team')).toHaveLength(0);
  });

  it('preserves one logical start and end-to-end wall clock across checkpoint retries', async () => {
    vi.useFakeTimers();
    const logicalStart = new Date('2026-08-23T02:00:00.000Z');
    vi.setSystemTime(logicalStart);
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_QA_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const ai = aiStub({
      perShip: {
        'code-reviewer': reviewWithFinding('PASS'),
        qa: 'FLEET-VERDICT: PASS',
      },
    });
    const env = makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db });

    const first = await executeFleet(makeJob(), env, {
      queueAttempt: 1,
      maxNewShipsPerInvocation: 1,
    });
    const durableCreatedAt = Math.floor(logicalStart.getTime() / 1000);
    expect(first).toEqual({
      kind: 'continuation',
      completedShip: 'code-reviewer',
      remainingShips: ['qa'],
    });
    expect(d1.runs).toHaveLength(1);
    expect(Number(d1.runs[0].createdAt)).toBe(durableCreatedAt);
    expect(d1.runs[0].conclusion).toBe('pending');

    vi.setSystemTime(new Date(logicalStart.getTime() + 120_000));
    const second = await executeFleet(makeJob(), env, {
      queueAttempt: 2,
      maxNewShipsPerInvocation: 1,
    });

    expect(second).toBeUndefined();
    expect(d1.runs).toHaveLength(1);
    expect(Number(d1.runs[0].createdAt)).toBe(durableCreatedAt);
    expect(d1.runs[0].conclusion).toBe('success');
    expect(d1.runs[0].ms).toBe(120_000);
  });

  it.each([
    ['zero', 0],
    ['future', Math.floor(new Date('2026-08-23T03:00:00.000Z').getTime() / 1000)],
  ])('falls back to the current attempt clock for a malformed %s durable start', async (_kind, malformedCreatedAt) => {
    vi.useFakeTimers();
    const logicalStart = new Date('2026-08-23T02:00:00.000Z');
    vi.setSystemTime(logicalStart);
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_QA_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const ai = aiStub({
      perShip: {
        'code-reviewer': reviewWithFinding('PASS'),
        qa: 'FLEET-VERDICT: PASS',
      },
    });
    const env = makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db });

    await executeFleet(makeJob(), env, {
      queueAttempt: 1,
      maxNewShipsPerInvocation: 1,
    });
    d1.runs[0].createdAt = malformedCreatedAt;

    vi.setSystemTime(new Date(logicalStart.getTime() + 120_000));
    await executeFleet(makeJob(), env, {
      queueAttempt: 2,
      maxNewShipsPerInvocation: 1,
    });

    expect(d1.runs[0].conclusion).toBe('success');
    expect(d1.runs[0].ms).toBe(0);
  });

  it('a completed run leaves one parseable checkpoint row per ship that ran', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_QA_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const ai = aiStub({
      perShip: {
        'code-reviewer': reviewWithFinding('PASS'),
        qa: 'FLEET-VERDICT: PASS',
      },
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    const checkpoints = d1.steps.filter(st => st.kind === SHIP_CHECKPOINT_KIND);
    expect(checkpoints.map(c => c.ship).sort()).toEqual(['code-reviewer', 'qa']);
    for (const row of checkpoints) {
      expect(Number(row.seq)).toBeGreaterThanOrEqual(SHIP_CHECKPOINT_SEQ_BASE);
      expect(JSON.parse(String(row.detail))).toMatchObject({
        checkpointSchemaVersion: SHIP_CHECKPOINT_SCHEMA_VERSION,
      });
      const parsed = parseShipCheckpoint(row.ship, row.detail);
      expect(parsed?.ship).toBe(row.ship);
    }
  });

  it('a retried delivery reuses a checkpointed ship: no AI re-spend, result still aggregated', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_QA_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    // Attempt 1 (simulated): code-reviewer finished before the platform kill.
    const runId = 'run:delivery-abc'; // makeJob()'s deterministic run id
    await saveShipCheckpoint(
      makeEnv({ DB: d1.db }),
      runId,
      0,
      { ship: 'code-reviewer', blocking: true, verdict: 'PASS', errored: false, findings: [] },
      await checkpointBindingForYaml(REVIEWER_PLUS_QA_YAML, 'code-reviewer'),
    );

    const ai = aiStub({ perShip: { qa: 'FLEET-VERDICT: PASS' } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    // The resumed ship never touched a model; the fresh ship did.
    expect(ai.calls.filter(c => c.ship === 'code-reviewer')).toHaveLength(0);
    expect(ai.calls.filter(c => c.ship === 'qa').length).toBeGreaterThan(0);
    // Its verdict still reached the aggregate: both ships PASS => success.
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('success');
    // And the resume is legible in the transcript.
    const resumedSteps = d1.steps.filter(st => st.kind === 'ship-resumed');
    expect(resumedSteps.map(s => s.ship)).toEqual(['code-reviewer']);
  });

  it('resumes when trusted YAML formatting changes but effective ship policy is identical', async () => {
    // The binding uses a fixed semantic tuple, so reordered YAML keys cannot
    // force unnecessary re-spend while any actual policy change still does.
    const priorBinding = await checkpointBindingForYaml(REVIEWER_YAML, 'code-reviewer');
    const currentBinding = await checkpointBindingForYaml(REORDERED_REVIEWER_YAML, 'code-reviewer');
    expect(currentBinding).toEqual(priorBinding);

    state.files.set('main:pd-fleet.yml', REORDERED_REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    await saveShipCheckpoint(
      makeEnv({ DB: d1.db }),
      'run:delivery-abc',
      0,
      { ship: 'code-reviewer', blocking: true, verdict: 'PASS', errored: false, findings: [] },
      priorBinding,
    );

    const ai = aiStub({ perShip: {} });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls).toHaveLength(0);
    expect(d1.steps.filter(step => step.kind === 'ship-resumed').map(step => step.ship))
      .toEqual(['code-reviewer']);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('re-runs a checkpoint when the trusted ship changes from advisory to blocking', async () => {
    // A cached advisory pass cannot prove the now-required ship satisfied the
    // current policy. The `blocking` bit is therefore part of the binding.
    const advisoryBinding = await checkpointBindingForYaml(
      ADVISORY_REVIEWER_YAML,
      'code-reviewer',
    );
    const blockingBinding = await checkpointBindingForYaml(REVIEWER_YAML, 'code-reviewer');
    expect(blockingBinding).not.toEqual(advisoryBinding);

    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    await saveShipCheckpoint(
      makeEnv({ DB: d1.db }),
      'run:delivery-abc',
      0,
      { ship: 'code-reviewer', blocking: false, verdict: 'PASS', errored: false, findings: [] },
      advisoryBinding,
    );

    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding('PASS') } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls.filter(call => call.ship === 'code-reviewer').length).toBeGreaterThan(0);
    expect(d1.steps.filter(step => step.kind === 'ship-resumed')).toHaveLength(0);
    expect(d1.steps.filter(step => step.kind === 'ship-checkpoint-invalidated')).toMatchObject([
      { ship: 'code-reviewer' },
    ]);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('re-runs a checkpoint when the trusted ship contract text changes', async () => {
    // The config can stay byte-for-byte identical while the authoritative
    // contract changes the review. Contract text is bound into the prompt and
    // cannot be silently inherited from a prior completed result.
    const earlierContract = '# Reviewer contract\n\nReject unsafe changes.\n';
    const currentContract = '# Reviewer contract\n\nRequire explicit threat analysis.\n';
    const priorBinding = await checkpointBindingForYaml(
      REVIEWER_YAML,
      'code-reviewer',
      earlierContract,
    );
    const currentBinding = await checkpointBindingForYaml(
      REVIEWER_YAML,
      'code-reviewer',
      currentContract,
    );
    expect(currentBinding).not.toEqual(priorBinding);

    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    state.files.set('main:fleet/ships/code-reviewer.md', currentContract);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    await saveShipCheckpoint(
      makeEnv({ DB: d1.db }),
      'run:delivery-abc',
      0,
      { ship: 'code-reviewer', blocking: true, verdict: 'PASS', errored: false, findings: [] },
      priorBinding,
    );

    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding('PASS') } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls.filter(call => call.ship === 'code-reviewer').length).toBeGreaterThan(0);
    expect(d1.steps.filter(step => step.kind === 'ship-resumed')).toHaveLength(0);
    expect(d1.steps.filter(step => step.kind === 'ship-checkpoint-invalidated')).toMatchObject([
      { ship: 'code-reviewer' },
    ]);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('re-runs a checkpoint when the live PR title or description changes without a new head', async () => {
    // GitHub permits metadata edits without a push, so the delivery id/head
    // are unchanged. The model's user prompt is not: it includes both fields.
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    state.prTitle = 'Initial fleet hardening';
    state.prBody = 'Review the original admission rule.';
    const priorBinding = await checkpointBindingForYaml(REVIEWER_YAML, 'code-reviewer');

    state.prTitle = 'Corrected fleet hardening';
    state.prBody = 'Review the corrected admission rule and new failure mode.';
    const currentBinding = await checkpointBindingForYaml(REVIEWER_YAML, 'code-reviewer');
    expect(currentBinding).not.toEqual(priorBinding);

    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    await saveShipCheckpoint(
      makeEnv({ DB: d1.db }),
      'run:delivery-abc',
      0,
      { ship: 'code-reviewer', blocking: true, verdict: 'PASS', errored: false, findings: [] },
      priorBinding,
    );

    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding('PASS') } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls.filter(call => call.ship === 'code-reviewer').length).toBeGreaterThan(0);
    expect(d1.steps.filter(step => step.kind === 'ship-resumed')).toHaveLength(0);
    expect(d1.steps.filter(step => step.kind === 'ship-checkpoint-invalidated')).toMatchObject([
      { ship: 'code-reviewer' },
    ]);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('re-runs a checkpoint when the live diff or changed-file inventory changes', async () => {
    // The head is intentionally unchanged. The exact diff and file index both
    // render into reviewer/Purser input, so a stale checkpoint cannot survive
    // a GitHub context refresh that changes either projection.
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const priorBinding = await checkpointBindingForYaml(REVIEWER_YAML, 'code-reviewer');

    state.prDiff = [
      'diff --git a/src/changed.ts b/src/changed.ts',
      '--- a/src/changed.ts',
      '+++ b/src/changed.ts',
      '@@ -0,0 +1 @@',
      '+export const changed = true;',
      '',
    ].join('\n');
    state.prFiles = [{ filename: 'src/changed.ts', status: 'added', additions: 1, deletions: 0 }];
    const currentBinding = await checkpointBindingForYaml(REVIEWER_YAML, 'code-reviewer');
    expect(currentBinding).not.toEqual(priorBinding);

    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    await saveShipCheckpoint(
      makeEnv({ DB: d1.db }),
      'run:delivery-abc',
      0,
      { ship: 'code-reviewer', blocking: true, verdict: 'PASS', errored: false, findings: [] },
      priorBinding,
    );

    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding('PASS') } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls.filter(call => call.ship === 'code-reviewer').length).toBeGreaterThan(0);
    expect(d1.steps.filter(step => step.kind === 'ship-resumed')).toHaveLength(0);
    expect(d1.steps.filter(step => step.kind === 'ship-checkpoint-invalidated')).toMatchObject([
      { ship: 'code-reviewer' },
    ]);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('invalidates and re-runs a stale ERROR checkpoint when its review input drifts', async () => {
    // #9914 shape: an ERROR recorded before a PR description correction must
    // not reach epidemic adjudication as though it were this delivery's fresh
    // model evidence. Binding drift is checked before error eligibility so the
    // transcript makes the stale-input cause explicit.
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    state.prTitle = 'Before the correction';
    const staleBinding = await checkpointBindingForYaml(REVIEWER_YAML, 'code-reviewer');
    state.prTitle = 'After the correction';
    const currentBinding = await checkpointBindingForYaml(REVIEWER_YAML, 'code-reviewer');
    expect(currentBinding).not.toEqual(staleBinding);

    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    d1.steps.push({
      runId: 'run:delivery-abc',
      seq: SHIP_CHECKPOINT_SEQ_BASE,
      kind: SHIP_CHECKPOINT_KIND,
      ship: 'code-reviewer',
      title: 'historical ERROR checkpoint',
      detail: JSON.stringify({
        ship: 'code-reviewer',
        blocking: true,
        verdict: 'PASS',
        errored: true,
        findings: [],
        checkpointSchemaVersion: SHIP_CHECKPOINT_SCHEMA_VERSION,
        checkpointBinding: staleBinding,
      }),
    });

    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding('PASS') } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls.filter(call => call.ship === 'code-reviewer').length).toBeGreaterThan(0);
    expect(d1.steps.filter(step => step.kind === 'ship-resumed')).toHaveLength(0);
    expect(d1.steps.filter(step => step.kind === 'ship-checkpoint-invalidated')).toMatchObject([
      { ship: 'code-reviewer' },
    ]);
    expect(JSON.parse(String(d1.steps.find(step => step.kind === 'ship-checkpoint-invalidated')?.detail)))
      .toMatchObject({ reason: 'trusted-binding-mismatch' });
    expect(state.completed[0].conclusion).toBe('success');
  });

  it.each([
    {
      label: 'ERROR',
      result: { verdict: 'PASS' as const, errored: true, findings: [] },
    },
    {
      label: 'no-usable-output',
      result: { verdict: 'PASS' as const, errored: false, noUsableOutput: true, findings: [] },
    },
  ])('does not resume a matching $label checkpoint', async ({ result }) => {
    // Historical rows can predate the save-side guard below. Even with a
    // perfect current binding, a broken result is diagnostic evidence rather
    // than permission to skip a fresh model attempt.
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const binding = await checkpointBindingForYaml(REVIEWER_YAML, 'code-reviewer');
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    d1.steps.push({
      runId: 'run:delivery-abc',
      seq: SHIP_CHECKPOINT_SEQ_BASE,
      kind: SHIP_CHECKPOINT_KIND,
      ship: 'code-reviewer',
      title: 'historical broken checkpoint',
      detail: JSON.stringify({
        ship: 'code-reviewer',
        blocking: true,
        ...result,
        checkpointSchemaVersion: SHIP_CHECKPOINT_SCHEMA_VERSION,
        checkpointBinding: binding,
      }),
    });

    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding('PASS') } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls.filter(call => call.ship === 'code-reviewer').length).toBeGreaterThan(0);
    expect(d1.steps.filter(step => step.kind === 'ship-resumed')).toHaveLength(0);
    expect(JSON.parse(String(d1.steps.find(step => step.kind === 'ship-checkpoint-invalidated')?.detail)))
      .toMatchObject({ reason: 'non-resumable-result' });
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('does not persist ERROR or no-usable-output results as checkpoint progress', async () => {
    const d1 = memoryD1();
    const binding = await checkpointBindingForYaml(REVIEWER_YAML, 'code-reviewer');
    const env = makeEnv({ DB: d1.db });

    await expect(saveShipCheckpoint(
      env,
      'run:delivery-abc',
      0,
      { ship: 'code-reviewer', blocking: true, verdict: 'PASS', errored: true, findings: [] },
      binding,
    )).resolves.toBe(false);
    await expect(saveShipCheckpoint(
      env,
      'run:delivery-abc',
      0,
      {
        ship: 'code-reviewer',
        blocking: true,
        verdict: 'PASS',
        errored: false,
        noUsableOutput: true,
        findings: [],
      },
      binding,
    )).resolves.toBe(false);
    expect(d1.steps).toHaveLength(0);
  });

  it('requires an executed Purser sandbox receipt before saving or resuming PASS', async () => {
    const failed = memoryD1();
    failed.steps.push({
      runId: 'run:delivery-abc',
      seq: 7,
      kind: 'purser-sandbox',
      ship: 'purser',
      title: 'pd-purser: sandbox NOT RUN',
      detail: JSON.stringify({
        executed: false,
        passed: null,
        outcomeKind: 'not-executed',
        reason: 'sandbox setup failed before the test runner started',
      }),
    });
    const falsePass = {
      ship: 'purser',
      blocking: true,
      verdict: 'PASS' as const,
      errored: false,
      findings: [],
    };

    await expect(saveShipCheckpoint(
      makeEnv({ DB: failed.db }),
      'run:delivery-abc',
      0,
      falsePass,
      PURSER_CHECKPOINT_BINDING,
    )).resolves.toBe(false);
    expect(failed.steps.filter(step => step.kind === SHIP_CHECKPOINT_KIND)).toHaveLength(0);

    // A row written by the buggy executor is diagnostic evidence only. The
    // current loader must consult the same run's sandbox receipt and rerun
    // Purser instead of inheriting the false PASS into another queue slice.
    failed.steps.push({
      runId: 'run:delivery-abc',
      seq: SHIP_CHECKPOINT_SEQ_BASE,
      kind: SHIP_CHECKPOINT_KIND,
      ship: 'purser',
      title: 'historical false Purser PASS',
      detail: JSON.stringify({
        ...falsePass,
        checkpointSchemaVersion: SHIP_CHECKPOINT_SCHEMA_VERSION,
        // Pre-fix Purser bindings had no execution-receipt requirement. The
        // current trusted binding must invalidate that row before reuse.
        checkpointBinding: TEST_CHECKPOINT_BINDING,
      }),
    });
    const invalidated: string[] = [];
    await expect(loadShipCheckpoints(
      makeEnv({ DB: failed.db }),
      'run:delivery-abc',
      new Map([['purser', PURSER_CHECKPOINT_BINDING]]),
      (_ship, reason) => { invalidated.push(reason); },
    )).resolves.toEqual(new Map());
    expect(invalidated).toEqual(['trusted-binding-mismatch']);

    // Positive control: an exact structured execution receipt still permits
    // monotonic continuation, so this hardening cannot recreate starvation.
    const executed = memoryD1();
    executed.steps.push({
      runId: 'run:delivery-good',
      seq: 7,
      kind: 'purser-sandbox',
      ship: 'purser',
      title: 'pd-purser: sandbox PASSED',
      detail: JSON.stringify({
        executed: true,
        passed: true,
        outcomeKind: 'passed',
        failuresTail: '',
      }),
    });
    await expect(saveShipCheckpoint(
      makeEnv({ DB: executed.db }),
      'run:delivery-good',
      0,
      falsePass,
      PURSER_CHECKPOINT_BINDING,
    )).resolves.toBe(true);
    const saved = executed.steps.find(step => step.kind === SHIP_CHECKPOINT_KIND)!;
    expect(JSON.parse(String(saved.detail))).toMatchObject({
      verdict: 'PASS',
      checkpointExecutionReceipt: {
        kind: 'purser-sandbox-v1',
        executed: true,
        passed: true,
        outcomeKind: 'passed',
      },
    });
    executed.steps.splice(
      executed.steps.findIndex(step => step.kind === 'purser-sandbox'),
      1,
    );
    await expect(loadShipCheckpoints(
      makeEnv({ DB: executed.db }),
      'run:delivery-good',
      new Map([['purser', PURSER_CHECKPOINT_BINDING]]),
    )).resolves.toEqual(new Map([['purser', falsePass]]));

    const mismatched = JSON.parse(String(saved.detail)) as Record<string, unknown>;
    mismatched.checkpointExecutionReceipt = {
      kind: 'purser-sandbox-v1',
      executed: true,
      passed: false,
      outcomeKind: 'assertion-failure',
    };
    saved.detail = JSON.stringify(mismatched);
    await expect(loadShipCheckpoints(
      makeEnv({ DB: executed.db }),
      'run:delivery-good',
      new Map([['purser', PURSER_CHECKPOINT_BINDING]]),
    )).resolves.toEqual(new Map());
  });

  it('refuses to persist a Lookout checkpoint with the non-applicable projection sentinel', async () => {
    const d1 = memoryD1();
    const binding = await checkpointBindingForYaml(
      LOOKOUT_THEN_REVIEWER_QA_YAML,
      'lookout',
      null,
      '',
      '',
      '',
    );

    await expect(saveShipCheckpoint(
      makeEnv({ DB: d1.db }),
      'run:delivery-abc',
      0,
      { ship: 'lookout', blocking: false, verdict: 'PASS', errored: false, findings: [] },
      { ...binding, lookoutProjectionSha256: 'not-applicable' },
    )).resolves.toBe(false);
    expect(d1.steps).toHaveLength(0);
  });

  it('invalidates a mediator-scoped checkpoint after its Modify order is consumed', async () => {
    // Attempt one consumes and applies the human order. Attempt two sees the
    // explicit no-order sentinel; it must re-run rather than reuse a verdict
    // made under instructions that no longer appear in the current context.
    state.files.set('main:pd-fleet.yml', MEDIATOR_REVIEWER_PLUS_QA_YAML);
    const kv = memoryKV();
    const control = memoryKV();
    seedToken(kv, 42);
    await control.put(
      'mediator:reinjection:erichowens/port-daddy:7',
      JSON.stringify({
        parleyId: '979f6940-e0b0-42b9-ab21-078bbb2acae6',
        repo: 'erichowens/port-daddy',
        pr: 7,
        action: 'merge',
        modifyText: 'Reconcile the conflicting error-boundary behavior before concluding.',
        decidedBy: 'operator',
        at: 1_756_320_000,
      }),
    );
    const d1 = memoryD1();
    const ai = aiStub({
      perShip: {
        'code-reviewer': reviewWithFinding('PASS'),
        qa: 'FLEET-VERDICT: PASS',
      },
    });
    const env = makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: control, AI: ai.ai, DB: d1.db });

    const first = await executeFleet(makeJob(), env, {
      queueAttempt: 1,
      maxNewShipsPerInvocation: 1,
    });
    expect(first).toEqual({
      kind: 'continuation',
      completedShip: 'code-reviewer',
      remainingShips: ['qa'],
    });
    expect(control._store.has('mediator:reinjection:erichowens/port-daddy:7')).toBe(false);
    const firstReviewerCalls = ai.calls.filter(call => call.ship === 'code-reviewer').length;
    expect(firstReviewerCalls).toBeGreaterThan(0);
    expect(JSON.stringify(ai.calls)).toContain('MEDIATOR ORDERS');
    const firstCheckpoint = d1.steps.find(
      step => step.kind === SHIP_CHECKPOINT_KIND && step.ship === 'code-reviewer',
    );
    expect(JSON.parse(String(firstCheckpoint?.detail)).checkpointBinding.mediatorOrdersSha256)
      .toMatch(/^sha256:/);

    const second = await executeFleet(makeJob(), env, {
      queueAttempt: 2,
      maxNewShipsPerInvocation: 1,
    });
    expect(second).toEqual({
      kind: 'continuation',
      completedShip: 'code-reviewer',
      remainingShips: ['qa'],
    });
    expect(ai.calls.filter(call => call.ship === 'code-reviewer').length).toBeGreaterThan(firstReviewerCalls);
    expect(JSON.stringify(ai.calls.slice(firstReviewerCalls))).not.toContain('MEDIATOR ORDERS');
    expect(d1.steps.filter(step => step.kind === 'ship-resumed' && step.ship === 'code-reviewer'))
      .toHaveLength(0);
    expect(JSON.parse(String(d1.steps.find(step => step.kind === 'ship-checkpoint-invalidated')?.detail)))
      .toMatchObject({ reason: 'trusted-binding-mismatch' });
    const latestCheckpoint = d1.steps.filter(
      step => step.kind === SHIP_CHECKPOINT_KIND && step.ship === 'code-reviewer',
    ).at(-1);
    expect(JSON.parse(String(latestCheckpoint?.detail)).checkpointBinding.mediatorOrdersSha256)
      .toBe('absent');
  });

  it('multiple checkpointed ships resume in roster order with their findings intact', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_QA_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const runId = 'run:delivery-abc';
    await saveShipCheckpoint(
      makeEnv({ DB: d1.db }),
      runId,
      0,
      {
        ship: 'code-reviewer',
        blocking: true,
        verdict: 'PASS',
        errored: false,
        findings: [{ path: 'src/x.ts', line: 1, severity: 'LOW', body: 'reviewer finding' }],
      },
      await checkpointBindingForYaml(REVIEWER_PLUS_QA_YAML, 'code-reviewer'),
    );
    await saveShipCheckpoint(
      makeEnv({ DB: d1.db }),
      runId,
      1,
      {
        ship: 'qa',
        blocking: false,
        verdict: 'PASS',
        errored: false,
        findings: [{ path: 'src/x.ts', line: 2, severity: 'LOW', body: 'qa finding' }],
      },
      await checkpointBindingForYaml(REVIEWER_PLUS_QA_YAML, 'qa'),
    );

    const ai = aiStub({ perShip: {} });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls).toHaveLength(0);
    expect(d1.steps.filter(st => st.kind === 'ship-resumed').map(st => st.ship)).toEqual([
      'code-reviewer',
      'qa',
    ]);
    expect(state.completed[0].conclusion).toBe('success');
    expect(state.reviews).toHaveLength(1);
    expect(state.reviews[0].comments).toEqual([
      { path: 'src/x.ts', line: 1, body: '[code-reviewer] reviewer finding' },
      { path: 'src/x.ts', line: 2, body: '[qa] qa finding' },
    ]);
  });

  it('a resumed BLOCK verdict fails the gate without re-running the ship', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_QA_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    await saveShipCheckpoint(
      makeEnv({ DB: d1.db }),
      'run:delivery-abc',
      0,
      {
        ship: 'code-reviewer',
        blocking: true,
        verdict: 'BLOCK',
        errored: false,
        findings: [{ path: 'src/x.ts', line: 1, severity: 'HIGH', body: 'checkpointed finding' }],
      },
      await checkpointBindingForYaml(REVIEWER_PLUS_QA_YAML, 'code-reviewer'),
    );

    const ai = aiStub({ perShip: { qa: 'FLEET-VERDICT: PASS' } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls.filter(c => c.ship === 'code-reviewer')).toHaveLength(0);
    expect(state.completed[0].conclusion).toBe('failure');
  });

  it('a corrupt checkpoint row is ignored — the ship re-runs (fail-open to work, closed to trust)', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    // Raw garbage in the checkpoint band: unparseable detail must never resume.
    d1.steps.push({
      runId: 'run:delivery-abc',
      seq: SHIP_CHECKPOINT_SEQ_BASE,
      kind: SHIP_CHECKPOINT_KIND,
      ship: 'code-reviewer',
      title: 'corrupt',
      detail: '{not json',
    });

    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding('PASS') } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls.filter(c => c.ship === 'code-reviewer').length).toBeGreaterThan(0);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('a valid-but-v2 checkpoint is ignored and re-runs the ship', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    // This is the former v2 wire shape: clean and internally valid, but it
    // predates trusted config/contract binding so must not resume after deploy.
    d1.steps.push({
      runId: 'run:delivery-abc',
      seq: SHIP_CHECKPOINT_SEQ_BASE,
      kind: SHIP_CHECKPOINT_KIND,
      ship: 'code-reviewer',
      title: 'v2 clean checkpoint',
      detail: JSON.stringify({
        ship: 'code-reviewer',
        blocking: true,
        verdict: 'PASS',
        errored: false,
        findings: [],
        checkpointSchemaVersion: 2,
      }),
    });

    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding('PASS') } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls.filter(call => call.ship === 'code-reviewer').length).toBeGreaterThan(0);
    expect(d1.steps.filter(step => step.kind === 'ship-resumed')).toHaveLength(0);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('does not report a versionless checkpoint as resumable DLQ progress', async () => {
    const d1 = memoryD1();
    d1.steps.push({
      runId: 'run:delivery-abc',
      seq: SHIP_CHECKPOINT_SEQ_BASE,
      kind: SHIP_CHECKPOINT_KIND,
      ship: 'code-reviewer',
      title: 'legacy clean checkpoint',
      detail: JSON.stringify({
        ship: 'code-reviewer',
        blocking: true,
        verdict: 'PASS',
        errored: false,
      }),
    });

    await expect(countShipCheckpoints(makeEnv({ DB: d1.db }), 'run:delivery-abc')).resolves.toBe(0);
  });

  it("another delivery's checkpoints never leak in: run ids partition resume state", async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    // A checkpoint from a DIFFERENT delivery (new push = new deliveryId).
    await saveShipCheckpoint(
      makeEnv({ DB: d1.db }),
      'run:some-other-delivery',
      0,
      { ship: 'code-reviewer', blocking: true, verdict: 'PASS', errored: false, findings: [] },
      TEST_CHECKPOINT_BINDING,
    );

    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding('PASS') } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls.filter(c => c.ship === 'code-reviewer').length).toBeGreaterThan(0);
  });

  it('a checkpoint for a ship removed from the current roster is unreachable', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    await saveShipCheckpoint(
      makeEnv({ DB: d1.db }),
      'run:delivery-abc',
      0,
      { ship: 'removed-ship', blocking: true, verdict: 'BLOCK', errored: false, findings: [] },
      TEST_CHECKPOINT_BINDING,
    );

    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding('PASS') } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    // Resume lookup is driven by the CURRENT ordered roster. Extra map keys
    // are never aggregated, so parser-level roster knowledge is unnecessary.
    expect(ai.calls.filter(c => c.ship === 'code-reviewer').length).toBeGreaterThan(0);
    expect(state.completed[0].conclusion).toBe('success');
    expect(String(state.completed[0].summary)).not.toContain('removed-ship');
  });

  it('a swallowed checkpoint write leaves no state for a later attempt to trust', async () => {
    const d1 = memoryD1();
    const env = makeEnv({ DB: d1.db });
    d1.failAll = true;
    await saveShipCheckpoint(
      env,
      'run:delivery-abc',
      0,
      { ship: 'code-reviewer', blocking: true, verdict: 'PASS', errored: false, findings: [] },
      TEST_CHECKPOINT_BINDING,
    );
    d1.failAll = false;

    expect((await loadShipCheckpoints(env, 'run:delivery-abc', TEST_EXPECTED_CHECKPOINT_BINDINGS)).size).toBe(0);
  });

  it('a checkpoint load query failure returns an empty resume map', async () => {
    const d1 = memoryD1();
    const env = makeEnv({ DB: d1.db });
    d1.failAll = true;

    await expect(loadShipCheckpoints(env, 'run:delivery-abc', TEST_EXPECTED_CHECKPOINT_BINDINGS))
      .resolves.toEqual(new Map());
  });

  it('an invalid ship index uses the first reserved checkpoint slot', async () => {
    for (const invalidIndex of [1.5, -1]) {
      const d1 = memoryD1();
      await saveShipCheckpoint(
        makeEnv({ DB: d1.db }),
        'run:delivery-abc',
        invalidIndex,
        { ship: 'code-reviewer', blocking: true, verdict: 'PASS', errored: false, findings: [] },
        TEST_CHECKPOINT_BINDING,
      );

      expect(d1.steps).toHaveLength(1);
      expect(d1.steps[0].seq).toBe(SHIP_CHECKPOINT_SEQ_BASE);
    }
  });

  it('no D1 binding makes checkpoint load/save harmless no-ops', async () => {
    const env = makeEnv({});
    await expect(saveShipCheckpoint(
      env,
      'run:delivery-abc',
      0,
      { ship: 'code-reviewer', blocking: true, verdict: 'PASS', errored: false, findings: [] },
      TEST_CHECKPOINT_BINDING,
    )).resolves.toBe(false);
    await expect(loadShipCheckpoints(env, 'run:delivery-abc', TEST_EXPECTED_CHECKPOINT_BINDINGS))
      .resolves.toEqual(new Map());
  });

  it('D1 down: checkpoint load/save swallow and the run behaves exactly as before checkpoints', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    d1.failAll = true;

    const ai = aiStub({ perShip: { 'code-reviewer': reviewWithFinding('PASS') } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('parseShipCheckpoint refuses mis-attributed or malformed rows', () => {
    const good = { ship: 'qa', blocking: false, verdict: 'PASS', errored: false };
    const versionedGood = {
      ...good,
      checkpointSchemaVersion: SHIP_CHECKPOINT_SCHEMA_VERSION,
      checkpointBinding: TEST_CHECKPOINT_BINDING,
    };
    expect(parseShipCheckpoint('qa', JSON.stringify(versionedGood))).toEqual(good);
    // Row/detail ship mismatch (band collision after a roster change): refused.
    expect(parseShipCheckpoint('code-reviewer', JSON.stringify(versionedGood))).toBeNull();
    // Schema v3 rows need a complete current binding; a clean-looking legacy
    // result without one cannot prove the policy or prompt it reviewed.
    expect(parseShipCheckpoint('qa', JSON.stringify({ ...good, checkpointSchemaVersion: SHIP_CHECKPOINT_SCHEMA_VERSION })))
      .toBeNull();
    expect(parseShipCheckpoint('qa', JSON.stringify({
      ...versionedGood,
      checkpointBinding: { ...TEST_CHECKPOINT_BINDING, bindingVersion: 1 },
    }))).toBeNull();
    expect(parseShipCheckpoint('qa', JSON.stringify({
      ...versionedGood,
      checkpointBinding: { ...TEST_CHECKPOINT_BINDING, systemPromptSha256: 'sha256:not-a-digest' },
    }))).toBeNull();
    expect(parseShipCheckpoint('qa', JSON.stringify({
      ...versionedGood,
      checkpointBinding: { ...TEST_CHECKPOINT_BINDING, reviewInputSha256: 'sha256:not-a-digest' },
    }))).toBeNull();
    expect(parseShipCheckpoint('qa', JSON.stringify({
      ...versionedGood,
      checkpointBinding: { ...TEST_CHECKPOINT_BINDING, mediatorOrdersSha256: 'sha256:not-a-digest' },
    }))).toBeNull();
    expect(parseShipCheckpoint('qa', JSON.stringify({
      ...versionedGood,
      checkpointBinding: { ...TEST_CHECKPOINT_BINDING, lookoutProjectionSha256: 'sha256:not-a-digest' },
    }))).toBeNull();
    // Unknown verdict, wrong types, and malformed finding payloads: refused.
    expect(parseShipCheckpoint('qa', JSON.stringify({ ...versionedGood, verdict: 'MAYBE' }))).toBeNull();
    expect(parseShipCheckpoint('qa', JSON.stringify({ ...versionedGood, blocking: 'yes' }))).toBeNull();
    expect(parseShipCheckpoint('qa', JSON.stringify({ ...versionedGood, findings: 'none' }))).toBeNull();
    expect(parseShipCheckpoint('qa', JSON.stringify({ ...versionedGood, findings: [null] }))).toBeNull();
    expect(parseShipCheckpoint('qa', JSON.stringify({
      ...versionedGood,
      findings: [{ path: 'src/x.ts', line: 0, severity: 'HIGH', body: 'bad line' }],
    }))).toBeNull();
    expect(parseShipCheckpoint('qa', JSON.stringify({
      ...versionedGood,
      findings: [{
        path: 'src/x.ts',
        line: Number.MAX_SAFE_INTEGER + 1,
        severity: 'HIGH',
        body: 'unsafe line',
      }],
    }))).toBeNull();
    expect(parseShipCheckpoint('qa', JSON.stringify({
      ...versionedGood,
      findings: [{ path: 'src/x.ts', line: 1, severity: 'URGENT', body: 'bad severity' }],
    }))).toBeNull();
    expect(parseShipCheckpoint('qa', 'not json')).toBeNull();
    expect(parseShipCheckpoint('', JSON.stringify(versionedGood))).toBeNull();
  });
});
