import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeFleet } from '../src/execute.js';
import { freshState, installGitHubFetch, memoryD1, memoryKV, aiStub, makeEnv, makeJob } from './harness.js';
import { setRepoShipControl } from '../../shared/repo-ship-controls.js';
import { shipControlsDb } from '../../relay/tests/ship-controls-db.js';

const YAML = `fleet:
  agents:
    code-reviewer:
      trigger: pull_request:opened
      blocking: true
      prompt: code-reviewer ship
    qa:
      trigger: pull_request:opened
      prompt: qa ship
`;
const PASS = '```json\n[]\n```\nFLEET-VERDICT: PASS';
let state: ReturnType<typeof freshState>;
let controls: ReturnType<typeof shipControlsDb>;
let capture: ReturnType<typeof memoryD1>;

beforeEach(() => {
  state = freshState();
  state.files.set('main:pd-fleet.yml', YAML);
  installGitHubFetch(state);
  controls = shipControlsDb(); capture = memoryD1();
});
afterEach(() => { controls.sqlite.close(); vi.unstubAllGlobals(); });

function database() {
  return { prepare(sql: string) {
    return sql.includes('repo_ship_controls') ? controls.db.prepare(sql) : capture.db.prepare(sql);
  } } as D1Database;
}
function environment(ai = aiStub({ perShip: { 'code-reviewer': PASS, qa: PASS } })) {
  const tokens = memoryKV();
  void tokens.put('github_inst_42', JSON.stringify({ token: 'mock-token', expiresAt: Date.now() + 3_600_000 }));
  return { ai, env: makeEnv({ AI: ai.ai, DB: database(), FLEET_TOKENS: tokens }) };
}

describe('cloud ship execution consumes signed-in repository controls', () => {
  it('repository OFF consumes delivery with no AI, sandbox, or review, and an honest neutral check', async () => {
    await setRepoShipControl(controls.db, 'erichowens/port-daddy', '*', false, 0, 'admin');
    const { env, ai } = environment();
    await executeFleet(makeJob(), env);
    expect(ai.calls).toHaveLength(0);
    expect(state.reviews).toHaveLength(0);
    expect(state.completed.at(-1)?.conclusion).toBe('neutral');
    expect(state.completed.at(-1)?.summary).toContain('off for this repository');
  });
  it('one disabled ship does not spend while its enabled peer executes; never reports disabled as PASS', async () => {
    await setRepoShipControl(controls.db, 'erichowens/port-daddy', 'code-reviewer', false, 0, 'admin');
    const { env, ai } = environment();
    await executeFleet(makeJob(), env);
    expect(ai.calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(ai.calls)).not.toContain('code-reviewer ship');
    expect(JSON.stringify(ai.calls)).toContain('qa ship');
    expect(state.completed.at(-1)?.conclusion).toBe('neutral');
    expect(state.completed.at(-1)?.summary).toContain('not reviewed');
    expect(capture.steps.some(step => step.ship === 'code-reviewer' && step.kind === 'ship-skipped')).toBe(true);
  });
  it('does not apply a different repository control to this job', async () => {
    await setRepoShipControl(controls.db, 'someone/else', '*', false, 0, 'admin');
    const { env, ai } = environment();
    await executeFleet(makeJob(), env);
    expect(JSON.stringify(ai.calls)).toContain('code-reviewer ship');
    expect(state.completed.at(-1)?.conclusion).toBe('success');
  });
  it('reads a newly saved OFF between ships', async () => {
    const ai = aiStub({ perShip: { 'code-reviewer': PASS, qa: PASS } });
    const realRun = ai.ai.run;
    ai.ai.run = vi.fn(async (...args: Parameters<Ai['run']>) => {
      await setRepoShipControl(controls.db, 'erichowens/port-daddy', 'qa', false, 0, 'admin');
      return realRun(...args);
    }) as unknown as Ai['run'];
    const { env } = environment(ai);
    await executeFleet(makeJob(), env);
    expect(JSON.stringify(ai.calls)).not.toContain('qa ship');
    expect(capture.steps.some(step => step.ship === 'qa' && step.kind === 'ship-skipped')).toBe(true);
  });
  it('queued continuation rechecks OFF before reusing checkpoints or spending', async () => {
    const { env, ai } = environment();
    const first = await executeFleet(makeJob(), env, { maxNewShipsPerInvocation: 1 });
    expect(first?.kind).toBe('continuation');
    const before = ai.calls.length;
    await setRepoShipControl(controls.db, 'erichowens/port-daddy', '*', false, 0, 'admin');
    await executeFleet(makeJob(), env, { maxNewShipsPerInvocation: 1 });
    expect(ai.calls).toHaveLength(before);
    expect(state.completed.at(-1)?.conclusion).toBe('neutral');
  });
  it('rechecks XO OFF after an ideation ship responds, before optional editor spend', async () => {
    state.files.set('main:pd-fleet.yml', 'fleet:\n  xo: true\n  agents:\n    spark:\n      class: ideation\n      trigger: pull_request:opened\n      prompt: spark ship\n');
    const proposal = '```json\n[{"title":"A bounded improvement","rationale":"Improve the changed flow","evidence":["a.ts"],"action":"roadmap"}]\n```\nFLEET-VERDICT: PASS';
    const ai = aiStub({ perShip: { spark: proposal } });
    const realRun = ai.ai.run;
    ai.ai.run = vi.fn(async (...args: Parameters<Ai['run']>) => {
      await setRepoShipControl(controls.db, 'erichowens/port-daddy', 'xo', false, 0, 'admin');
      return realRun(...args);
    }) as unknown as Ai['run'];
    await executeFleet(makeJob(), environment(ai).env);
    expect(JSON.stringify(ai.calls)).toContain('spark ship');
    expect(JSON.stringify(ai.calls)).not.toContain('XO EDITOR');
    expect(JSON.stringify(ai.calls)).not.toContain('XO TRIAGE');
    expect(state.completed.at(-1)?.conclusion).toBe('success');
  });
  it('missing database or migration cannot silently permit a ship', async () => {
    const { env, ai } = environment();
    env.DB = undefined;
    await executeFleet(makeJob(), env);
    expect(ai.calls).toHaveLength(0);
    expect(state.completed.at(-1)?.summary).toContain('controls unavailable');
  });
});
