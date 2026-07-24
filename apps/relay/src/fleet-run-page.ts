/**
 * Human-facing fleet run page (ADR-0101 Phase 0).
 *
 *   GET /fleet/runs/:id?t=<hmac>   — server-rendered HTML deliberation breakdown
 *
 * This is the target of the GitHub check run's details_url ("View more details
 * on Port Daddy Fleet"). Access model — capability URL:
 *
 *   - The `t` token is hex(HMAC-SHA256(RUN_PAGE_SECRET, runId)), minted by the
 *     fleet-executor and embedded in the details_url. GitHub's own repo ACL
 *     decides who ever SEES that link, so token possession ≈ PR read access —
 *     and everything rendered here is also posted as PR comments, so the page
 *     never widens exposure. The token makes deterministic run ids
 *     (`run:<deliveryId>`) unguessable and is revocable by rotating the secret.
 *   - The operator bearer token (Authorization header) also opens any run.
 *   - Everything else gets the SAME 404 page whether the run exists or not
 *     (no existence oracle).
 *
 * Rendering is strictly server-side with every interpolated value HTML-escaped
 * (transcript content is model output — attacker-influenced text), and the
 * response carries a no-script CSP. No JavaScript is served at all.
 */

import { timingSafeEqual } from './crypto.js';
import { getFleetRunWithSteps, type FleetRunRow, type FleetRunStepRow } from './db.js';
import { resolveSession, userCanReadRepo } from './auth-github.js';
import type { Env } from './types.js';

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/;

// ── Gate ──────────────────────────────────────────────────────────────────────

/** hex(HMAC-SHA256(secret, runId)) — must match apps/fleet-executor/src/run-page.ts. */
export async function runPageToken(secret: string, runId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(runId));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify a presented capability token against the current (and, during a
 * rotation grace window, the previous) RUN_PAGE_SECRET. Accepts both the
 * versioned `v1.<hmac>` form the executor emits post-ADR-0101 (Z1) and the
 * legacy bare `<hmac>` form stamped on already-existing check runs. Fail-closed
 * on a missing/short current secret.
 */
async function verifyRunToken(env: Env, runId: string, presented: string): Promise<boolean> {
  const hmac = presented.startsWith('v1.') ? presented.slice(3) : presented;
  if (!/^[0-9a-f]{64}$/.test(hmac)) return false;
  const secrets = [env.RUN_PAGE_SECRET, env.RUN_PAGE_SECRET_PREV].filter(
    (s): s is string => typeof s === 'string' && s.length >= 32,
  );
  if (secrets.length === 0) return false;
  for (const secret of secrets) {
    if (timingSafeEqual(hmac, await runPageToken(secret, runId))) return true;
  }
  return false;
}

/** Operator bearer OR a valid (versioned/legacy) capability token. */
async function hasTokenAuth(request: Request, env: Env, runId: string): Promise<boolean> {
  const auth = request.headers.get('Authorization');
  if (auth && env.RELAY_OPERATOR_TOKEN && env.RELAY_OPERATOR_TOKEN.length >= 32) {
    const bearer = auth.replace(/^Bearer\s+/i, '');
    if (timingSafeEqual(bearer, env.RELAY_OPERATOR_TOKEN)) return true;
  }
  const presented = new URL(request.url).searchParams.get('t') ?? '';
  if (!presented) return false;
  return verifyRunToken(env, runId, presented);
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

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
      // No scripts, ever: transcript content is model output.
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      // Capability URLs must not end up in caches or search indexes.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

const PAGE_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem 4rem;
    background: #0c131f; color: #dce5f1;
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  main { max-width: 60rem; margin: 0 auto; }
  a { color: #7fb4ff; }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; letter-spacing: -0.01em; }
  .eyebrow {
    font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.14em; color: #8fa3bd; margin-bottom: 0.75rem;
  }
  .meta { color: #97a8c0; font-size: 0.875rem; }
  .badge {
    display: inline-block; padding: 0.2rem 0.65rem; border-radius: 999px;
    font-size: 0.875rem; font-weight: 700; vertical-align: middle; margin-left: 0.5rem;
  }
  .badge.success { background: #14351f; color: #6fd692; border: 1px solid #2c6b42; }
  .badge.failure { background: #3b1720; color: #ff9aa8; border: 1px solid #7c3040; }
  .badge.neutral, .badge.other { background: #2a2f3a; color: #b8c2d4; border: 1px solid #4a5468; }
  .statgrid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 1px; background: #223047; border: 1px solid #223047; margin: 1.5rem 0 2rem;
  }
  .stat { background: #101a2a; padding: 0.9rem 1rem; }
  .stat .k { font-size: 0.8125rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #8fa3bd; }
  .stat .v { font-size: 1.25rem; font-weight: 700; margin-top: 0.15rem; font-variant-numeric: tabular-nums; }
  section.ship { border: 1px solid #223047; background: #101a2a; margin-bottom: 1.25rem; }
  section.ship > header {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 0.75rem 1rem; border-bottom: 1px solid #223047; background: #132033;
  }
  section.ship > header h2 { margin: 0; font-size: 1.0625rem; }
  ol.steps { list-style: none; margin: 0; padding: 0; }
  ol.steps li { padding: 0.7rem 1rem; border-bottom: 1px solid #1a2638; }
  ol.steps li:last-child { border-bottom: none; }
  .step-head { display: flex; gap: 0.75rem; align-items: baseline; flex-wrap: wrap; }
  .kind {
    font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    color: #9db7dc; min-width: 8.5rem;
  }
  .t { color: #718096; font-size: 0.875rem; font-variant-numeric: tabular-nums; margin-left: auto; }
  details { margin-top: 0.45rem; }
  summary { cursor: pointer; color: #8fa3bd; font-size: 0.875rem; }
  pre {
    margin: 0.5rem 0 0; padding: 0.75rem; overflow-x: auto;
    background: #0a1017; border: 1px solid #1a2638;
    font: 0.875rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap; word-break: break-word;
  }
  footer { margin-top: 2.5rem; color: #718096; font-size: 0.875rem; border-top: 1px solid #223047; padding-top: 1rem; }
`;

function shell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body><main>${inner}</main></body>
</html>`;
}

function notFoundPage(): Response {
  return htmlResponse(
    shell(
      'Run not found — Port Daddy Fleet',
      `<div class="eyebrow">Port Daddy Fleet</div>
       <h1>Run not found</h1>
       <p class="meta">This run does not exist, or the link is missing its access token.
       Open the page from the pull request's <strong>“View more details on Port Daddy Fleet”</strong> link.</p>`,
    ),
    404,
  );
}

// ── Rendering ────────────────────────────────────────────────────────────────

function badgeClass(conclusion: string): string {
  if (conclusion === 'success') return 'success';
  if (conclusion === 'failure') return 'failure';
  if (conclusion === 'neutral') return 'neutral';
  return 'other';
}

function fmtUtc(sec: number): string {
  return new Date(sec * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 90 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** Sum a numeric field across step detail blobs (tokens live per step). */
function sumDetailField(steps: FleetRunStepRow[], field: string): number {
  let total = 0;
  for (const s of steps) {
    if (!s.detail) continue;
    try {
      // reason: parsed JSON boundary — value is typeof-checked below before use.
      const d = JSON.parse(s.detail) as Record<string, unknown>;
      const v = d[field];
      if (typeof v === 'number' && Number.isFinite(v)) total += v;
    } catch {
      /* non-JSON detail — nothing to sum */
    }
  }
  return total;
}

function renderStep(step: FleetRunStepRow, runStartSec: number): string {
  const offset = Math.max(0, step.created_at - runStartSec);
  let detailHtml = '';
  if (step.detail && step.detail !== 'null') {
    let pretty = step.detail;
    try {
      pretty = JSON.stringify(JSON.parse(step.detail), null, 2);
    } catch {
      /* keep raw string */
    }
    detailHtml = `<details><summary>detail</summary><pre>${esc(pretty)}</pre></details>`;
  }
  return `<li>
    <div class="step-head">
      <span class="kind">${esc(step.kind)}</span>
      <span>${esc(step.title)}</span>
      <span class="t">+${esc(String(offset))}s</span>
    </div>
    ${detailHtml}
  </li>`;
}

/** Group transcript steps per ship, preserving order; null ship ⇒ "fleet". */
function renderShips(steps: FleetRunStepRow[], runStartSec: number): string {
  const groups = new Map<string, FleetRunStepRow[]>();
  for (const s of steps) {
    const key = s.ship ?? 'fleet';
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  let html = '';
  for (const [ship, list] of groups) {
    const label = ship === 'fleet' ? 'Fleet' : `pd-${ship}`;
    html += `<section class="ship">
      <header><h2>${esc(label)}</h2><span class="meta">${list.length} step${list.length === 1 ? '' : 's'}</span></header>
      <ol class="steps">${list.map(s => renderStep(s, runStartSec)).join('')}</ol>
    </section>`;
  }
  return html;
}

function renderRunPage(run: FleetRunRow, steps: FleetRunStepRow[]): string {
  const ships = run.ships_csv ? run.ships_csv.split(',') : [];
  const inputTokens = sumDetailField(steps, 'inputTokens');
  const outputTokens = sumDetailField(steps, 'outputTokens');
  // Defense-in-depth: only ever link an https URL (a poisoned row must not
  // become a javascript: href).
  const prLink = /^https:\/\//.test(run.pr_url)
    ? `<a href="${esc(run.pr_url)}">#${esc(run.pr_number)}</a>`
    : `#${esc(run.pr_number)}`;
  const inner = `
    <div class="eyebrow">Port Daddy Fleet — deliberation transcript</div>
    <h1>${esc(run.repo_full_name)} <span class="meta">PR</span> ${prLink}
      <span class="badge ${badgeClass(run.conclusion)}">${esc(run.conclusion || 'pending')}</span></h1>
    <p class="meta">head <code>${esc(run.head_sha.slice(0, 12))}</code>
      · ${esc(fmtUtc(run.created_at))}
      · wall-clock ${esc(fmtMs(run.ms))}
      · ships: ${ships.length ? esc(ships.map(s => `pd-${s}`).join(', ')) : '—'}</p>
    <div class="statgrid">
      <div class="stat"><div class="k">Ships</div><div class="v">${ships.length}</div></div>
      <div class="stat"><div class="k">Transcript steps</div><div class="v">${steps.length}</div></div>
      <div class="stat"><div class="k">Input tokens</div><div class="v">${inputTokens.toLocaleString('en-US')}</div></div>
      <div class="stat"><div class="k">Output tokens</div><div class="v">${outputTokens.toLocaleString('en-US')}</div></div>
      <div class="stat"><div class="k">Neurons</div><div class="v">${run.neurons == null ? '—' : run.neurons.toLocaleString('en-US')}</div></div>
    </div>
    ${renderShips(steps, run.created_at)}
    <footer>Run <code>${esc(run.id)}</code> · delivery <code>${esc(run.delivery_id)}</code>.
    This is a capability link: anyone holding this exact URL can view the page. Its contents match
    what the fleet posted as PR comments.</footer>`;
  return shell(`${run.repo_full_name} PR #${run.pr_number} — Port Daddy Fleet`, inner);
}

// ── Handler ──────────────────────────────────────────────────────────────────

/** GET /fleet/runs/:id — HTML page. Unauthorized and unknown are the same 404. */
export async function handleFleetRunPage(
  request: Request,
  env: Env,
  runId: string,
): Promise<Response> {
  if (!runId || runId.trim() !== runId || !RUN_ID_RE.test(runId) || runId.includes('..')) {
    return notFoundPage();
  }
  try {
    // Fast path: operator bearer or capability token authorizes without a DB
    // fetch or GitHub round-trip.
    const tokenOk = await hasTokenAuth(request, env, runId);
    const found = await getFleetRunWithSteps(env.DB, runId);
    if (!found) return notFoundPage();

    if (!tokenOk) {
      // Login path (ADR-0101 Phase 1): a signed-in user may open the page iff
      // GitHub says they can read the run's repo. Unauthorized ≙ unknown ≙ 404.
      const session = await resolveSession(request, env);
      if (!session) return notFoundPage();
      const [owner, repo] = (found.run.repo_full_name ?? '').split('/');
      if (!owner || !repo) return notFoundPage();
      if (!(await userCanReadRepo(env, session, owner, repo))) return notFoundPage();
    }

    return htmlResponse(renderRunPage(found.run, found.steps), 200);
  } catch {
    return htmlResponse(
      shell(
        'Error — Port Daddy Fleet',
        `<div class="eyebrow">Port Daddy Fleet</div><h1>Temporarily unavailable</h1>
         <p class="meta">The transcript store could not be read. Try again shortly.</p>`,
      ),
      500,
    );
  }
}
