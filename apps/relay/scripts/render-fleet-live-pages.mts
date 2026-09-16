/**
 * Render Cloud Fleet live-introspection pages from the production renderers.
 *
 * Motivation: PR screenshots must prove the deployed markup, including its
 * queued/running/superseded language, rather than a hand-built design mock.
 * The generated HTML is local capture input only; the shipped pages remain
 * script-free and server-rendered.
 *
 * Run with: ./node_modules/.bin/vite-node scripts/render-fleet-live-pages.mts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { renderRunsPage, type RepoGroup } from '../src/runs-page.js';
import { renderFleetRunReceiptPage } from '../src/fleet-run-page.js';
import type { UserRow, FleetRunStepRow } from '../src/db.js';
import type { FleetRunProjection } from '../src/fleet-run-intents.js';

const NOW = Math.floor(Date.parse('2026-08-22T17:00:00Z') / 1000);
const OUT = new URL('../.artifacts/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const operator: UserRow = {
  id: 'u_operator',
  github_user_id: 231,
  login: 'erichowens',
  display_name: 'Erich Owens',
  avatar_url: null,
  primary_email: 'operator@portdaddy.dev',
  email_verified: 1,
  created_at: NOW - 900_000,
  last_login_at: NOW - 120,
  deleted_at: null,
};

const running: FleetRunProjection = {
  id: 'run:delivery-8889-generation-4',
  delivery_id: 'delivery-8889-generation-4',
  repo_full_name: 'curiositech/port-daddy',
  pr_number: 8889,
  pr_url: 'https://github.com/curiositech/port-daddy/pull/8889',
  head_sha: '749b4dc2ffe0e9a359e9300f1ad3eaab5715d078',
  conclusion: 'running',
  ships_csv: 'code-reviewer,red-team',
  neurons: null,
  ms: 96_000,
  created_at: NOW - 180,
  logical_state: 'running',
  generation: 4,
  attempt_count: 2,
  queued_at: NOW - 180,
  started_at: NOW - 96,
  last_progress_at: NOW - 8,
  finished_at: null,
  superseded_by: null,
  last_error: null,
  expected_start_at: NOW - 96,
  expected_finish_at: NOW + 82,
  queue_ahead_estimate: 0,
  has_transcript: true,
};

const queued: FleetRunProjection = {
  ...running,
  id: 'intent:delivery-8910-generation-2',
  delivery_id: 'delivery-8910-generation-2',
  pr_number: 8910,
  pr_url: 'https://github.com/curiositech/port-daddy/pull/8910',
  head_sha: '8728eaaa7f2af5f115090bcb6799974e56553303',
  conclusion: 'queued',
  ships_csv: '',
  ms: 0,
  logical_state: 'queued',
  generation: 2,
  attempt_count: 0,
  queued_at: NOW - 64,
  started_at: null,
  last_progress_at: NOW - 64,
  expected_start_at: NOW + 82,
  expected_finish_at: NOW + 244,
  queue_ahead_estimate: 1,
  has_transcript: false,
};

const retrying: FleetRunProjection = {
  ...running,
  id: 'run:delivery-8871-generation-3',
  delivery_id: 'delivery-8871-generation-3',
  pr_number: 8871,
  pr_url: 'https://github.com/curiositech/port-daddy/pull/8871',
  head_sha: '17128c2042fb924f4dbc4ea965b9ea5cb7f4f649',
  conclusion: 'retrying',
  ships_csv: 'qa,purser',
  ms: 151_000,
  logical_state: 'retrying',
  generation: 3,
  attempt_count: 2,
  queued_at: NOW - 540,
  started_at: NOW - 510,
  last_progress_at: NOW - 25,
  expected_finish_at: NOW + 30,
  queue_ahead_estimate: 0,
  last_error: 'Workers AI circuit open on attempt 2/3; queue retry scheduled in 31s',
};

const providerOutageNeutral: FleetRunProjection = {
  ...retrying,
  id: 'run:delivery-8872-generation-1',
  delivery_id: 'delivery-8872-generation-1',
  pr_number: 8872,
  pr_url: 'https://github.com/curiositech/port-daddy/pull/8872',
  head_sha: '4cd6cab193da628c40553b5111217b77df53323a',
  conclusion: 'neutral',
  logical_state: 'neutral',
  generation: 1,
  attempt_count: 3,
  ms: 486_000,
  last_progress_at: NOW - 24,
  finished_at: NOW - 24,
  expected_start_at: null,
  expected_finish_at: null,
  queue_ahead_estimate: null,
  last_error: 'Workers AI dependency circuit remained open through 3/3 delivery attempts',
};

const superseded: FleetRunProjection = {
  ...queued,
  id: 'intent:delivery-8889-generation-3',
  delivery_id: 'delivery-8889-generation-3',
  pr_number: 8889,
  head_sha: '1058ea24239af625327f579e47013c7f74f253f1',
  conclusion: 'superseded',
  logical_state: 'superseded',
  generation: 3,
  queued_at: NOW - 1_420,
  last_progress_at: NOW - 180,
  finished_at: NOW - 180,
  superseded_by: 'delivery-8889-generation-4',
  expected_start_at: null,
  expected_finish_at: null,
  queue_ahead_estimate: null,
};

const success: FleetRunProjection = {
  ...running,
  id: 'run:delivery-8906-generation-1',
  delivery_id: 'delivery-8906-generation-1',
  pr_number: 8906,
  pr_url: 'https://github.com/curiositech/port-daddy/pull/8906',
  head_sha: '21e5f9913bf8bb86b2fb5e5045d378f872f6b78d',
  conclusion: 'success',
  ships_csv: 'qa,code-reviewer,red-team',
  neurons: 31_402,
  ms: 138_420,
  logical_state: 'success',
  generation: 1,
  attempt_count: 1,
  queued_at: NOW - 4_200,
  started_at: NOW - 4_180,
  last_progress_at: NOW - 4_042,
  finished_at: NOW - 4_042,
  expected_start_at: null,
  expected_finish_at: null,
  queue_ahead_estimate: null,
};

const groups: RepoGroup[] = [{
  repo: 'curiositech/port-daddy',
  runs: [queued, running, retrying, superseded, success],
}];

const progressSteps: FleetRunStepRow[] = [
  {
    run_id: running.id,
    seq: 0,
    kind: 'map-chunk',
    ship: 'code-reviewer',
    title: 'Read 8 changed files · checkpoint restored',
    detail: JSON.stringify({ inputTokens: 8_241, outputTokens: 812 }),
    created_at: NOW - 90,
  },
  {
    run_id: running.id,
    seq: 1,
    kind: 'reduce',
    ship: 'code-reviewer',
    title: 'Admission ledger is idempotent across repeated deliveries',
    detail: JSON.stringify({ inputTokens: 1_420, outputTokens: 196, findings: [] }),
    created_at: NOW - 58,
  },
  {
    run_id: running.id,
    seq: 2,
    kind: 'map-chunk',
    ship: 'red-team',
    title: 'Testing rollback and queue-send failure boundaries',
    detail: JSON.stringify({ inputTokens: 4_802, outputTokens: 522 }),
    created_at: NOW - 19,
  },
];

const finishedSteps: FleetRunStepRow[] = [
  ...progressSteps,
  {
    run_id: running.id,
    seq: 3,
    kind: 'ship-verdict',
    ship: 'red-team',
    title: 'pd-red-team: PASS',
    detail: JSON.stringify({ inputTokens: 2_104, outputTokens: 281, findings: [] }),
    created_at: NOW + 24,
  },
  {
    run_id: running.id,
    seq: 4,
    kind: 'check-completed',
    ship: null,
    title: 'Port Daddy Fleet concluded: success',
    detail: JSON.stringify({ conclusion: 'success' }),
    created_at: NOW + 31,
  },
];

const retrySteps: FleetRunStepRow[] = [
  {
    run_id: retrying.id,
    seq: 0,
    kind: 'provider-circuit-open',
    ship: 'qa',
    title: 'Workers AI circuit opened',
    detail: JSON.stringify({ attempt: 2, maxAttempts: 3, status: 429, code: 3040, retryable: true }),
    created_at: NOW - 25,
  },
];

const providerOutageNeutralSteps: FleetRunStepRow[] = [
  {
    run_id: providerOutageNeutral.id,
    seq: 0,
    kind: 'provider-circuit-open',
    ship: 'qa',
    title: 'Workers AI circuit opened',
    detail: JSON.stringify({ attempt: 3, maxAttempts: 3, status: 429, code: 3040, retryable: true }),
    created_at: NOW - 25,
  },
  {
    run_id: providerOutageNeutral.id,
    seq: 1,
    kind: 'ship-adjudicated',
    ship: 'qa',
    title: 'pd-qa: adjudicated FLEET-WIDE fault — not gating this PR',
    detail: JSON.stringify({ verdict: 'fleet', reason: 'Workers AI dependency circuit remained open through 3/3 delivery attempts' }),
    created_at: NOW - 24,
  },
];

const completed: FleetRunProjection = {
  ...running,
  conclusion: 'success',
  logical_state: 'success',
  ms: 127_000,
  last_progress_at: NOW + 31,
  finished_at: NOW + 31,
  expected_start_at: null,
  expected_finish_at: null,
  queue_ahead_estimate: null,
};

writeFileSync(`${OUT}fleet-account.html`, renderRunsPage(operator, groups, { truncated: false, nowSec: NOW }));
writeFileSync(`${OUT}fleet-receipt-queued.html`, renderFleetRunReceiptPage(queued, []));
writeFileSync(`${OUT}fleet-receipt-running.html`, renderFleetRunReceiptPage(running, progressSteps));
writeFileSync(`${OUT}fleet-receipt-retrying.html`, renderFleetRunReceiptPage(retrying, retrySteps));
writeFileSync(`${OUT}fleet-receipt-provider-neutral.html`, renderFleetRunReceiptPage(providerOutageNeutral, providerOutageNeutralSteps));
writeFileSync(`${OUT}fleet-receipt-success.html`, renderFleetRunReceiptPage(completed, finishedSteps));

console.log(`rendered Cloud Fleet evidence HTML under ${OUT}`);
