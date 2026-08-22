#!/usr/bin/env node
/**
 * scripts/fleet-ship-stats.mjs — the fleet's per-ship × per-model scoreboard.
 *
 * WHY THIS EXISTS (operator ask, 2026-08-22, during the #8870 purser
 * epidemic): the relay D1 has always RECORDED everything needed to judge a
 * model — `fleet_run_spend` (ship, model, tokens, USD), `fleet_run_steps`
 * (broken/no-output/adjudicated/repair, the purser authoring funnel), and
 * `fleet_runs` (verdict mix) — but there was no query surface, so "how is
 * each model doing on each ship" was answered by archaeology or, worse, by
 * memory. The gpt-oss-20b author tier ran for a week at a 75% repair-failure
 * rate before anyone assembled the numbers. This script makes the scoreboard
 * a one-command answer, so model decisions are made (and re-judged) against
 * live evidence — see the standing rule in
 * skills/port-daddy-internal-dev/references/cloudflare-model-roster.md.
 *
 * Usage:
 *   node scripts/fleet-ship-stats.mjs [--days 14] [--database port-daddy-relay] \
 *     [--config apps/fleet-executor/wrangler.deploy.toml]
 *
 * Runs each query remotely via `npx wrangler d1 execute --remote --json`
 * using the fleet-executor's committed Worker config (which binds the shared
 * relay database), so it needs the same Cloudflare auth wrangler already
 * uses (CLOUDFLARE_API_TOKEN / `wrangler login`). The SQL builders and the
 * renderer are exported pure functions so the unit suite
 * (tests/unit/fleet-ship-stats.test.js) exercises the real logic without a
 * network.
 */

import { execFileSync } from 'node:child_process';

/**
 * Build the three scoreboard queries for a trailing window.
 *
 * Design: plain SQL strings with the window inlined as an integer — D1's
 * `wrangler d1 execute --command` takes no bind params, and `days` is
 * validated to a positive integer in {@link parseArgs} precisely so this
 * inlining cannot be an injection surface.
 *
 * @param {number} days trailing window in days (positive integer)
 * @returns {{spend: string, health: string, purser: string, runs: string}}
 *   named SQL strings: spend by ship×model, step-health by ship, the purser
 *   authoring funnel, and the run-verdict mix
 */
export function buildQueries(days) {
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`days must be a positive integer, got ${days}`);
  }
  const since = `unixepoch() - ${days} * 86400`;
  return {
    spend:
      `SELECT ship, model, COUNT(*) AS calls, SUM(input_tokens) AS in_tok, ` +
      `SUM(output_tokens) AS out_tok, ROUND(SUM(cost_usd), 4) AS usd ` +
      `FROM fleet_run_spend WHERE created_at > ${since} ` +
      `GROUP BY ship, model ORDER BY ship, calls DESC`,
    health:
      `SELECT ship, kind, COUNT(*) AS n FROM fleet_run_steps ` +
      `WHERE created_at > ${since} AND kind IN ` +
      `('ship-broken','ship-no-output','ship-adjudicated','ship-repair') ` +
      `GROUP BY ship, kind ORDER BY ship, kind`,
    purser:
      `SELECT kind, CASE ` +
      `WHEN title LIKE '%HEALED%' THEN 'healed' ` +
      `WHEN title LIKE '%FAILED%' THEN 'failed' ` +
      `WHEN title LIKE '%PARTIAL%' THEN 'partial' ` +
      `WHEN title LIKE '%NON-EXECUTABLE%' THEN 'non-executable' ` +
      `WHEN title LIKE '%REJECTED%' THEN 'rejected' ` +
      `ELSE 'ok' END AS outcome, COUNT(*) AS n FROM fleet_run_steps ` +
      `WHERE created_at > ${since} AND kind IN ('purser-tests','purser-author-repair','purser-sandbox') ` +
      `GROUP BY kind, outcome ORDER BY kind, n DESC`,
    runs:
      `SELECT conclusion, COUNT(*) AS n FROM fleet_runs ` +
      `WHERE created_at > ${since} GROUP BY conclusion ORDER BY n DESC`,
  };
}

/**
 * Render the scoreboard from the four query result sets.
 *
 * Kept pure (rows in, string out) for testability, and deliberately plain
 * text rather than JSON: the audience is an operator (or an agent quoting an
 * operator) deciding whether a model tier earns its keep. The one piece of
 * derived judgement baked in: a row with recorded tokens and $0.0000 cost is
 * flagged UNPRICED, because that is how a model rides invisibly (the
 * gpt-oss-20b author tier metered $0 for a week).
 *
 * @param {object} data
 * @param {Array<object>} data.spend rows from the spend query
 * @param {Array<object>} data.health rows from the health query
 * @param {Array<object>} data.purser rows from the purser-funnel query
 * @param {Array<object>} data.runs rows from the run-verdict query
 * @param {number} data.days the window, echoed in headers
 * @returns {string} the rendered scoreboard
 */
export function renderShipStats({ spend, health, purser, runs, days }) {
  const out = [];
  const pad = (v, w) => String(v ?? '').padEnd(w);
  const num = (v, w) => String(v ?? 0).padStart(w);

  out.push(`FLEET SHIP STATS — trailing ${days} day(s)`);
  out.push('');
  out.push(`Run verdicts: ${runs.map(r => `${r.conclusion}=${r.n}`).join('  ') || '(none)'}`);
  out.push('');

  out.push('SPEND BY SHIP × MODEL');
  out.push(
    `${pad('ship', 20)}${pad('model', 38)}${num('calls', 7)}${num('in_tok', 12)}${num('out_tok', 10)}${num('usd', 10)}`,
  );
  for (const r of spend) {
    const unpriced = (r.in_tok > 0 || r.out_tok > 0) && Number(r.usd) === 0;
    out.push(
      `${pad(r.ship, 20)}${pad(r.model, 38)}${num(r.calls, 7)}${num(r.in_tok, 12)}${num(r.out_tok, 10)}${num(
        Number(r.usd).toFixed(4),
        10,
      )}${unpriced ? '  ← UNPRICED (add a WORKERS_AI_RATES row)' : ''}`,
    );
  }
  out.push('');

  out.push('STEP HEALTH BY SHIP (broken gates the fleet under adjudication)');
  const byShip = new Map();
  for (const r of health) {
    if (!byShip.has(r.ship)) byShip.set(r.ship, {});
    byShip.get(r.ship)[r.kind] = r.n;
  }
  out.push(
    `${pad('ship', 20)}${num('broken', 8)}${num('no-out', 8)}${num('adjud', 8)}${num('repair', 8)}`,
  );
  for (const [ship, k] of [...byShip.entries()].sort((a, b) => (b[1]['ship-broken'] ?? 0) - (a[1]['ship-broken'] ?? 0))) {
    out.push(
      `${pad(ship, 20)}${num(k['ship-broken'], 8)}${num(k['ship-no-output'], 8)}${num(k['ship-adjudicated'], 8)}${num(
        k['ship-repair'],
        8,
      )}`,
    );
  }
  out.push('');

  out.push('PURSER AUTHORING FUNNEL');
  for (const r of purser) {
    out.push(`  ${pad(r.kind, 22)}${pad(r.outcome, 16)}${num(r.n, 6)}`);
  }
  return out.join('\n');
}

/**
 * Parse CLI args. Kept minimal on purpose — the script has three knobs and
 * anything richer belongs in a FleetBar/dashboard panel per the operator-vs-
 * agent product rule.
 *
 * @param {string[]} argv process argv slice
 * @returns {{days: number, database: string, config: string}}
 */
export function parseArgs(argv) {
  const out = {
    days: 14,
    database: 'port-daddy-relay',
    config: 'apps/fleet-executor/wrangler.deploy.toml',
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') out.days = Number.parseInt(argv[++i], 10);
    else if (argv[i] === '--database') out.database = String(argv[++i]);
    else if (argv[i] === '--config') out.config = String(argv[++i]);
  }
  if (!Number.isInteger(out.days) || out.days <= 0) {
    throw new Error(`--days must be a positive integer`);
  }
  return out;
}

/**
 * Execute one query remotely via wrangler and return its result rows.
 *
 * Why wrangler rather than a raw D1 HTTP call: wrangler already owns the
 * account auth story on every machine that deploys these Workers, so the
 * script inherits it instead of inventing a second credential path.
 *
 * @param {{database: string, config: string}} opts target database + config
 * @param {string} sql the query
 * @returns {Array<object>} result rows
 */
function runQuery(opts, sql) {
  const raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', opts.database, '--remote', '--json', '--config', opts.config, '--command', sql],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw);
  return parsed?.[0]?.results ?? [];
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const q = buildQueries(opts.days);
  const data = {
    days: opts.days,
    spend: runQuery(opts, q.spend),
    health: runQuery(opts, q.health),
    purser: runQuery(opts, q.purser),
    runs: runQuery(opts, q.runs),
  };
  console.log(renderShipStats(data));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
