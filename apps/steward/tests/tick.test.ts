/**
 * Tick tests: the priority function's tier table and ordering, the mechanical
 * verdict policy, and runTick's full loop against injected survey/fetch fakes
 * — decide-and-record only, never landing (that is P1 PR 3's contract).
 */

import { describe, it, expect } from 'vitest';
import { buildDocket, classifyPr, renderDocket, type PrSnapshot } from '../src/priority.js';
import { decideVerdict, runTick } from '../src/tick.js';
import { surveyOpenPrs, OPERATOR_REQUEST_LABEL } from '../src/survey.js';
import { makeEnv, memoryD1 } from './harness.js';

const REPO = 'erichowens/port-daddy';
const NOW = 1_700_000_000_000;

function pr(over: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    number: 1,
    title: 't',
    draft: false,
    checks: 'pending',
    approved: false,
    changesRequested: false,
    operatorRequested: false,
    fleetOwned: false,
    mergeable: null,
    updatedAt: NOW,
    ...over,
  };
}

describe('priority — the published tier table', () => {
  it('classifies each tier per the plan, in authority order', () => {
    expect(classifyPr(pr({ operatorRequested: true })).tier).toBe(1);
    expect(classifyPr(pr({ approved: true, checks: 'green', mergeable: true })).tier).toBe(2);
    expect(classifyPr(pr({ fleetOwned: true, checks: 'red' })).tier).toBe(3);
    expect(classifyPr(pr({ approved: true, checks: 'green', mergeable: null })).tier).toBe(4);
    expect(classifyPr(pr({ changesRequested: true, checks: 'red' })).tier).toBe(4);
    expect(classifyPr(pr()).tier).toBe(5);
  });

  it('operator request outranks even approved+green — the human beats every heuristic', () => {
    const d = classifyPr(pr({ operatorRequested: true, approved: true, checks: 'green', mergeable: true }));
    expect(d.tier).toBe(1);
  });

  it('orders by tier, then oldest-updated, then PR number — total and stable', () => {
    const docket = buildDocket([
      pr({ number: 9, updatedAt: NOW - 100 }),
      pr({ number: 3, operatorRequested: true, updatedAt: NOW }),
      pr({ number: 7, approved: true, checks: 'green', mergeable: true, updatedAt: NOW }),
      pr({ number: 5, updatedAt: NOW - 100 }),
    ]);
    expect(docket.map(d => d.pr.number)).toEqual([3, 7, 5, 9]);
  });

  it('drafts never enter the docket — a draft declines a verdict by definition', () => {
    expect(buildDocket([pr({ draft: true, operatorRequested: true })])).toHaveLength(0);
  });

  it('renders the audit block with the arrow on the chosen PR, and an honest empty line', () => {
    const text = renderDocket(buildDocket([pr({ number: 4, operatorRequested: true }), pr({ number: 6 })]));
    expect(text).toContain('→ #4 tier 1');
    expect(text).toContain('  #6 tier 5');
    expect(renderDocket([])).toContain('docket empty');
  });
});

describe('decideVerdict — mechanical, evidence-named', () => {
  const top = (over: Partial<PrSnapshot>) => buildDocket([pr(over)])[0];

  it('approved + green + mergeable ⇒ LAND, noting landing is PR 3', () => {
    const d = decideVerdict(top({ approved: true, checks: 'green', mergeable: true }));
    expect(d.verdict).toBe('LAND');
    expect(d.evidence).toContain('P1 PR 3');
  });

  it('red checks ⇒ NEEDS-WORK naming the checks', () => {
    expect(decideVerdict(top({ checks: 'red' }))).toMatchObject({ verdict: 'NEEDS-WORK' });
  });

  it('changes requested ⇒ NEEDS-WORK; conflict ⇒ NEEDS-WORK', () => {
    expect(decideVerdict(top({ changesRequested: true })).verdict).toBe('NEEDS-WORK');
    expect(decideVerdict(top({ mergeable: false })).verdict).toBe('NEEDS-WORK');
  });

  it('undecidable evidence ⇒ SURFACE — the only safe over-issue', () => {
    const d = decideVerdict(top({ checks: 'pending' }));
    expect(d.verdict).toBe('SURFACE');
    expect(d.evidence).toContain('checks=pending');
  });
});

describe('runTick — decide and record, never throw, never land', () => {
  it('holds honestly without a survey token', async () => {
    const r = await runTick(makeEnv({}), REPO, NOW);
    expect(r.ran).toBe(false);
    expect(r.skipped).toContain('cannot survey');
  });

  it('holds honestly when the survey throws — never decides blind', async () => {
    const env = makeEnv({ STEWARD_GITHUB_TOKEN: 'tok' });
    const r = await runTick(env, REPO, NOW, undefined as never, async () => {
      throw new Error('GitHub 502');
    });
    expect(r.ran).toBe(false);
    expect(r.skipped).toContain('survey failed');
  });

  it('an empty docket ticks cleanly with the honest empty line and no verdict', async () => {
    const env = makeEnv({ STEWARD_GITHUB_TOKEN: 'tok', DB: memoryD1().db });
    const r = await runTick(env, REPO, NOW, undefined as never, async () => []);
    expect(r.ran).toBe(true);
    expect(r.docketText).toContain('docket empty');
    expect(r.verdict).toBeUndefined();
  });

  it('renders the top PR’s verdict into the merge ledger with evidence and requestedBy=tick', async () => {
    const d1 = memoryD1();
    const env = makeEnv({ STEWARD_GITHUB_TOKEN: 'tok', DB: d1.db });
    const r = await runTick(env, REPO, NOW, undefined as never, async () => [
      pr({ number: 12, approved: true, checks: 'green', mergeable: true }),
      pr({ number: 8, checks: 'red', fleetOwned: true }),
    ]);
    expect(r.ran).toBe(true);
    expect(r.verdict).toMatchObject({ prNumber: 12, verdict: 'LAND', requestedBy: 'tick' });
    expect(r.verdictLedgered).toBe(true);
    expect(d1.mergeLedger).toHaveLength(1);
    expect(String(d1.mergeLedger[0].evidence)).toContain('approved review standing');
    expect(r.docketText).toContain('→ #12');
  });

  it('reports a failed ledger write instead of pretending it recorded', async () => {
    const d1 = memoryD1();
    d1.failing.value = true;
    const env = makeEnv({ STEWARD_GITHUB_TOKEN: 'tok', DB: d1.db });
    const r = await runTick(env, REPO, NOW, undefined as never, async () => [pr({ checks: 'red' })]);
    expect(r.verdict?.verdict).toBe('NEEDS-WORK');
    expect(r.verdictLedgered).toBe(false);
  });
});

describe('surveyOpenPrs — GitHub reads into snapshots', () => {
  /** Route a fake GitHub API by URL substring. */
  function ghFake(routes: Record<string, unknown>): (url: string) => Promise<Response> {
    return async (url: string) => {
      for (const [key, body] of Object.entries(routes)) {
        if (url.includes(key)) return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };
  }

  it('maps PRs, check states, last-review-per-user, labels, and fleet ownership', async () => {
    const fetchFake = ghFake({
      '/pulls?state=open': [
        {
          number: 7,
          title: 'fix',
          draft: false,
          labels: [{ name: OPERATOR_REQUEST_LABEL }],
          user: { login: 'erichowens', type: 'User' },
          head: { ref: 'claude/some-branch', sha: 'SHA7' },
          mergeable: true,
          updated_at: '2026-08-19T10:00:00Z',
        },
      ],
      '/commits/SHA7/check-runs': {
        check_runs: [
          { status: 'completed', conclusion: 'success' },
          { status: 'completed', conclusion: 'failure' },
        ],
      },
      '/pulls/7/reviews': [
        { state: 'CHANGES_REQUESTED', user: { login: 'rev' } },
        { state: 'APPROVED', user: { login: 'rev' } }, // later review supersedes
      ],
    });
    const [snap] = await surveyOpenPrs('o', 'r', 'tok', fetchFake);
    expect(snap).toMatchObject({
      number: 7,
      checks: 'red',
      approved: true,
      changesRequested: false,
      operatorRequested: true,
      fleetOwned: true,
      mergeable: true,
    });
  });

  it('one PR’s failed detail read degrades THAT PR to pending, not the whole survey', async () => {
    const fetchFake = ghFake({
      '/pulls?state=open': [
        { number: 1, title: 'a', head: { ref: 'x', sha: 'S1' }, updated_at: '2026-08-19T10:00:00Z' },
      ],
      // no check-runs route → 404 → throw → caught per-PR
    });
    const [snap] = await surveyOpenPrs('o', 'r', 'tok', fetchFake);
    expect(snap.checks).toBe('pending');
  });

  it('a failed PR-list read throws — a blind survey is infrastructure failure, not an empty repo', async () => {
    await expect(
      surveyOpenPrs('o', 'r', 'tok', async () => new Response('nope', { status: 500 })),
    ).rejects.toThrow('500');
  });
});
