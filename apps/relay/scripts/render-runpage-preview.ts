/**
 * Dev-only preview: render the fleet run page with realistic data via the REAL
 * handler (auth path included) and write the HTML for screenshotting. Not shipped.
 */
import { writeFileSync } from 'node:fs';
import { handleFleetRunPage, runPageToken } from '../src/fleet-run-page.js';
import type { Env } from '../src/types.js';
import type { FleetRunRow, FleetRunStepRow } from '../src/db.js';

const SECRET = 'run-page-secret-that-is-at-least-32-chars';
const RUN_ID = 'run:delivery-9f3ac21';

const run: FleetRunRow = {
  id: RUN_ID,
  delivery_id: '9f3ac21b-7e0d-4f2a-9c11-abc123def456',
  repo_full_name: 'erichowens/port-daddy',
  pr_number: 3849,
  pr_url: 'https://github.com/erichowens/port-daddy/pull/3849',
  head_sha: 'c68fe8122a4b9d3e1f0a',
  conclusion: 'success',
  ships_csv: 'code-reviewer,red-team,test-gap-hunter',
  neurons: 184_920,
  ms: 148_000,
  created_at: 1_721_770_000,
};

const steps: FleetRunStepRow[] = [
  { run_id: RUN_ID, seq: 1, kind: 'map-chunk', ship: 'code-reviewer', title: 'MAP chunk 1/3 — apps/relay/src/fleet-run-page.ts',
    detail: JSON.stringify({ inputTokens: 4210, outputTokens: 512, chunk: '1/3', lines: 340 }), created_at: 1_721_770_006 },
  { run_id: RUN_ID, seq: 2, kind: 'map-chunk', ship: 'code-reviewer', title: 'MAP chunk 2/3 — apps/relay/src/db.ts',
    detail: JSON.stringify({ inputTokens: 3880, outputTokens: 420, chunk: '2/3', lines: 210 }), created_at: 1_721_770_011 },
  { run_id: RUN_ID, seq: 3, kind: 'ship-finding', ship: 'code-reviewer', title: 'Findings on the run-page redesign',
    detail: JSON.stringify({ findings: [
      { note: 'CSP correctly extended for Google Fonts while remaining script-free — style-src/font-src pinned to the two Google origins.', path: 'apps/relay/src/fleet-run-page.ts', line: 96, severity: 'info' },
      { note: 'Every interpolated transcript value flows through esc(); attacker-influenced model output cannot become live markup.', path: 'apps/relay/src/fleet-run-page.ts', line: 348 },
    ] }), created_at: 1_721_770_040 },
  { run_id: RUN_ID, seq: 4, kind: 'reduce', ship: 'code-reviewer', title: 'REDUCE — merge chunk verdicts',
    detail: JSON.stringify({ inputTokens: 2100, outputTokens: 980, mergedFrom: 3, verdict: 'PASS' }), created_at: 1_721_770_058 },
  { run_id: RUN_ID, seq: 5, kind: 'ship-verdict', ship: 'code-reviewer', title: 'pd-code-reviewer: PASS',
    detail: JSON.stringify({ verdict: 'CONFIRMED', confidence: 0.92, summary: 'Auth untouched; only the HTML body changed. Security posture preserved.' }), created_at: 1_721_770_061 },
  { run_id: RUN_ID, seq: 6, kind: 'map-chunk', ship: 'red-team', title: 'MAP chunk 1/1 — adversarial pass on gating',
    detail: JSON.stringify({ inputTokens: 5100, outputTokens: 640 }), created_at: 1_721_770_070 },
  { run_id: RUN_ID, seq: 7, kind: 'ship-finding', ship: 'red-team', title: 'Probed the capability-token gate',
    detail: JSON.stringify({ findings: [
      'No existence oracle: unknown run and unauthorized run return byte-identical 404 pages.',
      { note: 'timingSafeEqual guards both the operator bearer and the HMAC compare — no early-exit length leak.', path: 'apps/relay/src/fleet-run-page.ts', line: 62 },
    ] }), created_at: 1_721_770_090 },
  { run_id: RUN_ID, seq: 8, kind: 'ship-verdict', ship: 'red-team', title: 'pd-red-team: no escalation found',
    detail: JSON.stringify({ verdict: 'CONFIRMED', attempts: 14, escalations: 0 }), created_at: 1_721_770_101 },
  { run_id: RUN_ID, seq: 9, kind: 'ship-verdict', ship: 'test-gap-hunter', title: 'pd-test-gap-hunter: CHANGES',
    detail: JSON.stringify({ verdict: 'CHANGES', note: 'Consider an assertion for the empty-transcript state.' }), created_at: 1_721_770_120 },
  { run_id: RUN_ID, seq: 10, kind: 'review-posted', ship: null, title: 'Review posted to PR #3849',
    detail: JSON.stringify({ commentId: 219938471, url: 'https://github.com/erichowens/port-daddy/pull/3849#issuecomment-219938471' }), created_at: 1_721_770_140 },
  { run_id: RUN_ID, seq: 11, kind: 'check-completed', ship: null, title: 'Check concluded: success',
    detail: JSON.stringify({ conclusion: 'success', durationMs: 148000 }), created_at: 1_721_770_148 },
];

function makeDb(): D1Database {
  const stmtFor = () => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...vals: unknown[]) { bound = vals; return stmt; },
      async first<T>(): Promise<T | null> { return (bound[0] === run.id ? run : null) as T | null; },
      async all<T>(): Promise<{ results: T[] }> { return { results: (bound[0] === run.id ? steps : []) as T[] }; },
      async run() { return { success: true }; },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return { prepare: stmtFor } as unknown as D1Database;
}

const env = {
  DB: makeDb(),
  RUN_PAGE_SECRET: SECRET,
  RELAY_OPERATOR_TOKEN: 'operator-token-at-least-32-bytes-long!!',
} as unknown as Env;

async function main(): Promise<void> {
  const OUT = process.env.OUT ?? `${process.env.HOME}/coding/tmp/pd-runpage/run.html`;
  const t = await runPageToken(SECRET, RUN_ID);
  const url = new URL(`https://relay.example/fleet/runs/${encodeURIComponent(RUN_ID)}`);
  url.searchParams.set('t', t);
  const res = await handleFleetRunPage(new Request(url), env, RUN_ID);
  const html = await res.text();
  writeFileSync(OUT, html);
  console.log('status', res.status, 'bytes', html.length);

  // Empty-state variant
  const emptyDb = (() => {
    const s = () => {
      let b: unknown[] = [];
      const st = {
        bind(...v: unknown[]) { b = v; return st; },
        async first<T>(): Promise<T | null> { return (b[0] === run.id ? run : null) as T | null; },
        async all<T>(): Promise<{ results: T[] }> { return { results: [] as T[] }; },
        async run() { return { success: true }; },
      };
      return st as unknown as D1PreparedStatement;
    };
    return { prepare: s } as unknown as D1Database;
  })();
  const env2 = { ...env, DB: emptyDb } as unknown as Env;
  const res2 = await handleFleetRunPage(new Request(url), env2, RUN_ID);
  writeFileSync(OUT.replace('.html', '-empty.html'), await res2.text());
  console.log('empty status', res2.status);
}

void main();
