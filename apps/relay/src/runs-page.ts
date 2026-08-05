/**
 * apps/relay/src/runs-page.ts — "see all my runs" (ADR-0101 Phase 1).
 *
 *   GET /account/runs — session-gated index of recent fleet runs, filtered to
 *   the repos the signed-in user can read on GitHub. Each row links to the
 *   already-shipped /fleet/runs/:id receipt page, which authorizes the same
 *   session via the same userCanReadRepo gate.
 *
 * Authorization model: GitHub stays the single source of authz truth. We pull
 * the most recent ~100 fleet_runs and probe repo readability per DISTINCT repo
 * (cached per request; userCanReadRepo adds its own 5-minute KV cache). To keep
 * a page view from fanning out into unbounded GitHub calls, at most
 * MAX_REPO_CHECKS distinct repos are probed — runs in repos beyond that cap are
 * NOT shown, and the page says so honestly instead of pretending the list is
 * complete.
 *
 * Rendering is strictly server-side, story-linework (ch20) via the shared
 * TOKENS block from account-page.ts. Every interpolated value is esc()'d
 * (repo names / ship lists come from webhook-controlled data — treat as
 * hostile), and the response is no-store + noindex under a script-free CSP.
 */

import type { Env } from './types.js';
import { listFleetRuns, type FleetRunRow, type UserRow } from './db.js';
import { resolveSession, userCanReadRepo, type ResolvedSession } from './auth-github.js';
import { HEAD, TOKENS } from './account-page.js';

/** How many recent runs to pull from D1 (newest first). */
const RUNS_LIMIT = 100;
/** Cap on distinct-repo GitHub readability probes per page view. */
export const MAX_REPO_CHECKS = 10;

/** Minimal HTML-escape for interpolated data (XSS guard). */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // No scripts, ever. Google Fonts is the only third-party origin.
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      // A per-user authz-filtered page must not land in caches or indexes.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

// ── formatting helpers ───────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 90 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** Coarse relative date ("4h ago"); absolute ISO date beyond ~30 days. */
function relDate(nowSec: number, thenSec: number): string {
  const d = Math.max(0, nowSec - thenSec);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 30 * 86400) return `${Math.floor(d / 86400)}d ago`;
  return new Date(thenSec * 1000).toISOString().slice(0, 10);
}

function badgeClass(conclusion: string): string {
  if (conclusion === 'success') return 'success';
  if (conclusion === 'failure') return 'failure';
  if (conclusion === 'neutral') return 'neutral';
  return 'other';
}

// ── authz filter ─────────────────────────────────────────────────────────────

export interface RepoGroup {
  repo: string;
  runs: FleetRunRow[];
}

/**
 * Filter runs to repos the session's user can read, grouped by repo in
 * newest-run-first order. Readability is probed once per distinct repo
 * (per-request Map cache) and at most {@link MAX_REPO_CHECKS} repos are probed;
 * runs in repos past the cap are dropped and `truncated` is set so the page can
 * say so. Malformed repo names fail closed without consuming a probe.
 */
export async function filterReadableRuns(
  env: Env,
  session: ResolvedSession,
  runs: FleetRunRow[],
): Promise<{ groups: RepoGroup[]; truncated: boolean }> {
  const access = new Map<string, boolean | 'unchecked'>();
  const groups = new Map<string, FleetRunRow[]>();
  let checks = 0;
  let truncated = false;

  for (const run of runs) {
    const repo = run.repo_full_name ?? '';
    let state = access.get(repo);
    if (state === undefined) {
      const parts = repo.split('/');
      const owner = parts[0];
      const name = parts[1];
      if (parts.length !== 2 || !owner || !name) {
        state = false; // malformed — fail closed, no GitHub probe spent
      } else if (checks >= MAX_REPO_CHECKS) {
        state = 'unchecked';
      } else {
        checks += 1;
        state = await userCanReadRepo(env, session, owner, name);
      }
      access.set(repo, state);
    }
    if (state === 'unchecked') {
      truncated = true;
      continue;
    }
    if (state !== true) continue;
    const list = groups.get(repo) ?? [];
    list.push(run);
    groups.set(repo, list);
  }

  return {
    groups: [...groups.entries()].map(([repo, list]) => ({ repo, runs: list })),
    truncated,
  };
}

// ── page CSS (story-linework, shared TOKENS) ─────────────────────────────────

const RUNS_CSS = `
${TOKENS}
.site-header{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:14px clamp(20px,4vw,40px);background:var(--surface-base);border-bottom:2px solid var(--border-strong)}
.sh-brand{display:flex;align-items:baseline;gap:10px;font-weight:700;font-size:17px;letter-spacing:-.01em;color:var(--text-primary);text-decoration:none}
.sh-mark{color:var(--cobalt);font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:19px}
.sh-status{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:500;color:var(--text-muted)}
.page{max-width:74rem;margin:0 auto;padding:0 clamp(20px,4vw,40px) 88px}
.masthead{padding:40px 0 10px}
.masthead .eyebrow{display:block;margin-bottom:16px}
.ko{position:relative;z-index:0;display:inline-block;--ko-r:62%;font-size:clamp(30px,4.4vw,52px);font-weight:700;line-height:1.08;letter-spacing:-.03em;max-width:18ch}
.ko::before{content:"";position:absolute;z-index:-1;left:-56px;right:calc(100% - var(--ko-r));top:-14px;bottom:-14px;background:var(--cobalt-slab)}
.ko .ko-over{position:absolute;inset:0;color:var(--cream);pointer-events:none;clip-path:inset(-14px calc(100% - var(--ko-r)) -14px -56px)}
.ko .rec{color:var(--cobalt)}
.ko .ko-over .rec{color:var(--cream)}
.lede{display:block;margin-top:22px;max-width:62ch;font-size:15px;color:var(--text-secondary);line-height:1.6}
.repo-group{margin-top:34px;border:2px solid var(--border-strong);background:var(--surface-raised)}
.rg-head{display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:14px 20px;border-bottom:2px solid var(--border-strong);background:var(--surface-strong)}
.rg-head h2{font-size:18px;font-weight:700;letter-spacing:-.01em;min-width:0;word-break:break-word}
.rg-count{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;color:var(--text-muted);white-space:nowrap}
.run-list{list-style:none}
.run-row{display:grid;grid-template-columns:5rem auto minmax(0,1fr) auto auto;gap:6px 18px;align-items:baseline;padding:13px 20px;border-top:1px solid var(--hair);text-decoration:none;color:var(--text-primary)}
.run-list li:first-child .run-row{border-top:none}
.run-row:hover{background:var(--surface-strong)}
.rr-pr{font-family:"IBM Plex Mono",monospace;font-weight:700;font-size:15px;color:var(--cobalt);white-space:nowrap}
.badge{display:inline-flex;align-items:center;gap:7px;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border:2px solid var(--border-strong);white-space:nowrap;justify-self:start}
.badge .dot{width:8px;height:8px;flex:none;border:1px solid rgba(0,0,0,.35)}
.badge.success{background:var(--health);color:var(--on-accent)}.badge.success .dot{background:var(--on-accent)}
.badge.failure{background:var(--error);color:var(--on-accent)}.badge.failure .dot{background:var(--on-accent)}
.badge.neutral,.badge.other{background:var(--amber);color:var(--ink)}.badge.neutral .dot,.badge.other .dot{background:var(--ink)}
.rr-ships{font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--text-secondary);min-width:0;word-break:break-word}
.rr-ms,.rr-when{font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--text-muted);white-space:nowrap;text-align:right}
.trunc{margin-top:26px;background:var(--surface-card);border:1px solid var(--hair);padding:16px 20px;box-shadow:inset 3px 0 0 var(--amber);font-size:14.5px;color:var(--text-secondary);line-height:1.6;max-width:66ch}
.trunc b{color:var(--text-primary)}
.empty{margin-top:34px;border:2px dashed var(--hair-strong);background:transparent;padding:26px 26px}
.empty .e-title{font-weight:700;font-size:17px}
.empty p{font-size:14.5px;color:var(--text-secondary);line-height:1.6;margin-top:8px;max-width:66ch}
.empty .cmd{font-family:"IBM Plex Mono",monospace;font-size:13.5px;color:var(--teal);font-weight:600}
.notice{max-width:52rem;margin:0 auto;padding:64px 0}
.notice h1{font-size:clamp(28px,4vw,40px);font-weight:700;margin:14px 0 16px;letter-spacing:-.03em}
.notice p{font-size:16px;color:var(--text-secondary);line-height:1.62;max-width:56ch}
@media (max-width:720px){
  .sh-status{display:none}
  .ko{--ko-r:82%}
  .ko::before{left:-20px}
  .ko .ko-over{clip-path:inset(-14px calc(100% - var(--ko-r)) -14px -20px)}
  .run-row{grid-template-columns:auto auto 1fr;gap:6px 14px;padding:12px 16px}
  .rr-ships{grid-column:1 / -1}
  .rr-ms,.rr-when{text-align:left}
  .rg-head{padding:13px 16px}
}
`;

// ── rendering ────────────────────────────────────────────────────────────────

function shellPage(inner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><title>Port Daddy — Your fleet runs</title>${HEAD}<style>${RUNS_CSS}</style></head><body>
<header class="site-header">
  <a class="sh-brand" href="/account"><span class="sh-mark" aria-hidden="true">pd</span>Port Daddy</a>
  <span class="sh-status"><a href="/account">account</a>&ensp;/&ensp;fleet runs</span>
</header>
${inner}
</body></html>`;
}

const EMPTY_STATE = `<div class="empty">
  <div class="e-title">No runs yet.</div>
  <p>No runs yet — install the Port Daddy Fleet GitHub App on a repository you can read, open a
  pull request, and the fleet&rsquo;s review lands here as a receipt: verdict, ships, cost and
  wall-clock, each linking to its full transcript. Only runs in repos <strong>your GitHub identity
  can read</strong> ever appear on this page.</p>
</div>`;

function renderRow(run: FleetRunRow, nowSec: number): string {
  const ships = [
    ...new Set((run.ships_csv ? run.ships_csv.split(',') : []).map((s) => s.trim()).filter(Boolean)),
  ];
  const shipsLabel = ships.length ? ships.map((s) => `pd-${s}`).join(', ') : '—';
  const href = `/fleet/runs/${encodeURIComponent(run.id)}`;
  return `<li><a class="run-row" href="${esc(href)}">
    <span class="rr-pr">#${esc(run.pr_number)}</span>
    <span class="badge ${badgeClass(run.conclusion)}"><span class="dot" aria-hidden="true"></span>${esc(run.conclusion || 'pending')}</span>
    <span class="rr-ships">${esc(shipsLabel)}</span>
    <span class="rr-ms">${esc(fmtMs(run.ms))}</span>
    <span class="rr-when">${esc(relDate(nowSec, run.created_at))}</span>
  </a></li>`;
}

function renderGroup(group: RepoGroup, nowSec: number): string {
  const n = group.runs.length;
  return `<section class="repo-group">
    <header class="rg-head"><h2>${esc(group.repo)}</h2><span class="rg-count">${n} run${n === 1 ? '' : 's'}</span></header>
    <ol class="run-list">${group.runs.map((r) => renderRow(r, nowSec)).join('')}</ol>
  </section>`;
}

/** The truncation notice — shown only when the distinct-repo probe cap bit. */
function renderTruncation(): string {
  return `<div class="trunc"><b>Partial view.</b> To keep this page from fanning out into unbounded
  GitHub permission checks, repo access is verified for at most ${MAX_REPO_CHECKS} distinct
  repositories per view — recent runs in further repositories are <b>not shown here</b> (they are
  not hidden for permission reasons; they simply were not checked). Each run&rsquo;s own receipt
  link still works.</div>`;
}

/** Render the full /account/runs page for a signed-in user. */
export function renderRunsPage(
  user: UserRow,
  groups: RepoGroup[],
  opts: { truncated: boolean; nowSec: number },
): string {
  const total = groups.reduce((n, g) => n + g.runs.length, 0);
  const body = groups.length
    ? groups.map((g) => renderGroup(g, opts.nowSec)).join('')
    : EMPTY_STATE;
  const inner = `<main class="page">
    <div class="masthead">
      <span class="eyebrow">portdaddy.dev · account · fleet runs</span>
      <h1 class="ko">Your fleet <span class="rec">runs</span><span class="ko-over" aria-hidden="true">Your fleet <span class="rec">runs</span></span></h1>
      <span class="lede">The most recent fleet runs in repositories <strong>${esc(user.login)}</strong> can read on
      GitHub — GitHub&rsquo;s own repo ACL decides what appears here. Each row opens the run&rsquo;s full
      receipt: the transcript, the findings, the verdict.</span>
    </div>
    ${body}
    ${opts.truncated ? renderTruncation() : ''}
    ${groups.length ? `<p class="caption" style="margin-top:22px">Showing ${total} run${total === 1 ? '' : 's'} from the last ${RUNS_LIMIT} recorded fleet runs, newest first.</p>` : ''}
  </main>`;
  return shellPage(inner);
}

// ── handler ──────────────────────────────────────────────────────────────────

/** GET /account/runs — session-gated; redirects to /login when signed out. */
export async function handleRunsPage(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  try {
    const runs = await listFleetRuns(env.DB, RUNS_LIMIT);
    const { groups, truncated } = await filterReadableRuns(env, session, runs);
    return htmlResponse(
      renderRunsPage(session.user, groups, { truncated, nowSec: Math.floor(Date.now() / 1000) }),
      200,
    );
  } catch {
    return htmlResponse(
      shellPage(`<main class="page"><div class="notice">
        <span class="eyebrow">Port Daddy Fleet</span>
        <h1>Temporarily unavailable</h1>
        <p>The run index could not be read. Try again shortly.</p>
      </div></main>`),
      500,
    );
  }
}
