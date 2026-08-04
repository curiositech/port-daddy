/**
 * apps/relay/src/account-page.ts — the storefront login + account surfaces
 * (ADR-0101 Phase 1). Server-rendered HTML, no client JS, matching the ch20
 * Story-Linework design (docs/design/2026-07-05-surface-redesign/mockups-ch20/
 * {login,account}.html): warm substrate, 2px ink enclosure / 1.5px linework,
 * zero radius, zero elevation, the cobalt "storefront" accent, the story
 * palette, IBM Plex + Recursive-CASL for the one play em-word.
 *
 * HONESTY (repo law: no Potemkin). Only sections with real backing data render
 * live: the IDENTITY plate (the users row) and the LEAVING strip (real
 * /account/export + /account/delete). Devices, Receipts, Harbors, and Plan have
 * no per-user backing yet (no user_tokens table; fleet_runs are not user-scoped;
 * no per-user plan rows), so they render the design's own "empty states teach"
 * (unified-design-language law 5) — never fabricated rows. As each backend
 * lands, swap its empty state for the real query.
 *
 * The manual theme toggle from the mockups is intentionally dropped: it needs
 * client JS, and this page ships under a script-free CSP. `prefers-color-scheme`
 * still themes the page in both directions.
 */

import type { Env } from './types.js';
import type { UserRow } from './db.js';
import { resolveSession, type ResolvedSession } from './auth-github.js';

/** Minimal HTML-escape for interpolated user data (XSS guard). */
function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlPage(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Public storefront pages: inline styles + Google Fonts, but no scripts,
      // no framing, no third-party anything else.
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; img-src 'self' https://avatars.githubusercontent.com data:; " +
        "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// ── shared design tokens + primitives (ch20 story-linework, trimmed) ─────────
// HEAD + TOKENS are exported for sibling storefront pages (runs-page.ts) so the
// story-linework token block stays single-sourced across /login, /account and
// /account/runs.
export const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Recursive:CASL,slnt,wght@1,-8,400..800&display=swap" rel="stylesheet">`;

export const TOKENS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;border-radius:0}
:root,:root[data-theme="light"]{
  --surface-base:#f2eee6;--surface-raised:#f7f3eb;--surface-strong:#e9e2d5;
  --text-primary:#121212;--text-secondary:#403b34;--text-muted:#47423a;--text-ghost:#98928a;
  --cobalt:#003fb8;--teal:#006b5f;--health:#1f7a4d;--amber:#a66f00;--error:#bf2f2f;
  --violet:#933fa5;--rust:#7a4514;--gold:#666a00;
  --hair:rgba(18,18,18,.14);--hair-strong:rgba(18,18,18,.34);--border-strong:#121212;
  --surface-card:#e9e2d5;--on-accent:#fbf7ef;}
:root{--cobalt-slab:#003fb8;--gold-slab:#666a00;--lime:#cad900;--cream:#fbf7ef;--ink:#17191d;
  --rust-slab:#7a4514;--flag-white:#fbf7ef;
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
button,input{font:inherit;color:inherit}
`;

// ══════════════════════════════════════════════════════════════════════════
//  LOGIN PAGE  — GET /login  (public)
// ══════════════════════════════════════════════════════════════════════════
const LOGIN_CSS = `
${TOKENS}
.site-header{position:sticky;top:0;z-index:50;display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:14px 40px;background:var(--surface-base);border-bottom:2px solid var(--border-strong)}
.sh-brand{display:flex;align-items:baseline;gap:10px;font-weight:700;font-size:17px;letter-spacing:-.01em;color:var(--text-primary);text-decoration:none}
.sh-mark{color:var(--cobalt);font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:19px}
.sh-status{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:500;color:var(--text-muted)}
.sh-status b{color:var(--health);font-weight:700}
.page{max-width:1240px;margin:0 auto;padding:0 40px}
.split{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:56px;padding:30px 0 88px;align-items:start}
/* slug hoist — the route spelled in ICS signal flags, over the cobalt slab */
.slug-hoist{display:flex;gap:7px;align-items:center;padding:22px 0 0;position:relative;z-index:1}
.slug-hoist .route{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:700;letter-spacing:.08em;color:var(--flag-white);margin-right:8px}
.fl{display:inline-block;width:26px;height:19px;border:1px solid var(--hair-strong);--fw:var(--flag-white);--c:var(--cobalt-slab);--r:var(--rust-slab);--y:var(--lime)}
.fl-lima{background:conic-gradient(var(--ink) 0 25%,var(--y) 25% 50%,var(--ink) 50% 75%,var(--y) 75%)}
.fl-oscar{background:linear-gradient(to top right,var(--r) 0 50%,var(--y) 50%)}
.fl-golf{background:repeating-linear-gradient(to right,var(--y) 0 16.667%,var(--c) 16.667% 33.333%)}
.fl-india{background:radial-gradient(circle at 50% 50%,var(--ink) 0 30%,transparent calc(30% + 0.5px)),var(--y)}
.fl-november{background:repeating-conic-gradient(var(--c) 0 25%,var(--fw) 25% 50%) top left/50% 50%}
/* the cobalt knockout slab (rule 4): a Vignelli block bleeds off the left edge
   and passes through the headline; glyphs flip to cream at the block edge, and
   the slab rises to sit behind the slug-hoist + eyebrow. */
.ko{position:relative;z-index:0}
.ko::before{content:"";position:absolute;z-index:-1;left:-100vw;right:calc(100% - var(--ko-r));top:calc(-1 * var(--ko-up,500px));bottom:calc(100% - var(--ko-b));background:var(--cobalt-slab)}
.ko .ko-over{position:absolute;inset:0;color:var(--flag-white);pointer-events:none;clip-path:inset(calc(-1 * var(--ko-up,500px)) calc(100% - var(--ko-r)) calc(100% - var(--ko-b)) -100vw)}
.ko .ko-over .accent{color:var(--flag-white)!important}
.hero-eyebrow{position:relative;z-index:1;color:var(--flag-white);margin-bottom:14px;display:block}
h1.hero{font-size:clamp(40px,5vw,64px);font-weight:700;line-height:1.02;letter-spacing:-.035em;max-width:15ch;margin-bottom:34px}
h1.hero .accent{color:var(--cobalt)}
/* QUEBEC — "I request free pratique": the big flag holding the pairing masthead */
.pair{margin-top:22px;border:2px solid var(--border-strong)}
.pair-mast{background:var(--lime);color:var(--ink);min-height:132px;padding:18px 22px 16px;display:flex;flex-direction:column;justify-content:flex-end;gap:8px}
.pair-mast .flag-name{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--ink)}
.pair-mast h3{font-size:20px;font-weight:700;letter-spacing:-.015em;line-height:1.15}
.pair-body{padding:18px 22px 20px;background:var(--surface-card)}
.pair-body .soon-label{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);border:1px solid var(--hair-strong);padding:3px 9px;margin-bottom:10px}
.pair-body p{font-size:14px;color:var(--text-secondary);line-height:1.6}
.pair-body .cmd{font-family:"IBM Plex Mono",monospace;font-size:13.5px;color:var(--teal);font-weight:600}
.honesty{background:var(--surface-card);border:1px solid var(--hair);padding:20px 22px;max-width:40rem;box-shadow:inset 3px 0 0 var(--teal)}
.honesty .h-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--teal);margin-bottom:8px}
.honesty p{font-size:16.5px;line-height:1.62;color:var(--text-primary)}
.proof{margin-top:36px;max-width:40rem;position:relative;padding-top:14px}
.proof::before{content:"";position:absolute;top:0;left:0;width:64px;height:1px;background:var(--hair-strong)}
.p-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--text-muted);margin-bottom:4px}
.proof-row{display:grid;grid-template-columns:8.5rem 1fr;gap:16px;padding:13px 0;border-top:1px solid var(--hair);align-items:baseline}
.proof-row:first-of-type{border-top:1px solid var(--border-strong)}
.proof-row:last-of-type{border-bottom:1px solid var(--border-strong)}
.proof-key{font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:700;letter-spacing:.06em;color:var(--cobalt)}
.proof-body{font-size:15px;color:var(--text-primary);line-height:1.55}
.proof-body .path{font-family:"IBM Plex Mono",monospace;font-size:13.5px;color:var(--text-muted)}
.door{border:2px solid var(--border-strong);background:var(--surface-raised)}
.door-head{border-bottom:2px solid var(--border-strong);padding:14px 22px;display:flex;justify-content:space-between;align-items:baseline}
.door-head h2{font-size:22px;font-weight:700;letter-spacing:-.02em}
.door-head .num{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;color:var(--text-muted)}
.door-body{padding:22px}
.btn{display:block;width:100%;border:2px solid var(--border-strong);font-family:"IBM Plex Mono",monospace;font-size:15px;font-weight:700;letter-spacing:.02em;padding:13px 16px;cursor:pointer;text-align:center;text-decoration:none}
.btn-primary{background:var(--cobalt);color:var(--on-accent)}
.btn-primary:hover{background:var(--border-strong);color:var(--surface-base)}
.sub-caption{display:block;margin-top:8px;font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--text-muted);text-align:center}
.soon{margin-top:22px;padding-top:18px;border-top:1px solid var(--hair)}
.soon .soon-label{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);border:1px solid var(--hair-strong);padding:3px 9px;margin-bottom:10px}
.soon p{font-size:14px;color:var(--text-secondary);line-height:1.6}
.soon .cmd{font-family:"IBM Plex Mono",monospace;font-size:13.5px;color:var(--teal);font-weight:600}
.door-foot{border-top:2px solid var(--border-strong);padding:18px 22px}
.door-foot .warn{font-size:15px;line-height:1.58;margin-bottom:12px}
.door-foot nav{font-size:14.5px;font-weight:600;display:flex;gap:10px;flex-wrap:wrap}
footer.creed{border-top:2px solid var(--border-strong);background:var(--surface-raised)}
.creed-inner{max-width:1240px;margin:0 auto;display:grid;grid-template-columns:repeat(3,1fr)}
.plaque{padding:22px 16px;text-align:center;font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border-left:2px solid var(--border-strong)}
.plaque:first-child{border-left:none}
@media (max-width:980px){.site-header{padding:12px 20px;flex-wrap:wrap}.sh-status{display:none}.page{padding:0 20px}.split{grid-template-columns:1fr;gap:44px;padding:24px 0 64px}h1.hero{max-width:18ch}}
@media (max-width:520px){.proof-row{grid-template-columns:1fr;gap:3px}.creed-inner{grid-template-columns:1fr}.plaque{border-left:none;border-top:2px solid var(--border-strong)}.plaque:first-child{border-top:none}}
`;

/** GET /login — the public storefront sign-in page. */
export function renderLoginPage(): string {
  return `<!DOCTYPE html><html lang="en"><head><title>Port Daddy — Sign in</title>${HEAD}<style>${LOGIN_CSS}</style></head><body>
<header class="site-header">
  <a class="sh-brand" href="/login"><span class="sh-mark" aria-hidden="true">pd</span>Port Daddy</a>
  <p class="sh-status">accounts.portdaddy.dev&ensp;/&ensp;<b>daemon optional</b></p>
</header>
<main class="page">
  <section class="split">
    <div aria-labelledby="headline">
      <div class="slug-hoist" aria-label="/login spelled in signal flags">
        <span class="route">/login</span>
        <i class="fl fl-lima" title="L" aria-hidden="true"></i><i class="fl fl-oscar" title="O" aria-hidden="true"></i><i class="fl fl-golf" title="G" aria-hidden="true"></i><i class="fl fl-india" title="I" aria-hidden="true"></i><i class="fl fl-november" title="N" aria-hidden="true"></i>
      </div>
      <span class="eyebrow hero-eyebrow">Port Daddy / Accounts</span>
      <h1 id="headline" class="hero ko" style="--ko-r:340px;--ko-b:100%;">Sign in to the <span class="accent rec">control plane.</span><span class="ko-over" aria-hidden="true">Sign in to the <span class="accent rec">control plane.</span></span></h1>
      <div class="honesty">
        <p class="h-label">Local-first</p>
        <p>Port Daddy works without an account. Your daemon, agents, and transcripts stay on your machine. An account adds what only a server can: <strong>signed downloads, device pairing, receipts you can share, team harbors.</strong></p>
      </div>
      <div class="proof">
        <p class="p-label">What the server can prove</p>
        <div class="proof-row"><span class="proof-key">RECEIPTS</span><span class="proof-body">Verifiable URLs for every fleet run <span class="path">· portdaddy.dev/fleet/runs/…</span></span></div>
        <div class="proof-row"><span class="proof-key">PAIRING</span><span class="proof-body">4-digit code, echoed on your daemon</span></div>
        <div class="proof-row"><span class="proof-key">KEYS</span><span class="proof-body">The website never holds your private keys</span></div>
      </div>
    </div>
    <div aria-labelledby="door-title">
      <div class="door">
        <div class="door-head"><h2 id="door-title">Sign in</h2><span class="num">AUTH / 01</span></div>
        <div class="door-body">
          <a class="btn btn-primary" href="/auth/github/login">Continue with GitHub</a>
          <span class="sub-caption">OIDC — 1-hour session, httponly</span>
          <div class="pair">
            <div class="pair-mast" title="Quebec — I request free pratique; permission to enter">
              <span class="flag-name">Quebec — I request free pratique</span>
              <h3>Pair this browser to a daemon</h3>
            </div>
            <div class="pair-body">
              <span class="soon-label">Coming soon</span>
              <p>A 4-digit code will appear on both screens — in FleetBar → <span class="cmd">Pair this device</span>, or <span class="cmd">pd account pair</span>. Magic-link email too. GitHub is the only live path today.</p>
            </div>
          </div>
        </div>
        <div class="door-foot">
          <p class="warn"><strong>No custodial recovery</strong> — your account key lives in your OS keychain. Lose it and the account is dead by design.</p>
          <nav aria-label="Account footer links"><a href="https://portdaddy.dev">Home</a></nav>
        </div>
      </div>
    </div>
  </section>
</main>
<footer class="creed"><div class="creed-inner">
  <p class="plaque">Local-first</p><p class="plaque">Receipts over promises</p><p class="plaque">No keys server-side</p>
</div></footer>
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════
//  ACCOUNT PAGE  — GET /account  (session-gated)
// ══════════════════════════════════════════════════════════════════════════
const ACCOUNT_CSS = `
${TOKENS}
.shell{display:grid;grid-template-columns:236px 1fr;max-width:1240px;margin:0 auto;min-height:100vh}
.rail{border-right:2px solid var(--border-strong);display:flex;flex-direction:column;position:sticky;top:0;align-self:start;min-height:100vh;padding:26px 0 18px}
.rail-brand{display:flex;align-items:baseline;gap:9px;padding:0 22px 22px}
.rail-brand .mark{font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:19px;color:var(--cobalt)}
.rail-brand .word{font-weight:700;font-size:17px;letter-spacing:-.01em}
.rail nav{flex:1;padding-top:10px;position:relative}
.rail nav .eyebrow{display:block;padding:10px 22px 8px}
.rail nav a{display:block;padding:8px 22px;font-size:15px;font-weight:500;color:var(--text-primary);text-decoration:none}
.rail nav a:hover{color:var(--cobalt)}
.rail nav a[aria-current="page"]{font-weight:700;box-shadow:inset var(--lw-stripe) 0 0 var(--cobalt)}
.rail-foot{padding:16px 22px 0;position:relative}
.rail-foot::before{content:"";position:absolute;top:0;left:22px;width:64px;height:1px;background:var(--hair-strong)}
.rail-foot .who{display:block;font-family:"IBM Plex Mono",monospace;font-size:13.5px;color:var(--text-secondary);margin-bottom:6px;word-break:break-all}
.rail-foot button{font-size:14px;font-weight:600;color:var(--cobalt);text-decoration:underline;text-underline-offset:3px;padding:0;background:none;border:none;cursor:pointer}
.content{padding:40px 56px 80px;min-width:0}
.page-head h1{font-size:clamp(30px,3.4vw,42px);font-weight:700;line-height:1.05;letter-spacing:-.03em}
.page-head .caption{margin-top:10px;max-width:52ch}
section.sect{padding-top:56px;margin-top:56px;position:relative}
section.sect.first{padding-top:32px;margin-top:20px}
section.sect.first::before{content:none}
section.sect::before{content:"";position:absolute;top:0;left:0;right:0;height:var(--lw-weight);background-image:linear-gradient(to right,transparent 0 32%,var(--border-strong) 32% 68%,transparent 68% 100%)}
.sect-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px}
.sect-head h2{font-size:24px;font-weight:700}
.sect-head .eyebrow{margin-bottom:6px;display:block}
.identity-plate{background:var(--surface-card);border:1px solid var(--hair);padding:26px 28px;display:flex;gap:20px;align-items:flex-start}
.identity-plate .avatar{width:56px;height:56px;border:1px solid var(--hair-strong);flex:none}
.identity-plate .name{font-size:30px;font-weight:700;letter-spacing:-.025em;line-height:1.1}
.chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
.chip{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;padding:5px 11px;border:1px solid var(--hair-strong);color:var(--text-secondary)}
.chip-identity{border-color:var(--violet);color:var(--violet)}
.chip-oidc{border-color:var(--teal);color:var(--teal);font-weight:700}
.chip-unverified{border-color:var(--amber);color:var(--amber);font-weight:700}
.oidc-row{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-top:16px;padding-top:12px;box-shadow:inset 0 1px 0 var(--hair)}
.oidc-row .provider{font-weight:700;font-size:15px}
.oidc-row .detail{font-family:"IBM Plex Mono",monospace;font-size:13.5px;color:var(--text-muted)}
.empty{border:1px dashed var(--hair-strong);background:transparent;padding:22px 24px}
.empty .e-title{font-weight:700;font-size:16px}
.empty p{font-size:14.5px;color:var(--text-secondary);line-height:1.6;margin-top:6px;max-width:64ch}
.empty .cmd{font-family:"IBM Plex Mono",monospace;font-size:13.5px;color:var(--teal);font-weight:600}
/* KILO — "I wish to communicate with you": the Devices pairing flag (rule 7) */
.flag-kilo{display:inline-block;width:28px;height:20px;flex:none;border:1px solid var(--hair-strong);align-self:center;background:linear-gradient(to right,var(--lime) 0 50%,var(--cobalt-slab) 50% 100%)}
.flag-title{display:flex;align-items:center;gap:12px}
.flag-mean{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)}
/* Receipts — the page's one color zone: a cobalt-slab masthead whose glyphs
   flip to cream at the block edge (knockout). */
.zone-mast{margin-bottom:24px}
.zone-mast h2{font-size:26px;font-weight:700;line-height:1.15}
.ko{position:relative;z-index:0;display:inline-block;--ko-r:64%}
.ko::before{content:"";position:absolute;z-index:-1;left:-56px;right:calc(100% - var(--ko-r));top:-13px;bottom:-13px;background:var(--cobalt-slab)}
.ko .ko-over{position:absolute;inset:0;color:var(--cream);pointer-events:none;clip-path:inset(-13px calc(100% - var(--ko-r)) -13px -56px)}
.zone-mast .caption{display:block;margin-top:20px;max-width:62ch}
/* prominent door into the per-account runs index (/account/runs — real page) */
.runs-cta{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:14.5px;font-weight:700;letter-spacing:.02em;padding:12px 20px;border:2px solid var(--border-strong);background:var(--cobalt-slab);color:var(--cream);text-decoration:none;margin-bottom:18px}
.runs-cta:hover{background:var(--border-strong);color:var(--surface-base)}
/* free-tier upsell strip (ADR-0116): shown when none of the operator's GitHub
   App installations has a credit_ledger row yet. Amber stripe = advisory, not
   an error; the whole strip is one door into /account/billing. */
.upsell{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-top:20px;padding:14px 18px;border:2px solid var(--border-strong);box-shadow:inset var(--lw-stripe) 0 0 var(--amber);text-decoration:none;color:var(--text-primary)}
.upsell:hover{background:var(--surface-raised);color:var(--text-primary)}
.upsell .u-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--amber);flex:none}
.upsell .u-body{font-size:14.5px;line-height:1.55;color:var(--text-secondary)}
.upsell .u-body b{font-family:"IBM Plex Mono",monospace;font-size:13.5px;font-weight:700;color:var(--cobalt);white-space:nowrap}
/* prominent door into the MERCY report card (/account/mercy — real page) */
.mercy-cta{display:inline-block;margin-top:18px;font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:700;letter-spacing:.02em;padding:10px 18px;border:2px solid var(--border-strong);color:var(--text-primary);text-decoration:none;box-shadow:inset var(--lw-stripe) 0 0 var(--health)}
.mercy-cta:hover{background:var(--border-strong);color:var(--surface-base)}
/* INTERRUPTIONS banner — agents are BLOCKED on a human. Red, loud, first. */
.interrupt-banner{display:block;margin-top:22px;border:2px solid var(--error);background:var(--surface-card);padding:16px 20px;text-decoration:none;color:var(--text-primary);box-shadow:inset var(--lw-stripe) 0 0 var(--error)}
.interrupt-banner:hover{background:var(--error);color:var(--surface-base)}
.interrupt-banner:hover .ib-label,.interrupt-banner:hover .ib-top{color:inherit}
.ib-label{display:block;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--error)}
.ib-count{font-size:19px;font-weight:700;letter-spacing:-.01em;display:block;margin-top:6px}
.ib-top{display:block;margin-top:4px;font-size:14.5px;color:var(--text-secondary)}
.danger{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.btn-ghost{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:13.5px;font-weight:700;letter-spacing:.04em;padding:9px 17px;border:1px solid var(--hair-strong);color:var(--text-primary);background:transparent;text-decoration:none;cursor:pointer}
.btn-ghost:hover{border-color:var(--border-strong)}
.btn-delete{font-family:"IBM Plex Mono",monospace;font-size:13.5px;font-weight:700;letter-spacing:.04em;padding:9px 17px;border:1px solid var(--error);color:var(--error);background:transparent;cursor:pointer}
.btn-delete:hover{background:var(--error);color:var(--surface-base)}
.danger .caption{flex-basis:100%;max-width:66ch}
.inline-form{display:inline}
@media (max-width:860px){.shell{grid-template-columns:1fr}.rail{position:static;min-height:0;border-right:none;border-bottom:2px solid var(--border-strong);padding-bottom:18px}.content{padding:28px 20px 64px}.identity-plate{flex-direction:column}.ko::before{left:-20px}.ko .ko-over{clip-path:inset(-13px calc(100% - var(--ko-r)) -13px -20px)}}
`;

/** The open-interruptions summary the banner renders (null/0 ⇒ no banner). */
export interface InterruptionsBanner {
  count: number;
  topTitle: string | null;
}

/**
 * GET /account — the signed-in home. `user` is the resolved session's user.
 * `opts.showBillingUpsell` renders the free-tier strip (no credit_ledger row on
 * any installation this user owns → they are running on the free tier);
 * `opts.interruptions` renders the red open-asks banner (null/0 ⇒ no banner).
 */
export function renderAccountPage(
  user: UserRow,
  opts: { showBillingUpsell?: boolean; interruptions?: InterruptionsBanner | null } = {},
): string {
  const interruptions = opts.interruptions ?? null;
  const name = user.display_name || user.login;
  const created = new Date(user.created_at * 1000).toISOString().slice(0, 10);
  const emailChip = user.primary_email
    ? user.email_verified
      ? `<span class="chip chip-oidc mono">${esc(user.primary_email)} · verified</span>`
      : `<span class="chip chip-unverified mono">${esc(user.primary_email)} · unverified</span>`
    : `<span class="chip mono">no email on file</span>`;
  const avatar = user.avatar_url
    ? `<img class="avatar" src="${esc(user.avatar_url)}" alt="" width="56" height="56">`
    : '';
  // HITL banner: only rendered when at least one agent is BLOCKED on a human —
  // never a Potemkin zero-state (repo law: empty states teach, banners alarm).
  const interruptBanner =
    interruptions && interruptions.count > 0
      ? `<a class="interrupt-banner" href="/account/interruptions" aria-label="${interruptions.count} agent interruption${interruptions.count === 1 ? '' : 's'} awaiting you">
        <span class="ib-label">Interruptions — agents blocked on you</span>
        <span class="ib-count">${interruptions.count} open ask${interruptions.count === 1 ? '' : 's'} awaiting a human &rarr;</span>
        ${interruptions.topTitle ? `<span class="ib-top">Top: ${esc(interruptions.topTitle)}</span>` : ''}
      </a>`
      : '';

  return `<!DOCTYPE html><html lang="en"><head><title>Port Daddy — Account</title>${HEAD}<style>${ACCOUNT_CSS}</style></head><body>
<div class="shell">
  <aside class="rail">
    <div class="rail-brand"><span class="mark" aria-hidden="true">pd</span><span class="word">Port Daddy</span></div>
    <nav aria-label="Account">
      <span class="eyebrow">Account</span>
      <a href="/account" aria-current="page">Overview</a>
      <a href="/account/interruptions">Interruptions</a>
      <a href="/account/runs">Fleet runs</a>
      <a href="/account/mercy">Mercy health</a>
      <a href="/account/shipwright">Shipwright</a>
      <a href="#devices">Devices</a>
      <a href="#receipts">Receipts</a>
      <a href="#harbors">Harbors</a>
      <a href="#plan">Plan &amp; caps</a>
    </nav>
    <div class="rail-foot">
      <span class="who">${esc(user.primary_email || user.login)}</span>
      <form class="inline-form" method="post" action="/auth/logout"><button type="submit">Sign out</button></form>
    </div>
  </aside>
  <main class="content">
    <div class="page-head">
      <span class="eyebrow">portdaddy.dev · account · overview</span>
      <h1 style="margin-top:8px">Your <span class="rec">account</span></h1>
      <p class="caption">Everything here mirrors your daemon. The daemon is the authority; this page is the window.</p>
      ${interruptBanner}
      <a class="mercy-cta" href="/account/mercy">MERCY — network health report card &rarr;</a>
      ${
        opts.showBillingUpsell
          ? `<a class="upsell" href="/account/billing"><span class="u-label">Free tier</span><span class="u-body">Running on the free tier — add credits and your cloud fleet keeps reviewing PRs when your laptop is closed. <b>Add credits &rarr;</b></span></a>`
          : ''
      }
    </div>

    <section class="sect first" aria-labelledby="identity-h">
      <div class="sect-head"><div><h2 id="identity-h" class="eyebrow" style="font-size:12px;margin:0">Identity</h2></div></div>
      <div class="identity-plate">
        ${avatar}
        <div>
          <div class="name">${esc(name)}</div>
          <div class="chips">
            <span class="chip chip-identity mono">github.com/${esc(user.login)} · id ${user.github_user_id}</span>
            <span class="chip mono">member since ${created}</span>
          </div>
          <div class="oidc-row">
            <span class="provider">GitHub OIDC</span>
            ${emailChip}
          </div>
          <p class="caption" style="margin-top:14px">The website never holds a private key. GitHub is the identity provider; the server only stores your profile and a sealed session token.</p>
        </div>
      </div>
    </section>

    <section class="sect" id="devices" aria-labelledby="devices-h">
      <div class="sect-head">
        <div class="flag-title">
          <i class="flag-kilo" role="img" aria-label="Kilo signal flag: I wish to communicate with you"></i>
          <div><span class="eyebrow">Devices</span><h2 id="devices-h">Paired devices</h2></div>
        </div>
        <span class="flag-mean">Kilo — I wish to communicate with you</span>
      </div>
      <div class="empty">
        <div class="e-title">No devices paired yet.</div>
        <p>Pair FleetBar or pd-console to approve gates and see fleets from this account. Pairing shows the same 4-digit code on both screens — <span class="cmd">pd account pair</span> (device-flow login lands here next).</p>
      </div>
    </section>

    <section class="sect" id="receipts" aria-labelledby="receipts-h">
      <div class="zone-mast">
        <h2 id="receipts-h" class="ko">Receipts — <span class="rec">verifiable</span>, not promised<span class="ko-over" aria-hidden="true">Receipts — <span class="rec">verifiable</span>, not promised</span></h2>
        <span class="caption">The Strava-map of code work: agents, commits, cost, duration — never your code. Anyone with the scoped link sees the proof.</span></div>
      <a class="runs-cta" href="/account/runs">Your fleet runs &rarr;</a>
      <div class="empty">
        <div class="e-title">See every run your GitHub identity can read.</div>
        <p>Fleet runs produce shareable pages at <span class="cmd">/fleet/runs/&lt;id&gt;</span>, and <a href="/account/runs">Your fleet runs</a> lists the recent ones for repos you can read on GitHub — verdicts, ships, cost and wall-clock, each linking to its full transcript.</p>
      </div>
    </section>

    <section class="sect" id="harbors" aria-labelledby="harbors-h">
      <div class="sect-head"><div><span class="eyebrow">Harbors</span><h2 id="harbors-h">Where your agents work</h2></div></div>
      <div class="empty">
        <div class="e-title">Personal harbor only.</div>
        <p>Your local daemon is your personal harbor — you are the only authority and nothing leaves the machine unless you say so. Team and guest harbors (RBAC, scoped guest cards) surface here once membership is linked to your account.</p>
        <p>Team harbors carry <strong>parleys</strong> — signed multi-party agreements with a deadline. List and sign yours at <span class="cmd">GET /v1/harbors/&lt;namespace&gt;/&lt;name&gt;/parleys</span> (member-gated; a rendered list lands here next).</p>
      </div>
    </section>

    <section class="sect" id="plan" aria-labelledby="plan-h">
      <div class="sect-head"><div><span class="eyebrow">Plan &amp; caps</span><h2 id="plan-h">What it costs, and where it stops</h2></div></div>
      <div class="empty">
        <div class="e-title">BYOK-first — no managed plan yet.</div>
        <p>Bring your own provider key and each fleet run bills your own account. Cost caps are enforced by <strong>your daemon</strong> and will mirror here; managed prepaid credits are a later slice.</p>
      </div>
    </section>

    <section class="sect" aria-labelledby="danger-h">
      <div class="sect-head"><div><span class="eyebrow">Leaving</span><h2 id="danger-h">Take everything with you</h2></div></div>
      <div class="danger">
        <a class="btn-ghost" href="/account/export">Export everything</a>
        <form class="inline-form" method="post" action="/account/delete"><button type="submit" class="btn-delete">Delete account</button></form>
        <span class="caption">Deletion is real: server data is soft-deleted now and hard-purged within 30 days; your local daemon is untouched. Your machine keeps working; we just stop knowing you.</span>
      </div>
    </section>
  </main>
</div>
</body></html>`;
}

// ── handlers ─────────────────────────────────────────────────────────────────

/** GET /login — public storefront sign-in page. */
export function handleLoginPage(): Response {
  return htmlPage(renderLoginPage());
}

const GH_API = 'https://api.github.com';

/**
 * Does ANY GitHub App installation this user owns have a billing row (a
 * credit_ledger entry, ADR-0116)? Drives the free-tier upsell strip on
 * /account. GitHub stays the source of installation ownership (same doctrine
 * as userOwnsInstallation); the answer is cached in KV for 5 minutes keyed by
 * user. Best-effort and fail-open-to-upsell: no gh token, an API error, or a
 * D1 error all read as "no billing row" — the strip is advisory, never a gate,
 * and must not be able to sink the page.
 */
async function userHasBillingRow(env: Env, session: ResolvedSession): Promise<boolean> {
  try {
    if (!session.ghToken) return false;
    const cacheKey = `billing_row:${session.user.id}`;
    const cached = await env.KV.get(cacheKey);
    if (cached === '1') return true;
    if (cached === '0') return false;
    const res = await fetch(`${GH_API}/user/installations?per_page=100`, {
      headers: {
        Authorization: `Bearer ${session.ghToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'port-daddy-relay',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { installations?: Array<{ id?: number }> };
    const ids = (Array.isArray(body.installations) ? body.installations : [])
      .map((i) => i.id)
      .filter((n): n is number => Number.isInteger(n));
    let has = false;
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const row = await env.DB.prepare(
        `SELECT 1 AS one FROM credit_ledger WHERE installation_id IN (${placeholders}) LIMIT 1`,
      )
        .bind(...ids)
        .first<{ one: number }>();
      has = Boolean(row);
    }
    await env.KV.put(cacheKey, has ? '1' : '0', { expirationTtl: 300 });
    return has;
  } catch {
    return false;
  }
}

/** GET /account — session-gated; redirects to /login when not signed in. */
export async function handleAccountPage(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  const showBillingUpsell = !(await userHasBillingRow(env, session));
  // HITL banner data (best-effort; the SQL lives here rather than importing
  // src/interruptions.ts, which imports this module's HEAD/TOKENS — a cycle).
  let interruptions: InterruptionsBanner | null = null;
  try {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM operator_interruptions WHERE user_id = ? AND state = 'open'",
    )
      .bind(session.user.id)
      .first<{ n: number }>();
    const n = count?.n ?? 0;
    if (n > 0) {
      const top = await env.DB.prepare(
        `SELECT title FROM operator_interruptions WHERE user_id = ? AND state = 'open'
         ORDER BY CASE urgency WHEN 'critical' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END DESC,
                  created_at ASC LIMIT 1`,
      )
        .bind(session.user.id)
        .first<{ title: string }>();
      interruptions = { count: n, topTitle: top?.title ?? null };
    }
  } catch {
    interruptions = null; // banner is honest-or-absent, never a guess
  }
  return htmlPage(renderAccountPage(session.user, { showBillingUpsell, interruptions }));
}
