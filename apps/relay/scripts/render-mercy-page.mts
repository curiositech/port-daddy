/**
 * Render the MERCY report card to a static file for visual capture
 * (grand-plan DAG node x7-mercy-hooks — the per-feature hooks panel).
 *
 * Same discipline as render-parley-pages.mts: the captured PNG must be a
 * picture of PRODUCTION markup, so this imports the real renderMercyPage and
 * feeds it a realistic stored snapshot — subsystems, incidents, and the new
 * hooks_json with every declared hook in a representative state, including
 * the `unknown` verdicts that must render muted and never green.
 *
 * Run with: bunx vite-node scripts/render-mercy-page.mts
 * Output:   .artifacts/mercy-report.html
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { renderMercyPage, type SubsystemProbe, type MercyIncidentRow } from '../src/mercy.js';
import type { FeatureHook } from '../src/mercy-hooks.js';

const NOW = Math.floor(Date.parse('2026-08-09T18:00:00Z') / 1000);
const OUT = new URL('../.artifacts/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const subsystems: SubsystemProbe[] = [
  { name: 'd1', status: 'green', latencyMs: 12, detail: 'write 7ms / read 12ms' },
  { name: 'kv', status: 'green', latencyMs: 9, detail: 'put+get round-trip 9ms' },
  { name: 'do_channel', status: 'green', latencyMs: 31, detail: 'channel echo round-trip 31ms' },
  { name: 'queue', status: 'green', latencyMs: null, detail: 'producer binding present; Cloudflare exposes no queue-depth API, so depth is unmeasured' },
  { name: 'fleet_executor', status: 'green', latencyMs: null, detail: 'last fleet_runs write 421s ago' },
  { name: 'error_rate', status: 'yellow', latencyMs: null, detail: '6/11 runs (55%) concluded failure in 24h — includes legitimate BLOCK verdicts, inspect transcripts' },
];

const hooks: FeatureHook[] = [
  { name: 'x4_summons_ack', status: 'green', metric: 95, detail: '19/20 summonses acked within 15min over 7d (95%; target ≥ 90%; 0 overdue unacked)' },
  { name: 'x4_parley_fatigue', status: 'yellow', metric: 7, detail: "most-summoned party in 24h: 'daemon-hasty' × 7 (warn ≥ 6, red ≥ 12)" },
  { name: 'x3_stale_helm', status: 'green', metric: 0, detail: 'no vacant-flagged helms' },
  { name: 'x3_helm_contention', status: 'yellow', metric: 1, detail: '1 dead-man helm transition(s) in 24h — holders going silent past grace' },
  { name: 'x2_remote_harbors', status: 'unknown', metric: 3, detail: '3 harbor(s) registered; per-harbor canary round-trip not yet shipped (X2 v2) — liveness unproven' },
  { name: 'x8_quota_exhaustion', status: 'green', metric: 0, detail: 'no enforced budget refusals in 24h' },
  { name: 'x8_shadow_delta', status: 'yellow', metric: 5, detail: '5 event(s) in 24h passed in shadow that enforcement WOULD refuse — review before any flip' },
  { name: 'hitl_interruptions', status: 'green', metric: 1, detail: '1 open ask(s); none expired unanswered in 24h' },
  { name: 'squid_reconciliation', status: 'yellow', metric: 3, detail: '2/9 run(s) in 7d show a claimed-vs-received gap (3 event(s) lost) — fire-and-forget loss made visible' },
  { name: 'slo_burn', status: 'green', metric: 0.4, detail: 'burn ×0.4 (1h) / ×0.2 (6h) of the 99.9% error budget; alert ≥ ×14 (3/14620 5xx in 6h)' },
];

const incidents: MercyIncidentRow[] = [
  {
    id: 'mi_1f2e3d4c',
    subsystem: 'do_channel',
    opened_at: NOW - 3 * 24 * 3600,
    resolved_at: NOW - 3 * 24 * 3600 + 900,
    paged_at: NOW - 3 * 24 * 3600 + 12,
    detail: 'channel echo returned HTTP 500',
  },
];

const snapshot = {
  at: NOW - 140,
  overall: 'yellow',
  remote_harbors_possible: 1,
  subsystems_json: JSON.stringify(subsystems),
  hooks_json: JSON.stringify(hooks),
} as never;

writeFileSync(`${OUT}mercy-report.html`, renderMercyPage(snapshot, incidents, NOW));
console.log(`wrote ${OUT}mercy-report.html`);
