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
import { ackClusterfudge, isFrozen, readClusterfudge, tripClusterfudge } from '../src/clusterfudge.js';
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
  /**
   * Fake the two calls a landing makes: the REST protected-path file list, and
   * the GraphQL pair (resolve node id, then enqueue).
   *
   * `merges.count` counts ENQUEUE ATTEMPTS — the mutation, not the lookup — so
   * the "did the seat try to land?" assertions keep meaning what they meant
   * when landing was a direct merge. The name is kept for the same reason:
   * these tests assert whether the seat REACHED for the merge button, and that
   * question is unchanged by which button it is.
   */
  function ghLandFake(
    files: string[],
    merge: { status: number; body: Record<string, unknown> },
  ): { fetchImpl: (url: string, init?: RequestInit) => Promise<Response>; merges: { count: number } } {
    const merges = { count: 0 };
    return {
      merges,
      fetchImpl: async (url: string, init?: RequestInit) => {
        if (url.includes('/files')) {
          return new Response(JSON.stringify(files.map(filename => ({ filename }))), { status: 200 });
        }
        if (url.includes('/graphql')) {
          const body = String(init?.body);
          if (body.includes('pullRequest(number:')) {
            return new Response(
              JSON.stringify({
                data: { repository: { pullRequest: { id: 'PR_node', headRefOid: String(merge.body.sha ?? 'headoid') } } },
              }),
              { status: 200 },
            );
          }
          merges.count++;
          if (merge.status !== 200) {
            return new Response(JSON.stringify({ message: merge.body.message }), { status: merge.status });
          }
          return new Response(
            JSON.stringify({ data: { enqueuePullRequest: { mergeQueueEntry: { position: 1, state: 'QUEUED' } } } }),
            { status: 200 },
          );
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

    // Held: the merge API is no longer called. At the threshold the breaker
    // has also tripped (P1 PR 4), and the freeze is the outer gate — so the
    // reason names the freeze rather than the per-PR hold behind it.
    const held = ghLandFake(['src/x.ts'], { status: 200, body: { sha: 'y' } });
    const r = await runTick(env, REPO, NOW, held.fetchImpl, landSurvey(), store);
    expect(r.landing).toMatchObject({ attempted: false, landed: false });
    expect(r.landing?.reason).toContain('CLUSTERFUDGE frozen');
    expect(held.merges.count).toBe(0);

    // Clearing the per-PR hold alone is NOT enough once the repo is frozen:
    // both the ship-it and the operator's breaker ack are required.
    await store.put(shipItKey(12), { grantedBy: 'operator', grantedAt: NOW });
    await store.delete(landFailKey(12));
    await ackClusterfudge(store, 'operator', 'ack and retry once', NOW + 1000);
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

  it('an armed seat with no store bound holds — grants cannot be checked, so nothing lands', async () => {
    const { fetchImpl, merges } = ghLandFake(['src/a.ts'], { status: 200, body: { sha: 'x' } });
    const r = await runTick(armedEnv(), REPO, NOW, fetchImpl, landSurvey());
    expect(r.verdict?.verdict).toBe('LAND');
    expect(r.landing).toMatchObject({ attempted: false, landed: false });
    expect(r.landing?.reason).toContain('no seat store');
    expect(merges.count).toBe(0);
  });

  it('a frozen breaker stops a perfectly healthy land — the freeze outranks every per-PR gate', async () => {
    const store = new FakeStorage();
    await tripClusterfudge(store, 'land-fail-loop', 'something systemic', NOW);
    const { fetchImpl, merges } = ghLandFake(['src/a.ts'], { status: 200, body: { sha: 'x' } });
    const r = await runTick(armedEnv(), REPO, NOW, fetchImpl, landSurvey(), store);
    // Read-only work still happened: the verdict is decided and recorded.
    expect(r.verdict?.verdict).toBe('LAND');
    expect(r.landing).toMatchObject({ attempted: false, landed: false });
    expect(r.landing?.reason).toContain('CLUSTERFUDGE frozen');
    expect(merges.count).toBe(0);
  });

  it('the third distinct land failure trips the breaker and freezes the seat', async () => {
    const store = new FakeStorage();
    const env = armedEnv();
    for (const message of ['a', 'b']) {
      const { fetchImpl } = ghLandFake(['src/x.ts'], { status: 409, body: { message } });
      const r = await runTick(env, REPO, NOW, fetchImpl, landSurvey(), store);
      expect(r.landing?.reason).not.toContain('CLUSTERFUDGE');
    }
    expect(isFrozen(await readClusterfudge(store))).toBe(false);

    const third = ghLandFake(['src/x.ts'], { status: 409, body: { message: 'c' } });
    const r = await runTick(env, REPO, NOW, third.fetchImpl, landSurvey(), store);
    expect(r.landing?.reason).toContain('CLUSTERFUDGE tripped (land-fail-loop)');

    const breaker = await readClusterfudge(store);
    expect(isFrozen(breaker)).toBe(true);
    expect(breaker.tripwire).toBe('land-fail-loop');
    expect(breaker.evidence).toContain('3 distinct causes');
  });

  it('a ship-it clears the per-PR hold but does NOT release the breaker', async () => {
    const store = new FakeStorage();
    await tripClusterfudge(store, 'land-fail-loop', 'systemic', NOW);
    // Simulate the ship-it route's per-PR effects (see handleShipIt).
    await store.put(shipItKey(12), { grantedBy: 'operator', grantedAt: NOW });
    await store.delete(landFailKey(12));

    const { fetchImpl, merges } = ghLandFake(['src/a.ts'], { status: 200, body: { sha: 'x' } });
    const r = await runTick(armedEnv(), REPO, NOW, fetchImpl, landSurvey(), store);
    expect(r.landing?.landed).toBe(false);
    expect(r.landing?.reason).toContain('CLUSTERFUDGE frozen');
    expect(merges.count).toBe(0);
  });

  it('an operator ack releases the freeze and landing resumes', async () => {
    const store = new FakeStorage();
    await tripClusterfudge(store, 'land-fail-loop', 'systemic', NOW);
    await ackClusterfudge(store, 'erich', 'ack and retry once', NOW + 1000);
    const { fetchImpl } = ghLandFake(['src/a.ts'], { status: 200, body: { sha: 'freed' } });
    const r = await runTick(armedEnv(), REPO, NOW, fetchImpl, landSurvey(), store);
    expect(r.landing).toMatchObject({ landed: true, sha: 'freed' });
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

describe('the docket walk — one opinion per PR, recorded once', () => {
  // WHAT THIS IS AND IS NOT. An earlier reading of production called this a
  // head-of-line livelock: #6419 (tier 3, red, fleet-owned) sat at the docket
  // head across two wakes and the tick judged only `docket[0]`, so the claim
  // was that a landable PR behind it could never be reached. That claim was
  // WRONG, and the first draft of these tests is what disproved it —
  // `classifyPr` puts approved + green + mergeable at TIER 2, which outranks
  // tier 3, so anything landable jumps the queue by construction. #6419 at the
  // head means only that nothing in the repo is currently landable.
  //
  // Two real defects remain, and they are what these pin:
  //   1. The seat recorded the SAME verdict for the SAME PR on every wake —
  //      four identical rows a day, forever, in the ledger that is supposed to
  //      be the repo's readable merge history.
  //   2. It formed an opinion on exactly one PR, so the ledger described the
  //      docket head rather than the repo.

  const redHead = pr({ number: 6419, checks: 'red', fleetOwned: true });
  const landable = pr({ number: 7777, checks: 'green', approved: true, mergeable: true });

  it('confirms tier order already protects a landable PR — no walk required', async () => {
    // Stated as a test so the disproved claim cannot quietly come back.
    const d1 = memoryD1();
    const env = makeEnv({ DB: d1.db, STEWARD_GITHUB_TOKEN: 'survey' });
    const res = await runTick(env, REPO, NOW, undefined, async () => [redHead, landable]);
    expect(res.verdict?.verdict).toBe('LAND');
    expect(res.verdict?.prNumber).toBe(7777);
    expect(d1.mergeLedger[0].pr_number).toBe(7777);
  });

  it('now forms an opinion on the whole docket, not just its head', async () => {
    const d1 = memoryD1();
    const env = makeEnv({ DB: d1.db, STEWARD_GITHUB_TOKEN: 'survey' });
    const res = await runTick(env, REPO, NOW, undefined, async () =>
      [redHead, pr({ number: 8, checks: 'red' }), pr({ number: 9, changesRequested: true })]);
    expect(res.scanned).toBe(3);
    expect(res.ledgered).toBe(3);
    expect(d1.mergeLedger.map(r => r.pr_number).sort()).toEqual([8, 9, 6419].sort());
  });

  it('records a verdict once, then goes quiet while the answer is unchanged', async () => {
    // The defect that made the ledger unreadable: identical rows every wake.
    const d1 = memoryD1();
    const env = makeEnv({ DB: d1.db, STEWARD_GITHUB_TOKEN: 'survey' });
    const survey = async () => [redHead, pr({ number: 8, checks: 'red' })];

    const first = await runTick(env, REPO, NOW, undefined, survey);
    expect(first.ledgered).toBe(2);
    const afterFirst = d1.mergeLedger.length;

    const second = await runTick(env, REPO, NOW + 60_000, undefined, survey);
    expect(second.unchanged).toBe(2);
    expect(second.ledgered).toBe(0);
    expect(d1.mergeLedger.length).toBe(afterFirst);
  });

  it('speaks up again the moment a verdict actually changes', async () => {
    // Silence must mean "nothing changed", never "stopped looking".
    const d1 = memoryD1();
    const env = makeEnv({ DB: d1.db, STEWARD_GITHUB_TOKEN: 'survey' });
    await runTick(env, REPO, NOW, undefined, async () => [pr({ number: 42, checks: 'red' })]);
    const before = d1.mergeLedger.length;

    const res = await runTick(env, REPO, NOW + 60_000, undefined, async () =>
      [pr({ number: 42, checks: 'green', approved: true, mergeable: true })]);
    expect(res.ledgered).toBe(1);
    expect(res.verdict?.verdict).toBe('LAND');
    expect(d1.mergeLedger.length).toBe(before + 1);
  });

  it('reports an all-unchanged tick honestly instead of naming one PR', async () => {
    // The old line named `docket[0]` unconditionally, so a seat with nothing
    // new to say looked identical to one that had just decided something.
    const d1 = memoryD1();
    const env = makeEnv({ DB: d1.db, STEWARD_GITHUB_TOKEN: 'survey' });
    const survey = async () => [redHead];
    await runTick(env, REPO, NOW, undefined, survey);
    const res = await runTick(env, REPO, NOW + 60_000, undefined, survey);
    expect(res.verdict).toBeUndefined();
    expect(res.scanned).toBe(1);
    expect(res.unchanged).toBe(1);
  });
});
