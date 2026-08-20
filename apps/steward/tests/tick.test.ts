/**
 * Tick tests: the priority function's tier table and ordering, the mechanical
 * verdict policy, and runTick's full loop against injected survey/fetch fakes
 * — decide-and-record only, never landing (that is P1 PR 3's contract).
 */

import { describe, it, expect } from 'vitest';
import { buildDocket, classifyPr, renderDocket, type PrSnapshot } from '../src/priority.js';
import { decideVerdict, runTick } from '../src/tick.js';
import { surveyOpenPrs, OPERATOR_REQUEST_LABEL } from '../src/survey.js';
import { landFailKey, shipItKey, LAND_FAIL_HOLD_AT, type SeatStore } from '../src/landing.js';
import { makeEnv, memoryD1, FakeStorage } from './harness.js';

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

  it('approved + green + mergeable ⇒ LAND with the evidence named', () => {
    const d = decideVerdict(top({ approved: true, checks: 'green', mergeable: true }));
    expect(d.verdict).toBe('LAND');
    expect(d.evidence).toContain('approved review standing');
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

  it('an unarmed seat records LAND but reports it holds no landing capability', async () => {
    const env = makeEnv({ STEWARD_GITHUB_TOKEN: 'tok', DB: memoryD1().db });
    const r = await runTick(env, REPO, NOW, undefined as never, async () => [
      pr({ number: 12, approved: true, checks: 'green', mergeable: true }),
    ]);
    expect(r.verdict?.verdict).toBe('LAND');
    expect(r.landing).toMatchObject({ attempted: false, landed: false });
    expect(r.landing?.reason).toContain('no landing capability');
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

describe('the landing arm — armed ticks execute LAND, gated and honest', () => {
  /** A LAND-verdict survey over one PR, the docket's inevitable top. */
  const landSurvey = (n = 12) => async () => [pr({ number: n, approved: true, checks: 'green', mergeable: true })];

  /**
   * Fake the two GitHub endpoints the landing arm touches.
   *
   * PURPOSE: routes by URL substring so a test declares only what the files
   * read and the merge PUT should answer — everything else in the tick runs
   * for real against the injected survey and memory D1.
   *
   * @param files - Changed filenames the files endpoint returns.
   * @param merge - Status + body for the merge PUT.
   * @returns The fetch fake plus a counter of merge attempts.
   */
  function ghLandFake(
    files: string[],
    merge: { status: number; body: Record<string, unknown> },
  ): { fetchImpl: (url: string, init?: RequestInit) => Promise<Response>; merges: { count: number } } {
    const merges = { count: 0 };
    return {
      merges,
      fetchImpl: async (url: string) => {
        if (url.includes('/files')) {
          return new Response(JSON.stringify(files.map(filename => ({ filename }))), { status: 200 });
        }
        if (url.includes('/merge')) {
          merges.count++;
          return new Response(JSON.stringify(merge.body), { status: merge.status });
        }
        return new Response('{}', { status: 404 });
      },
    };
  }

  const armedEnv = () => makeEnv({ STEWARD_GITHUB_TOKEN: 'tok', STEWARD_LAND_TOKEN: 'land', DB: memoryD1().db });

  it('armed + unprotected files ⇒ lands, reports the sha, clears per-PR state', async () => {
    const store = new FakeStorage();
    await store.put(shipItKey(12), { grantedBy: 'operator', grantedAt: NOW });
    const { fetchImpl } = ghLandFake(['src/a.ts'], { status: 200, body: { sha: 'deadbeef' } });
    const r = await runTick(armedEnv(), REPO, NOW, fetchImpl, landSurvey(), store);
    expect(r.landing).toMatchObject({ attempted: true, landed: true, sha: 'deadbeef' });
    expect(r.landing?.reason).toContain('LANDED #12');
    expect(await store.get(shipItKey(12))).toBeUndefined();
    expect(await store.get(landFailKey(12))).toBeUndefined();
  });

  it('a protected path without a grant does not land — it awaits the operator', async () => {
    const store = new FakeStorage();
    const { fetchImpl, merges } = ghLandFake(['.github/workflows/ci.yml'], { status: 200, body: { sha: 'x' } });
    const r = await runTick(armedEnv(), REPO, NOW, fetchImpl, landSurvey(), store);
    expect(r.landing).toMatchObject({ attempted: false, landed: false });
    expect(r.landing?.reason).toContain('ship-it/12');
    expect(merges.count).toBe(0);
  });

  it('a protected path WITH a grant lands and consumes it', async () => {
    const store = new FakeStorage();
    await store.put(shipItKey(12), { grantedBy: 'operator', grantedAt: NOW });
    const { fetchImpl } = ghLandFake(['docs/adr/0110-x.md'], { status: 200, body: { sha: 'cafe' } });
    const r = await runTick(armedEnv(), REPO, NOW, fetchImpl, landSurvey(), store);
    expect(r.landing?.landed).toBe(true);
    expect(await store.get(shipItKey(12))).toBeUndefined();
  });

  it('an unreadable files list holds — never lands what it could not inspect', async () => {
    const store = new FakeStorage();
    const fetchImpl = async () => new Response('x', { status: 500 });
    const r = await runTick(armedEnv(), REPO, NOW, fetchImpl, landSurvey(), store);
    expect(r.landing).toMatchObject({ attempted: false, landed: false });
    expect(r.landing?.reason).toContain('could not read');
  });

  it('distinct failures accumulate to the hold; repeats do not; ship-it resets it', async () => {
    const store = new FakeStorage() as FakeStorage & SeatStore;
    const env = armedEnv();
    // Three ticks, three DIFFERENT failure messages ⇒ hold engages.
    for (const message of ['a', 'b', 'c']) {
      const { fetchImpl } = ghLandFake(['src/x.ts'], { status: 409, body: { message } });
      const r = await runTick(env, REPO, NOW, fetchImpl, landSurvey(), store);
      expect(r.landing?.attempted).toBe(true);
      expect(r.landing?.landed).toBe(false);
    }
    expect(((await store.get(landFailKey(12))) as string[]).length).toBe(LAND_FAIL_HOLD_AT);

    // Held: the merge API is no longer called.
    const held = ghLandFake(['src/x.ts'], { status: 200, body: { sha: 'y' } });
    const r = await runTick(env, REPO, NOW, held.fetchImpl, landSurvey(), store);
    expect(r.landing).toMatchObject({ attempted: false, landed: false });
    expect(r.landing?.reason).toContain('land-fail hold');
    expect(held.merges.count).toBe(0);

    // The operator's ship-it doubles as the reset (mirrors handleShipIt).
    await store.put(shipItKey(12), { grantedBy: 'operator', grantedAt: NOW });
    await store.delete(landFailKey(12));
    const retry = ghLandFake(['src/x.ts'], { status: 200, body: { sha: 'z' } });
    const r2 = await runTick(env, REPO, NOW, retry.fetchImpl, landSurvey(), store);
    expect(r2.landing?.landed).toBe(true);
  });

  it('the same failure repeated stays ONE distinct reason — a retry story, not clusterfudge', async () => {
    const store = new FakeStorage();
    const env = armedEnv();
    for (let i = 0; i < 3; i++) {
      const { fetchImpl } = ghLandFake(['src/x.ts'], { status: 409, body: { message: 'same' } });
      await runTick(env, REPO, NOW, fetchImpl, landSurvey(), store);
    }
    expect(((await store.get(landFailKey(12))) as string[]).length).toBe(1);
  });

  it('a full files page fails closed — treated as protected', async () => {
    const store = new FakeStorage();
    const bigPr = Array.from({ length: 100 }, (_, i) => `src/f${i}.ts`);
    const { fetchImpl, merges } = ghLandFake(bigPr, { status: 200, body: { sha: 'x' } });
    const r = await runTick(armedEnv(), REPO, NOW, fetchImpl, landSurvey(), store);
    expect(r.landing?.landed).toBe(false);
    expect(merges.count).toBe(0);
  });

  it('a non-LAND verdict never grows a landing outcome', async () => {
    const store = new FakeStorage();
    const r = await runTick(armedEnv(), REPO, NOW, undefined as never, async () => [pr({ checks: 'red' })], store);
    expect(r.verdict?.verdict).toBe('NEEDS-WORK');
    expect(r.landing).toBeUndefined();
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
