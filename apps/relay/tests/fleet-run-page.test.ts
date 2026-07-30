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

  it('narrates an ideation ship whose proposal block was malformed', async () => {
    const steps: FleetRunStepRow[] = [
      { run_id: RUN_ID, seq: 1, kind: 'ship-verdict', ship: 'spark', title: 'pd-spark: PASS (ideation)',
        detail: JSON.stringify({ proposals: 'malformed', posted: false }), created_at: 1_700_000_005 },
    ];
    const html = await openPage(makeRun(), steps);
    expect(html).toContain('proposal block was malformed');
    expect(html).toContain('advisory · ideation');
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
