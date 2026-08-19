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
 *
 * Content semantics (English narratives, severity-ranked findings review,
 * MAP-chunk consolidation, per-ship outcome badges) come from the legibility
 * rewrite; the visual system (story-linework tokens, masthead, receipt strip,
 * stat ledger, timeline cards, IBM Plex / Recursive fonts, light+dark theming)
 * is the shared ch20 design language.
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
.ship-id{display:flex;align-items:center;gap:12px;min-width:0;flex-wrap:wrap}
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
.tl-title{font-size:15.5px;font-weight:600;color:var(--text-primary);min-width:0;word-break:break-word}
.tl-time{margin-left:auto;font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--text-ghost);white-space:nowrap}

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

/* ── legibility content: English narratives, findings review, outcome badges,
      MAP consolidation — themed onto the story-linework tokens. The .step /
      .narrative / .review / .outcome / .finding.sev-* classes are also test
      hooks, kept alongside the .tl-* timeline scaffold. ── */
li.step{border-left:var(--lw-stripe) solid transparent}
li.step.tone-pass{border-left-color:var(--health)}
li.step.tone-block{border-left-color:var(--error)}
li.step.tone-skip{border-left-color:var(--text-ghost)}
li.step.tone-neutral{border-left-color:var(--amber)}
li.step.tone-info{border-left-color:var(--hair-strong)}
.step-icon{font-size:1rem;line-height:1.2;flex:none}
.narrative{color:var(--text-primary);font-size:15.5px;font-weight:600;min-width:0;word-break:break-word}
.narrative .meta{font-weight:400}
.meta{color:var(--text-muted);font-size:13px}
.t{margin-left:auto;font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--text-ghost);white-space:nowrap}
.outcome{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border:2px solid var(--border-strong);white-space:nowrap}
.outcome.tone-pass{background:var(--health);color:var(--on-accent)}
.outcome.tone-block{background:var(--error);color:var(--on-accent)}
.outcome.tone-neutral{background:var(--surface-strong);color:var(--text-secondary);border-color:var(--hair-strong)}
.review{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.finding{position:relative;padding:9px 12px 9px 16px;background:var(--surface-card);box-shadow:inset var(--lw-stripe) 0 0 var(--text-ghost);font-size:14.5px;line-height:1.55;color:var(--text-primary);word-break:break-word}
.finding.sev-high{box-shadow:inset var(--lw-stripe) 0 0 var(--error)}
.finding.sev-medium{box-shadow:inset var(--lw-stripe) 0 0 var(--amber)}
.finding.sev-low{box-shadow:inset var(--lw-stripe) 0 0 var(--text-ghost)}
.finding-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;font-size:13px}
.finding-head .sev{font-weight:700;font-family:"IBM Plex Mono",monospace}
.floc{font-family:"IBM Plex Mono",monospace;color:var(--text-muted);background:var(--surface-strong);padding:1px 6px;border:1px solid var(--hair-strong);word-break:break-all}
.finding-body{margin-top:6px;color:var(--text-secondary);font-size:14px;white-space:pre-wrap;word-break:break-word}
ol.breakdown{list-style:none;margin-top:8px}
ol.breakdown li{padding:2px 0;color:var(--text-muted);font-size:13px;font-family:"IBM Plex Mono",monospace}
details.consolidated,details.raw{margin-top:10px}
details.consolidated summary,details.raw summary{cursor:pointer;color:var(--text-muted);font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600}
details.raw pre{margin:8px 0 0;padding:12px;overflow-x:auto;background:var(--surface-strong);border:1px solid var(--hair-strong);
  font-family:"IBM Plex Mono",monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word}

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
/**
 * Sum a numeric field across transcript step details, distinguishing "summed to
 * zero" from "no step reported this field at all".
 *
 * The distinction is the whole point. A run whose model never returned a
 * `usage` block has NO token rows; rendering that as `0` tells the operator the
 * run was free, which is a lie of the same family as "PASS · clean" for a ship
 * that reviewed nothing. `null` here becomes "not reported" in the UI.
 *
 * @param steps The run's transcript rows (treated as hostile: detail may be
 *   absent, non-JSON, or carry non-numeric values).
 * @param field The detail key to sum, e.g. `inputTokens`.
 * @returns The total, or null when no row carried a finite number for `field`.
 */
function sumDetailField(steps: FleetRunStepRow[], field: string): number | null {
  let total = 0;
  let seen = false;
  for (const s of steps) {
    if (!s.detail) continue;
    try {
      // reason: parsed JSON boundary — value is typeof-checked below before use.
      const d = JSON.parse(s.detail) as Record<string, unknown>;
      const v = d[field];
      if (typeof v === 'number' && Number.isFinite(v)) {
        total += v;
        seen = true;
      }
    } catch {
      /* non-JSON detail — nothing to sum */
    }
  }
  return seen ? total : null;
}

/** Render a token tile value: a real count, or an honest "not reported". */
function tokenTileValue(total: number | null): string {
  return total == null ? 'not reported' : total.toLocaleString('en-US');
}

// ── Step semantics: English narratives over the raw kind/detail ──────────────
//
// The transcript store speaks in machine kinds ("map-chunk", "reduce",
// "ship-verdict") and dumps its `detail` blob as raw JSON. That reads as
// "endless helpful maps with no specificity". This layer turns each row into a
// plain-English sentence describing what the agent actually did, renders a
// ship's structured findings as an on-page review with line-level annotations
// (the same substance findings-render.ts posts to GitHub, not a JSON dump), and
// consolidates the repetitive per-chunk MAP rows into one line the operator can
// skip past. Everything model-influenced is still HTML-escaped.

type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
interface Finding {
  path: string;
  line: number;
  severity: Severity;
  body: string;
}

const SEV_BADGE: Record<Severity, string> = { HIGH: '🔴 HIGH', MEDIUM: '🟡 MEDIUM', LOW: '⚪ LOW' };
const SEV_RANK: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** Parse a step's detail blob to a value, or null when absent/non-JSON. */
function parseDetail(step: FleetRunStepRow): unknown {
  if (!step.detail || step.detail === 'null') return null;
  try {
    return JSON.parse(step.detail);
  } catch {
    return null;
  }
}

/** Pretty-print a step's detail for the secondary "raw step data" affordance. */
function prettyDetail(step: FleetRunStepRow): string | null {
  if (!step.detail || step.detail === 'null') return null;
  try {
    return JSON.stringify(JSON.parse(step.detail), null, 2);
  } catch {
    return step.detail;
  }
}

/** Read a finite number field off a parsed object, else undefined. */
function numField(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Narrow a parsed detail to a plain object (not array/primitive/null). */
function asObject(detail: unknown): Record<string, unknown> {
  return detail && typeof detail === 'object' && !Array.isArray(detail)
    ? (detail as Record<string, unknown>)
    : {};
}

/**
 * Tolerantly extract line-level {@link Finding}s from a ship-verdict detail.
 * Reviewer ships store the raw `Finding[]`; older/opaque shapes may nest it
 * under `.findings`. Anything that does not match the {path,line,body} schema
 * is ignored (it falls through to the raw-JSON affordance instead).
 */
function extractFindings(detail: unknown): Finding[] {
  const arr = Array.isArray(detail)
    ? detail
    : Array.isArray(asObject(detail).findings)
      ? (asObject(detail).findings as unknown[])
      : null;
  if (!arr) return [];
  const out: Finding[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.path !== 'string' || typeof o.line !== 'number' || typeof o.body !== 'string') continue;
    const s = String(o.severity ?? 'LOW').toUpperCase();
    const severity: Severity = s === 'HIGH' ? 'HIGH' : s === 'MEDIUM' || s === 'MED' ? 'MEDIUM' : 'LOW';
    out.push({ path: o.path, line: o.line, severity, body: o.body });
  }
  return out;
}

/**
 * Last PASS/BLOCK token in a step title, e.g. "pd-code-reviewer: BLOCK".
 * Accepts a possibly-absent title defensively: the schema declares
 * `title TEXT NOT NULL`, but this page treats every stored value as hostile, so
 * a malformed row must degrade to `null`, never throw.
 */
function verdictFromTitle(title: string | undefined | null): 'PASS' | 'BLOCK' | null {
  const m = /:\s*(PASS|BLOCK)\b/i.exec(title ?? '');
  const token = m?.[1];
  return token ? (token.toUpperCase() as 'PASS' | 'BLOCK') : null;
}

/**
 * Render a ship's findings as a legible review with line-level annotations —
 * the on-page equivalent of the markdown reviewer comment (findings-render.ts),
 * so the operator reads an actual review instead of a raw JSON array. Grouped
 * HIGH → MEDIUM → LOW; every path/body is escaped (model output).
 */
function renderFindingsHtml(findings: Finding[]): string {
  if (findings.length === 0) return '';
  const sorted = [...findings].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const rows = sorted
    .map(
      f => `<div class="finding sev-${f.severity.toLowerCase()}">
        <div class="finding-head">
          <span class="sev">${esc(SEV_BADGE[f.severity])}</span>
          <span class="floc">${esc(f.path)}:${esc(String(f.line))}</span>
        </div>
        <div class="finding-body">${esc(f.body)}</div>
      </div>`,
    )
    .join('');
  return `<div class="review">${rows}</div>`;
}

interface StepView {
  icon: string;
  tone: 'pass' | 'block' | 'neutral' | 'info' | 'skip';
  headline: string;
  bodyHtml: string;
}

/** Turn one non-MAP transcript step into an English narrative + optional body. */
function describeStep(step: FleetRunStepRow, shipLabel: string): StepView {
  const detail = parseDetail(step);
  const obj = asObject(detail);
  // Defensive: `title` is NOT NULL in the schema, but a malformed/legacy row must
  // never take the whole page down (this endpoint treats stored data as hostile).
  const title = typeof step.title === 'string' ? step.title : '';

  switch (step.kind) {
    case 'reduce': {
      const n = numField(obj, 'chunkCount');
      const len = numField(obj, 'outputLength');
      return {
        icon: '🧵',
        tone: 'info',
        headline:
          `Merged the findings from ${n ?? 'several'} diff chunks into one review` +
          `${len != null ? ` (${len.toLocaleString('en-US')} chars).` : '.'}`,
        bodyHtml: '',
      };
    }

    case 'ship-skipped': {
      const reason = typeof obj.reason === 'string' ? obj.reason : 'nothing to review on this diff';
      return {
        icon: '⏭️',
        tone: 'skip',
        headline: `Skipped ${shipLabel} — ${reason}. No AI spend.`,
        bodyHtml: '',
      };
    }

    case 'ship-finding':
      return {
        icon: '⚠️',
        tone: 'block',
        headline: `${shipLabel} returned output the fleet could not parse — treated as errored (fail-closed).`,
        bodyHtml: '',
      };

    // A ship that produced NO USABLE OUTPUT (fleet-executor's
    // src/usable-output.ts). This must NEVER render as a pass: the ship ran and
    // reviewed nothing. The executor already writes an honest English title, so
    // prefer it verbatim and only synthesize a fallback for a legacy/odd row.
    case 'ship-no-output': {
      const blocking = obj.blocking === true;
      return {
        icon: '🕳️',
        tone: 'block',
        headline:
          title ||
          `${shipLabel} returned no usable output — nothing was reviewed.`,
        bodyHtml: `<p class="meta">${esc(
          blocking
            ? 'This is a blocking ship, so the fleet check failed closed — an absent review is not an approval.'
            : 'This ship is advisory in judgment, but a ship that returned nothing is broken — the fleet check fails until it is fixed.',
        )}</p>`,
      };
    }

    // Per-ship token spend. Present so the run page's token tiles have a
    // source; an honest "not reported" when the model returned no usage block.
    case 'ship-spend': {
      const reported = obj.usageReported === true;
      const calls = numField(obj, 'calls');
      return {
        icon: '🧮',
        tone: 'info',
        headline: reported
          ? title || `${shipLabel} token spend recorded.`
          : `${shipLabel} made ${calls ?? 'its'} model call(s); the model reported no token usage — spend is not reported, not zero.`,
        bodyHtml: '',
      };
    }

    case 'ship-verdict': {
      const verdict = verdictFromTitle(title);

      // Ideation ships propose forward work rather than gating.
      if (/ideation/i.test(title) || 'proposals' in obj) {
        const proposals = obj.proposals;
        if (Array.isArray(proposals)) {
          const items = proposals
            .map(p => {
              const po = asObject(p);
              const t = typeof po.title === 'string' ? po.title : 'proposal';
              const action = typeof po.action === 'string' ? po.action : 'idea';
              const rationale = typeof po.rationale === 'string' ? po.rationale : '';
              return `<div class="finding">
                <div class="finding-head"><span class="floc">${esc(action)}</span><span>${esc(t)}</span></div>
                ${rationale ? `<div class="finding-body">${esc(rationale)}</div>` : ''}
              </div>`;
            })
            .join('');
          return {
            icon: '💡',
            tone: 'neutral',
            headline:
              `${shipLabel} proposed ${proposals.length} piece${proposals.length === 1 ? '' : 's'} of ` +
              'forward work (advisory — never gates the merge).',
            bodyHtml: proposals.length ? `<div class="review">${items}</div>` : '',
          };
        }
        return {
          icon: '💡',
          tone: 'block',
          headline:
            `${shipLabel} emitted a malformed proposal block — a broken ship, so the ` +
            `fleet check fails until it is fixed.`,
          bodyHtml: '',
        };
      }

      // A ship whose job errored resolves fail-closed.
      if (obj.errored === true) {
        return {
          icon: '⚠️',
          tone: 'block',
          headline: `${shipLabel} errored — resolved to ${verdict ?? 'BLOCK'} (fail-closed).`,
          bodyHtml: '',
        };
      }

      // Reviewer verdict: render its structured findings as a real review.
      const findings = extractFindings(detail);
      const count = findings.length;
      const headline =
        count > 0
          ? `${shipLabel} reviewed the diff and returned ${verdict ?? 'a verdict'} with ` +
            `${count} finding${count === 1 ? '' : 's'}.`
          : `${shipLabel} reviewed the diff and returned ${verdict ?? 'a verdict'} — no findings.`;
      return {
        icon: verdict === 'BLOCK' ? '🛑' : '✅',
        tone: verdict === 'BLOCK' ? 'block' : 'pass',
        headline,
        bodyHtml: renderFindingsHtml(findings),
      };
    }

    // ── Purser (adversarial gatekeeper) steps ───────────────────────────────
    case 'purser-steelman': {
      if (typeof obj.error === 'string') {
        return {
          icon: '⚖️',
          tone: 'block',
          headline:
            'The purser could not steel-man this PR — its contract output was malformed. ' +
            'No contract was bluffed, and the broken ship fails the fleet check until fixed.',
          bodyHtml: '',
        };
      }
      const n = numField(obj, 'obligationCount');
      const purpose = typeof obj.purpose === 'string' ? obj.purpose : '';
      return {
        icon: '⚖️',
        tone: 'info',
        headline:
          `The purser steel-manned this PR into ${n ?? 'several'} testable ` +
          `obligation${n === 1 ? '' : 's'} — the strongest reading of its contract.`,
        bodyHtml: purpose
          ? `<div class="review"><div class="finding"><div class="finding-body">${esc(purpose)}</div></div></div>`
          : '',
      };
    }

    // The steel-man contract being written into the reviewed PR's body (the PR
    // summary) — the operator-mandated chronology of what the PR should be.
    case 'purser-contract-posted': {
      const posted = obj.posted === true;
      return {
        icon: '📜',
        tone: posted ? 'info' : 'block',
        headline:
          title ||
          (posted
            ? 'The steel-man contract was written into the PR summary.'
            : 'FAILED to write the steel-man contract into the PR summary.'),
        bodyHtml: '',
      };
    }

    case 'purser-tests': {
      if (typeof obj.error === 'string') {
        return {
          icon: '🧪',
          tone: 'block',
          headline:
            `The purser's authored tests did not survive validation — ${obj.error}. ` +
            `Nothing was stacked, and the broken ship fails the fleet check until fixed.`,
          bodyHtml: '',
        };
      }
      const files = Array.isArray(obj.files) ? obj.files : [];
      const total = numField(obj, 'totalBytes');
      const kb = total != null ? ` (${(total / 1024).toFixed(1)} KB)` : '';
      const list = files
        .map(f => {
          const fo = asObject(f);
          return typeof fo.path === 'string' ? `<li>${esc(fo.path)}</li>` : '';
        })
        .join('');
      return {
        icon: '🧪',
        tone: 'info',
        headline:
          `Authored ${files.length} adversarial test file${files.length === 1 ? '' : 's'}${kb} ` +
          'to grill the contract.',
        bodyHtml: list ? `<ul class="breakdown">${list}</ul>` : '',
      };
    }

    case 'purser-sandbox': {
      if (obj.executed === true) {
        if (obj.passed === true) {
          return {
            icon: '📦',
            tone: 'pass',
            headline: 'Sandbox ran the suite against the PR head — all tests passed.',
            bodyHtml: '',
          };
        }
        const tail = typeof obj.failuresTail === 'string' ? obj.failuresTail : '';
        return {
          icon: '📦',
          tone: 'block',
          headline:
            'Sandbox ran the suite against the PR head — test FAILURES: the PR does not ' +
            'satisfy its own contract.',
          bodyHtml: tail
            ? `<details class="raw"><summary>failing output (tail)</summary><pre>${esc(tail)}</pre></details>`
            : '',
        };
      }
      const reason = typeof obj.reason === 'string' ? obj.reason : 'sandbox unavailable';
      return {
        icon: '📦',
        tone: 'neutral',
        headline: `Sandbox did not run — ${reason}. No results were fabricated.`,
        bodyHtml: '',
      };
    }

    case 'purser-stacked': {
      const n = numField(obj, 'testPrNumber');
      if (n != null) {
        const retargeted = obj.retargeted === true;
        return {
          icon: '⛓️',
          tone: 'info',
          headline:
            `Stacked #${n}: the reviewed PR must now satisfy these tests` +
            (retargeted ? ' — it was retargeted onto the test branch and merges through them' : '') +
            '.',
          bodyHtml: '',
        };
      }
      const degraded = typeof obj.degraded === 'string' ? obj.degraded : 'the test branch could not be pushed';
      return {
        icon: '⛓️',
        tone: 'neutral',
        headline: `Stacking degraded — ${degraded} The tests were posted inline on the PR instead.`,
        bodyHtml: '',
      };
    }

    // ── Ideation "stack" fixes (the ship coded the solution itself) ─────────
    case 'stack-posted': {
      const n = numField(obj, 'stackPrNumber');
      if (obj.stacked === true && n != null) {
        const files = Array.isArray(obj.files) ? obj.files.filter((f): f is string => typeof f === 'string') : [];
        const validated = obj.sandboxValidated === true;
        return {
          icon: '🚢',
          tone: 'pass',
          headline:
            `${shipLabel} coded its own fix and stacked #${n} on top of this PR` +
            (validated ? ' (sandbox-validated against the PR head)' : '') +
            '.',
          bodyHtml: files.length
            ? `<ul class="breakdown">${files.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`
            : '',
        };
      }
      const degraded = typeof obj.degraded === 'string' ? obj.degraded : 'validation failed';
      return {
        icon: '🚢',
        tone: 'neutral',
        headline: `${shipLabel} proposed a coded fix, but it was not stacked — ${degraded}.`,
        bodyHtml: '',
      };
    }

    case 'review-posted':
      return obj.posted === true
        ? { icon: '📤', tone: 'info', headline: `Posted ${shipLabel}'s review to the pull request.`, bodyHtml: '' }
        : { icon: '🧼', tone: 'pass', headline: `${shipLabel} came back clean — nothing to post.`, bodyHtml: '' };

    case 'ideas-captured':
      return {
        icon: '📥',
        tone: 'info',
        headline: title.replace(/^pd-\S+:\s*/, `${shipLabel} captured `),
        bodyHtml: '',
      };

    case 'check-completed': {
      const c = typeof obj.conclusion === 'string' ? obj.conclusion : 'done';
      const reason = typeof obj.reason === 'string' ? ` (${obj.reason})` : '';
      return {
        icon: c === 'failure' ? '🛑' : '🏁',
        tone: c === 'success' ? 'pass' : c === 'failure' ? 'block' : 'neutral',
        headline: `Fleet check concluded: ${c}${reason}.`,
        bodyHtml: '',
      };
    }

    default:
      return { icon: '•', tone: 'info', headline: title || step.kind, bodyHtml: '' };
  }
}

/** Node styling keyed off a step view's tone / kind (story-linework rail). */
function nodeClass(tone: StepView['tone'], kind?: string): string {
  if (kind === 'ship-verdict') return ' tl-verdict';
  if (kind === 'review-posted' || kind === 'check-completed') return ' tl-terminal';
  if (tone === 'pass' || tone === 'block') return ' tl-verdict';
  return '';
}

/**
 * One rendered timeline `<li>` for a described step, with a collapsed raw-data
 * escape. Carries the story-linework `.tl-*` scaffold AND the legibility test
 * hooks (`step tone-<tone>`, `.narrative`) on the same elements.
 */
function renderStepLi(view: StepView, offsetSec: number, rawJson: string | null, kind?: string): string {
  const raw = rawJson
    ? `<details class="raw"><summary>raw step data</summary><pre>${esc(rawJson)}</pre></details>`
    : '';
  return `<li class="tl-step step tone-${view.tone}${nodeClass(view.tone, kind)}">
    <div class="tl-rail"><span class="tl-node" aria-hidden="true"></span></div>
    <div class="tl-body">
      <div class="tl-topline step-head">
        <span class="step-icon" aria-hidden="true">${view.icon}</span>
        <span class="tl-title narrative">${esc(view.headline)}</span>
        <span class="tl-time t">+${esc(String(offsetSec))}s</span>
      </div>
      ${view.bodyHtml}
      ${raw}
    </div>
  </li>`;
}

/**
 * Consolidate a run of consecutive MAP-chunk steps into ONE line — "skip through
 * most of this". The English headline states how many chunks were scanned and
 * the total analysis size; the per-chunk breakdown (which preserves each
 * original "MAP chunk i/N" title) is tucked into a collapsed `<details>`.
 */
function renderConsolidatedMap(chunks: FleetRunStepRow[], runStartSec: number): string {
  const first = chunks[0];
  if (!first) return '';
  const n = chunks.length;
  const offset = Math.max(0, first.created_at - runStartSec);
  let total = 0;
  let empties = 0;
  const breakdown = chunks
    .map(c => {
      const o = asObject(parseDetail(c));
      const len = numField(o, 'outputLength');
      if (len != null) total += len;
      const empty = 'responseShape' in o;
      if (empty) empties += 1;
      const lenLabel = len != null ? ` · ${len.toLocaleString('en-US')} chars` : '';
      return `<li>${esc(c.title)}${esc(lenLabel)}${empty ? ' · ⚠ EMPTY (see raw)' : ''}</li>`;
    })
    .join('');

  const size = total ? `, ${total.toLocaleString('en-US')} chars of analysis` : '';
  const headline =
    n === 1
      ? `Scanned the diff in a single pass${total ? ` (${total.toLocaleString('en-US')} chars of analysis)` : ''}.`
      : `Scanned the diff across ${n} chunks${size} — mapped in parallel, then reduced.`;
  const emptyNote = empties > 0 ? ` <span class="meta">(${empties} chunk${empties === 1 ? '' : 's'} returned empty)</span>` : '';

  return `<li class="tl-step step tone-info">
    <div class="tl-rail"><span class="tl-node" aria-hidden="true"></span></div>
    <div class="tl-body">
      <div class="tl-topline step-head">
        <span class="step-icon" aria-hidden="true">🗺️</span>
        <span class="tl-title narrative">${esc(headline)}${emptyNote}</span>
        <span class="tl-time t">+${esc(String(offset))}s</span>
      </div>
      <details class="consolidated"><summary>${esc(n === 1 ? 'Chunk detail' : `Per-chunk breakdown · ${n} steps`)}</summary>
        <ol class="breakdown">${breakdown}</ol>
      </details>
    </div>
  </li>`;
}

/**
 * A one-line at-a-glance outcome for a ship, from its verdict step.
 *
 * `ship-no-output` is scanned alongside the verdict kinds and short-circuits to
 * its own badge. Without it, a ship that returned nothing carried NO outcome
 * step at all and the card fell through to the ship's last verdict-ish row —
 * which is how "PASS · clean" ended up next to a ship that reviewed nothing.
 */
function shipOutcome(list: FleetRunStepRow[]): { text: string; tone: StepView['tone'] } | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (
      !s ||
      (s.kind !== 'ship-verdict' && s.kind !== 'ship-finding' && s.kind !== 'ship-no-output')
    ) {
      continue;
    }
    if (s.kind === 'ship-no-output') {
      return { text: 'no usable output · nothing reviewed', tone: 'block' };
    }
    if (s.kind === 'ship-finding') return { text: 'errored · unparseable output', tone: 'block' };
    if (/ideation/i.test(s.title ?? '')) return { text: 'advisory · ideation', tone: 'neutral' };
    if (asObject(parseDetail(s)).errored === true) return { text: 'errored · fail-closed', tone: 'block' };
    const verdict = verdictFromTitle(s.title);
    const count = extractFindings(parseDetail(s)).length;
    const suffix = count ? `${count} finding${count === 1 ? '' : 's'}` : 'clean';
    return { text: `${verdict ?? 'done'} · ${suffix}`, tone: verdict === 'BLOCK' ? 'block' : 'pass' };
  }
  return null;
}

/**
 * Group transcript steps per ship, preserving order; null ship ⇒ "Fleet".
 * Each group renders as a story-linework `.ship-card` with a `.timeline`; each
 * step (and each consolidated MAP entry) is a `.tl-step` timeline node whose
 * body is the English narrative + findings review + raw-data affordance.
 */
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
    const outcome = isFleet ? null : shipOutcome(list);
    const outcomeHtml = outcome ? `<span class="outcome tone-${outcome.tone}">${esc(outcome.text)}</span>` : '';

    const lis: string[] = [];
    for (let i = 0; i < list.length; ) {
      const cur = list[i];
      if (!cur) {
        i += 1;
        continue;
      }
      if (cur.kind === 'map-chunk') {
        let j = i;
        while (j < list.length && list[j]?.kind === 'map-chunk') j += 1;
        lis.push(renderConsolidatedMap(list.slice(i, j), runStartSec));
        i = j;
      } else {
        const offset = Math.max(0, cur.created_at - runStartSec);
        lis.push(renderStepLi(describeStep(cur, label), offset, prettyDetail(cur), cur.kind));
        i += 1;
      }
    }

    html += `<section class="ship-card${isFleet ? ' fleet' : ''}">
      <header class="ship-head">
        <div class="ship-id"><span class="ship-tick" aria-hidden="true"></span><h2>${esc(label)}</h2>${outcomeHtml}</div>
        <span class="ship-count">${list.length} step${list.length === 1 ? '' : 's'}</span>
      </header>
      <ol class="timeline">${lis.join('')}</ol>
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
      <span class="eyebrow">Port Daddy Fleet · review receipt</span>
      <h1 class="ko">What the fleet <span class="rec">found</span><span class="ko-over" aria-hidden="true">What the fleet <span class="rec">found</span></span></h1>
      <span class="lede">Every review bot's pass on this PR — the files it read, the problems it raised, the calls it made. It's the same thing they posted in the comments, gathered in one place. Your code never leaves GitHub; the bots only see the diff.</span>
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
      <div class="stat"><div class="k">Input tokens</div><div class="v mono">${esc(tokenTileValue(inputTokens))}</div></div>
      <div class="stat"><div class="k">Output tokens</div><div class="v mono">${esc(tokenTileValue(outputTokens))}</div></div>
      <div class="stat stat-money"><div class="k">Neurons</div><div class="v mono">${run.neurons == null ? '—' : run.neurons.toLocaleString('en-US')}</div></div>
      <div class="stat"><div class="k">Wall-clock</div><div class="v mono">${esc(fmtMs(run.ms))}</div></div>
    </div>

    <div class="tx-head">
      <span class="eyebrow">Deliberation</span>
      <h2>The transcript</h2>
    </div>
    <p class="tx-sub">Read it top to bottom. Each bot chunks the diff, weighs it, and files what it found;
    the last rows are what it posted back to GitHub.</p>
    ${steps.length ? renderShips(steps, run.created_at) : EMPTY_TRANSCRIPT}

    <footer class="receipt-foot">Run <code>${esc(run.id)}</code> · delivery <code>${esc(run.delivery_id)}</code>.
    Anyone with this exact link can open it — it shows the review, not your source. Same contents the
    fleet posted in the PR.</footer>
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
