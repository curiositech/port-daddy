/**
 * apps/relay/src/billing-page.ts — the billing storefront (ADR-0116 front-end).
 *
 *   GET /account/billing — session-gated page listing the GitHub App
 *   installations the signed-in user owns, each with its prepaid credit
 *   balance, buy-credit buttons (the CREDIT_PACKS presets → POST
 *   /billing/checkout) and a Manage button (→ POST /billing/portal).
 *
 * Tenant boundary: the page NEVER accepts an installation id from the caller.
 * The list comes from listUserInstallations — the same GET /user/installations
 * source of truth userOwnsInstallation gates on — so a session can only ever
 * see (and post about) its own installations; the checkout/portal endpoints
 * re-verify ownership server-side on every post.
 *
 * Honesty (relay-grand-plan D12: reads degrade with reasons, writes stay
 * gated):
 *   - GitHub unreachable → an explicit "unknown" panel, never a fabricated
 *     empty state and never another tenant's data.
 *   - zero installations → an empty state that teaches how to install the app.
 *   - The free tier is fail-OPEN and the page says so plainly: an installation
 *     with no credit history runs free; enrollment starts with the first pack.
 *   - Stripe unconfigured → buy/manage buttons are NOT rendered (no dead
 *     buttons); an honest notice explains why.
 *
 * Rendering is server-side story-linework (shared TOKENS from account-page.ts)
 * under a script-free CSP. Forms are plain HTML posts; billing.ts answers the
 * form dialect with 303 redirects (success → Stripe, failure → back here with
 * ?notice=<code>). Every interpolated value is esc()'d — installation account
 * names come from GitHub and are treated as hostile.
 */

import type { Env } from './types.js';
import type { UserRow } from './db.js';
import {
  resolveSession,
  listUserInstallations,
  type UserInstallation,
} from './auth-github.js';
import { billingConfigured, getBillingStatus, CREDIT_PACKS } from './billing.js';
import { HEAD, TOKENS } from './account-page.js';

/** Cap on per-installation D1 balance lookups per page view. */
export const MAX_INSTALLATIONS = 20;

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
      // No scripts, ever. Forms may submit to this origin; Stripe's checkout /
      // portal hosts are allowed as form-action targets because the submission
      // 303s there (some browsers enforce form-action across the redirect).
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        'font-src https://fonts.gstatic.com; base-uri \'none\'; ' +
        "form-action 'self' https://checkout.stripe.com https://billing.stripe.com; " +
        'frame-ancestors \'none\'',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      // Per-user balances must not land in caches or indexes.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

// ── view model ───────────────────────────────────────────────────────────────

export interface BillingInstallationView extends UserInstallation {
  balanceUsd: number;
  /** Ledger has rows — the executor's spend breaker is armed for this install. */
  enrolled: boolean;
}

export interface BillingPageView {
  /** Stripe secrets present — buy/manage buttons render only when true. */
  configured: boolean;
  /** null = could not establish the list (GitHub error) — render "unknown". */
  installations: BillingInstallationView[] | null;
  /** True when more installations exist than MAX_INSTALLATIONS were shown. */
  truncated: boolean;
  /** Whitelisted notice key from ?notice=, or null. */
  notice: string | null;
}

/**
 * The ONLY notices the page renders — a fixed whitelist keyed by the codes
 * billing.ts's form dialect emits. Raw query-string text is never echoed.
 */
const NOTICES: Record<string, { tone: 'ok' | 'warn'; text: string }> = {
  'checkout-success': {
    tone: 'ok',
    text: 'Payment received. Stripe confirms asynchronously — the new balance lands here as soon as the webhook arrives (usually under a minute). Refresh to see it.',
  },
  'checkout-cancelled': { tone: 'warn', text: 'Checkout cancelled — nothing was charged.' },
  billing_unconfigured: {
    tone: 'warn',
    text: 'Purchases are unavailable: Stripe is not configured on this relay.',
  },
  forbidden: {
    tone: 'warn',
    text: 'That installation is not yours — GitHub decides ownership, and it said no. Nothing was charged.',
  },
  bad_request: { tone: 'warn', text: 'That request did not make sense — nothing was charged. Try again.' },
  bad_pack: { tone: 'warn', text: 'Unknown credit pack — nothing was charged. Pick one of the presets.' },
  bad_json: { tone: 'warn', text: 'That request did not make sense — nothing was charged. Try again.' },
  no_customer: {
    tone: 'warn',
    text: 'No Stripe record exists for that installation yet, so there is nothing to manage. Buying a first pack creates it.',
  },
  stripe_error: { tone: 'warn', text: 'Stripe had a problem — nothing was charged. Try again shortly.' },
  cross_origin: { tone: 'warn', text: 'Cross-origin request refused — use the buttons on this page.' },
};

// ── page CSS (story-linework, shared TOKENS) ─────────────────────────────────

const BILLING_CSS = `
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
.notice-strip{margin-top:26px;background:var(--surface-card);border:1px solid var(--hair);padding:15px 20px;font-size:14.5px;line-height:1.6;max-width:66ch}
.notice-strip.ok{box-shadow:inset 3px 0 0 var(--health)}
.notice-strip.warn{box-shadow:inset 3px 0 0 var(--amber)}
.freetier{margin-top:30px;background:var(--surface-card);border:1px solid var(--hair);padding:20px 22px;max-width:44rem;box-shadow:inset 3px 0 0 var(--teal)}
.freetier .h-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--teal);margin-bottom:8px}
.freetier p{font-size:15px;line-height:1.62;color:var(--text-primary)}
.freetier p+p{margin-top:8px}
.inst{margin-top:30px;border:2px solid var(--border-strong);background:var(--surface-raised)}
.inst-head{display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:14px 20px;border-bottom:2px solid var(--border-strong);background:var(--surface-strong)}
.inst-head h2{font-size:19px;font-weight:700;letter-spacing:-.01em;min-width:0;word-break:break-word}
.inst-id{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;color:var(--text-muted);white-space:nowrap}
.inst-body{padding:18px 20px 20px}
.bal-row{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
.bal{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;font-size:34px;font-weight:700;letter-spacing:-.02em}
.bal-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted)}
.tier-chip{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:4px 10px;border:2px solid var(--border-strong)}
.tier-chip.free{background:var(--teal);color:var(--on-accent)}
.tier-chip.active{background:var(--health);color:var(--on-accent)}
.tier-chip.exhausted{background:var(--error);color:var(--on-accent)}
.buy-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px;padding-top:16px;box-shadow:inset 0 1px 0 var(--hair)}
.buy-row .buy-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);flex-basis:100%}
.inline-form{display:inline}
.btn-buy{font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:700;letter-spacing:.02em;padding:10px 16px;border:2px solid var(--border-strong);background:var(--cobalt);color:var(--on-accent);cursor:pointer}
.btn-buy:hover{background:var(--border-strong);color:var(--surface-base)}
.btn-manage{font-family:"IBM Plex Mono",monospace;font-size:13.5px;font-weight:700;letter-spacing:.04em;padding:9px 16px;border:1px solid var(--hair-strong);background:transparent;color:var(--text-primary);cursor:pointer}
.btn-manage:hover{border-color:var(--border-strong)}
.buy-note{font-size:13.5px;color:var(--text-muted);flex-basis:100%;line-height:1.55}
.unavail{margin-top:16px;font-size:14px;color:var(--text-secondary);line-height:1.6;border:1px dashed var(--hair-strong);padding:12px 16px;max-width:60ch}
.degraded{margin-top:30px;background:var(--surface-card);border:1px solid var(--hair);padding:18px 22px;box-shadow:inset 3px 0 0 var(--amber);max-width:44rem}
.degraded .d-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--amber);margin-bottom:8px}
.degraded p{font-size:14.5px;line-height:1.6;color:var(--text-primary)}
.trunc{margin-top:26px;background:var(--surface-card);border:1px solid var(--hair);padding:16px 20px;box-shadow:inset 3px 0 0 var(--amber);font-size:14.5px;color:var(--text-secondary);line-height:1.6;max-width:66ch}
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
}
`;

// ── rendering ────────────────────────────────────────────────────────────────

function shellPage(inner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><title>Port Daddy — Billing &amp; credits</title>${HEAD}<style>${BILLING_CSS}</style></head><body>
<header class="site-header">
  <a class="sh-brand" href="/account"><span class="sh-mark" aria-hidden="true">pd</span>Port Daddy</a>
  <span class="sh-status"><a href="/account">account</a>&ensp;/&ensp;billing</span>
</header>
${inner}
</body></html>`;
}

const FREE_TIER_PANEL = `<div class="freetier">
  <p class="h-label">Free until enrolled — billing fails open</p>
  <p>An installation with <strong>no credit history runs free</strong>. Nothing is gated, capped,
  or metered against a balance until you enroll it by buying its first credit pack.</p>
  <p>After enrolling, fleet runs meter their token spend against the balance, and runs are skipped
  only when it reaches $0. The gate itself fails <strong>open</strong>: if the ledger cannot be
  read, your runs proceed — a billing outage never blocks your fleet.</p>
</div>`;

const EMPTY_STATE = `<div class="empty">
  <div class="e-title">No GitHub App installations found.</div>
  <p>Billing is per <strong>installation</strong> of the Port Daddy Fleet GitHub App. Install the
  app on a user or organization you administer, and it appears here with its credit balance and
  buy buttons. Until then there is nothing to bill — and nothing to pay: the free tier is simply
  the absence of an enrolled installation.</p>
</div>`;

const DEGRADED_STATE = `<div class="degraded">
  <p class="d-label">Unknown — could not list your installations</p>
  <p>GitHub did not answer when we asked which app installations you own, so this page cannot
  show balances right now (it will not guess, and it will never show anyone else&rsquo;s).
  Reload to retry.</p>
</div>`;

function tierChip(inst: BillingInstallationView): string {
  if (!inst.enrolled) return '<span class="tier-chip free">Free tier — not enrolled</span>';
  if (inst.balanceUsd <= 0) return '<span class="tier-chip exhausted">Out of credit — runs skip</span>';
  return '<span class="tier-chip active">Credits active</span>';
}

function fmtUsd(v: number): string {
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function renderBuyRow(inst: BillingInstallationView): string {
  const packs = Object.values(CREDIT_PACKS)
    .map(
      (p) => `<form class="inline-form" method="post" action="/billing/checkout">
      <input type="hidden" name="installationId" value="${inst.id}">
      <input type="hidden" name="pack" value="${esc(p.id)}">
      <button type="submit" class="btn-buy">+ ${esc(p.label)}</button>
    </form>`,
    )
    .join('');
  return `<div class="buy-row">
    <span class="buy-label">Buy credits — one-time packs, prepaid, closed-loop</span>
    ${packs}
    <form class="inline-form" method="post" action="/billing/portal">
      <input type="hidden" name="installationId" value="${inst.id}">
      <button type="submit" class="btn-manage">Manage in Stripe</button>
    </form>
    <span class="buy-note">Checkout and card management happen on Stripe — this server never sees
    card numbers. &ldquo;Manage&rdquo; opens the Stripe portal (receipts, payment methods) once a
    first purchase has created the billing record.</span>
  </div>`;
}

function renderInstallation(inst: BillingInstallationView, configured: boolean): string {
  const name = inst.accountLogin ?? `installation ${inst.id}`;
  const kind = inst.accountType ? ` · ${esc(inst.accountType)}` : '';
  return `<section class="inst">
    <header class="inst-head"><h2>${esc(name)}</h2><span class="inst-id">installation ${inst.id}${kind}</span></header>
    <div class="inst-body">
      <div class="bal-row">
        <span class="bal-label">Prepaid balance</span>
        <span class="bal">${esc(fmtUsd(inst.balanceUsd))}</span>
        ${tierChip(inst)}
      </div>
      ${
        configured
          ? renderBuyRow(inst)
          : '<div class="unavail">Purchases are unavailable: Stripe is not configured on this relay, so there are no buy buttons to press. The balance above is still real.</div>'
      }
    </div>
  </section>`;
}

/** Render the full /account/billing page for a signed-in user. */
export function renderBillingPage(user: UserRow, view: BillingPageView): string {
  const notice = view.notice ? NOTICES[view.notice] : null;
  const noticeHtml = notice
    ? `<div class="notice-strip ${notice.tone}" role="status">${notice.text}</div>`
    : '';

  let body: string;
  if (view.installations === null) {
    body = DEGRADED_STATE;
  } else if (view.installations.length === 0) {
    body = EMPTY_STATE;
  } else {
    body = view.installations.map((i) => renderInstallation(i, view.configured)).join('');
    if (view.truncated) {
      body += `<div class="trunc"><b>Partial view.</b> Only the first ${MAX_INSTALLATIONS} of your
      installations are shown per page view; the rest still exist and their billing is unaffected.</div>`;
    }
  }

  const inner = `<main class="page">
    <div class="masthead">
      <span class="eyebrow">portdaddy.dev · account · billing</span>
      <h1 class="ko">Billing &amp; <span class="rec">credits</span><span class="ko-over" aria-hidden="true">Billing &amp; <span class="rec">credits</span></span></h1>
      <span class="lede">Prepaid credit for the fleet, per GitHub App installation. Only
      installations <strong>${esc(user.login)}</strong> can act on — by GitHub&rsquo;s own
      say-so — ever appear here.</span>
    </div>
    ${noticeHtml}
    ${FREE_TIER_PANEL}
    ${body}
  </main>`;
  return shellPage(inner);
}

// ── handler ──────────────────────────────────────────────────────────────────

/** GET /account/billing — session-gated; redirects to /login when signed out. */
export async function handleBillingPage(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  const rawNotice = new URL(request.url).searchParams.get('notice');
  const notice = rawNotice && NOTICES[rawNotice] ? rawNotice : null;
  try {
    const configured = billingConfigured(env);
    const listed = await listUserInstallations(env, session);
    let installations: BillingInstallationView[] | null = null;
    let truncated = false;
    if (listed) {
      truncated = listed.length > MAX_INSTALLATIONS;
      installations = [];
      for (const inst of listed.slice(0, MAX_INSTALLATIONS)) {
        const status = await getBillingStatus(env.DB, inst.id);
        installations.push({ ...inst, ...status });
      }
    }
    return htmlResponse(
      renderBillingPage(session.user, { configured, installations, truncated, notice }),
      200,
    );
  } catch {
    return htmlResponse(
      shellPage(`<main class="page"><div class="notice">
        <span class="eyebrow">Port Daddy Billing</span>
        <h1>Temporarily unavailable</h1>
        <p>The billing view could not be read. Nothing was charged. Try again shortly.</p>
      </div></main>`),
      500,
    );
  }
}
