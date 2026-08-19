import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeFleet } from '../src/execute.js';
import {
  SHIP_CHECKPOINT_KIND,
  SHIP_CHECKPOINT_SEQ_BASE,
  loadShipCheckpoints,
  recordShipCheckpoint,
} from '../src/resume.js';
import { DELIVERY_FAILURE_SEQ_BASE } from '../src/delivery-failure.js';
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
import type { ShipResult } from '../src/verdict.js';

function fleetYaml(ships: Array<{ name: string; blocking?: boolean }>): string {
  const body = ships
    .map(s => [
      `    ${s.name}:`,
      '      trigger: pull_request:opened',
      ...(s.blocking ? ['      blocking: true'] : []),
      '      fallbacks:',
      '        - backend: cloudflare',
      "          model: '@cf/qwen/qwen3-30b-a3b-fp8'",
      '      prompt: |',
      `        ${s.name} ship: review the diff and report findings.`,
    ].join('\n'))
    .join('\n');
  return `fleet:\n  name: test\n  agents:\n${body}\n`;
}

function seedToken(kv: KVNamespace, installationId: number): void {
  void kv.put(
    `github_inst_${installationId}`,
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 3_600_000 }),
  );
}

const RESULT: ShipResult = {
  ship: 'code-reviewer',
  blocking: true,
  verdict: 'PASS',
  errored: false,
  findings: [],
};

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ship checkpoints (resumable runs)', () => {
  it('round-trips a result through the real write and read paths', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    await recordShipCheckpoint(env, 'run:x', 0, RESULT);

    const step = db.steps.find(s => s.kind === SHIP_CHECKPOINT_KIND);
    expect(Number(step!.seq)).toBe(SHIP_CHECKPOINT_SEQ_BASE);

    const restored = await loadShipCheckpoints(env, 'run:x');
    expect(restored.get('code-reviewer')).toEqual(RESULT);
  });

  it('lives outside both the narrative and the delivery-failure seq ranges', () => {
    // The Transcript restarts seq at 0 per delivery with INSERT OR REPLACE, so
    // a checkpoint inside the narrative range would be erased by the very
    // attempt trying to resume from it; a collision with the failure block
    // would erase the diagnosis instead.
    expect(SHIP_CHECKPOINT_SEQ_BASE).toBeGreaterThan(DELIVERY_FAILURE_SEQ_BASE + 100_000);
  });

  it('a corrupt checkpoint drops only that ship, not the map', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    await recordShipCheckpoint(env, 'run:x', 0, RESULT);
    await recordShipCheckpoint(env, 'run:x', 1, { ...RESULT, ship: 'qa' });
    db.steps.find(s => s.kind === SHIP_CHECKPOINT_KIND && s.ship === 'qa')!.detail = '{"trunca';

    const restored = await loadShipCheckpoints(env, 'run:x');
    expect(restored.has('code-reviewer')).toBe(true);
    expect(restored.has('qa')).toBe(false);
  });

  it('is empty for a different delivery — checkpoints never leak between runs', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    await recordShipCheckpoint(env, 'run:old-delivery', 0, RESULT);
    expect((await loadShipCheckpoints(env, 'run:new-delivery')).size).toBe(0);
  });

  it('no DB binding degrades to no-checkpoint, never a throw', async () => {
    const env = makeEnv({});
    await expect(recordShipCheckpoint(env, 'run:x', 0, RESULT)).resolves.toBeUndefined();
    expect((await loadShipCheckpoints(env, 'run:x')).size).toBe(0);
  });
});

describe('a redelivered run resumes instead of restarting', () => {
  it('skips checkpointed ships, runs the rest, and reaches one complete verdict', async () => {
    state.files.set('main:pd-fleet.yml', fleetYaml([
      { name: 'code-reviewer', blocking: true },
      { name: 'qa' },
    ]));
    const kv = memoryKV();
    seedToken(kv, 42);
    const stub = aiStub({
      perShip: {
        'code-reviewer': 'should not run\n\nFLEET-VERDICT: BLOCK',
        qa: 'ok\n\nFLEET-VERDICT: PASS',
      },
    });
    const db = memoryD1();
    const env = makeEnv({ FLEET_TOKENS: kv, AI: stub.ai, DB: db.db });

    // Attempt 1 (killed by the platform) got through code-reviewer only.
    await recordShipCheckpoint(env, 'run:delivery-abc', 0, RESULT);

    await executeFleet(makeJob(), env);

    // The summary carries BOTH ships — one restored, one freshly run…
    const summary = String(state.completed.at(-1)!.summary);
    expect(summary).toContain('pd-code-reviewer');
    expect(summary).toContain('pd-qa');
    // …and the restored ship's verdict is the CHECKPOINTED one (PASS), not the
    // stub's BLOCK — proof it was restored, not re-run.
    expect(state.completed.at(-1)!.conclusion).toBe('success');
    expect(summary).not.toContain('should not run');
    // The resume is narrated for the run page.
    expect(db.steps.some(s => s.kind === 'run-resumed')).toBe(true);
  });

  it('a first attempt with no checkpoints behaves exactly as before', async () => {
    state.files.set('main:pd-fleet.yml', fleetYaml([{ name: 'code-reviewer', blocking: true }]));
    const kv = memoryKV();
    seedToken(kv, 42);
    const stub = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const db = memoryD1();

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: stub.ai, DB: db.db }));

    expect(state.completed.at(-1)!.conclusion).toBe('success');
    expect(db.steps.some(s => s.kind === 'run-resumed')).toBe(false);
    // The completed ship left a checkpoint for any future lost attempt.
    expect(db.steps.some(s => s.kind === SHIP_CHECKPOINT_KIND && s.ship === 'code-reviewer')).toBe(true);
  });
});
