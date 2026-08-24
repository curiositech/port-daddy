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
import type { FleetRunStepRow } from './db.js';
import {
  getFleetRunProjectionWithSteps,
  listFleetRunGenerationsForPr,
  type FleetRunProjection,
  type FleetRunGenerationSummary,
} from './fleet-run-intents.js';
import { resolveSession, userCanReadRepo } from './auth-github.js';
import { getRepoToken, getPrMeta, getPrDiff, type PrMeta, type PrDiff } from './github-app.js';
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

function htmlResponse(body: string, status: number, refreshSeconds: number | null = null): Response {
  const headers: Record<string, string> = {
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
  };
  if (refreshSeconds !== null) headers.Refresh = String(refreshSeconds);
  return new Response(body, {
    status,
    headers,
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
.badge.running{background:var(--cobalt);color:var(--cream)}.badge.running .dot{background:var(--cream)}
.badge.queued{background:var(--surface-base);color:var(--text-primary)}.badge.queued .dot{background:var(--amber)}
.badge.retrying{background:var(--amber);color:var(--ink)}.badge.retrying .dot{background:var(--error)}
.badge.superseded{background:var(--surface-card);color:var(--text-muted);border-color:var(--hair-strong)}.badge.superseded .dot{background:var(--text-muted)}
.rid-facts{display:flex;flex-wrap:wrap;gap:10px 12px;padding:16px 22px}
.fact{display:inline-flex;align-items:baseline;gap:8px;font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;color:var(--text-secondary);border:1px solid var(--hair-strong);padding:5px 11px;max-width:100%;overflow:hidden}
.fact .fk{color:var(--text-muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:11.5px}
.fact code{color:var(--text-primary);word-break:break-all}
.rid-title{padding:0 22px 14px;margin-top:-8px;font-size:15px;color:var(--text-secondary);line-height:1.5;word-break:break-word}
.genstrip{padding:0 22px 16px}
.genstrip summary{cursor:pointer;font-family:"IBM Plex Mono",monospace;font-size:12.5px;font-weight:600;color:var(--cobalt)}
.genstrip ul{list-style:none;margin-top:8px}
.genstrip li{padding:4px 0;font-size:13px}

/* diff panel */
.diffpanel{border:2px solid var(--border-strong);border-top:none;background:var(--surface-card);margin-bottom:44px}
.diffpanel>summary{cursor:pointer;padding:13px 22px;font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:700;letter-spacing:.02em;color:var(--cobalt);list-style:none}
.diffpanel>summary::-webkit-details-marker{display:none}
.diffpanel-body{padding:0 22px 18px}
.diffpanel-empty{padding:13px 22px;border:2px solid var(--border-strong);border-top:none;background:var(--surface-card);margin-bottom:44px;font-size:13.5px;color:var(--text-muted)}
.difffile{border:1px solid var(--hair-strong);margin-top:10px}
.difffile summary{cursor:pointer;padding:8px 12px;font-family:"IBM Plex Mono",monospace;font-size:12.5px;background:var(--surface-strong)}
.difffile summary code{color:var(--text-primary)}
.diffbody{overflow-x:auto;padding:10px 12px;font-family:"IBM Plex Mono",monospace;font-size:12px;line-height:1.5;max-height:480px;overflow-y:auto;white-space:pre}
.diffbody .df-add{color:var(--health)}
.diffbody .df-del{color:var(--error)}
.diffbody .df-hunk{color:var(--cobalt)}
.diffbody .df-meta{color:var(--text-ghost)}
.diffbody .df-ctx{color:var(--text-secondary)}

/* stat ledger */
.statrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));gap:var(--lw-weight);background:var(--hair-strong);border:2px solid var(--border-strong);border-top:none;margin-bottom:44px}
.stat{background:var(--surface-card);padding:16px 18px}
.stat .k{font-family:"IBM Plex Mono",monospace;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted)}
.stat .v{font-size:26px;font-weight:700;margin-top:6px;letter-spacing:-.01em;line-height:1.05}
.stat-money .v{color:var(--gold)}
.live-strip{display:flex;align-items:center;gap:10px;padding:11px 18px;border:2px solid var(--border-strong);border-top:none;background:var(--surface-raised);font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--text-muted)}
.live-strip .pulse{width:9px;height:9px;background:var(--cobalt);border:2px solid var(--border-strong);animation:fleet-pulse 1.8s ease-in-out infinite}
@keyframes fleet-pulse{50%{opacity:.28}}
@media (prefers-reduced-motion:reduce){.live-strip .pulse{animation:none}}

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
.spend-badge{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--text-muted);white-space:nowrap}
.spend-badge code{color:var(--text-secondary)}
.ship-config{display:flex;flex-wrap:wrap;gap:8px 22px;align-items:center;padding:11px 20px;border-bottom:2px solid var(--border-strong);background:var(--surface-card);font-size:13px}
.ship-config .cfg-row{display:flex;gap:6px;align-items:baseline}
.ship-config .cfg-k{font-family:"IBM Plex Mono",monospace;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-ghost)}
.ship-config .cfg-flags{display:flex;flex-wrap:wrap;gap:6px}
.ship-config .flag{font-family:"IBM Plex Mono",monospace;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border:1px solid var(--hair-strong);color:var(--text-secondary);white-space:nowrap}
.ship-config .flag.on{border-color:var(--cobalt);color:var(--cobalt)}
.ship-config .cfg-link{font-size:12.5px;white-space:nowrap;margin-left:auto}

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
.operator-action{margin-top:12px;padding:10px 12px;border-left:var(--lw-stripe) solid var(--teal);background:var(--surface-card);font-size:14px;line-height:1.55;color:var(--text-secondary)}
.operator-action strong{color:var(--text-primary)}
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

/* ── raw session transcript viewer (pd-transcript.v1; Phase 2) ─────────── */
.tvx{max-width:980px;margin:0 auto;padding:18px 16px 60px}
.tvx-mast{background:var(--surface-raised);border:1px solid var(--surface-strong);padding:14px 16px;margin-bottom:14px}
.tvx-mast h1{font:600 17px/1.3 "IBM Plex Sans",sans-serif;color:var(--text-primary);margin-bottom:6px}
.tvx-facts{display:flex;flex-wrap:wrap;gap:6px 16px;font:400 12px/1.5 "IBM Plex Mono",monospace;color:var(--text-secondary)}
.tvx-facts b{color:var(--text-primary);font-weight:600}
.tvx-links{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px 14px;font:500 12px/1.5 "IBM Plex Mono",monospace}
.tvx-links a{color:var(--cobalt);text-decoration:none;border-bottom:1px solid var(--surface-strong)}
.tvx-attempt-on{font-weight:700;color:var(--text-primary)}
.turn{background:var(--surface-raised);border:1px solid var(--surface-strong);margin-bottom:10px}
.turn-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;padding:8px 12px;border-bottom:1px solid var(--surface-strong);font:400 11.5px/1.5 "IBM Plex Mono",monospace;color:var(--text-muted)}
.turn-kind{font-weight:700;letter-spacing:.06em;padding:1px 7px;border:1px solid var(--surface-strong)}
.turn-system .turn-kind{color:var(--text-muted)}
.turn-user .turn-kind{color:var(--cobalt)}
.turn-assistant .turn-kind{color:var(--teal)}
.turn-error .turn-kind{color:var(--error);border-color:var(--error)}
.turn-phase{color:var(--text-secondary);font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.turn-model code{color:var(--text-secondary)}
.turn-anchor{margin-left:auto;color:var(--text-ghost);text-decoration:none}
.turn-anchor:hover{color:var(--cobalt)}
.turn-badge{color:var(--amber);font-weight:700}
.turn-body{padding:10px 12px}
.turn-body pre{white-space:pre-wrap;word-break:break-word;font:400 12px/1.6 "IBM Plex Mono",monospace;color:var(--text-primary);max-height:520px;overflow:auto}
.turn-error .turn-body pre{color:var(--error)}
.turn-body details>summary{cursor:pointer;font:500 12px/1.6 "IBM Plex Mono",monospace;color:var(--text-secondary)}
.turn-sysref{font:400 12px/1.6 "IBM Plex Mono",monospace;color:var(--text-ghost)}
.tvx-notice{background:var(--surface-strong);padding:10px 12px;margin-bottom:12px;font:400 12px/1.6 "IBM Plex Mono",monospace;color:var(--text-secondary)}
:target.turn{outline:2px solid var(--cobalt)}
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
  if (conclusion === 'running') return 'running';
  if (conclusion === 'queued' || conclusion === 'admitting') return 'queued';
  if (conclusion === 'retrying') return 'retrying';
  if (conclusion === 'superseded') return 'superseded';
  if (conclusion === 'enqueue_failed') return 'failure';
  return 'other';
}

function stateLabel(state: string): string {
  if (state === 'enqueue_failed') return 'needs repair';
  return state || 'pending';
}

function fmtUtc(sec: number): string {
  return new Date(sec * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

/** Short clock-only form for inline step timestamps (full date is the tooltip). */
function fmtClockUtc(sec: number): string {
  return `${new Date(sec * 1000).toISOString().slice(11, 19)} UTC`;
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

/**
 * Format a USD cost for display. Fleet spend is typically sub-cent per run,
 * so a fixed two-decimal format would round almost everything to "$0.00" —
 * indistinguishable from genuinely free. Shows enough precision to be honest
 * at the run's actual scale, never fewer than 2 places, never more than 6.
 */
function fmtUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  const decimals = usd >= 1 ? 2 : usd >= 0.01 ? 4 : 6;
  return `$${usd.toFixed(decimals)}`;
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

    // The contract-repair pass (fleet-executor src/repair.ts): broken output
    // gets up to two bounded retries before the broken-ship doctrine engages.
    case 'ship-repair': {
      const healed = obj.healed === true;
      return {
        icon: '🩹',
        tone: healed ? 'info' : 'block',
        headline:
          title ||
          (healed
            ? `${shipLabel} emitted broken output, then healed it on a repair retry.`
            : `${shipLabel} emitted broken output and the repair retries failed too.`),
        bodyHtml: '',
      };
    }

    // The broken-ship marker (fleet-executor src/adjudicator.ts) — evidence
    // for the epidemic test; the adjudication step right after it says who
    // the breakage gates.
    case 'ship-broken':
      return {
        icon: '💥',
        tone: 'block',
        headline: title || `${shipLabel} is broken — repair failed; adjudicating who this gates.`,
        bodyHtml: '',
      };

    case 'ship-adjudicated': {
      const fleetWide = (obj as { verdict?: unknown }).verdict === 'fleet';
      return {
        icon: '⚖️',
        tone: fleetWide ? 'neutral' : 'block',
        headline:
          title ||
          (fleetWide
            ? `${shipLabel}'s breakage was adjudicated a FLEET-WIDE fault — tracked in one issue; not gating this PR.`
            : `${shipLabel}'s breakage is isolated to this PR — the failure stands.`),
        bodyHtml: `<p class="meta">${esc(
          fleetWide
            ? 'This is a fleet-wide adjudication, not a PR-review failure. The run resolves neutral — visible, never green — because the fault gates the fleet, not this author, who must fix it.'
            : 'This is an isolated PR-review failure, not a fleet-wide provider outage. The breakage fails the run and remains a failing gate for this PR.',
        )}</p><p class="operator-action"><strong>Operator action:</strong> ${esc(
          fleetWide
            ? 'No change is requested from the PR author. Track the fleet fault and repair or pause the affected ship in FleetBar before asking for another review.'
            : 'Inspect this ship’s transcript and configuration; the PR remains blocked until the isolated review failure is resolved.',
        )}</p>`,
      };
    }

    // A FleetAiCircuit opens only for a retryable Workers AI dependency fault.
    // This is a provider availability event, deliberately distinct from a ship's
    // review judgement or an isolated broken-ship failure.
    case 'provider-circuit-open': {
      const attempt = numField(obj, 'attempt');
      const maxAttempts = numField(obj, 'maxAttempts');
      const hasRetryRemaining = attempt != null && maxAttempts != null && attempt < maxAttempts;
      const status = numField(obj, 'status');
      const code = numField(obj, 'code');
      const providerDetail = [
        status != null ? `HTTP ${status}` : null,
        code != null ? `provider code ${code}` : null,
      ].filter((value): value is string => value !== null).join(' · ');
      const attemptLabel = attempt != null && maxAttempts != null
        ? `delivery attempt ${attempt}/${maxAttempts}`
        : 'this delivery attempt';
      return {
        icon: '!',
        tone: 'neutral',
        headline: `Workers AI provider circuit opened on ${attemptLabel} — provider outage, not a PR-review failure.`,
        bodyHtml: `<p class="meta">${esc(
          `${providerDetail ? `${providerDetail}. ` : ''}${
            hasRetryRemaining
              ? 'The queue has scheduled the next bounded retry.'
              : 'The bounded provider retry budget is exhausted.'
          }`,
        )}</p><p class="operator-action"><strong>Operator action:</strong> ${esc(
          hasRetryRemaining
            ? 'No change is requested from the PR author. Let the scheduled retry run and monitor the next attempt in Cloud Fleet.'
            : 'No change is requested from the PR author. Check Workers AI availability and the Fleet provider configuration in FleetBar before requesting a fresh review.',
        )}</p>`,
      };
    }

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
      const model = typeof obj.model === 'string' ? obj.model : null;
      const cost = numField(obj, 'costUsd');
      return {
        icon: '🧮',
        tone: 'info',
        headline: reported
          ? title || `${shipLabel} token spend recorded.`
          : `${shipLabel} made ${calls ?? 'its'} model call(s); the model reported no token usage — spend is not reported, not zero.`,
        bodyHtml:
          reported && (model || cost != null)
            ? `<p class="meta">${model ? `Ran on <code>${esc(model)}</code>. ` : ''}${
                cost != null ? `Cost this run: ${esc(fmtUsd(cost))}.` : ''
              }</p>`
            : '',
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
      const obligations = Array.isArray(obj.obligations)
        ? obj.obligations.filter((o): o is string => typeof o === 'string')
        : [];
      const purposeHtml = purpose
        ? `<div class="finding"><div class="finding-head"><span class="floc">purpose</span></div><div class="finding-body">${esc(purpose)}</div></div>`
        : '';
      const obligationsHtml = obligations.length
        ? `<div class="finding"><div class="finding-head"><span class="floc">the ${obligations.length} obligation${obligations.length === 1 ? '' : 's'} held to</span></div>` +
          `<div class="finding-body"><ol class="breakdown">${obligations.map(o => `<li>${esc(o)}</li>`).join('')}</ol></div></div>`
        : '';
      return {
        icon: '⚖️',
        tone: 'info',
        headline:
          `The purser steel-manned this PR into ${n ?? 'several'} testable ` +
          `obligation${n === 1 ? '' : 's'} — the strongest reading of its contract.`,
        bodyHtml: purposeHtml || obligationsHtml ? `<div class="review">${purposeHtml}${obligationsHtml}</div>` : '',
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

    // A ship's job errored (transport/AI failure) — the title the executor
    // wrote is already a specific summary (fleet-executor's execute.ts); this
    // case only fixes the icon/tone so an error reads as one, and adds the
    // retry note when the failure is one the executor will retry on its own.
    case 'ship-error': {
      const retryable = obj.retryable === true;
      return {
        icon: '🛑',
        tone: 'block',
        headline: title || `${shipLabel} errored.`,
        bodyHtml: retryable
          ? `<p class="meta">This class of failure is retried automatically on the next delivery attempt.</p>`
          : '',
      };
    }

    // A ship whose verdict was reused from an EARLIER delivery attempt of the
    // same PR generation, instead of re-running (ship-checkpoint.ts) — the
    // fleet does not pay twice for the same diff when a prior attempt already
    // has a good answer.
    case 'ship-resumed': {
      const verdict = typeof obj.verdict === 'string' ? obj.verdict : null;
      const errored = obj.errored === true;
      const findings = numField(obj, 'findings');
      return {
        icon: '♻️',
        tone: errored ? 'block' : verdict === 'BLOCK' ? 'block' : 'pass',
        headline:
          title ||
          `${shipLabel} reused its verdict from an earlier attempt on this same PR generation — no re-run, no repeat spend.`,
        bodyHtml: `<p class="meta">Reused: ${esc(errored ? 'ERROR' : (verdict ?? 'done'))}${
          findings != null ? ` · ${findings} finding${findings === 1 ? '' : 's'}` : ''
        } (from the attempt that first ran it).</p>`,
      };
    }

    // A ship's result was CHECKPOINTED so a retried delivery can resume past
    // it (ship-checkpoint.ts) — the full ShipResult (verdict/findings) is
    // already shown by that ship's own `ship-verdict` row earlier in this
    // same attempt; this marker only proves the checkpoint was durably saved.
    case 'ship-checkpoint': {
      const verdict = typeof obj.verdict === 'string' ? obj.verdict : null;
      const errored = obj.errored === true;
      return {
        icon: '💾',
        tone: 'info',
        headline:
          `${shipLabel} checkpointed its ${errored ? 'ERROR' : (verdict ?? 'result')} — ` +
          'a retried delivery resumes past this ship instead of paying for it again.',
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
function renderStepLi(
  view: StepView,
  offsetSec: number,
  createdAtSec: number,
  rawJson: string | null,
  kind?: string,
): string {
  const raw = rawJson
    ? `<details class="raw"><summary>raw step data</summary><pre>${esc(rawJson)}</pre></details>`
    : '';
  return `<li class="tl-step step tone-${view.tone}${nodeClass(view.tone, kind)}">
    <div class="tl-rail"><span class="tl-node" aria-hidden="true"></span></div>
    <div class="tl-body">
      <div class="tl-topline step-head">
        <span class="step-icon" aria-hidden="true">${view.icon}</span>
        <span class="tl-title narrative">${esc(view.headline)}</span>
        <span class="tl-time t" title="+${esc(String(offsetSec))}s into the run">${esc(fmtClockUtc(createdAtSec))}</span>
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
        <span class="tl-time t" title="+${esc(String(offset))}s into the run">${esc(fmtClockUtc(first.created_at))}</span>
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

/** The repo that owns every ship's actual system-prompt source (fleet/ships/*.md) — Port Daddy's own, not the reviewed repo. */
const SHIP_DEFINITION_REPO = 'curiositech/port-daddy';

/**
 * A per-ship spend rollup from its `ship-spend` step(s): the model(s) it ran
 * on and its total cost this run — the same fields already summed into the
 * page's global token tiles, just kept per-ship for the ship-card header.
 */
function shipSpendBadge(list: FleetRunStepRow[]): string {
  let model: string | null = null;
  let cost: number | null = null;
  let anyReported = false;
  for (const s of list) {
    if (s.kind !== 'ship-spend') continue;
    const o = asObject(parseDetail(s));
    if (typeof o.model === 'string') model = o.model;
    const c = numField(o, 'costUsd');
    if (c != null) {
      cost = (cost ?? 0) + c;
      anyReported = true;
    }
  }
  if (!model && !anyReported) return '';
  const parts = [model ? `<code>${esc(model)}</code>` : null, anyReported ? esc(fmtUsd(cost ?? 0)) : null].filter(
    Boolean,
  );
  return parts.length ? `<span class="spend-badge">${parts.join(' · ')}</span>` : '';
}

/**
 * Render a ship's static configuration (fleet-ship-config step, written once
 * at run start — see execute.ts's recordShipsConfigInTranscript) as an info
 * strip under the ship-card header: model(s), role, the permission-shaped
 * flags an operator actually asks about (can it block? can it write files?),
 * and a link to its real prompt source, since that prompt is never persisted
 * per-run and Port Daddy's ships are the same definitions across every repo
 * the fleet reviews.
 */
function renderShipConfigPanel(
  configStep: FleetRunStepRow | undefined,
  shipName: string,
  /** Raw pd-transcript.v1 link for this ship, when one was captured. */
  transcriptHref?: string,
): string {
  const transcriptLink = transcriptHref
    ? `<a class="cfg-link" href="${esc(transcriptHref)}">Raw session transcript (JSONL) →</a>`
    : '';
  if (!configStep) {
    // Pre-config-step runs can still have a captured transcript: the link is
    // the promise this page has been making — never hide it behind config.
    return transcriptLink ? `<div class="ship-config">${transcriptLink}</div>` : '';
  }
  const o = asObject(parseDetail(configStep));
  const cfModel = typeof o.cfModel === 'string' ? o.cfModel : null;
  const modelRows = [
    cfModel ? `<div class="cfg-row"><span class="cfg-k">model</span><code>${esc(cfModel)}</code></div>` : '',
    typeof o.cfPlanModel === 'string'
      ? `<div class="cfg-row"><span class="cfg-k">purser plan</span><code>${esc(o.cfPlanModel)}</code></div>`
      : '',
    typeof o.cfAuthorModel === 'string'
      ? `<div class="cfg-row"><span class="cfg-k">purser author</span><code>${esc(o.cfAuthorModel)}</code></div>`
      : '',
    typeof o.cfMapModel === 'string'
      ? `<div class="cfg-row"><span class="cfg-k">map fan-out</span><code>${esc(o.cfMapModel)}</code></div>`
      : '',
  ].join('');
  const flags = [
    `<span class="flag${o.blocking === true ? ' on' : ''}">${o.blocking === true ? 'blocking' : 'advisory'}</span>`,
    o.needsExecution === true ? `<span class="flag on">bash/write execution</span>` : '',
    o.purser === true ? `<span class="flag on">purser · adversarial gatekeeper</span>` : '',
    o.ideation === true ? `<span class="flag">ideation · never blocks</span>` : '',
    Array.isArray(o.testPaths) && o.testPaths.length
      ? `<span class="flag">tests confined to ${esc(o.testPaths.filter((p): p is string => typeof p === 'string').join(', '))}</span>`
      : '',
  ].join('');
  const link = `<a class="cfg-link" href="https://github.com/${SHIP_DEFINITION_REPO}/blob/main/fleet/ships/${encodeURIComponent(shipName)}.md">Ship definition &amp; prompt on GitHub →</a>`;
  return `<div class="ship-config">${modelRows}<div class="cfg-flags">${flags}</div>${link}${transcriptLink}</div>`;
}

/**
 * Consolidate the Fleet group's `delivery-attempt` / `delivery-failed` rows
 * into ONE line — these are per-retry infrastructure markers ("Delivery
 * attempt 1 started", "Delivery attempt 2 started", …), not deliberation, and
 * reading them one-per-line is exactly the noise the MAP-chunk consolidation
 * already exists to kill. Pairs each attempt with its failure (if any) so the
 * collapsed breakdown reads as "what happened between attempts", not just a
 * bare count.
 */
function renderDeliveryHistory(rows: FleetRunStepRow[], runStartSec: number): string {
  if (rows.length === 0) return '';
  const byAttempt = new Map<number, { started?: FleetRunStepRow; failed?: FleetRunStepRow }>();
  for (const r of rows) {
    const n = numField(asObject(parseDetail(r)), 'attempt') ?? 0;
    const entry = byAttempt.get(n) ?? {};
    if (r.kind === 'delivery-failed') entry.failed = r;
    else entry.started = r;
    byAttempt.set(n, entry);
  }
  const attempts = [...byAttempt.entries()].sort((a, b) => a[0] - b[0]);
  const failedCount = attempts.filter(([, e]) => e.failed).length;
  const first = rows[0];
  if (!first) return '';
  const offset = Math.max(0, first.created_at - runStartSec);
  const breakdown = attempts
    .map(([n, e]) => {
      const time = e.started ? fmtClockUtc(e.started.created_at) : e.failed ? fmtClockUtc(e.failed.created_at) : '';
      const failText = e.failed ? esc((asObject(parseDetail(e.failed)).error as string) ?? 'failed') : null;
      return `<li>Attempt ${n || '?'} · ${esc(time)}${failText ? ` — FAILED: ${failText}` : ' — started'}</li>`;
    })
    .join('');
  const headline =
    attempts.length === 1
      ? 'Delivered on the first attempt — no retries.'
      : `Delivered across ${attempts.length} attempt${attempts.length === 1 ? '' : 's'}` +
        (failedCount ? `, ${failedCount} of which failed before completing.` : '.');
  return `<li class="tl-step step tone-${failedCount ? 'neutral' : 'info'}">
    <div class="tl-rail"><span class="tl-node" aria-hidden="true"></span></div>
    <div class="tl-body">
      <div class="tl-topline step-head">
        <span class="step-icon" aria-hidden="true">🔁</span>
        <span class="tl-title narrative">${esc(headline)}</span>
        <span class="tl-time t" title="+${esc(String(offset))}s into the run">${esc(fmtClockUtc(first.created_at))}</span>
      </div>
      <details class="consolidated"><summary>Per-attempt breakdown · ${attempts.length} attempt${attempts.length === 1 ? '' : 's'}</summary>
        <ol class="breakdown">${breakdown}</ol>
      </details>
    </div>
  </li>`;
}

/**
 * Group transcript steps per ship, preserving order; null ship ⇒ "Fleet".
 * Each group renders as a story-linework `.ship-card` with a `.timeline`; each
 * step (and each consolidated MAP entry) is a `.tl-step` timeline node whose
 * body is the English narrative + findings review + raw-data affordance.
 * Per-ship groups also render a config strip (model/role/permissions, from
 * the one-time `fleet-ship-config` step) and a spend badge in the header; the
 * Fleet group's `delivery-attempt`/`delivery-failed` rows collapse into one
 * consolidated entry instead of one line per retry.
 */
function renderShips(
  steps: FleetRunStepRow[],
  runStartSec: number,
  /** ship → raw-transcript href (newest attempt), from the D1 index. */
  transcriptHrefs?: Map<string, string>,
): string {
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
    const spendHtml = isFleet ? '' : shipSpendBadge(list);
    const configStep = isFleet ? undefined : list.find(s => s.kind === 'fleet-ship-config');
    const configHtml = isFleet
      ? ''
      : renderShipConfigPanel(configStep, ship, transcriptHrefs?.get(ship));

    const deliveryRows = isFleet
      ? list.filter(s => s.kind === 'delivery-attempt' || s.kind === 'delivery-failed')
      : [];
    const timelineSource = list.filter(
      s =>
        s.kind !== 'fleet-ship-config' &&
        !(isFleet && (s.kind === 'delivery-attempt' || s.kind === 'delivery-failed')),
    );

    const lis: string[] = [];
    if (deliveryRows.length) lis.push(renderDeliveryHistory(deliveryRows, runStartSec));
    for (let i = 0; i < timelineSource.length; ) {
      const cur = timelineSource[i];
      if (!cur) {
        i += 1;
        continue;
      }
      if (cur.kind === 'map-chunk') {
        let j = i;
        while (j < timelineSource.length && timelineSource[j]?.kind === 'map-chunk') j += 1;
        lis.push(renderConsolidatedMap(timelineSource.slice(i, j), runStartSec));
        i = j;
      } else {
        const offset = Math.max(0, cur.created_at - runStartSec);
        lis.push(renderStepLi(describeStep(cur, label), offset, cur.created_at, prettyDetail(cur), cur.kind));
        i += 1;
      }
    }

    html += `<section class="ship-card${isFleet ? ' fleet' : ''}">
      <header class="ship-head">
        <div class="ship-id"><span class="ship-tick" aria-hidden="true"></span><h2>${esc(label)}</h2>${outcomeHtml}${spendHtml}</div>
        <span class="ship-count">${list.length} step${list.length === 1 ? '' : 's'}</span>
      </header>
      ${configHtml}
      <ol class="timeline">${lis.join('')}</ol>
    </section>`;
  }
  return html;
}

function emptyTranscript(run: FleetRunProjection): string {
  if (['admitting', 'queued'].includes(run.logical_state)) {
    return `<div class="empty"><div class="e-title">Waiting for a Fleet worker.</div>
      <p>This generation is durably admitted. No ship has started yet; the page will refresh while
      it waits${run.queue_ahead_estimate == null ? '' : ` behind approximately ${esc(run.queue_ahead_estimate)} earlier run(s)`}.</p></div>`;
  }
  if (run.logical_state === 'superseded') {
    return `<div class="empty"><div class="e-title">Superseded before execution.</div>
      <p>A newer commit became the current PR generation, so this queued delivery was acknowledged
      without model spend.</p></div>`;
  }
  if (run.logical_state === 'enqueue_failed') {
    return `<div class="empty"><div class="e-title">Queue admission needs repair.</div>
      <p>${esc(run.last_error ?? 'The relay could not hand this generation to a Fleet worker.')}</p></div>`;
  }
  if (run.logical_state === 'retrying') {
    const attempt = Number.isInteger(run.attempt_count) && run.attempt_count > 0 ? run.attempt_count : 1;
    return `<div class="empty"><div class="e-title">Provider retry scheduled — attempt ${esc(attempt)} is complete.</div>
      <p>A provider outage interrupted this Fleet delivery. This is not a PR-review failure, and no review conclusion has been made yet.</p>
      ${run.last_error ? `<p class="meta">${esc(run.last_error)}</p>` : ''}
      <p class="operator-action"><strong>Operator action:</strong> No change is requested from the PR author. Let the queue retry; if its bounded attempts exhaust, inspect Workers AI and the Fleet provider configuration in FleetBar before requesting a fresh review.</p></div>`;
  }
  return `<div class="empty"><div class="e-title">No transcript steps recorded for this run.</div>
    <p>The run ended before per-ship deliberation was stored, or step recording was unavailable.
    The state above remains authoritative.</p></div>`;
}

interface DiffFile {
  path: string;
  body: string;
}

/** Split a unified diff into per-file segments at `diff --git` boundaries. */
function splitDiffByFile(diffText: string): DiffFile[] {
  const parts = diffText.split(/(?=^diff --git )/m).filter(p => p.trim().length > 0);
  return parts.map(part => {
    const m = /^diff --git a\/(.+?) b\/(.+?)[\r\n]/.exec(part);
    return { path: (m?.[2] ?? m?.[1] ?? 'unknown file').trim(), body: part };
  });
}

/** One diff file's body as escaped, per-line-classed spans (+/- coloring, no client JS). */
function renderDiffLines(body: string): string {
  return body
    .split('\n')
    .map(line => {
      const cls =
        line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')
          ? 'df-meta'
          : line.startsWith('@@')
            ? 'df-hunk'
            : line.startsWith('+')
              ? 'df-add'
              : line.startsWith('-')
                ? 'df-del'
                : 'df-ctx';
      return `<span class="${cls}">${esc(line)}</span>`;
    })
    .join('\n');
}

/**
 * Render the PR's diff as one `<details>` per changed file — expand a file to
 * read its full patch, never a wall of raw text. Degrades to a plain link
 * when no diff could be fetched (private-ish failure, huge PR, transient
 * GitHub error) rather than a broken or empty-looking page.
 */
function renderDiffPanel(diff: PrDiff | null, prUrl: string): string {
  const viewLink = /^https:\/\//.test(prUrl) ? `<a href="${esc(prUrl)}">View the full diff on GitHub →</a>` : '';
  if (!diff || !diff.text.trim()) {
    return `<div class="diffpanel-empty">The diff could not be fetched for this receipt right now. ${viewLink}</div>`;
  }
  const files = splitDiffByFile(diff.text);
  if (files.length === 0) {
    return `<div class="diffpanel-empty">The diff came back empty. ${viewLink}</div>`;
  }
  const items = files
    .map(
      f => `<details class="difffile"><summary><code>${esc(f.path)}</code></summary>
      <pre class="diffbody">${renderDiffLines(f.body)}</pre></details>`,
    )
    .join('');
  const truncNote = diff.truncated
    ? `<p class="meta">Diff truncated for this receipt — ${viewLink} for the complete patch.</p>`
    : '';
  return `<details class="diffpanel">
    <summary>Diff — ${files.length} file${files.length === 1 ? '' : 's'} changed</summary>
    <div class="diffpanel-body">${truncNote}${items}</div>
  </details>`;
}

/**
 * Render the "every session across this PR" strip — every OTHER review
 * generation (one per push) admitted for the same repo/PR, newest first, so
 * an operator does not need to know a delivery id to find yesterday's review
 * of the same pull request. Empty when this is the only generation, or when
 * the D1 read degraded (best-effort, never blocks the receipt).
 */
function renderGenerationsStrip(currentId: string, generations: FleetRunGenerationSummary[]): string {
  const others = generations.filter(g => g.runId !== currentId && `intent:${g.deliveryId}` !== currentId);
  if (others.length === 0) return '';
  const items = others
    .map(g => {
      const href = `/fleet/runs/${encodeURIComponent(g.runId ?? `intent:${g.deliveryId}`)}`;
      const when = fmtUtc(g.finishedAt ?? g.queuedAt);
      return `<li><a href="${esc(href)}">generation ${esc(String(g.generation))} · ${esc(stateLabel(g.state))} · ${esc(when)}</a></li>`;
    })
    .join('');
  return `<details class="genstrip">
    <summary>${others.length} other review${others.length === 1 ? '' : 's'} of this PR</summary>
    <ul class="breakdown">${items}</ul>
  </details>`;
}

/**
 * Render one authoritative Fleet receipt from the same projection used by the
 * JSON operator API. The design intent is to keep visual evidence and deployed
 * markup on one code path rather than maintaining a screenshot-only facsimile.
 *
 * @param run - Logical admission plus eventual transcript header.
 * @param steps - Ordered, already-authorized transcript steps.
 * @param prContext - Live-fetched PR title/diff (best-effort; null when
 *   unavailable — the page still renders a complete, honest receipt).
 * @returns A complete, script-free HTML document.
 */
/**
 * One ship's newest raw session transcript, as a ready-to-render link. The
 * href already carries the viewer's own capability token (when they presented
 * one), so following it never widens exposure beyond the page itself.
 */
export interface FleetRunTranscriptLink {
  ship: string;
  attempt: number;
  href: string;
}

export interface FleetRunPrContext {
  meta: PrMeta | null;
  diff: PrDiff | null;
  generations: FleetRunGenerationSummary[];
  /** Raw pd-transcript.v1 links per ship (absent/empty ⇒ nothing captured). */
  transcripts?: FleetRunTranscriptLink[];
}

export function renderFleetRunReceiptPage(
  run: FleetRunProjection,
  steps: FleetRunStepRow[],
  prContext: FleetRunPrContext = { meta: null, diff: null, generations: [] },
): string {
  const distinctShips = [
    ...new Set((run.ships_csv ? run.ships_csv.split(',') : []).map(s => s.trim()).filter(Boolean)),
  ];
  const inputTokens = sumDetailField(steps, 'inputTokens');
  const outputTokens = sumDetailField(steps, 'outputTokens');
  const totalCostUsd = sumDetailField(steps, 'costUsd');
  const shipsLabel = distinctShips.length ? distinctShips.map(s => `pd-${s}`).join(', ') : '—';
  // Defense-in-depth: only ever link an https URL (a poisoned row must not
  // become a javascript: href). The repo/PR label is escaped inside the link.
  const prLabel = `${esc(run.repo_full_name)} <span class="pr">#${esc(run.pr_number)}</span>`;
  const prLink = /^https:\/\//.test(run.pr_url)
    ? `<a href="${esc(run.pr_url)}">${prLabel}</a>`
    : prLabel;
  const active = ['admitting', 'queued', 'running', 'retrying'].includes(run.logical_state);
  const retrying = run.logical_state === 'retrying';
  const timingLabel = active ? 'admitted' : 'finished';
  const timingValue = active ? run.queued_at : (run.finished_at ?? run.created_at);
  const expected = run.expected_finish_at == null ? 'calculating' : fmtUtc(run.expected_finish_at);
  const wallClock = run.ms > 0 ? fmtMs(run.ms) : active ? 'live' : '—';
  const lede = active
    ? 'Follow this review from durable admission through every delivery attempt and ship checkpoint. Queue timing is estimated; recorded steps and outcomes are receipts.'
    : "Every review bot's pass on this PR — the files it read, the problems it raised, and the calls it made — gathered in one verifiable receipt.";
  const accessNote = run.id.startsWith('intent:')
    ? 'Signed-in access follows the same GitHub repository permissions as the pull request.'
    : 'Anyone with this exact capability link can open the receipt; it shows the review, not your source.';
  const inner = `<main class="page">
    <div class="masthead">
      <span class="eyebrow">Port Daddy Fleet · review receipt</span>
      <h1 class="ko">What the fleet <span class="rec">found</span><span class="ko-over" aria-hidden="true">What the fleet <span class="rec">found</span></span></h1>
      <span class="lede">${esc(lede)}</span>
    </div>

    <div class="receipt-id">
      <div class="rid-top">
        <div class="rid-repo">${prLink}</div>
        <span class="badge ${badgeClass(run.logical_state)}"><span class="dot" aria-hidden="true"></span>${esc(stateLabel(run.logical_state))}</span>
      </div>
      ${prContext.meta ? `<div class="rid-title">${esc(prContext.meta.title)}</div>` : ''}
      <div class="rid-facts">
        <span class="fact"><span class="fk">head</span><code>${esc(run.head_sha.slice(0, 12))}</code></span>
        <span class="fact"><span class="fk">${esc(timingLabel)}</span><code>${esc(fmtUtc(timingValue))}</code></span>
        <span class="fact"><span class="fk">${retrying ? 'retry attempt' : 'attempts'}</span><code>${esc(run.attempt_count)}</code></span>
        ${active ? `<span class="fact"><span class="fk">expected by</span><code>${esc(expected)}</code></span>` : ''}
        <span class="fact"><span class="fk">ships</span><code>${esc(shipsLabel)}</code></span>
        ${
          prContext.meta
            ? `<span class="fact"><span class="fk">changed</span><code>${esc(prContext.meta.changedFiles)} file${prContext.meta.changedFiles === 1 ? '' : 's'}, +${esc(prContext.meta.additions)}/-${esc(prContext.meta.deletions)}</code></span>`
            : ''
        }
      </div>
      ${renderGenerationsStrip(run.id, prContext.generations)}
    </div>

    ${renderDiffPanel(prContext.diff, run.pr_url)}

    ${active ? '<div class="live-strip"><span class="pulse" aria-hidden="true"></span>Live run · this receipt refreshes every 5 seconds while work is active</div>' : ''}

    <div class="statrow">
      <div class="stat"><div class="k">Agents</div><div class="v mono">${distinctShips.length}</div></div>
      <div class="stat"><div class="k">Transcript steps</div><div class="v mono">${steps.length}</div></div>
      <div class="stat"><div class="k">Input tokens</div><div class="v mono">${esc(tokenTileValue(inputTokens))}</div></div>
      <div class="stat"><div class="k">Output tokens</div><div class="v mono">${esc(tokenTileValue(outputTokens))}</div></div>
      <div class="stat stat-money"><div class="k">Spend</div><div class="v mono">${totalCostUsd == null ? 'not reported' : esc(fmtUsd(totalCostUsd))}</div></div>
      <div class="stat"><div class="k">Wall-clock</div><div class="v mono">${esc(wallClock)}</div></div>
    </div>

    <div class="tx-head">
      <span class="eyebrow">Deliberation</span>
      <h2>${active ? 'Live progress' : 'The transcript'}</h2>
    </div>
    <p class="tx-sub">Read it top to bottom. Each bot chunks the diff, weighs it, and files what it found;
    the last rows are what it posted back to GitHub.</p>
    ${
      steps.length
        ? renderShips(
            steps,
            run.started_at ?? run.created_at,
            new Map((prContext.transcripts ?? []).map(t => [t.ship, t.href])),
          )
        : emptyTranscript(run)
    }

    <footer class="receipt-foot">Run <code>${esc(run.id)}</code> · delivery <code>${esc(run.delivery_id)}</code>.
    ${esc(accessNote)}</footer>
  </main>`;
  return shell(`${run.repo_full_name} PR #${run.pr_number} — Port Daddy Fleet`, inner);
}

/**
 * Best-effort live context beyond the transcript: the PR's title/size/diff
 * (fetched via the GitHub App installation, the same zero-trust mechanism
 * every other GitHub read on the relay uses) and every other review
 * generation of this PR. NEVER throws — a GitHub hiccup, an unconfigured App,
 * or a pre-migration D1 without `fleet_run_intents` all degrade their own
 * section to an honest empty state; the transcript itself is never at risk.
 */
async function gatherPrContext(env: Env, run: FleetRunProjection): Promise<FleetRunPrContext> {
  const generations = run.repo_full_name
    ? await listFleetRunGenerationsForPr(env.DB, run.repo_full_name, run.pr_number).catch(() => [])
    : [];
  const [owner, repo] = (run.repo_full_name ?? '').split('/');
  if (!owner || !repo || !env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY || !env.KV) {
    return { meta: null, diff: null, generations };
  }
  try {
    const token = await getRepoToken(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, owner, repo, env.KV);
    const [meta, diff] = await Promise.all([
      getPrMeta(owner, repo, run.pr_number, token),
      getPrDiff(owner, repo, run.pr_number, token),
    ]);
    return { meta, diff, generations };
  } catch {
    return { meta: null, diff: null, generations };
  }
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
    const found = await getFleetRunProjectionWithSteps(env.DB, runId);
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

    const active = ['admitting', 'queued', 'running', 'retrying'].includes(found.run.logical_state);
    const prContext = await gatherPrContext(env, found.run);
    prContext.transcripts = await listTranscriptLinks(env, request, runId);
    return htmlResponse(renderFleetRunReceiptPage(found.run, found.steps, prContext), 200, active ? 5 : null);
  } catch {
    return noticePage(
      'Error — Port Daddy Fleet',
      'Temporarily unavailable',
      'The transcript store could not be read. Try again shortly.',
      500,
    );
  }
}

// ── Raw session transcripts (pd-transcript.v1; docs/FLEET-SESSION-TRANSCRIPTS.md)

/** One `fleet_run_transcripts` index row, as the read path consumes it. */
interface TranscriptIndexRow {
  ship: string;
  attempt: number;
  r2_key: string;
}

/** A ship name as the executor mints them — path-safe by construction. */
const TRANSCRIPT_SHIP_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

/**
 * Read a run's transcript index rows, newest attempt first per ship.
 *
 * DESIGN: best-effort by contract — a pre-migration D1 (missing table) or a
 * transient failure returns `[]` and the run page simply renders no links,
 * because the transcript layer is evidence the page ADDS, never a dependency
 * it can fail on (same posture as gatherPrContext's live GitHub reads).
 */
async function listTranscriptIndexRows(
  db: D1Database,
  runId: string,
): Promise<TranscriptIndexRow[]> {
  try {
    const res = await db
      .prepare(
        `SELECT ship, attempt, r2_key FROM fleet_run_transcripts
         WHERE run_id = ? ORDER BY ship ASC, attempt DESC`,
      )
      .bind(runId)
      .all<TranscriptIndexRow>();
    return res.results ?? [];
  } catch {
    return [];
  }
}

/**
 * Build the run page's per-ship raw-transcript links (newest attempt wins).
 *
 * WHY the token rides along: the transcript route enforces the same capability
 * scheme as the page itself, so a viewer who arrived via `?t=…` must carry
 * that token onward — while a bearer/session viewer gets plain hrefs that the
 * route authorizes through their own credentials. Either way, following a
 * link never grants more than the page the viewer is already reading.
 */
async function listTranscriptLinks(
  env: Env,
  request: Request,
  runId: string,
): Promise<FleetRunTranscriptLink[]> {
  const rows = await listTranscriptIndexRows(env.DB, runId);
  if (rows.length === 0) return [];
  const t = new URL(request.url).searchParams.get('t');
  const suffix = t ? `?t=${encodeURIComponent(t)}` : '';
  const newest = new Map<string, TranscriptIndexRow>();
  for (const row of rows) if (!newest.has(row.ship)) newest.set(row.ship, row);
  return [...newest.values()].map(row => ({
    ship: row.ship,
    attempt: row.attempt,
    // The HTML viewer, not the raw object: the viewer is the human surface and
    // itself links the raw .jsonl download (docs/FLEET-SESSION-TRANSCRIPTS.md
    // Phase 2). Machine consumers hit the .jsonl route directly.
    href:
      `/fleet/runs/${encodeURIComponent(runId)}/transcript/` +
      `${encodeURIComponent(row.ship)}${suffix}`,
  }));
}

/**
 * The ONE authorization rule for everything under /fleet/runs/:id — the HTML
 * receipt, the transcript viewer, and the raw .jsonl route all accept exactly
 * the same three credentials: operator bearer, the run's `?t=<hmac>` capability
 * token, or a signed-in user GitHub says can read the run's repo. Shared so the
 * surfaces can never drift apart on who may see a run's deliberations.
 *
 * @param request The incoming request (bearer header / `t` query / cookie).
 * @param env Worker bindings + secrets.
 * @param runId The run whose material is being requested.
 * @returns true iff this viewer may see the run — false is rendered as 404.
 */
async function authorizedForRun(request: Request, env: Env, runId: string): Promise<boolean> {
  if (await hasTokenAuth(request, env, runId)) return true;
  const session = await resolveSession(request, env);
  if (!session) return false;
  const found = await getFleetRunProjectionWithSteps(env.DB, runId);
  const [owner, repo] = (found?.run.repo_full_name ?? '').split('/');
  if (!owner || !repo) return false;
  return userCanReadRepo(env, session, owner, repo);
}

/**
 * GET /fleet/runs/:id/transcript/:ship.jsonl — stream one ship's raw
 * pd-transcript.v1 capture from R2, under EXACTLY the run page's own
 * authorization (operator bearer, capability token, or a signed-in user with
 * GitHub read access to the run's repo). `?attempt=N` selects an attempt;
 * default is the newest. 404 is the only failure the outside ever sees —
 * missing run, missing transcript, bad ship name, and no access are
 * deliberately indistinguishable, matching the page's own posture.
 */
export async function handleFleetRunTranscript(
  request: Request,
  env: Env,
  runId: string,
  ship: string,
): Promise<Response> {
  const notFound = () =>
    new Response(JSON.stringify({ error: 'not found' }) + '\n', {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  if (!RUN_ID_RE.test(runId) || runId.includes('..')) return notFound();
  if (!TRANSCRIPT_SHIP_RE.test(ship)) return notFound();
  if (!env.TRANSCRIPTS) return notFound();
  try {
    if (!(await authorizedForRun(request, env, runId))) return notFound();
    const rows = (await listTranscriptIndexRows(env.DB, runId)).filter(r => r.ship === ship);
    if (rows.length === 0) return notFound();
    const wanted = new URL(request.url).searchParams.get('attempt');
    const row = wanted
      ? rows.find(r => String(r.attempt) === wanted)
      : rows[0]; // rows are newest-attempt-first
    if (!row) return notFound();
    const object = await env.TRANSCRIPTS.get(row.r2_key);
    if (!object) return notFound();
    return new Response(object.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
        'Content-Disposition': `inline; filename="${runId.replace(/[^A-Za-z0-9._-]/g, '_')}.${ship}.${row.attempt}.jsonl"`,
      },
    });
  } catch {
    return notFound();
  }
}

// ── pd-transcript.v1 HTML viewer (Phase 2 — docs/FLEET-SESSION-TRANSCRIPTS.md)

/** One parsed pd-transcript.v1 envelope, exactly as the executor wrote it. */
interface ViewerTurn {
  v: number;
  seq: number;
  phase: string;
  chunk: { index: number; count: number } | null;
  kind: string;
  model: string;
  ts: number;
  latencyMs: number | null;
  usage: { prompt: number; completion: number } | null;
  costUsd: number | null;
  content: Array<{ type: string; text: string }>;
  sysRef: string | null;
  truncated: boolean;
}

/**
 * Parse a pd-transcript.v1 JSONL body TOLERANTLY: a malformed line or an
 * envelope from an unknown major version is counted, never thrown — the viewer
 * must render whatever forensic material survives, with an honest notice about
 * what did not, because a transcript is read precisely when something already
 * went wrong.
 */
function parseTranscriptJsonl(body: string): {
  turns: ViewerTurn[];
  badLines: number;
  unsupportedVersion: number;
} {
  const turns: ViewerTurn[] = [];
  let badLines = 0;
  let unsupportedVersion = 0;
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    try {
      const t = JSON.parse(line) as ViewerTurn;
      if (typeof t !== 'object' || t === null || typeof t.seq !== 'number') {
        badLines += 1;
        continue;
      }
      if (t.v !== 1) {
        unsupportedVersion += 1;
        continue;
      }
      turns.push(t);
    } catch {
      badLines += 1;
    }
  }
  return { turns, badLines, unsupportedVersion };
}

/** Phase chip text: `MAP 3/7` for chunked turns, `PLAN`/`GATE`/… otherwise. */
function turnPhaseLabel(t: ViewerTurn): string {
  const base = String(t.phase ?? '').toUpperCase();
  return t.chunk ? `${base} ${t.chunk.index + 1}/${t.chunk.count}` : base;
}

/** Render one turn card — anchored `#t{seq}`, no scripts, everything escaped. */
function renderTurnCard(t: ViewerTurn, firstSysSeqByRef: Map<string, number>): string {
  const kind = ['system', 'user', 'assistant', 'error'].includes(t.kind) ? t.kind : 'assistant';
  const text = t.content?.map(c => (typeof c?.text === 'string' ? c.text : '')).join('') ?? '';
  const usage = t.usage
    ? `<span>${t.usage.prompt.toLocaleString('en-US')} in / ${t.usage.completion.toLocaleString('en-US')} out</span>`
    : '';
  const cost = typeof t.costUsd === 'number' && t.costUsd > 0 ? `<span>${fmtUsd(t.costUsd)}</span>` : '';
  const latency = typeof t.latencyMs === 'number' ? `<span>${(t.latencyMs / 1000).toFixed(1)}s</span>` : '';
  const truncated = t.truncated ? `<span class="turn-badge">TRUNCATED</span>` : '';

  let body: string;
  if (kind === 'system' && t.sysRef && text === '') {
    // Dedup repeat: the full prompt lives on the first turn carrying this hash.
    const firstSeq = firstSysSeqByRef.get(t.sysRef);
    body =
      firstSeq !== undefined
        ? `<div class="turn-sysref">same system prompt as <a href="#t${firstSeq}">#t${firstSeq}</a></div>`
        : `<div class="turn-sysref">system prompt body deduplicated (${esc(t.sysRef)})</div>`;
  } else if (kind === 'system' || kind === 'user') {
    // Prompts are bulky and usually context the reader already knows — folded
    // by default, one keypress-free click away. <details> needs no scripts.
    const label = kind === 'system' ? 'system prompt' : 'user message';
    body = `<details><summary>${label} · ${text.length.toLocaleString('en-US')} chars</summary><pre>${esc(text)}</pre></details>`;
  } else {
    body = `<pre>${esc(text)}</pre>`;
  }

  return `<article class="turn turn-${kind}" id="t${t.seq}">
  <div class="turn-head">
    <span class="turn-kind">${kind.toUpperCase()}</span>
    <span class="turn-phase">${esc(turnPhaseLabel(t))}</span>
    <span class="turn-model"><code>${esc(t.model ?? '')}</code></span>
    ${usage}${cost}${latency}${truncated}
    <span class="t" title="+unix ${t.ts}">${fmtClockUtc(t.ts)}</span>
    <a class="turn-anchor" href="#t${t.seq}">#t${t.seq}</a>
  </div>
  <div class="turn-body">${body}</div>
</article>`;
}

/**
 * Render the full transcript viewer page: masthead (run link, attempt chips,
 * aggregate spend, raw download) + the turn-card timeline. Pure server-side
 * HTML under the run page's no-script CSP — model output renders as escaped
 * text, folding uses <details>, permalinks are plain anchors. Exported for
 * render tests.
 */
export function renderTranscriptViewerPage(opts: {
  runId: string;
  ship: string;
  attempt: number;
  attempts: number[];
  turns: ViewerTurn[];
  badLines: number;
  unsupportedVersion: number;
  tokenSuffix: string;
}): string {
  const { runId, ship, attempt, attempts, turns, tokenSuffix } = opts;
  const base = `/fleet/runs/${encodeURIComponent(runId)}/transcript/${encodeURIComponent(ship)}`;
  const firstSysSeqByRef = new Map<string, number>();
  for (const t of turns) {
    if (t.kind === 'system' && t.sysRef && !firstSysSeqByRef.has(t.sysRef) && (t.content?.length ?? 0) > 0) {
      firstSysSeqByRef.set(t.sysRef, t.seq);
    }
  }
  const models = [...new Set(turns.filter(t => t.kind === 'assistant').map(t => t.model))];
  const promptTokens = turns.reduce((n, t) => n + (t.usage?.prompt ?? 0), 0);
  const completionTokens = turns.reduce((n, t) => n + (t.usage?.completion ?? 0), 0);
  const costUsd = turns.reduce((n, t) => n + (t.costUsd ?? 0), 0);
  const attemptChips = attempts
    .map(a =>
      a === attempt
        ? `<span class="tvx-attempt-on">attempt ${a}</span>`
        : `<a href="${base}?attempt=${a}${tokenSuffix ? `&t=${esc(tokenSuffix)}` : ''}">attempt ${a}</a>`,
    )
    .join('');
  const lost =
    opts.badLines || opts.unsupportedVersion
      ? `<div class="tvx-notice">${opts.badLines} malformed line(s) and ${opts.unsupportedVersion} unsupported-version envelope(s) were skipped — the raw download below carries every byte.</div>`
      : '';
  const inner = `<main class="tvx">
  <div class="tvx-mast">
    <h1>pd-${esc(ship)} — raw session transcript</h1>
    <div class="tvx-facts">
      <span>run <b>${esc(runId)}</b></span>
      <span><b>${turns.length}</b> turns</span>
      <span>models <b>${esc(models.join(', ') || '—')}</b></span>
      <span><b>${promptTokens.toLocaleString('en-US')}</b> in / <b>${completionTokens.toLocaleString('en-US')}</b> out tokens</span>
      ${costUsd > 0 ? `<span>spend <b>${fmtUsd(costUsd)}</b></span>` : ''}
    </div>
    <div class="tvx-links">
      <a href="/fleet/runs/${encodeURIComponent(runId)}${tokenSuffix ? `?t=${esc(tokenSuffix)}` : ''}">← run receipt</a>
      ${attemptChips}
      <a href="${base}.jsonl?attempt=${attempt}${tokenSuffix ? `&t=${esc(tokenSuffix)}` : ''}">raw pd-transcript.v1 (JSONL) ↓</a>
    </div>
  </div>
  ${lost}
  ${turns.map(t => renderTurnCard(t, firstSysSeqByRef)).join('\n')}
</main>`;
  return shell(`pd-${ship} transcript — ${runId}`, inner);
}

/**
 * GET /fleet/runs/:id/transcript/:ship — the human-facing transcript viewer,
 * under EXACTLY the run page's authorization (see {@link authorizedForRun});
 * every failure is the same 404 the receipt and the .jsonl route give. Reads
 * the newest attempt by default, `?attempt=N` selects an earlier one; the raw
 * .jsonl route stays the machine surface.
 */
export async function handleFleetRunTranscriptPage(
  request: Request,
  env: Env,
  runId: string,
  ship: string,
): Promise<Response> {
  if (!RUN_ID_RE.test(runId) || runId.includes('..')) return notFoundPage();
  if (!TRANSCRIPT_SHIP_RE.test(ship)) return notFoundPage();
  if (!env.TRANSCRIPTS) return notFoundPage();
  try {
    if (!(await authorizedForRun(request, env, runId))) return notFoundPage();
    const rows = (await listTranscriptIndexRows(env.DB, runId)).filter(r => r.ship === ship);
    if (rows.length === 0) return notFoundPage();
    const url = new URL(request.url);
    const wanted = url.searchParams.get('attempt');
    const row = wanted ? rows.find(r => String(r.attempt) === wanted) : rows[0];
    if (!row) return notFoundPage();
    const object = await env.TRANSCRIPTS.get(row.r2_key);
    if (!object) return notFoundPage();
    const parsed = parseTranscriptJsonl(await object.text());
    const html = renderTranscriptViewerPage({
      runId,
      ship,
      attempt: row.attempt,
      attempts: rows.map(r => r.attempt),
      turns: parsed.turns,
      badLines: parsed.badLines,
      unsupportedVersion: parsed.unsupportedVersion,
      tokenSuffix: url.searchParams.get('t') ?? '',
    });
    return htmlResponse(html, 200);
  } catch {
    return notFoundPage();
  }
}
