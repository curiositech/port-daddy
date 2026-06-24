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

// A pd-fleet.yml present on the trusted branch. The AI fleet-parser stub maps
// this to whatever ships the test wants, so the YAML body is opaque here.
const FLEET_YAML = 'fleet:\n  agents:\n    code-reviewer:\n      blocking: true\n';

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
    state.files.set('main:pd-fleet.yml', FLEET_YAML);
    state.files.set('main:fleet/ships/code-reviewer.md', '## contract');

    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer review', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
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
    state.files.set('main:pd-fleet.yml', FLEET_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer review', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'HIGH: injection\n\nFLEET-VERDICT: BLOCK' },
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('failure');
  });

  it('blocking ship with NO verdict => failure (fail closed)', async () => {
    state.files.set('main:pd-fleet.yml', FLEET_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer review', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      // No FLEET-VERDICT line at all.
      perShip: { 'code-reviewer': 'I looked and it seems fine, probably.' },
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    expect(state.completed[0].conclusion).toBe('failure');
  });

  it('blocking ship that errors => failure (fail closed) and other ships still run', async () => {
    state.files.set('main:pd-fleet.yml', FLEET_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer review', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
        { name: 'qa', trigger: 'pull_request:opened', prompt: 'qa analysis', cfModel: null, role: 'r', telos: 't', blocking: false, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'x', 'qa': 'gaps\n\nFLEET-VERDICT: PASS' },
      throwForShip: 'code-reviewer',
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    expect(state.completed[0].conclusion).toBe('failure');
    // qa still posted a comment despite code-reviewer crashing.
    expect(state.commentPosts).toBeGreaterThanOrEqual(1);
  });

  it('createCheckRun failure REJECTS (job retries) and never completes a check — fail closed', async () => {
    state.files.set('main:pd-fleet.yml', FLEET_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    state.failCreateCheckRun = 99; // every check-run create fails
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer review', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
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

describe('non-blocking ship semantics', () => {
  it('non-blocking ship BLOCK => check still success-or-neutral (never failure) + comment posted', async () => {
    state.files.set('main:pd-fleet.yml', FLEET_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer review', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
        { name: 'qa', trigger: 'pull_request:opened', prompt: 'qa analysis', cfModel: null, role: 'r', telos: 't', blocking: false, allowedTools: '' },
      ]),
      perShip: {
        'code-reviewer': 'clean\n\nFLEET-VERDICT: PASS',
        'qa': 'missing tests\n\nFLEET-VERDICT: BLOCK',
      },
    }).ai;

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    // A non-blocking BLOCK must NOT fail the merge gate.
    expect(state.completed[0].conclusion).not.toBe('failure');
    expect(state.completed[0].conclusion).toBe('neutral');
    // The advisory finding was still posted.
    expect(state.commentPosts).toBe(2);
  });
});

describe('idempotent re-run', () => {
  it('same deliveryId / head SHA does not double-create the check run', async () => {
    state.files.set('main:pd-fleet.yml', FLEET_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const mkAi = () =>
      aiStub({
        fleetParser: JSON.stringify([
          { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer review', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
        ]),
        perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
      }).ai;

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
    state.files.set('main:pd-fleet.yml', FLEET_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const mkAi = () =>
      aiStub({
        fleetParser: JSON.stringify([
          { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer review', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
        ]),
        perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
      }).ai;

    const job = makeJob();
    await executeFleet(job, makeEnv({ FLEET_TOKENS: kv, AI: mkAi() }));
    // Simulate the comment now existing on GitHub.
    state.existingComments = [{ id: 555, body: 'old\n\n<!-- pd-ship:code-reviewer -->' }];
    await executeFleet(job, makeEnv({ FLEET_TOKENS: kv, AI: mkAi() }));

    expect(state.commentPosts).toBe(1); // only the first run created
    expect(state.commentPatches).toBe(1); // the re-run edited in place
  });
});
