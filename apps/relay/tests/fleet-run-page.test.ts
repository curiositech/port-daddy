/**
 * Tests for the HTML fleet run page (src/fleet-run-page.ts, ADR-0101 Phase 0).
 *
 * Coverage:
 *   - Gate: no token / malformed token / wrong token / short secret all yield
 *     the SAME 404 page (no existence oracle); a valid HMAC opens the page; the
 *     operator bearer opens it without a token; unknown run stays 404 even
 *     with a valid token for that id.
 *   - Rendering: repo/PR header, conclusion badge, per-ship grouping, token
 *     sums from step details, and strict escaping of attacker-influenced
 *     transcript strings (model output must never become markup).
 *   - Headers: no-script CSP, no-store, noindex.
 */

import { describe, it, expect } from 'vitest';
import { handleFleetRunPage, runPageToken } from '../src/fleet-run-page.js';
import type { Env } from '../src/types.js';
import type { FleetRunRow, FleetRunStepRow } from '../src/db.js';

const OPERATOR = 'super-secret-operator-token-32bytes-min';
const SECRET = 'run-page-secret-that-is-at-least-32-chars';
const RUN_ID = 'run:delivery-123';

// ── Mocks (same shape as fleet-observability.test.ts) ────────────────────────

function makeRun(over: Partial<FleetRunRow> = {}): FleetRunRow {
  return {
    id: RUN_ID,
    delivery_id: 'delivery-123',
    repo_full_name: 'erichowens/port-daddy',
    pr_number: 7,
    pr_url: 'https://github.com/erichowens/port-daddy/pull/7',
    head_sha: 'abc123def4567890',
    conclusion: 'success',
    ships_csv: 'code-reviewer,red-team',
    neurons: 1234,
    ms: 42_000,
    created_at: 1_700_000_000,
    ...over,
  };
}

function makeSteps(): FleetRunStepRow[] {
  return [
    {
      run_id: RUN_ID, seq: 1, kind: 'map-chunk', ship: 'code-reviewer',
      title: 'MAP chunk 1/2',
      detail: JSON.stringify({ inputTokens: 100, outputTokens: 40 }),
      created_at: 1_700_000_005,
    },
    {
      run_id: RUN_ID, seq: 2, kind: 'ship-verdict', ship: 'code-reviewer',
      title: 'pd-code-reviewer: PASS',
      detail: JSON.stringify({ findings: [{ note: '<script>alert(1)</script>' }] }),
      created_at: 1_700_000_010,
    },
    {
      run_id: RUN_ID, seq: 3, kind: 'check-completed', ship: null,
      title: 'Check concluded: success', detail: null, created_at: 1_700_000_040,
    },
  ];
}

function makeDb(run: FleetRunRow | null, steps: FleetRunStepRow[]): D1Database {
  const stmtFor = (query: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...vals: unknown[]) { bound = vals; return stmt; },
      async first<T>(): Promise<T | null> {
        return (run && bound[0] === run.id ? run : null) as T | null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        void query;
        return { results: (run && bound[0] === run.id ? steps : []) as T[] };
      },
      async run() { return { success: true }; },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return { prepare: stmtFor } as unknown as D1Database;
}

function makeEnv(o: { db?: D1Database; secret?: string | undefined } = {}): Env {
  return {
    DB: o.db ?? makeDb(makeRun(), makeSteps()),
    KV: {} as unknown as KVNamespace,
    HARBOR_CHANNEL: {} as unknown as DurableObjectNamespace,
    RELAY_OPERATOR_TOKEN: OPERATOR,
    RELAY_ED25519_PRIVATE_KEY_HEX: '00'.repeat(32),
    RUN_PAGE_SECRET: 'secret' in o ? o.secret : SECRET,
    RELAY_VERSION: '0.0.0-test',
  } as unknown as Env;
}

function req(runId: string, opts: { t?: string; bearer?: string } = {}): Request {
  const url = new URL(`https://relay.example/fleet/runs/${encodeURIComponent(runId)}`);
  if (opts.t) url.searchParams.set('t', opts.t);
  return new Request(url, {
    headers: opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {},
  });
}

// ── Gate ─────────────────────────────────────────────────────────────────────

describe('fleet run page gate', () => {
  it('404s without a token, with a malformed token, and with a wrong token — identically', async () => {
    const env = makeEnv();
    const bad = await Promise.all([
      handleFleetRunPage(req(RUN_ID), env, RUN_ID),
      handleFleetRunPage(req(RUN_ID, { t: 'zz-not-hex' }), env, RUN_ID),
      handleFleetRunPage(req(RUN_ID, { t: 'a'.repeat(64) }), env, RUN_ID),
    ]);
    const bodies = await Promise.all(bad.map(r => r.text()));
    for (const r of bad) expect(r.status).toBe(404);
    // Same page for every failure mode — no oracle distinguishing them.
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('Run not found');
  });

  it('opens with a valid HMAC capability token', async () => {
    const t = await runPageToken(SECRET, RUN_ID);
    const res = await handleFleetRunPage(req(RUN_ID, { t }), makeEnv(), RUN_ID);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('opens with the operator bearer even when no token is supplied', async () => {
    const res = await handleFleetRunPage(req(RUN_ID, { bearer: OPERATOR }), makeEnv(), RUN_ID);
    expect(res.status).toBe(200);
  });

  it('fail-closes when RUN_PAGE_SECRET is unset or too short (operator still works)', async () => {
    const t = await runPageToken(SECRET, RUN_ID);
    const noSecret = makeEnv({ secret: undefined });
    expect((await handleFleetRunPage(req(RUN_ID, { t }), noSecret, RUN_ID)).status).toBe(404);
    const shortSecret = makeEnv({ secret: 'short' });
    expect((await handleFleetRunPage(req(RUN_ID, { t }), shortSecret, RUN_ID)).status).toBe(404);
    expect(
      (await handleFleetRunPage(req(RUN_ID, { bearer: OPERATOR }), noSecret, RUN_ID)).status,
    ).toBe(200);
  });

  it('a token for run A never opens run B, and an unknown run 404s with its own valid token', async () => {
    const tokenA = await runPageToken(SECRET, RUN_ID);
    const other = 'run:other-delivery';
    // Token bound to RUN_ID presented against `other`.
    expect(
      (await handleFleetRunPage(req(other, { t: tokenA }), makeEnv(), other)).status,
    ).toBe(404);
    // Correctly-derived token for a run that does not exist in D1.
    const tokenOther = await runPageToken(SECRET, other);
    expect(
      (await handleFleetRunPage(req(other, { t: tokenOther }), makeEnv(), other)).status,
    ).toBe(404);
  });

  it('rejects malformed run ids before touching the database', async () => {
    const evil = '../etc/passwd';
    const res = await handleFleetRunPage(req(evil), makeEnv(), evil);
    expect(res.status).toBe(404);
  });
});

// ── Rendering ────────────────────────────────────────────────────────────────

describe('fleet run page rendering', () => {
  async function openPage(run = makeRun(), steps = makeSteps()): Promise<string> {
    const t = await runPageToken(SECRET, run.id);
    const res = await handleFleetRunPage(
      req(run.id, { t }),
      makeEnv({ db: makeDb(run, steps) }),
      run.id,
    );
    expect(res.status).toBe(200);
    return res.text();
  }

  it('renders the run header: repo, PR link, conclusion badge, ships', async () => {
    const html = await openPage();
    expect(html).toContain('erichowens/port-daddy');
    expect(html).toContain('https://github.com/erichowens/port-daddy/pull/7');
    expect(html).toContain('badge success');
    expect(html).toContain('pd-code-reviewer, pd-red-team');
  });

  it('groups steps per ship and sums token counts from step details', async () => {
    const html = await openPage();
    expect(html).toContain('pd-code-reviewer');       // ship section
    expect(html).toContain('Fleet');                  // null-ship group
    expect(html).toContain('MAP chunk 1/2');
    expect(html).toContain('>100<');                  // input tokens stat
    expect(html).toContain('>40<');                   // output tokens stat
  });

  it('escapes attacker-influenced transcript content (no live markup ever)', async () => {
    const run = makeRun({ repo_full_name: 'evil/<img src=x onerror=alert(1)>' });
    const html = await openPage(run);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not link a non-https pr_url', async () => {
    const run = makeRun({ pr_url: 'javascript:alert(1)' });
    const html = await openPage(run);
    expect(html).not.toContain('href="javascript:');
  });

  // ── English narratives, findings review, and MAP consolidation ─────────────

  function makeRichSteps(): FleetRunStepRow[] {
    const t0 = 1_700_000_000;
    return [
      // Three MAP chunks that should collapse into ONE consolidated line.
      { run_id: RUN_ID, seq: 1, kind: 'map-chunk', ship: 'code-reviewer', title: 'MAP chunk 1/3',
        detail: JSON.stringify({ chunkIndex: 0, chunkCount: 3, outputLength: 300 }), created_at: t0 + 5 },
      { run_id: RUN_ID, seq: 2, kind: 'map-chunk', ship: 'code-reviewer', title: 'MAP chunk 2/3',
        detail: JSON.stringify({ chunkIndex: 1, chunkCount: 3, outputLength: 200 }), created_at: t0 + 6 },
      { run_id: RUN_ID, seq: 3, kind: 'map-chunk', ship: 'code-reviewer', title: 'MAP chunk 3/3',
        detail: JSON.stringify({ chunkIndex: 2, chunkCount: 3, outputLength: 100 }), created_at: t0 + 7 },
      { run_id: RUN_ID, seq: 4, kind: 'reduce', ship: 'code-reviewer', title: 'REDUCE pd-code-reviewer',
        detail: JSON.stringify({ chunkCount: 3, outputLength: 512 }), created_at: t0 + 8 },
      // Reviewer verdict stores the raw Finding[] as detail.
      { run_id: RUN_ID, seq: 5, kind: 'ship-verdict', ship: 'code-reviewer', title: 'pd-code-reviewer: BLOCK',
        detail: JSON.stringify([
          { path: 'src/a.ts', line: 42, severity: 'HIGH', body: 'Null deref when x is undefined' },
          { path: 'src/b.ts', line: 7, severity: 'LOW', body: 'Nit: rename foo' },
        ]), created_at: t0 + 9 },
      { run_id: RUN_ID, seq: 6, kind: 'review-posted', ship: 'code-reviewer', title: 'Posted review for pd-code-reviewer',
        detail: JSON.stringify({ posted: true }), created_at: t0 + 10 },
      { run_id: RUN_ID, seq: 7, kind: 'ship-skipped', ship: 'red-team', title: 'pd-red-team: skipped — off-surface diff',
        detail: JSON.stringify({ reason: 'off-surface diff', changedPathCount: 3 }), created_at: t0 + 11 },
      { run_id: RUN_ID, seq: 8, kind: 'check-completed', ship: null, title: 'Check concluded: failure',
        detail: JSON.stringify({ conclusion: 'failure' }), created_at: t0 + 12 },
    ];
  }

  it('consolidates repetitive MAP-chunk steps into one line, preserving the per-chunk breakdown', async () => {
    const html = await openPage(makeRun(), makeRichSteps());
    // One English summary line instead of three near-identical rows.
    expect(html).toContain('Scanned the diff across 3 chunks');
    expect(html).toContain('600 chars of analysis'); // 300 + 200 + 100
    expect((html.match(/Scanned the diff across/g) ?? []).length).toBe(1);
    // The detail is not lost — each original chunk title survives in the breakdown.
    expect(html).toContain('Per-chunk breakdown');
    expect(html).toContain('MAP chunk 1/3');
    expect(html).toContain('MAP chunk 3/3');
    // The old generic uppercase "kind" chip is gone.
    expect(html).not.toContain('class="kind"');
  });

  it('describes each step in plain English instead of a bare machine kind', async () => {
    const html = await openPage(makeRun(), makeRichSteps());
    expect(html).toContain('Merged the findings from 3 diff chunks');
    expect(html).toContain('reviewed the diff and returned BLOCK with 2 findings');
    // The apostrophe is HTML-escaped (&#39;) — assert around it.
    expect(html).toContain('Posted pd-code-reviewer');
    expect(html).toContain('review to the pull request');
    expect(html).toContain('Skipped pd-red-team — off-surface diff');
    expect(html).toContain('Fleet check concluded: failure');
  });

  it('renders findings as a review with line annotations, not a raw JSON dump', async () => {
    const html = await openPage(makeRun(), makeRichSteps());
    expect(html).toContain('src/a.ts:42');
    expect(html).toContain('Null deref when x is undefined');
    expect(html).toContain('🔴 HIGH');
    expect(html).toContain('src/b.ts:7');
    expect(html).toContain('⚪ LOW');
    expect(html).toContain('class="review"');
    // HIGH sorts before LOW regardless of input order.
    expect(html.indexOf('src/a.ts:42')).toBeLessThan(html.indexOf('src/b.ts:7'));
  });

  it('shows an at-a-glance ship outcome badge', async () => {
    const html = await openPage(makeRun(), makeRichSteps());
    expect(html).toContain('outcome tone-block');
    expect(html).toContain('BLOCK · 2 findings');
  });

  it('escapes finding paths and bodies (model output never becomes markup)', async () => {
    const steps: FleetRunStepRow[] = [
      { run_id: RUN_ID, seq: 1, kind: 'ship-verdict', ship: 'code-reviewer', title: 'pd-code-reviewer: BLOCK',
        detail: JSON.stringify([
          { path: '<img src=x onerror=alert(1)>', line: 1, severity: 'HIGH', body: '<script>alert(2)</script>' },
        ]), created_at: 1_700_000_005 },
    ];
    const html = await openPage(makeRun(), steps);
    expect(html).not.toContain('<img src=x onerror');
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  // ── Branch coverage raised by the pd-qa review on this PR ──────────────────

  it('narrates a malformed (ship-finding) reviewer output as fail-closed errored', async () => {
    const steps: FleetRunStepRow[] = [
      { run_id: RUN_ID, seq: 1, kind: 'ship-finding', ship: 'code-reviewer', title: 'pd-code-reviewer: MALFORMED',
        detail: JSON.stringify({ error: 'failed to parse findings' }), created_at: 1_700_000_005 },
    ];
    const html = await openPage(makeRun(), steps);
    expect(html).toContain('could not parse');
    expect(html).toContain('treated as errored');
    expect(html).toContain('errored · unparseable output');
    expect(html).toContain('outcome tone-block');
  });

  it('narrates a malformed ideation proposal block as a broken ship that fails the check', async () => {
    // Legacy row shape (`proposals: 'malformed'` on a ship-verdict step) — the
    // executor now records these as ship-finding + errored, but old rows must
    // still render, and they must render as breakage, never as an advisory
    // shrug (broken-ship doctrine, 2026-08-19).
    const steps: FleetRunStepRow[] = [
      { run_id: RUN_ID, seq: 1, kind: 'ship-verdict', ship: 'spark', title: 'pd-spark: PASS (ideation)',
        detail: JSON.stringify({ proposals: 'malformed', posted: false }), created_at: 1_700_000_005 },
    ];
    const html = await openPage(makeRun(), steps);
    expect(html).toContain('malformed proposal block');
    expect(html).toContain('broken ship');
    expect(html).toContain('fails until it is fixed');
  });

  it('derives the ship outcome from the verdict step even when it is not the last step', async () => {
    // review-posted / ideas-captured follow the verdict — shipOutcome must scan
    // back to the verdict, not read the trailing step.
    const steps: FleetRunStepRow[] = [
      { run_id: RUN_ID, seq: 1, kind: 'ship-verdict', ship: 'code-reviewer', title: 'pd-code-reviewer: BLOCK',
        detail: JSON.stringify([{ path: 'x.ts', line: 3, severity: 'HIGH', body: 'boom' }]), created_at: 1_700_000_005 },
      { run_id: RUN_ID, seq: 2, kind: 'review-posted', ship: 'code-reviewer', title: 'Posted review for pd-code-reviewer',
        detail: JSON.stringify({ posted: true }), created_at: 1_700_000_006 },
    ];
    const html = await openPage(makeRun(), steps);
    expect(html).toContain('BLOCK · 1 finding');
    expect(html).toContain('outcome tone-block');
  });

  it('treats a ship-verdict whose detail is non-finding-shaped as "no findings" (extractFindings tolerance)', async () => {
    const steps: FleetRunStepRow[] = [
      // Object without a valid Finding[] under `findings` — must not throw and
      // must not fabricate a review block.
      { run_id: RUN_ID, seq: 1, kind: 'ship-verdict', ship: 'code-reviewer', title: 'pd-code-reviewer: PASS',
        detail: JSON.stringify({ findings: 'not-an-array', misc: 1 }), created_at: 1_700_000_005 },
    ];
    const html = await openPage(makeRun(), steps);
    expect(html).toContain('returned PASS — no findings');
    expect(html).not.toContain('class="review"');
    expect(html).toContain('PASS · clean');
  });

  it('extracts the verdict from a title with extra colons after PASS/BLOCK', async () => {
    const steps: FleetRunStepRow[] = [
      { run_id: RUN_ID, seq: 1, kind: 'ship-verdict', ship: 'code-reviewer', title: 'pd-code-reviewer: BLOCK: merge blocked',
        detail: '[]', created_at: 1_700_000_005 },
    ];
    const html = await openPage(makeRun(), steps);
    expect(html).toContain('returned BLOCK');
    expect(html).toContain('BLOCK · clean');
  });

  it('escapes ampersands and angle brackets in a finding body inside the review block', async () => {
    const steps: FleetRunStepRow[] = [
      { run_id: RUN_ID, seq: 1, kind: 'ship-verdict', ship: 'code-reviewer', title: 'pd-code-reviewer: BLOCK',
        detail: JSON.stringify([{ path: 'a.ts', line: 1, severity: 'LOW', body: 'foo & bar <baz>' }]),
        created_at: 1_700_000_005 },
    ];
    const html = await openPage(makeRun(), steps);
    expect(html).toContain('foo &amp; bar &lt;baz&gt;');
    expect(html).not.toContain('foo & bar <baz>');
  });

  it('consolidates MAP chunks that all returned empty without inventing an analysis size', async () => {
    const empty = (i: number): FleetRunStepRow => ({
      run_id: RUN_ID, seq: i, kind: 'map-chunk', ship: 'code-reviewer', title: `MAP chunk ${i}/2`,
      detail: JSON.stringify({ chunkIndex: i - 1, chunkCount: 2, outputLength: 0, responseShape: 'empty:responses' }),
      created_at: 1_700_000_000 + i,
    });
    const html = await openPage(makeRun(), [empty(1), empty(2)]);
    expect(html).toContain('Scanned the diff across 2 chunks');
    expect(html).toContain('2 chunks returned empty');
    expect(html).not.toContain('chars of analysis');
  });

  // ── Hardening raised by the pd-code-reviewer review on this PR ─────────────

  it('does not crash rendering a malformed row whose title is not a string', async () => {
    // Schema is `title TEXT NOT NULL`, but a bad/legacy row must degrade, not
    // take the endpoint down. `ideas-captured` does a `.replace` on the title.
    const steps: FleetRunStepRow[] = [
      { run_id: RUN_ID, seq: 1, kind: 'ideas-captured', ship: 'spark',
        title: undefined as unknown as string, detail: JSON.stringify({ results: [] }), created_at: 1_700_000_005 },
      { run_id: RUN_ID, seq: 2, kind: 'ship-verdict', ship: 'code-reviewer',
        title: null as unknown as string, detail: '[]', created_at: 1_700_000_006 },
    ];
    const t = await runPageToken(SECRET, RUN_ID);
    const res = await handleFleetRunPage(req(RUN_ID, { t }), makeEnv({ db: makeDb(makeRun(), steps) }), RUN_ID);
    expect(res.status).toBe(200); // renders instead of throwing a 500
  });

  it('escapes a ship-skipped reason (model-influenced) before it reaches the narrative', async () => {
    const steps: FleetRunStepRow[] = [
      { run_id: RUN_ID, seq: 1, kind: 'ship-skipped', ship: 'red-team', title: 'pd-red-team: skipped',
        detail: JSON.stringify({ reason: '<script>alert(9)</script>' }), created_at: 1_700_000_005 },
    ];
    const html = await openPage(makeRun(), steps);
    expect(html).not.toContain('<script>alert(9)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  // ── Purser + stacked-fix narratives (wf-crew) ──────────────────────────────

  function step(kind: string, ship: string | null, title: string, detail: unknown, seq = 1): FleetRunStepRow {
    return {
      run_id: RUN_ID, seq, kind, ship, title,
      detail: detail == null ? null : JSON.stringify(detail),
      created_at: 1_700_000_000 + seq,
    };
  }

  it('narrates purser-steelman: obligations count + escaped purpose', async () => {
    const html = await openPage(makeRun(), [
      step('purser-steelman', 'purser', 'pd-purser: steel-manned contract (3 obligation(s))', {
        purpose: 'Guarantee frobbing <b>always</b>', obligationCount: 3, testTargets: ['src/x.ts'],
      }),
    ]);
    expect(html).toContain('The purser steel-manned this PR into 3 testable obligations');
    expect(html).toContain('Guarantee frobbing &lt;b&gt;always&lt;/b&gt;');
    expect(html).not.toContain('<b>always</b>');
  });

  it('narrates a malformed purser-steelman as a broken ship — honest, and failing the check', async () => {
    const html = await openPage(makeRun(), [
      step('purser-steelman', 'purser', 'pd-purser: steel-man MALFORMED', { error: 'not fenced JSON' }),
    ]);
    expect(html).toContain('could not steel-man this PR');
    expect(html).toContain('No contract was bluffed');
    expect(html).toContain('fails the fleet check until fixed');
  });

  it('narrates purser-contract-posted: contract into the PR summary, and the failure to do so', async () => {
    const posted = await openPage(makeRun(), [
      step('purser-contract-posted', 'purser',
        'pd-purser: steel-man contract (3 obligation(s)) written into the PR summary',
        { posted: true, obligationCount: 3 }),
    ]);
    expect(posted).toContain('written into the PR summary');

    const failed = await openPage(makeRun(), [
      step('purser-contract-posted', 'purser',
        'pd-purser: FAILED to write the steel-man contract into the PR summary',
        { posted: false, obligationCount: 3 }),
    ]);
    expect(failed).toContain('FAILED to write the steel-man contract');
  });

  it('narrates purser-tests: file count + size in KB + escaped file list', async () => {
    const html = await openPage(makeRun(), [
      step('purser-tests', 'purser', 'pd-purser: authored 2 adversarial test file(s)', {
        files: [
          { path: 'tests/purser/a.test.ts', bytes: 1024 },
          { path: 'tests/purser/<img>.test.ts', bytes: 512 },
        ],
        totalBytes: 1536,
      }),
    ]);
    expect(html).toContain('Authored 2 adversarial test files (1.5 KB)');
    expect(html).toContain('tests/purser/a.test.ts');
    expect(html).toContain('&lt;img&gt;');
    expect(html).not.toContain('<img>.test.ts');
  });

  it('narrates rejected purser tests without pretending anything was stacked', async () => {
    const html = await openPage(makeRun(), [
      step('purser-tests', 'purser', 'pd-purser: authored tests REJECTED', {
        error: 'path traversal rejected: ../x.ts',
      }),
    ]);
    expect(html).toContain('did not survive validation');
    expect(html).toContain('Nothing was stacked');
  });

  it('narrates purser-sandbox: ran-and-passed, ran-and-failed (escaped tail), and not-run', async () => {
    const passed = await openPage(makeRun(), [
      step('purser-sandbox', 'purser', 'pd-purser: sandbox PASSED', { executed: true, passed: true, failuresTail: '' }),
    ]);
    expect(passed).toContain('Sandbox ran the suite against the PR head — all tests passed');

    const failed = await openPage(makeRun(), [
      step('purser-sandbox', 'purser', 'pd-purser: sandbox FAILED', {
        executed: true, passed: false, failuresTail: '2 failed <script>x</script>',
      }),
    ]);
    expect(failed).toContain('Sandbox ran the suite against the PR head — test FAILURES');
    expect(failed).toContain('does not satisfy its own contract');
    expect(failed).toContain('&lt;script&gt;');
    expect(failed).not.toContain('<script>x</script>');

    const absent = await openPage(makeRun(), [
      step('purser-sandbox', 'purser', 'pd-purser: sandbox NOT RUN', {
        executed: false, passed: null, failuresTail: '', reason: 'SANDBOX binding absent',
      }),
    ]);
    expect(absent).toContain('Sandbox did not run — SANDBOX binding absent');
    expect(absent).toContain('No results were fabricated');
  });

  it('narrates purser-stacked: the demand ("must now satisfy these tests") + retarget note', async () => {
    const html = await openPage(makeRun(), [
      step('purser-stacked', 'purser', 'pd-purser: stacked tests as #8001 (PR retargeted onto tests)', {
        testPrNumber: 8001, testPrUrl: 'https://github.com/test/pr/8001', retargeted: true,
      }),
    ]);
    expect(html).toContain('Stacked #8001: the reviewed PR must now satisfy these tests');
    expect(html).toContain('retargeted onto the test branch');
  });

  it('narrates a degraded purser stacking honestly', async () => {
    const html = await openPage(makeRun(), [
      step('purser-stacked', 'purser', 'pd-purser: stacking degraded', {
        testPrNumber: null, testPrUrl: null, retargeted: false,
        degraded: 'the GitHub App lacks the `contents: write` permission.',
      }),
    ]);
    expect(html).toContain('Stacking degraded');
    expect(html).toContain('contents: write');
    expect(html).toContain('posted inline');
  });

  it("narrates stack-posted: the ship coded its own fix and stacked it on this PR", async () => {
    const html = await openPage(makeRun(), [
      step('stack-posted', 'spark', 'pd-spark: coded its own fix and stacked #8002 on top of #7', {
        stacked: true, stackPrNumber: 8002, stackPrUrl: 'https://github.com/test/pr/8002',
        proposalTitle: 'Fix the null guard', files: ['src/fix.ts'], sandboxValidated: true,
      }),
    ]);
    expect(html).toContain('pd-spark coded its own fix and stacked #8002 on top of this PR');
    expect(html).toContain('sandbox-validated against the PR head');
    expect(html).toContain('src/fix.ts');
  });

  it('narrates a degraded stack-posted (fix proposed but not stacked) with an escaped reason', async () => {
    const html = await openPage(makeRun(), [
      step('stack-posted', 'spark', 'pd-spark: stack fix NOT posted — fork PR', {
        stacked: false, degraded: 'fork PR — stacking is same-repo only <i>x</i>', proposalTitle: 'T',
      }),
    ]);
    expect(html).toContain('pd-spark proposed a coded fix, but it was not stacked');
    expect(html).toContain('same-repo only');
    expect(html).toContain('&lt;i&gt;');
    expect(html).not.toContain('<i>x</i>');
  });

  // ── No usable output (2026-08-04 green-theater regression) ────────────────
  //
  // A ship that returned nothing must never render as a pass. Before the fix
  // there was no `ship-no-output` step at all: the executor resolved such a
  // ship to a PASS verdict and this page rendered "PASS · clean" next to a
  // reviewer that had reviewed nothing.

  it('narrates a no-usable-output ship honestly and never as a pass', async () => {
    const html = await openPage(makeRun(), [
      step(
        'ship-no-output',
        'code-reviewer',
        'pd-code-reviewer returned no usable output — nothing was reviewed (the model returned text carrying no verdict and no structured block).',
        { noUsableOutput: true, reason: 'no-contract-signal', blocking: true, strippedLength: 45 },
      ),
    ]);
    expect(html).toContain('pd-code-reviewer returned no usable output');
    expect(html).toContain('nothing was reviewed');
    // The exact string the operator saw on the bad run must not appear.
    expect(html).not.toContain('PASS · clean');
    expect(html).not.toContain('came back clean');
    expect(html).not.toContain('reviewed the diff and returned');
  });

  it('badges the ship outcome as "no usable output", not a verdict', async () => {
    const html = await openPage(makeRun(), [
      step('ship-no-output', 'code-reviewer', 'pd-code-reviewer returned no usable output — nothing was reviewed.', {
        noUsableOutput: true, reason: 'empty', blocking: true,
      }),
    ]);
    expect(html).toContain('no usable output · nothing reviewed');
    expect(html).toContain('outcome tone-block');
  });

  it('explains fail-closed for a blocking ship and the broken-ship failure for an advisory one', async () => {
    const blocking = await openPage(makeRun(), [
      step('ship-no-output', 'code-reviewer', 'pd-code-reviewer returned no usable output — nothing was reviewed.', {
        noUsableOutput: true, reason: 'empty', blocking: true,
      }),
    ]);
    expect(blocking).toContain('failed closed');
    expect(blocking).toContain('an absent review is not an approval');

    // Broken-ship doctrine (2026-08-19): an advisory ship that returned
    // nothing is broken, and the fleet check fails until it is fixed. The old
    // copy — "did not fail the merge gate" — must never render again.
    const advisory = await openPage(makeRun(), [
      step('ship-no-output', 'snipe', 'pd-snipe returned no usable output — nothing was reviewed.', {
        noUsableOutput: true, reason: 'empty', blocking: false,
      }),
    ]);
    expect(advisory).not.toContain('did not fail the merge gate');
    expect(advisory).toContain('a ship that returned nothing is broken');
    expect(advisory).toContain('fails until it is fixed');
  });

  // ── Token metering (the same run showed "Input tokens 0 / Output tokens 0")

  it('sums token counts from the executor ship-spend step', async () => {
    const html = await openPage(makeRun(), [
      step('ship-spend', 'code-reviewer', 'pd-code-reviewer: 1,200 in / 340 out tokens over 3 call(s)', {
        model: '@cf/qwen/qwen3-30b-a3b-fp8', calls: 3, usageReported: true,
        inputTokens: 1200, outputTokens: 340, cachedInputTokens: 0, costUsd: 0.000175,
      }),
    ]);
    expect(html).toContain('>1,200<');
    expect(html).toContain('>340<');
    expect(html).not.toContain('not reported');
  });

  it('shows "not reported" rather than a zero that reads as free', async () => {
    // No step carries token fields — exactly the shape of the bad run.
    const html = await openPage(makeRun(), [
      step('ship-spend', 'code-reviewer', 'pd-code-reviewer: token usage not reported by @cf/qwen/qwen3-30b-a3b-fp8 (9 call(s))', {
        model: '@cf/qwen/qwen3-30b-a3b-fp8', calls: 9, usageReported: false, usageReports: 0,
      }),
    ]);
    expect(html).toContain('not reported');
    // The misleading zero tile is gone.
    expect(html).not.toMatch(/Input tokens<\/div><div class="v mono">0</);
    expect(html).toContain('the model reported no token usage');
  });

  it('serves a no-script CSP, no-store, and noindex on every response', async () => {
    const t = await runPageToken(SECRET, RUN_ID);
    for (const r of [
      await handleFleetRunPage(req(RUN_ID, { t }), makeEnv(), RUN_ID),
      await handleFleetRunPage(req(RUN_ID), makeEnv(), RUN_ID),
    ]) {
      expect(r.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
      expect(r.headers.get('Cache-Control')).toBe('no-store');
      expect(r.headers.get('X-Robots-Tag')).toContain('noindex');
    }
  });
});
