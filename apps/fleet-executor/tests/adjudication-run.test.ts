/**
 * End-to-end pipeline tests for the 2026-08-19 fleet-wide-red fix: the repair
 * pass (src/repair.ts) + broken-ship adjudication (src/adjudicator.ts) riding
 * the REAL executeFleet pipeline.
 *
 * The scenario being pinned: the broken-ship doctrine deployed and every open
 * PR went red at once, because the cheap model tiers emit contract-violating
 * output at a steady stochastic rate. These tests prove the three-stage
 * response: (1) most breakage HEALS in-run via repair, (2) persistent isolated
 * breakage still fails the run, (3) persistent EPIDEMIC breakage resolves
 * neutral with ONE tracked issue — the fault gates the fleet, not each author.
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

const GARBAGE = 'I took a look and it seems fine to me overall.';
const CLEAN = '```json\n[]\n```\nFLEET-VERDICT: PASS';

function seedToken(kv: KVNamespace): void {
  void kv.put(
    'github_inst_42',
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 3_600_000 }),
  );
}

/** Seed a prior broken run for `ship` on another PR (epidemic evidence). */
function seedBrokenHistory(d1: ReturnType<typeof memoryD1>, runId: string, prNumber: number, ship: string): void {
  void d1.db
    .prepare(
      `INSERT OR REPLACE INTO fleet_runs (id, delivery_id, repo_full_name, pr_number, pr_url, head_sha, conclusion, ships_csv, ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`,
    )
    .bind(runId, `d-${runId}`, 'erichowens/port-daddy', prNumber, '', 'SHA', '', Math.floor(Date.now() / 1000) - 600)
    .run();
  d1.steps.push({
    runId,
    seq: 0,
    kind: 'ship-broken',
    ship,
    title: `pd-${ship}: BROKEN`,
    detail: '{}',
    createdAt: Math.floor(Date.now() / 1000) - 600,
  });
}

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function runFleet(opts: {
  queue?: string[];
  fixed?: string;
  seedHistory?: boolean;
}) {
  state.files.set('main:pd-fleet.yml', ADVISORY_QA);
  const kv = memoryKV();
  seedToken(kv);
  const d1 = memoryD1();
  if (opts.seedHistory) {
    seedBrokenHistory(d1, 'hist1', 101, 'qa');
    seedBrokenHistory(d1, 'hist2', 102, 'qa');
  }
  const ai = aiStub({
    perShip: { qa: opts.fixed ?? GARBAGE },
    ...(opts.queue ? { perShipQueue: { qa: [...opts.queue] } } : {}),
  });
  await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));
  return { d1, ai };
}

describe('stage 1 — repair heals a formatting slip in-run', () => {
  it('garbage output that heals on the repair retry ends in a clean SUCCESS', async () => {
    // Call 1 (map): garbage. Call 2 (repair, same model): the real contract.
    const { d1 } = await runFleet({ queue: [GARBAGE, CLEAN] });
    expect(state.completed[0].conclusion).toBe('success');

    const repair = d1.steps.find(s => s.kind === 'ship-repair')!;
    expect(repair).toBeDefined();
    expect(String(repair.title)).toContain('HEALED');
    // No broken markers, no adjudication — the doctrine never engaged.
    expect(d1.steps.some(s => s.kind === 'ship-broken')).toBe(false);
    expect(d1.steps.some(s => s.kind === 'ship-no-output')).toBe(false);
  });

  it('repair spend is metered — the extra calls land in ship-spend', async () => {
    const { ai } = await runFleet({ queue: [GARBAGE, CLEAN] });
    // 1 map + 1 repair (healed on the first attempt).
    expect(ai.calls.length).toBe(2);
  });
});

describe('stage 2 — persistent ISOLATED breakage still fails the run', () => {
  it('no epidemic evidence ⇒ failure, with the broken marker + isolated adjudication on record', async () => {
    const { d1 } = await runFleet({});
    expect(state.completed[0].conclusion).toBe('failure');

    const kinds = d1.steps.map(s => s.kind);
    expect(kinds).toContain('ship-repair'); // repair was TRIED first
    expect(kinds).toContain('ship-no-output');
    expect(kinds).toContain('ship-broken'); // evidence for future epidemic tests
    const adj = d1.steps.find(s => s.kind === 'ship-adjudicated')!;
    expect(String(adj.title)).toContain('ISOLATED');
    expect(state.issuesCreated).toHaveLength(0); // no fleet fault, no issue
  });
});

describe('stage 3 — persistent EPIDEMIC breakage gates the fleet, not the PR', () => {
  it('with the same ship broken on 2 other PRs: neutral + ONE tracked issue + honest summary', async () => {
    const { d1 } = await runFleet({ seedHistory: true });
    expect(state.completed[0].conclusion).toBe('neutral');

    const adj = d1.steps.find(s => s.kind === 'ship-adjudicated')!;
    expect(String(adj.title)).toContain('FLEET-WIDE');

    expect(state.issuesCreated).toHaveLength(1);
    expect(state.issuesCreated[0].title).toContain('fleet-broken-ship: pd-qa');
    expect(state.issuesCreated[0].labels).toContain('fleet:broken-ship');

    const summary = state.completed[0].summary ?? '';
    expect(summary).toContain('adjudicated FLEET-WIDE fault');
    expect(summary).toContain('not gating this PR');
    expect(summary).not.toContain('run FAILED');
  });

  it('a subsequent run REUSES the open tracking issue instead of filing another', async () => {
    state.openIssues.push({ number: 5150, title: 'fleet-broken-ship: pd-qa — errored' });
    await runFleet({ seedHistory: true });
    expect(state.completed[0].conclusion).toBe('neutral');
    expect(state.issuesCreated).toHaveLength(0);
    expect(state.completed[0].summary).toContain('#5150');
  });
});
