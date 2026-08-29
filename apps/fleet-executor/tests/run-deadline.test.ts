/**
 * Tests for the absolute run-deadline gate added to executeFleet in response
 * to a human DO-NOT-SHIP finding on PR #9800: raising the per-call Workers AI
 * deadline (FLEET_AI_CALL_DEADLINE_MS) without a compensating run-level bound
 * lets a roster of retrying ships spend for hours with nothing to stop it.
 *
 * This pins the actual gate: a run whose TRUE first-attempt start (the
 * `fleet_runs.created_at` that survives every continuation/retry) is already
 * older than RUN_ABSOLUTE_DEADLINE_MS must stop before spending on the next
 * ship, completing the check neutral rather than hanging indefinitely.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildSystemPrompt, executeFleet } from '../src/execute.js';
import { RUN_ABSOLUTE_DEADLINE_MS } from '../src/ai-resilience.js';
import { parseFleetShips } from '../src/fleet.js';
import {
  createCheckpointReviewInputSha256,
  createShipCheckpointBinding,
  saveShipCheckpoint,
} from '../src/ship-checkpoint.js';
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

const ADVISORY_QA = [
  'fleet:',
  '  name: test',
  '  agents:',
  '    qa:',
  '      trigger: pull_request:opened',
  '      fallbacks:',
  '        - backend: cloudflare',
  "          model: '@cf/qwen/qwen2.5-coder-32b-instruct'",
  '      prompt: |',
  '        qa ship: review the diff and report findings.',
  '',
].join('\n');

const REVIEWER_PLUS_QA = [
  'fleet:',
  '  name: test',
  '  agents:',
  '    code-reviewer:',
  '      trigger: pull_request:opened',
  '      blocking: true',
  '      fallbacks:',
  '        - backend: cloudflare',
  "          model: '@cf/qwen/qwen2.5-coder-32b-instruct'",
  '      prompt: |',
  '        reviewer ship: review the diff and report findings.',
  '    qa:',
  '      trigger: pull_request:opened',
  '      fallbacks:',
  '        - backend: cloudflare',
  "          model: '@cf/qwen/qwen2.5-coder-32b-instruct'",
  '      prompt: |',
  '        qa ship: review the diff and report findings.',
  '',
].join('\n');

function seedToken(kv: KVNamespace): void {
  void kv.put(
    'github_inst_42',
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 3_600_000 }),
  );
}

/** Match the executor's pre-resume trusted config/contract/PR-input snapshot. */
async function checkpointBindingForYaml(config: string, shipName: string) {
  const ship = parseFleetShips(config, 'pull_request:opened')?.find(candidate => candidate.name === shipName);
  if (!ship) throw new Error(`fixture does not declare ${shipName}`);
  const diff = state.prDiff ?? 'diff --git a/src/x.ts b/src/x.ts\n+changed';
  const reviewInputSha256 = await createCheckpointReviewInputSha256({
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
  return createShipCheckpointBinding(ship, null, '', buildSystemPrompt(ship, null), reviewInputSha256);
}

/** Seed this run's TRUE first-attempt start far enough in the past to have
 * already exceeded RUN_ABSOLUTE_DEADLINE_MS by the time executeFleet runs. */
function seedStaleRun(d1: ReturnType<typeof memoryD1>, runId: string, createdAtSec: number): void {
  void d1.db
    .prepare(
      `INSERT OR REPLACE INTO fleet_runs (id, delivery_id, repo_full_name, pr_number, pr_url, head_sha, conclusion, ships_csv, ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`,
    )
    .bind(runId, 'delivery-abc', 'erichowens/port-daddy', 7, '', 'HEADSHA', '', createdAtSec)
    .run();
}

let state: GitHubState;
const TEST_NOW_MS = Date.parse('2026-08-27T02:00:00Z');

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(TEST_NOW_MS);
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function runFleet(runStartedAtSec: number | null) {
  state.files.set('main:pd-fleet.yml', ADVISORY_QA);
  const kv = memoryKV();
  seedToken(kv);
  const d1 = memoryD1();
  // makeJob()'s default deliveryId is 'delivery-abc', so the deterministic
  // run id executeFleet computes is 'run:delivery-abc'.
  if (runStartedAtSec != null) seedStaleRun(d1, 'run:delivery-abc', runStartedAtSec);
  const ai = aiStub({ perShip: { qa: 'FLEET-VERDICT: PASS' } });
  await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));
  return { d1, ai };
}

describe('absolute run deadline (DO-NOT-SHIP finding on #9800)', () => {
  it('stops BEFORE any ship spend once the run has exceeded its absolute budget', async () => {
    const staleStart = Math.floor(Date.now() / 1000) - Math.ceil(RUN_ABSOLUTE_DEADLINE_MS / 1000) - 60;
    const { d1, ai } = await runFleet(staleStart);

    expect(ai.calls.length).toBe(0); // no ship ever spent
    expect(state.completed[0].conclusion).toBe('neutral');
    expect(state.completed[0].summary).toContain('exceeded its');
    expect(state.completed[0].summary).toContain('run budget');

    const step = d1.steps.find(s => s.kind === 'run-deadline-exceeded');
    expect(step).toBeDefined();
    expect(String(step!.ship)).toBe('qa'); // stopped before the next ship in the roster
  });

  it('runs normally when the run is well within its absolute budget', async () => {
    const freshStart = Math.floor(Date.now() / 1000) - 30; // 30s old, nowhere near the ceiling
    const { d1, ai } = await runFleet(freshStart);

    expect(ai.calls.length).toBeGreaterThan(0); // the ship actually ran
    expect(state.completed[0].conclusion).toBe('success');
    expect(d1.steps.some(s => s.kind === 'run-deadline-exceeded')).toBe(false);
  });

  it('still admits the next ship after 120 minutes of legitimate checkpointed review work', async () => {
    // Production receipts for PRs #9892 and #9897 reached 82-93 minutes before
    // the remaining Purser work could begin. The 75-minute ceiling therefore
    // made the default nine-ship roster structurally incapable of returning a
    // verdict even though every completed ship had checkpointed successfully.
    const checkpointedStart = Math.floor(Date.now() / 1000) - 120 * 60;
    const { d1, ai } = await runFleet(checkpointedStart);

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.completed[0].conclusion).toBe('success');
    expect(d1.steps.some(s => s.kind === 'run-deadline-exceeded')).toBe(false);
  });

  it('admits the next ship at exactly the three-hour boundary', async () => {
    const boundaryStart = Math.floor(TEST_NOW_MS / 1000) - RUN_ABSOLUTE_DEADLINE_MS / 1000;
    const { d1, ai } = await runFleet(boundaryStart);

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.completed[0].conclusion).toBe('success');
    expect(d1.steps.some(s => s.kind === 'run-deadline-exceeded')).toBe(false);
  });

  it('stops before ship spend one second beyond the three-hour boundary', async () => {
    const expiredStart = Math.floor(TEST_NOW_MS / 1000) - RUN_ABSOLUTE_DEADLINE_MS / 1000 - 1;
    const { d1, ai } = await runFleet(expiredStart);

    expect(ai.calls.length).toBe(0);
    expect(state.completed[0].conclusion).toBe('neutral');
    expect(d1.steps.some(s => s.kind === 'run-deadline-exceeded')).toBe(true);
  });

  it('reuses free checkpoints before stopping at the first ship that would spend', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_PLUS_QA);
    const kv = memoryKV();
    seedToken(kv);
    const d1 = memoryD1();
    const staleStart = Math.floor(Date.now() / 1000) - RUN_ABSOLUTE_DEADLINE_MS / 1000 - 1;
    seedStaleRun(d1, 'run:delivery-abc', staleStart);
    await saveShipCheckpoint(
      makeEnv({ DB: d1.db }),
      'run:delivery-abc',
      0,
      {
        ship: 'code-reviewer',
        blocking: true,
        verdict: 'PASS',
        errored: false,
        findings: [],
      },
      await checkpointBindingForYaml(REVIEWER_PLUS_QA, 'code-reviewer'),
    );
    const ai = aiStub({ perShip: { qa: 'FLEET-VERDICT: PASS' } });

    await executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }),
    );

    expect(ai.calls).toHaveLength(0);
    expect(d1.steps.filter(s => s.kind === 'ship-resumed').map(s => s.ship)).toEqual([
      'code-reviewer',
    ]);
    const deadline = d1.steps.find(s => s.kind === 'run-deadline-exceeded');
    expect(deadline?.ship).toBe('qa');
    expect(JSON.parse(String(deadline?.detail)).shipsCompleted).toBe(1);
  });

  it('fails open (runs normally) when the run\'s start time cannot be determined', async () => {
    // No seeded row at all — getRunStartedAtSec returns null on a first
    // delivery before recordRunStart's own row exists in a way this test can
    // race, so this also covers "brand new run, first ever delivery".
    const { d1, ai } = await runFleet(null);
    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.completed[0].conclusion).toBe('success');
    expect(d1.steps.some(s => s.kind === 'run-deadline-exceeded')).toBe(false);
  });
});
