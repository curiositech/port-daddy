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
      // No scripts, ever: transcript content is model output. Google Fonts is
      // the only third-party origin (style + font files); nothing else.
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      // Capability URLs must not end up in caches or search indexes.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

// ── story-linework design tokens (ch20; shared with account-page.ts) ─────────
const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Recursive:CASL,slnt,wght@1,-8,400..800&display=swap" rel="stylesheet">`;

const PAGE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;border-radius:0}
:root,:root[data-theme="light"]{
  --surface-base:#f2eee6;--surface-raised:#f7f3eb;--surface-strong:#e9e2d5;
  --text-primary:#121212;--text-secondary:#403b34;--text-muted:#47423a;--text-ghost:#98928a;
  --cobalt:#003fb8;--teal:#006b5f;--health:#1f7a4d;--amber:#a66f00;--error:#bf2f2f;
  --violet:#933fa5;--rust:#7a4514;--gold:#666a00;
  --hair:rgba(18,18,18,.14);--hair-strong:rgba(18,18,18,.34);--border-strong:#121212;
  --surface-card:#e9e2d5;--on-accent:#fbf7ef;}
:root{--cobalt-slab:#003fb8;--lime:#cad900;--cream:#fbf7ef;--ink:#17191d;--flag-white:#fbf7ef;
  --lw-weight:1.5px;--lw-stripe:3px;}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --surface-base:#101216;--surface-raised:#181c22;--surface-strong:#222833;
  --text-primary:#f5f3ed;--text-secondary:#d3cec2;--text-muted:#a59f93;--text-ghost:#5c574e;
  --cobalt:#7db4ff;--teal:#8fd0a7;--health:#5fce97;--amber:#f2be51;--error:#ff7d7d;
  --violet:#e0a5ed;--rust:#b98e6b;--gold:#d8dd3c;
  --hair:rgba(245,243,237,.14);--hair-strong:rgba(245,243,237,.34);--border-strong:#f5f3ed;
  --surface-card:#181c22;--on-accent:#121212;}}
:root[data-theme="dark"]{
  --surface-base:#101216;--surface-raised:#181c22;--surface-strong:#222833;
  --text-primary:#f5f3ed;--text-secondary:#d3cec2;--text-muted:#a59f93;--text-ghost:#5c574e;
  --cobalt:#7db4ff;--teal:#8fd0a7;--health:#5fce97;--amber:#f2be51;--error:#ff7d7d;
  --violet:#e0a5ed;--rust:#b98e6b;--gold:#d8dd3c;
  --hair:rgba(245,243,237,.14);--hair-strong:rgba(245,243,237,.34);--border-strong:#f5f3ed;
  --surface-card:#181c22;--on-accent:#121212;}
html,body{overflow-x:clip}
body{background:var(--surface-base);color:var(--text-primary);
  font-family:"IBM Plex Sans","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
.mono,code{font-family:"IBM Plex Mono","SFMono-Regular",Consolas,monospace;font-variant-numeric:tabular-nums slashed-zero}
h1,h2,h3{text-wrap:balance;letter-spacing:-0.02em}p{text-wrap:pretty}
a{color:var(--cobalt);text-underline-offset:3px}a:hover{color:var(--teal)}
:focus-visible{outline:2px solid var(--cobalt);outline-offset:2px}
.rec{font-family:"Recursive","IBM Plex Sans",sans-serif;font-variation-settings:"CASL" 1,"slnt" -8;font-weight:660}
.eyebrow{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--text-muted)}
.caption{font-size:14px;line-height:1.55;color:var(--text-muted)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}

/* masthead / chrome */
.site-header{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:14px clamp(20px,4vw,40px);background:var(--surface-base);border-bottom:2px solid var(--border-strong)}
.sh-brand{display:flex;align-items:baseline;gap:10px;font-weight:700;font-size:17px;letter-spacing:-.01em;color:var(--text-primary);text-decoration:none}
.sh-mark{color:var(--cobalt);font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:19px}
.sh-status{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:500;color:var(--text-muted)}
.page{max-width:74rem;margin:0 auto;padding:0 clamp(20px,4vw,40px) 88px}

/* the cobalt knockout masthead — Receipts, verifiable */
.masthead{padding:40px 0 8px}
.masthead .eyebrow{display:block;margin-bottom:16px}
.ko{position:relative;z-index:0;display:inline-block;--ko-r:66%;font-size:clamp(30px,4.4vw,52px);font-weight:700;line-height:1.08;letter-spacing:-.03em;max-width:18ch}
.ko::before{content:"";position:absolute;z-index:-1;left:-56px;right:calc(100% - var(--ko-r));top:-14px;bottom:-14px;background:var(--cobalt-slab)}
.ko .ko-over{position:absolute;inset:0;color:var(--cream);pointer-events:none;clip-path:inset(-14px calc(100% - var(--ko-r)) -14px -56px)}
.ko .rec{color:var(--cobalt)}
.ko .ko-over .rec{color:var(--cream)}
.lede{display:block;margin-top:22px;max-width:60ch;font-size:15px;color:var(--text-secondary);line-height:1.6}

/* receipt identity strip */
.receipt-id{margin-top:30px;border:2px solid var(--border-strong);background:var(--surface-card)}
.rid-top{display:flex;flex-wrap:wrap;gap:14px 20px;align-items:baseline;justify-content:space-between;padding:18px 22px;border-bottom:var(--lw-weight) solid var(--hair-strong)}
.rid-repo{font-size:clamp(19px,2.4vw,26px);font-weight:700;letter-spacing:-.02em;min-width:0;word-break:break-word}
.rid-repo a{color:var(--text-primary);text-decoration:none;box-shadow:inset 0 -2px 0 var(--cobalt)}
.rid-repo a:hover{color:var(--cobalt)}
.rid-repo .pr{color:var(--cobalt);font-family:"IBM Plex Mono",monospace;font-weight:600}
.badge{display:inline-flex;align-items:center;gap:8px;font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:6px 13px;border:2px solid var(--border-strong);white-space:nowrap}
.badge .dot{width:9px;height:9px;flex:none;border:1px solid rgba(0,0,0,.35)}
.badge.success{background:var(--health);color:var(--on-accent)}.badge.success .dot{background:var(--on-accent)}
.badge.failure{background:var(--error);color:var(--on-accent)}.badge.failure .dot{background:var(--on-accent)}
.badge.neutral,.badge.other{background:var(--amber);color:var(--ink)}.badge.neutral .dot,.badge.other .dot{background:var(--ink)}
.rid-facts{display:flex;flex-wrap:wrap;gap:10px 12px;padding:16px 22px}
.fact{display:inline-flex;align-items:baseline;gap:8px;font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;color:var(--text-secondary);border:1px solid var(--hair-strong);padding:5px 11px;max-width:100%;overflow:hidden}
.fact .fk{color:var(--text-muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:11.5px}
.fact code{color:var(--text-primary);word-break:break-all}

/* stat ledger */
.statrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));gap:var(--lw-weight);background:var(--hair-strong);border:2px solid var(--border-strong);border-top:none;margin-bottom:44px}
.stat{background:var(--surface-card);padding:16px 18px}
.stat .k{font-family:"IBM Plex Mono",monospace;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted)}
.stat .v{font-size:26px;font-weight:700;margin-top:6px;letter-spacing:-.01em;line-height:1.05}
.stat-money .v{color:var(--gold)}

/* transcript */
.tx-head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:4px}
.tx-head h2{font-size:22px;font-weight:700}
.tx-head .eyebrow{color:var(--teal)}
.tx-sub{margin:0 0 22px;font-size:14px;color:var(--text-muted);max-width:64ch}
.ship-card{border:2px solid var(--border-strong);background:var(--surface-raised);margin-bottom:22px}
.ship-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:15px 20px;border-bottom:2px solid var(--border-strong);background:var(--surface-strong)}
.ship-id{display:flex;align-items:center;gap:12px;min-width:0}
.ship-tick{width:14px;height:14px;flex:none;border:2px solid var(--border-strong);background:var(--cobalt)}
.ship-card.fleet .ship-tick{background:var(--violet)}
.ship-id h2{font-size:18px;font-weight:700;letter-spacing:-.01em;word-break:break-word}
.ship-count{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;color:var(--text-muted);white-space:nowrap}

.timeline{list-style:none}
.tl-step{display:grid;grid-template-columns:34px 1fr;column-gap:2px}
.tl-rail{position:relative;display:flex;justify-content:center}
.tl-rail::before{content:"";position:absolute;top:0;bottom:0;width:2px;background:var(--hair-strong)}
.tl-step:first-child .tl-rail::before{top:22px}
.tl-step:last-child .tl-rail::before{bottom:calc(100% - 22px)}
.tl-node{position:relative;z-index:1;margin-top:16px;width:11px;height:11px;flex:none;border:2px solid var(--border-strong);background:var(--surface-raised)}
.tl-verdict .tl-node{background:var(--cobalt)}
.tl-terminal .tl-node{width:13px;height:13px;background:var(--border-strong)}
.tl-body{padding:14px 20px 16px 6px;border-bottom:var(--lw-weight) solid var(--hair);min-width:0}
.tl-step:last-child .tl-body{border-bottom:none}
.tl-topline{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.kind-tag{font-family:"IBM Plex Mono",monospace;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--teal);border:1px solid var(--hair-strong);padding:2px 7px;white-space:nowrap}
.tl-verdict .kind-tag{color:var(--cobalt);border-color:var(--cobalt)}
.tl-terminal .kind-tag{color:var(--text-muted)}
.tl-title{font-size:15.5px;font-weight:600;color:var(--text-primary);min-width:0;word-break:break-word}
.tl-time{margin-left:auto;font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--text-ghost);white-space:nowrap}
.tl-detail{margin-top:10px}
.verdict{display:inline-flex;align-items:center;gap:8px;font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:5px 12px;border:2px solid var(--border-strong)}
.verdict-health{background:var(--health);color:var(--on-accent)}
.verdict-error{background:transparent;color:var(--text-muted);border-color:var(--hair-strong)}
.verdict-neutral{background:var(--surface-strong);color:var(--text-secondary);border-color:var(--hair-strong)}
.findings{list-style:none;margin:12px 0 0;display:flex;flex-direction:column;gap:8px}
.finding{position:relative;padding:9px 12px 9px 16px;background:var(--surface-card);box-shadow:inset var(--lw-stripe) 0 0 var(--amber);font-size:14.5px;line-height:1.55;color:var(--text-primary);word-break:break-word}
.finding .fpath{display:block;margin-top:4px;font-family:"IBM Plex Mono",monospace;font-size:12.5px;color:var(--text-muted)}
.kv{display:grid;grid-template-columns:minmax(6rem,auto) 1fr;gap:4px 14px;margin-top:10px;font-size:14px}
.kv dt{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted);align-self:baseline}
.kv dd{color:var(--text-primary);word-break:break-word}
.tokens{display:inline-flex;gap:14px;margin-top:10px;flex-wrap:wrap;font-family:"IBM Plex Mono",monospace;font-size:12.5px;color:var(--text-muted)}
.tokens b{color:var(--text-secondary);font-weight:700}

/* empty + not-found + error states */
.empty{border:2px dashed var(--hair-strong);background:transparent;padding:26px 26px}
.empty .e-title{font-weight:700;font-size:17px}
.empty p{font-size:14.5px;color:var(--text-secondary);line-height:1.6;margin-top:8px;max-width:66ch}
.empty .cmd{font-family:"IBM Plex Mono",monospace;font-size:13.5px;color:var(--teal);font-weight:600}
.notice{max-width:52rem;margin:0 auto;padding:64px 0}
.notice h1{font-size:clamp(28px,4vw,40px);font-weight:700;margin:14px 0 16px;letter-spacing:-.03em}
.notice p{font-size:16px;color:var(--text-secondary);line-height:1.62;max-width:56ch}

footer.receipt-foot{margin-top:40px;padding-top:20px;border-top:2px solid var(--border-strong);font-size:13.5px;line-height:1.6;color:var(--text-muted);max-width:70ch}
footer.receipt-foot code{color:var(--text-secondary);word-break:break-all}

@media (max-width:640px){
  .ko{--ko-r:82%}
  .ko::before{left:-20px}
  .ko .ko-over{clip-path:inset(-14px calc(100% - var(--ko-r)) -14px -20px)}
  .sh-status{display:none}
  .rid-top{padding:15px 16px}.rid-facts{padding:14px 16px}
  .ship-head{padding:13px 16px}.tl-body{padding:12px 14px 14px 4px}
  .tl-step{grid-template-columns:28px 1fr}
}
`;

function shell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
${HEAD}
<title>${esc(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<header class="site-header">
  <span class="sh-brand"><span class="sh-mark" aria-hidden="true">pd</span>Port Daddy Fleet</span>
  <span class="sh-status">receipt · <span style="color:var(--health);font-weight:700">verifiable</span></span>
</header>
${inner}
</body>
</html>`;
}

/** A centered single-message page (not found / error), in the run-page shell. */
function noticePage(title: string, heading: string, body: string, status: number): Response {
  return htmlResponse(
    shell(
      title,
      `<main class="page"><div class="notice">
        <span class="eyebrow">Port Daddy Fleet</span>
        <h1>${esc(heading)}</h1>
        <p>${body}</p>
      </div></main>`,
    ),
    status,
  );
}

function notFoundPage(): Response {
  return noticePage(
    'Run not found — Port Daddy Fleet',
    'Run not found',
    `This run does not exist, or the link is missing its access token. Open the page from the
     pull request&rsquo;s <strong>&ldquo;View more details on Port Daddy Fleet&rdquo;</strong> link.`,
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

// Verdict tone is decided by matching the fleet's own structured verdict enum
// (a controlled vocabulary the ships emit), never by classifying free text.
const HEALTH_VERDICTS = new Set([
  'CONFIRMED', 'PASS', 'PASSED', 'APPROVE', 'APPROVED', 'OK', 'CLEAN', 'LGTM', 'SHIP',
]);
const ERROR_VERDICTS = new Set([
  'REFUTED', 'FAIL', 'FAILED', 'REJECT', 'REJECTED', 'CHANGES', 'BLOCK', 'BLOCKED', 'HOLD',
]);

function verdictTone(word: string): 'health' | 'error' | 'neutral' {
  const w = word.trim().toUpperCase();
  if (HEALTH_VERDICTS.has(w)) return 'health';
  if (ERROR_VERDICTS.has(w)) return 'error';
  return 'neutral';
}

/** kind → display tag, e.g. "ship-verdict" → "SHIP·VERDICT". */
function fmtKind(kind: string): string {
  return kind.replace(/[-_]/g, '·').toUpperCase();
}

/** Timeline node/tag styling keyed off the structured `kind` enum. */
function stepClass(kind: string): string {
  if (kind === 'ship-verdict') return 'tl-verdict';
  if (kind === 'review-posted' || kind === 'check-completed') return 'tl-terminal';
  return '';
}

/** Last whitespace-delimited token of a title, stripped to a bare word. */
function lastToken(s: string): string {
  return (s.trim().split(/\s+/).pop() ?? '').replace(/[^A-Za-z0-9-]/g, '');
}

/** First present, non-blank string value among candidate keys. */
function pickString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/** One review finding — a string, or an object with a note + optional path:line. */
function renderFinding(f: unknown): string {
  if (typeof f === 'string') return `<li class="finding">${esc(f)}</li>`;
  if (f && typeof f === 'object') {
    const o = f as Record<string, unknown>;
    const text =
      pickString(o, ['note', 'message', 'summary', 'title', 'text', 'detail', 'finding', 'description']) ??
      JSON.stringify(o);
    const path = pickString(o, ['path', 'file', 'location']);
    const line = typeof o.line === 'number' ? `:${o.line}` : '';
    const pathHtml = path ? `<span class="fpath">${esc(path + line)}</span>` : '';
    return `<li class="finding">${esc(text)}${pathHtml}</li>`;
  }
  return `<li class="finding">${esc(String(f))}</li>`;
}

/**
 * Render a step's `detail` JSON as legible HTML — verdict chip, findings list,
 * token meter, key/value rows — with the full JSON preserved in a raw fallback.
 * Every interpolated value is escaped (detail is attacker-influenced model text).
 */
function renderDetail(step: FleetRunStepRow): string {
  if (!step.detail || step.detail === 'null') return '';
  let data: unknown;
  try {
    // reason: parsed JSON boundary — every value is typeof-checked before use.
    data = JSON.parse(step.detail);
  } catch {
    return `<div class="tl-detail"><p class="caption">${esc(step.detail)}</p></div>`;
  }
  if (data === null || typeof data !== 'object') {
    return `<div class="tl-detail"><p class="caption">${esc(String(data))}</p></div>`;
  }
  const o = data as Record<string, unknown>;
  const parts: string[] = [];
  const used = new Set<string>();

  if (step.kind === 'ship-verdict') {
    const vword = pickString(o, ['verdict', 'decision', 'status', 'result']) ?? lastToken(step.title);
    if (vword) {
      for (const k of ['verdict', 'decision', 'status', 'result']) used.add(k);
      parts.push(`<span class="verdict verdict-${verdictTone(vword)}">${esc(vword)}</span>`);
    }
  }

  const rawFindings = Array.isArray(o.findings)
    ? o.findings
    : Array.isArray(o.finding)
      ? o.finding
      : null;
  if (rawFindings && rawFindings.length) {
    used.add('findings');
    used.add('finding');
    parts.push(`<ul class="findings">${rawFindings.slice(0, 20).map(renderFinding).join('')}</ul>`);
  }

  const inTok = typeof o.inputTokens === 'number' && Number.isFinite(o.inputTokens) ? o.inputTokens : null;
  const outTok = typeof o.outputTokens === 'number' && Number.isFinite(o.outputTokens) ? o.outputTokens : null;
  if (inTok !== null || outTok !== null) {
    used.add('inputTokens');
    used.add('outputTokens');
    const bits: string[] = [];
    if (inTok !== null) bits.push(`<span>in <b>${inTok.toLocaleString('en-US')}</b></span>`);
    if (outTok !== null) bits.push(`<span>out <b>${outTok.toLocaleString('en-US')}</b></span>`);
    parts.push(`<div class="tokens">${bits.join('')}</div>`);
  }

  const rows: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (used.has(k)) continue;
    let disp: string | null = null;
    if (typeof v === 'string' && v.trim()) disp = v.length > 240 ? `${v.slice(0, 240)}…` : v;
    else if (typeof v === 'number' && Number.isFinite(v)) disp = v.toLocaleString('en-US');
    else if (typeof v === 'boolean') disp = v ? 'yes' : 'no';
    if (disp !== null) rows.push(`<dt>${esc(k)}</dt><dd>${esc(disp)}</dd>`);
    if (rows.length >= 6) break;
  }
  if (rows.length) parts.push(`<dl class="kv">${rows.join('')}</dl>`);

  if (parts.length === 0) return '';
  return `<div class="tl-detail">${parts.join('')}</div>`;
}

/** One step as a timeline entry: rail node, kind tag, title, +offset, detail. */
function renderStep(step: FleetRunStepRow, runStartSec: number): string {
  const offset = Math.max(0, step.created_at - runStartSec);
  const cls = stepClass(step.kind);
  return `<li class="tl-step${cls ? ' ' + cls : ''}">
    <div class="tl-rail"><span class="tl-node" aria-hidden="true"></span></div>
    <div class="tl-body">
      <div class="tl-topline">
        <span class="kind-tag">${esc(fmtKind(step.kind))}</span>
        <span class="tl-title">${esc(step.title)}</span>
        <span class="tl-time">+${esc(String(offset))}s</span>
      </div>
      ${renderDetail(step)}
    </div>
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
    const isFleet = ship === 'fleet';
    const label = isFleet ? 'Fleet' : `pd-${ship}`;
    html += `<section class="ship-card${isFleet ? ' fleet' : ''}">
      <header class="ship-head">
        <div class="ship-id"><span class="ship-tick" aria-hidden="true"></span><h2>${esc(label)}</h2></div>
        <span class="ship-count">${list.length} step${list.length === 1 ? '' : 's'}</span>
      </header>
      <ol class="timeline">${list.map(s => renderStep(s, runStartSec)).join('')}</ol>
    </section>`;
  }
  return html;
}

const EMPTY_TRANSCRIPT = `<div class="empty">
  <div class="e-title">No transcript steps recorded for this run.</div>
  <p>This run concluded without emitting per-ship deliberation steps — either it short-circuited
  before the fleet mapped the diff, or step recording was disabled for this delivery. The verdict
  above is still authoritative. Re-run with <span class="cmd">pd fleet review</span> to capture a
  full transcript.</p>
</div>`;

function renderRunPage(run: FleetRunRow, steps: FleetRunStepRow[]): string {
  const distinctShips = [
    ...new Set((run.ships_csv ? run.ships_csv.split(',') : []).map(s => s.trim()).filter(Boolean)),
  ];
  const inputTokens = sumDetailField(steps, 'inputTokens');
  const outputTokens = sumDetailField(steps, 'outputTokens');
  const shipsLabel = distinctShips.length ? distinctShips.map(s => `pd-${s}`).join(', ') : '—';
  // Defense-in-depth: only ever link an https URL (a poisoned row must not
  // become a javascript: href). The repo/PR label is escaped inside the link.
  const prLabel = `${esc(run.repo_full_name)} <span class="pr">#${esc(run.pr_number)}</span>`;
  const prLink = /^https:\/\//.test(run.pr_url)
    ? `<a href="${esc(run.pr_url)}">${prLabel}</a>`
    : prLabel;
  const inner = `<main class="page">
    <div class="masthead">
      <span class="eyebrow">Port Daddy Fleet · deliberation transcript</span>
      <h1 class="ko">Receipts — <span class="rec">verifiable</span>, not promised<span class="ko-over" aria-hidden="true">Receipts — <span class="rec">verifiable</span>, not promised</span></h1>
      <span class="lede">The Strava-map of code work: which agents deliberated, what they found, and what it cost — never your source. This page mirrors exactly what the fleet posted to the pull request.</span>
    </div>

    <div class="receipt-id">
      <div class="rid-top">
        <div class="rid-repo">${prLink}</div>
        <span class="badge ${badgeClass(run.conclusion)}"><span class="dot" aria-hidden="true"></span>${esc(run.conclusion || 'pending')}</span>
      </div>
      <div class="rid-facts">
        <span class="fact"><span class="fk">head</span><code>${esc(run.head_sha.slice(0, 12))}</code></span>
        <span class="fact"><span class="fk">concluded</span><code>${esc(fmtUtc(run.created_at))}</code></span>
        <span class="fact"><span class="fk">ships</span><code>${esc(shipsLabel)}</code></span>
      </div>
    </div>

    <div class="statrow">
      <div class="stat"><div class="k">Agents</div><div class="v mono">${distinctShips.length}</div></div>
      <div class="stat"><div class="k">Transcript steps</div><div class="v mono">${steps.length}</div></div>
      <div class="stat"><div class="k">Input tokens</div><div class="v mono">${inputTokens.toLocaleString('en-US')}</div></div>
      <div class="stat"><div class="k">Output tokens</div><div class="v mono">${outputTokens.toLocaleString('en-US')}</div></div>
      <div class="stat stat-money"><div class="k">Neurons</div><div class="v mono">${run.neurons == null ? '—' : run.neurons.toLocaleString('en-US')}</div></div>
      <div class="stat"><div class="k">Wall-clock</div><div class="v mono">${esc(fmtMs(run.ms))}</div></div>
    </div>

    <div class="tx-head">
      <span class="eyebrow">Deliberation</span>
      <h2>The transcript</h2>
    </div>
    <p class="tx-sub">Each agent&rsquo;s reasoning, in order — map &rarr; reduce &rarr; finding &rarr; verdict.
    Terminal markers show what was posted back to GitHub.</p>
    ${steps.length ? renderShips(steps, run.created_at) : EMPTY_TRANSCRIPT}

    <footer class="receipt-foot">Run <code>${esc(run.id)}</code> · delivery <code>${esc(run.delivery_id)}</code>.
    This is a capability link — anyone holding this exact URL can view the page, and its contents match
    what the fleet posted as PR comments. It never exposes your source code.</footer>
  </main>`;
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
    return noticePage(
      'Error — Port Daddy Fleet',
      'Temporarily unavailable',
      'The transcript store could not be read. Try again shortly.',
      500,
    );
  }
}
