/** Repository-scoped evidence for the ship controls page. Why a bounded read
 * model: viewing ships must not launch work or fan out into model/cloud APIs.
 */
import type { ShipControlsDb } from '../../shared/repo-ship-controls.js';
import { shipControlRepo } from '../../shared/repo-ship-controls.js';

interface Run { id: string; pr_number: number; conclusion: string; created_at: number; ships_csv: string; }
interface Spend { run_id: string; ship: string; model: string; cost_usd: number; input_tokens: number; output_tokens: number; created_at: number; }
interface Step { run_id: string; ship: string; kind: string; title: string; created_at: number; }
interface Transcript { run_id: string; ship: string; attempt: number; turns: number; incomplete: number; }
interface Calls { run_id: string; ship: string; calls: number; error_calls: number; timeout_calls: number; total_elapsed_ms: number; }
export interface ShipEvidence {
  runs: Run[]; spend: Spend[]; steps: Step[]; transcripts: Transcript[]; calls: Calls[];
}
export interface RepoShipTelemetry extends ShipEvidence {
  available: boolean; gaps: string[]; truncated: boolean; now: number;
}

/** Why independent reads: missing cost or transcript storage must not hide
 * known run failures or disable the operator's Off button.
 * @param db Shared Relay D1, after the caller has authorized the repo.
 * @param repo Exact authorized repository name.
 * @param now Snapshot epoch seconds.
 * @returns Recent evidence, explicit missing sources, and window limitations.
 */
export async function readRepoShipTelemetry(db: ShipControlsDb | undefined, repo: string, now = Math.floor(Date.now() / 1000)): Promise<RepoShipTelemetry> {
  const result: RepoShipTelemetry = { available: false, gaps: [], truncated: false, now, runs: [], spend: [], steps: [], transcripts: [], calls: [] };
  const scope = shipControlRepo(repo);
  if (!db || !scope) return { ...result, gaps: ['Run telemetry unavailable'] };
  const since = Math.floor(now / 86400) * 86400 - 13 * 86400;
  const recent = `SELECT id FROM fleet_runs WHERE repo_full_name = ? COLLATE NOCASE AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 200`;
  /** Why SQL limits plus visible clipping: no unbounded tenant-history download.
   * @param name Display label for a failed source. @param sql Scoped query.
   * @returns Bounded result rows; errors remain visible in gaps.
   */
  async function rows<T>(name: string, sql: string, eventWindow = false): Promise<T[]> {
    try {
      const response = await db!.prepare(sql).bind(scope, since, now, ...(eventWindow ? [since, now] : [])).all<T>();
      if (response.success === false || !Array.isArray(response.results)) throw new Error('Unavailable');
      if (response.results.length > 1000) result.truncated = true;
      return response.results.slice(0, 1000);
    } catch { result.gaps.push(`${name} unavailable`); return []; }
  }
  result.runs = await rows<Run>('Run telemetry', `SELECT id, pr_number, conclusion, created_at, ships_csv FROM fleet_runs WHERE repo_full_name = ? COLLATE NOCASE AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 201`);
  result.available = result.gaps.length === 0;
  if (!result.available) return result;
  if (result.runs.length > 200) result.truncated = true;
  result.runs = result.runs.slice(0, 200);
  if (result.runs.length === 0) return result;
  [result.spend, result.steps, result.transcripts, result.calls] = await Promise.all([
    rows<Spend>('Cost ledger', `SELECT run_id, ship, model, cost_usd, input_tokens, output_tokens, created_at FROM fleet_run_spend WHERE run_id IN (${recent}) AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC, rowid DESC LIMIT 1001`, true),
    rows<Step>('Recent activity', `SELECT run_id, ship, kind, substr(title,1,600) AS title, created_at FROM fleet_run_steps WHERE run_id IN (${recent}) AND ship IS NOT NULL ORDER BY created_at DESC, seq DESC LIMIT 1001`),
    rows<Transcript>('Transcript index', `SELECT run_id, ship, attempt, turns, incomplete FROM fleet_run_transcripts WHERE run_id IN (${recent}) ORDER BY created_at DESC, attempt DESC LIMIT 1001`),
    rows<Calls>('Call health', `SELECT run_id, ship, calls, error_calls, timeout_calls, total_elapsed_ms FROM fleet_ai_call_stats WHERE run_id IN (${recent}) ORDER BY created_at DESC, run_id DESC, ship LIMIT 1001`),
  ]);
  return result;
}

/** Why escape every field: transcript titles/model names are untrusted output.
 * @param value Any stored value. @returns Attribute/text-safe HTML.
 */
function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
/** Why positive-only costs: historical zero ledger rows can mean missing usage.
 * @param n Stored numeric value. @returns Finite positive amount or zero.
 */
function positive(n: number): number { return Number.isFinite(n) && n > 0 ? n : 0; }
/** Why explicit currency: this is a recorded estimate, never an invoice.
 * @param n Recorded amount. @returns Display label.
 */
function dollars(n: number): string { return `$${n.toFixed(4)}`; }

/** Invalid stored timestamps must not break the operator's controls.
 * @param seconds Stored epoch. @returns Safe ISO timestamp or explicit gap.
 */
function timestamp(seconds: number): string {
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'Time unavailable';
}

/** Why one shared panel: aggregate and ship detail must use the same evidence.
 * @param data Fresh authorized snapshot. @param ship Exact name, or '*' for repo.
 * @returns Cost graph, health, recent evidence, and existing authorized deep-links.
 */
export function renderShipTelemetry(data: RepoShipTelemetry | undefined, ship: string): string {
  if (!data || !data.available) return '<p class="telemetry-note">Run telemetry unavailable. Permission is not running status.</p>';
  const matches = (name: string) => ship === '*' || name === ship;
  const spend = data.spend.filter(row => matches(row.ship));
  const steps = data.steps.filter(row => matches(row.ship));
  const transcripts = data.transcripts.filter(row => matches(row.ship));
  const calls = data.calls.filter(row => matches(row.ship));
  const evidenced = new Set([...spend, ...steps, ...transcripts, ...calls].map(row => row.run_id));
  const runs = data.runs.filter(row => ship === '*' || String(row.ships_csv ?? '').split(',').map(s => s.trim()).includes(ship) || evidenced.has(row.id));
  const total = spend.reduce((sum, row) => sum + positive(row.cost_usd), 0);
  const unreported = spend.filter(row => !positive(row.cost_usd)).length;
  const tokens = spend.reduce((sum, row) => sum + positive(row.input_tokens) + positive(row.output_tokens), 0);
  const nCalls = calls.reduce((sum, row) => sum + positive(row.calls), 0);
  const failures = calls.reduce((sum, row) => sum + positive(row.error_calls), 0);
  const timeouts = calls.reduce((sum, row) => sum + positive(row.timeout_calls), 0);
  const elapsed = calls.reduce((sum, row) => sum + positive(row.total_elapsed_ms), 0);
  const models = [...new Set(spend.map(row => row.model).filter(Boolean))].slice(0, 6);
  const day = Math.floor(data.now / 86400);
  const days = Array.from({ length: 14 }, (_, i) => {
    const epoch = (day - 13 + i) * 86400;
    const amount = spend.filter(row => row.created_at >= epoch && row.created_at < epoch + 86400).reduce((sum, row) => sum + positive(row.cost_usd), 0);
    return { date: new Date(epoch * 1000).toISOString().slice(0, 10), amount };
  });
  const peak = Math.max(...days.map(d => d.amount), 0.0001);
  const bars = days.map(d => `<div class="cost-day"><span class="${d.amount ? 'reported' : 'unreported'}" style="height:${Math.round(positive(d.amount) / peak * 70)}px" title="${d.date}: ${d.amount ? dollars(d.amount) : 'No reported cost'}"></span><small>${d.date.slice(8)}</small></div>`).join('');
  const table = days.map(d => `<tr><td>${d.date}</td><td>${d.amount ? dollars(d.amount) : 'No reported cost'}</td></tr>`).join('');
  const recent = runs.slice(0, 3).map(run => {
    const step = steps.find(row => row.run_id === run.id);
    const tx = transcripts.find(row => row.run_id === run.id);
    const link = `/fleet/runs/${encodeURIComponent(run.id)}`;
    // The existing viewer owns its own repo/session authorization and R2 read.
    const viewer = tx && /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(tx.ship) && Number.isSafeInteger(tx.attempt) && tx.attempt > 0
      ? `<a href="${link}/transcript/${encodeURIComponent(tx.ship)}?attempt=${tx.attempt}">Read ${esc(tx.ship)} transcript · ${esc(tx.turns)} turns${tx.incomplete ? ' · incomplete' : ''} →</a>` : '<span>Transcript not captured in this snapshot</span>';
    return `<li><a href="${link}">PR #${esc(run.pr_number)} · run ${esc(run.conclusion)}</a> <small>${esc(timestamp(run.created_at))}</small>${step ? `<p>${esc(step.kind)} · ${esc(step.title)}</p>` : '<p>No recorded ship activity</p>'}<p>${viewer}</p></li>`;
  }).join('');
  return `<section class="ship-evidence" aria-label="${esc(ship === '*' ? 'Repository' : ship)} activity and cost">
    <dl class="ship-metrics"><div><dt>Recorded estimate</dt><dd>${total ? dollars(total) : 'Not reported'}</dd></div><div><dt>Recorded tokens</dt><dd>${tokens || 'Not reported'}</dd></div><div><dt>Observed calls</dt><dd>${nCalls || 'Not reported'}</dd></div><div><dt>Errors / timeouts</dt><dd>${calls.length ? `${failures} / ${timeouts}` : 'Not reported'}</dd></div><div><dt>Mean call latency</dt><dd>${nCalls ? `${(elapsed / nCalls / 1000).toFixed(1)}s` : 'Not reported'}</dd></div></dl>
    <p class="meta">Observed models: ${models.length ? models.map(esc).join(' · ') : 'Not reported'}</p>
    <figure><figcaption>14-day recorded cost · UTC · not billed total</figcaption><div class="cost-chart" aria-hidden="true">${bars}</div></figure><p class="meta">Blue bars: recorded estimates. Gaps: no reported cost, not proof of free usage.</p>
    <details><summary>Daily cost values and coverage</summary><p>No reported cost is not $0. Missing usage, older retained runs, and unpriced models can make this estimate incomplete.${unreported ? ` ${unreported} zero/unreported ledger rows are excluded.` : ''}</p><table><thead><tr><th>Date (UTC)</th><th>Recorded estimate</th></tr></thead><tbody>${table}</tbody></table></details>
    <h3>Recent runs and transcripts</h3>${recent ? `<ol class="recent-ships">${recent}</ol>` : '<p>No recorded activity for this ship in this snapshot. On only means permitted.</p>'}
    ${data.gaps.length ? `<p class="telemetry-note">${data.gaps.map(esc).join(' · ')}</p>` : ''}
  </section>`;
}
