/**
 * Tests for broken-ship adjudication (src/adjudicator.ts): who does a
 * persistent breakage gate — this PR (isolated) or the fleet (epidemic)?
 *
 * The end-to-end pipeline behavior lives in adjudication-run.test.ts; this
 * file pins the decision logic, the D1 evidence query against the harness
 * fake, the issue dedupe, and the aggregate outcomes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  adjudicateBrokenShips,
  countOtherBrokenPrs,
  brokenShipIssueTitle,
  EPIDEMIC_LOOKBACK_SEC,
  EPIDEMIC_MIN_OTHER_PRS,
} from '../src/adjudicator.js';
import { aggregateConclusion, type ShipResult } from '../src/verdict.js';
import { freshState, installGitHubFetch, memoryD1, makeEnv, type GitHubState } from './harness.js';

const NOW = 1_700_000_000;
const REPO = 'erichowens/port-daddy';

function broken(over: Partial<ShipResult> = {}): ShipResult {
  return { ship: 'lookout', blocking: false, verdict: 'PASS', errored: true, findings: [], ...over };
}

/** Seed one historical run + one broken-marker step for a ship on a PR. */
function seedBrokenRun(
  d1: ReturnType<typeof memoryD1>,
  runId: string,
  prNumber: number,
  ship: string,
  createdAt = NOW - 3600,
): void {
  void d1.db
    .prepare(
      `INSERT OR REPLACE INTO fleet_runs (id, delivery_id, repo_full_name, pr_number, pr_url, head_sha, conclusion, ships_csv, ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`,
    )
    .bind(runId, `d-${runId}`, REPO, prNumber, '', 'SHA', '', createdAt)
    .run();
  d1.steps.push({
    runId,
    seq: 0,
    kind: 'ship-broken',
    ship,
    title: `pd-${ship}: BROKEN`,
    detail: '{}',
    createdAt,
  });
}

function recorder() {
  const steps: Array<{ kind: string; ship: string | null; title: string; detail: unknown }> = [];
  return {
    steps,
    transcript: {
      async step(kind: string, ship: string | null, title: string, detail: unknown) {
        steps.push({ kind, ship, title, detail });
      },
    },
  };
}

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('countOtherBrokenPrs', () => {
  it('counts DISTINCT other PRs with broken-marker steps inside the window', async () => {
    const d1 = memoryD1();
    seedBrokenRun(d1, 'r1', 101, 'lookout');
    seedBrokenRun(d1, 'r2', 102, 'lookout');
    seedBrokenRun(d1, 'r3', 102, 'lookout'); // same PR twice — still one PR
    seedBrokenRun(d1, 'r4', 7, 'lookout'); // the PR under adjudication — excluded
    expect(await countOtherBrokenPrs(d1.db, REPO, 'lookout', 7, NOW)).toBe(2);
  });

  it('ignores steps outside the lookback window and other ships', async () => {
    const d1 = memoryD1();
    seedBrokenRun(d1, 'r1', 101, 'lookout', NOW - EPIDEMIC_LOOKBACK_SEC - 10);
    seedBrokenRun(d1, 'r2', 102, 'snipe');
    expect(await countOtherBrokenPrs(d1.db, REPO, 'lookout', 7, NOW)).toBe(0);
  });

  it('returns null without a DB binding — no evidence, never a guess', async () => {
    expect(await countOtherBrokenPrs(undefined, REPO, 'lookout', 7, NOW)).toBeNull();
  });
});

describe('adjudicateBrokenShips', () => {
  const optsFor = (d1: ReturnType<typeof memoryD1> | null, rec: ReturnType<typeof recorder>) => ({
    env: makeEnv(d1 ? { DB: d1.db } : {}),
    owner: 'erichowens',
    repo: 'port-daddy',
    prNumber: 7,
    runId: 'run:test',
    token: 'tok',
    transcript: rec.transcript,
    nowEpochSec: NOW,
  });

  it('ISOLATED breakage: writes the marker, leaves the result unadjudicated — the failure stands', async () => {
    const d1 = memoryD1();
    const rec = recorder();
    const results = [broken()];
    const n = await adjudicateBrokenShips(results, optsFor(d1, rec));
    expect(n).toBe(0);
    expect(results[0].brokenAdjudicated).toBeUndefined();
    expect(rec.steps.map(s => s.kind)).toEqual(['ship-broken', 'ship-adjudicated']);
    expect(rec.steps[1].title).toContain('ISOLATED');
    expect(aggregateConclusion(results)).toBe('failure');
  });

  it('EPIDEMIC breakage: adjudicates fleet-wide, files ONE issue, resolves neutral', async () => {
    const d1 = memoryD1();
    seedBrokenRun(d1, 'r1', 101, 'lookout');
    seedBrokenRun(d1, 'r2', 102, 'lookout');
    const rec = recorder();
    const results = [broken(), { ...broken({ ship: 'qa', errored: false }), verdict: 'PASS' as const }];
    const n = await adjudicateBrokenShips(results, optsFor(d1, rec));
    expect(n).toBe(1);
    expect(results[0].brokenAdjudicated).toMatchObject({ scope: 'fleet' });
    expect(results[0].brokenAdjudicated!.issueNumber).toBe(state.issuesCreated[0].number);
    expect(state.issuesCreated).toHaveLength(1);
    expect(state.issuesCreated[0].title).toContain(brokenShipIssueTitle('lookout'));
    expect(state.issuesCreated[0].labels).toContain('fleet:broken-ship');
    expect(rec.steps.find(s => s.kind === 'ship-adjudicated')!.title).toContain('FLEET-WIDE');
    // Neutral — visible, non-blocking, never success.
    expect(aggregateConclusion(results)).toBe('neutral');
  });

  it('an already-open tracking issue is REUSED, never duplicated', async () => {
    const d1 = memoryD1();
    seedBrokenRun(d1, 'r1', 101, 'lookout');
    seedBrokenRun(d1, 'r2', 102, 'lookout');
    state.openIssues.push({ number: 4242, title: `${brokenShipIssueTitle('lookout')} — errored` });
    const rec = recorder();
    const results = [broken()];
    await adjudicateBrokenShips(results, optsFor(d1, rec));
    expect(results[0].brokenAdjudicated!.issueNumber).toBe(4242);
    expect(state.issuesCreated).toHaveLength(0);
  });

  it('no DB ⇒ no epidemic evidence ⇒ the failure stands (fail-closed)', async () => {
    const rec = recorder();
    const results = [broken()];
    const n = await adjudicateBrokenShips(results, optsFor(null, rec));
    expect(n).toBe(0);
    expect(aggregateConclusion(results)).toBe('failure');
  });

  it(`the threshold is ${EPIDEMIC_MIN_OTHER_PRS} other PRs — one below it stays isolated`, async () => {
    const d1 = memoryD1();
    seedBrokenRun(d1, 'r1', 101, 'lookout');
    const rec = recorder();
    const results = [broken()];
    await adjudicateBrokenShips(results, optsFor(d1, rec));
    expect(results[0].brokenAdjudicated).toBeUndefined();
  });
});

describe('aggregateConclusion with adjudication (verdict.ts)', () => {
  const r = (over: Partial<ShipResult>): ShipResult => ({
    ship: 's',
    blocking: false,
    verdict: 'PASS',
    errored: false,
    ...over,
  });

  it('an adjudicated broken BLOCKING ship resolves neutral — the fault gates the fleet, not the PR', () => {
    expect(
      aggregateConclusion([
        r({ blocking: true, verdict: 'BLOCK', errored: true, brokenAdjudicated: { scope: 'fleet', reason: 'x' } }),
        r({ verdict: 'PASS' }),
      ]),
    ).toBe('neutral');
  });

  it('a mix of adjudicated AND unadjudicated breakage still fails — the isolated one is real', () => {
    expect(
      aggregateConclusion([
        r({ errored: true, brokenAdjudicated: { scope: 'fleet', reason: 'x' } }),
        r({ ship: 'other', errored: true }),
      ]),
    ).toBe('failure');
  });

  it('adjudication never launders into success even when everything else passed', () => {
    expect(
      aggregateConclusion([
        r({ blocking: true, verdict: 'PASS' }),
        r({ noUsableOutput: true, brokenAdjudicated: { scope: 'fleet', reason: 'x' } }),
      ]),
    ).toBe('neutral');
  });

  it("a broken blocking ship's conventional BLOCK verdict is not a judgment — adjudication wins", () => {
    // Without the isBroken guard, verdict:'BLOCK' on the broken blocking ship
    // would fail the run even after adjudication. Pin the guard.
    expect(
      aggregateConclusion([
        r({ blocking: true, verdict: 'BLOCK', noUsableOutput: true, brokenAdjudicated: { scope: 'fleet', reason: 'x' } }),
      ]),
    ).toBe('neutral');
  });
});
