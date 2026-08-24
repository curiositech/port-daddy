/**
 * apps/relay/src/parleys-page.ts — the operator-facing HTML surface for X4
 * parleys (`parleys-html-ui`; docs/proposals/grand-plan-dag.md).
 *
 *   GET  /account/parleys                          → pick/redirect to a harbor
 *   GET  /account/parleys/:ns/:name                → that harbor's parleys
 *   GET  /account/parleys/:ns/:name/:id            → one parley in full
 *   POST /account/parleys/:ns/:name/:id/sign       → sign, as a plain form post
 *
 * WHY THIS EXISTS. X4 v1 shipped a complete, correct parley API and no way to
 * look at one. In practice that means nobody looks at one: reading a parley
 * required composing a curl with a session cookie, which is a thing an
 * operator does approximately never. A signed multi-party agreement whose
 * contents are effectively unreadable is not an agreement anyone can rely on,
 * so the page is not a nicety here — it is the difference between the feature
 * existing and the feature being usable.
 *
 * ── DISCIPLINE (matching the relay's established storefront idiom) ───────────
 *  - SESSION-GATED. No session ⇒ 302 /login, exactly like /account/runs and
 *    /account/billing. Rendering the page is a browser act; the pdu_ bearer
 *    path stays on the JSON API where it belongs.
 *  - MEMBER-GATED, sharing the API's gate. The page calls the SAME
 *    resolveHarborMembership / resolveParleyInHarbor the JSON routes call, so
 *    the no-existence-oracle property holds identically on both surfaces: a
 *    non-member cannot distinguish "no such parley" from "not yours" — both
 *    render the same 404 page with the same words. See {@link parleyNotFoundPage}.
 *  - SCRIPT-FREE CSP. `default-src 'none'` with no `script-src` at all: this
 *    page ships zero script tags and the policy says so. The Shipwright page
 *    is the ONE nonce-relaxed route on this relay and this is emphatically not
 *    it — which is precisely why signing is a plain form POST below.
 *  - `no-store` + `noindex`. A parley is member-only content naming people and
 *    quoting their positions; it must not land in a shared cache or a crawler.
 *  - EVERYTHING ESCAPED. Subjects, position texts, party labels, harbor names,
 *    and the mediator's model-authored observation all pass through `esc()`.
 *    Model output is treated exactly as hostile as user input, because it is:
 *    it is text the relay did not write appearing on a page the relay serves.
 *  - HONEST STATES. Empty harbors, empty parley lists, an unsigned seat, a
 *    silent mediator, and a failed read each render as themselves. Nothing is
 *    fabricated and nothing is hidden.
 *  - NO DEAD BUTTONS. A terminal (agreed/lapsed) parley renders as CLOSED with
 *    an explanation, never a sign button that would 409. Same for a viewer who
 *    is not a named party, and for a party who has already signed.
 *
 * ── THE THEME TOGGLE, DELIBERATELY ABSENT ────────────────────────────────────
 * Like account-page.ts, this page drops the mockups' manual theme toggle: it
 * needs client JS and this page has none. `prefers-color-scheme` themes it in
 * both directions, which covers the real requirement.
 */

import type { Env } from './types.js';
import type { UserRow } from './db.js';
import { resolveSession, isSameOrigin } from './auth-github.js';
import {
  getFleetPaused,
  getMediatorKilled,
  getMediatorPairForParley,
  getParleyGate,
  listHarborsForUser,
  listParleyPositions,
  listParleys,
  listParleySummonses,
  tallyParleySignatures,
  type HarborRow,
  type ParleyGateRow,
  type ParleyPositionRow,
  type ParleyRow,
  type ParleySummonsRow,
} from './db.js';
import {
  applyParleyExpiries,
  resolveHarborMembership,
  resolveParleyInHarbor,
  handleRespondParley,
  MEDIATOR_ID,
} from './parleys.js';
import { renderGateVerdict, type GateVerdictOutcome } from './mediator-body.js';
import { HEAD, TOKENS } from './account-page.js';

/** How many parleys one rendered list shows (newest first). */
export const PARLEY_LIST_LIMIT = 25;

// ── escaping + transport ─────────────────────────────────────────────────────

/**
 * Minimal HTML-escape for every interpolated value on this page (XSS guard).
 *
 * Deliberately a local copy of the same five-replacement function the sibling
 * storefront pages carry rather than a shared import: it is four lines, it has
 * no configuration, and each page owning its own means no page can be made
 * unsafe by an edit to somebody else's module. The five characters covered are
 * the complete set that matters for both element text and quoted attribute
 * values, which is every context this file interpolates into.
 *
 * @param v Any value; null/undefined render as the empty string.
 * @returns The value as HTML-safe text.
 */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap rendered HTML in this surface's response headers.
 *
 * The header set is the policy, so it lives in exactly one function that every
 * response on this surface goes through — a page that forgot `no-store` or
 * grew a `script-src` would be a security regression that no test of the
 * markup would catch. `default-src 'none'` with no script directive at all is
 * the strongest available statement that this page executes nothing;
 * `form-action 'self'` keeps the sign form's POST from being retargeted at
 * another origin; and `no-store` + `noindex` keep member-only content out of
 * caches and crawlers.
 *
 * @param body Fully rendered HTML document.
 * @param status HTTP status to serve it with.
 * @returns The Response, headers included.
 */
function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // No scripts, ever — this route is NOT the nonce-relaxed Shipwright page.
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; base-uri 'none'; " +
        "form-action 'self'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      // Member-only content naming people and quoting their positions.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

// ── notices (whitelisted; raw query text is never echoed) ────────────────────

/**
 * The ONLY notices this surface renders, keyed by the codes the sign form's
 * POST handler emits on its 303 back.
 *
 * A fixed whitelist rather than an echoed message, for the same reason
 * billing-page.ts uses one: `?notice=` is attacker-controlled, and a page that
 * renders arbitrary query text is a phishing surface even when it is escaped
 * ("Your session expired, re-enter your password at…"). Escaping stops script
 * injection; a whitelist stops the page being made to say things.
 */
const NOTICES: Record<string, { tone: 'ok' | 'warn'; text: string }> = {
  signed: { tone: 'ok', text: 'Your position is signed and recorded. Signatures are write-once — it cannot be edited or withdrawn.' },
  closed: { tone: 'warn', text: 'This parley is already closed. Nothing was recorded: a parley that has agreed or lapsed is immutable.' },
  'already-signed': { tone: 'warn', text: 'You have already signed this parley. Nothing was recorded — signatures are write-once.' },
  'not-a-party': { tone: 'warn', text: 'You are not a named party of this parley, so you cannot sign it. Nothing was recorded.' },
  'bad-stance': { tone: 'warn', text: 'Pick Accept or Reject. Nothing was recorded.' },
  'bad-position': { tone: 'warn', text: 'That position text was too long to record. Nothing was recorded — shorten it and sign again.' },
  error: { tone: 'warn', text: 'The relay could not record that position. Nothing was recorded; try again.' },
  // ── gate verdicts (mediator-body) ──────────────────────────────────────────
  'verdict-approved': { tone: 'ok', text: 'Approved. The irreversible action may proceed; the verdict is write-once and recorded below.' },
  'verdict-modified': { tone: 'ok', text: 'Modified. Your instructions are recorded and will be re-injected into the losing agent’s re-execution.' },
  'verdict-rejected': { tone: 'ok', text: 'Rejected. The irreversible action does not proceed; the verdict is write-once and recorded below.' },
  'gate-decided': { tone: 'warn', text: 'This gate already has a verdict. Verdicts are write-once — nothing was recorded.' },
  'no-gate': { tone: 'warn', text: 'This parley has no approve gate, so there is nothing to decide. Nothing was recorded.' },
  'bad-verdict': { tone: 'warn', text: 'Pick Approve, Modify, or Reject. Nothing was recorded.' },
  'modify-text-required': { tone: 'warn', text: 'Modify needs instructions (up to 2000 chars) — that text is what the losing agent re-executes with. Nothing was recorded.' },
  'fleet-paused': { tone: 'warn', text: 'The fleet is paused, so the relay will not accept a verdict it cannot enforce. Nothing was recorded — resume the fleet first.' },
  'mediator-killed': { tone: 'warn', text: 'The kill-mediator flag is set: the mediator is inert and its gates accept no verdicts. Nothing was recorded.' },
};

// ── page CSS (story-linework; TOKENS single-sourced from account-page.ts) ────

const PARLEY_CSS = `
${TOKENS}
.site-header{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:14px clamp(20px,4vw,40px);background:var(--surface-base);border-bottom:2px solid var(--border-strong)}
.sh-brand{display:flex;align-items:baseline;gap:10px;font-weight:700;font-size:17px;letter-spacing:-.01em;color:var(--text-primary);text-decoration:none}
.sh-mark{color:var(--cobalt);font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:19px}
.sh-status{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:500;color:var(--text-muted)}
.page{max-width:74rem;margin:0 auto;padding:0 clamp(20px,4vw,40px) 88px}
.masthead{padding:40px 0 10px}
.masthead .eyebrow{display:block;margin-bottom:16px}
.ko{position:relative;z-index:0;display:inline-block;--ko-r:62%;font-size:clamp(28px,4.2vw,48px);font-weight:700;line-height:1.08;letter-spacing:-.03em;max-width:20ch}
.ko::before{content:"";position:absolute;z-index:-1;left:-56px;right:calc(100% - var(--ko-r));top:-14px;bottom:-14px;background:var(--cobalt-slab)}
.ko .ko-over{position:absolute;inset:0;color:var(--cream);pointer-events:none;clip-path:inset(-14px calc(100% - var(--ko-r)) -14px -56px)}
.ko .rec{color:var(--cobalt)}
.ko .ko-over .rec{color:var(--cream)}
.lede{display:block;margin-top:22px;max-width:64ch;font-size:15px;color:var(--text-secondary);line-height:1.6}
/* The DETAIL headline is a user-supplied subject of arbitrary length, so it
   deliberately does NOT use the .ko knockout slab: the slab's clip boundary
   lands mid-word on long strings, which reads as a rendering bug rather than
   as the editorial device it is on a fixed phrase. Ink rule + weight instead. */
.subject-h1{margin-top:6px;font-size:clamp(26px,3.4vw,40px);font-weight:700;line-height:1.14;letter-spacing:-.03em;max-width:26ch;overflow-wrap:anywhere;padding-left:18px;box-shadow:inset 4px 0 0 var(--cobalt)}
.notice-strip{margin-top:26px;background:var(--surface-card);border:1px solid var(--hair);padding:15px 20px;font-size:14.5px;line-height:1.6;max-width:66ch}
.notice-strip.ok{box-shadow:inset 3px 0 0 var(--health)}
.notice-strip.warn{box-shadow:inset 3px 0 0 var(--amber)}
/* harbor switcher */
.harbors{display:flex;flex-wrap:wrap;gap:8px;margin-top:28px;align-items:baseline}
.harbors .hs-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);flex-basis:100%}
.hs-chip{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;padding:6px 12px;border:1px solid var(--hair-strong);color:var(--text-primary);text-decoration:none}
.hs-chip:hover{border-color:var(--border-strong)}
.hs-chip.on{background:var(--border-strong);color:var(--surface-base);border-color:var(--border-strong)}
/* state badges */
.badge{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:4px 10px;border:2px solid var(--border-strong);white-space:nowrap}
.badge.open{background:var(--cobalt);color:var(--on-accent)}
.badge.agreed{background:var(--health);color:var(--on-accent)}
.badge.lapsed{background:var(--surface-strong);color:var(--text-secondary)}
/* parley list */
.plist{margin-top:26px;border:2px solid var(--border-strong);background:var(--surface-raised)}
.prow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 18px;padding:16px 20px;align-items:baseline}
.prow + .prow{border-top:1px solid var(--hair)}
.prow .p-subject{font-size:17px;font-weight:600;letter-spacing:-.01em;min-width:0;overflow-wrap:anywhere}
.prow .p-subject a{color:var(--text-primary);text-decoration:none;box-shadow:inset 0 -1px 0 var(--hair-strong)}
.prow .p-subject a:hover{color:var(--cobalt);box-shadow:inset 0 -1px 0 var(--cobalt)}
.prow .p-meta{grid-column:1;font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--text-muted);line-height:1.7;overflow-wrap:anywhere}
.prow .p-meta b{color:var(--text-secondary);font-weight:600}
.prow .p-right{grid-column:2;grid-row:1 / span 2;display:flex;flex-direction:column;align-items:flex-end;gap:8px;text-align:right}
.prow .p-count{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;color:var(--text-secondary);white-space:nowrap}
/* detail */
.detail-meta{display:flex;flex-wrap:wrap;gap:10px 26px;margin-top:24px;padding:16px 20px;border:1px solid var(--hair);background:var(--surface-card)}
.dm{display:flex;flex-direction:column;gap:3px;min-width:0}
.dm .dm-k{font-family:"IBM Plex Mono",monospace;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted)}
.dm .dm-v{font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:600;color:var(--text-primary);overflow-wrap:anywhere}
.dm .dm-v.overdue{color:var(--error)}
.sect-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--text-muted);margin:34px 0 12px}
.seats{border:2px solid var(--border-strong);background:var(--surface-raised)}
.seat{padding:16px 20px}
.seat + .seat{border-top:1px solid var(--hair)}
.seat-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px 14px}
.seat-who{font-family:"IBM Plex Mono",monospace;font-size:15px;font-weight:700;color:var(--text-primary);overflow-wrap:anywhere;min-width:0}
.seat-kind{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--text-muted)}
.seat-when{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--text-muted);margin-left:auto;white-space:nowrap}
.chip{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:3px 9px;border:1px solid var(--hair-strong)}
.chip.accept{background:var(--health);color:var(--on-accent);border-color:var(--border-strong)}
.chip.reject{background:var(--error);color:var(--on-accent);border-color:var(--border-strong)}
.chip.await{background:transparent;color:var(--amber);border-color:var(--amber)}
.chip.observer{background:transparent;color:var(--violet);border-color:var(--violet)}
.seat-pos{margin-top:10px;font-size:15px;line-height:1.62;color:var(--text-primary);overflow-wrap:anywhere;white-space:pre-wrap;padding-left:14px;box-shadow:inset 2px 0 0 var(--hair-strong)}
.seat-none{margin-top:8px;font-size:14px;color:var(--text-muted);line-height:1.6}
.seat.mediator{background:var(--surface-card)}
.seat.mediator .seat-pos{box-shadow:inset 2px 0 0 var(--violet)}
.mediator-note{margin-top:8px;font-size:13.5px;color:var(--text-muted);line-height:1.6;max-width:70ch}
/* sign form */
.signbox{margin-top:34px;border:2px solid var(--border-strong);background:var(--surface-raised);padding:20px 22px 22px}
.signbox h2{font-size:19px;font-weight:700;letter-spacing:-.01em}
.signbox .sb-lede{margin-top:8px;font-size:14.5px;color:var(--text-secondary);line-height:1.6;max-width:64ch}
.sb-stance{display:flex;flex-wrap:wrap;gap:10px 20px;margin-top:18px}
.sb-stance label{display:flex;align-items:center;gap:8px;font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:600;padding:9px 14px;border:1px solid var(--hair-strong);cursor:pointer}
.sb-stance input{accent-color:var(--cobalt);width:16px;height:16px}
.sb-field{margin-top:16px}
.sb-field label{display:block;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:7px}
.sb-field textarea{width:100%;max-width:64rem;min-height:104px;padding:11px 13px;border:1px solid var(--hair-strong);background:var(--surface-base);color:var(--text-primary);font-family:"IBM Plex Sans",sans-serif;font-size:15px;line-height:1.6;resize:vertical}
.sb-field textarea:focus{border-color:var(--cobalt);outline:2px solid var(--cobalt);outline-offset:1px}
.btn-sign{margin-top:18px;font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:700;letter-spacing:.02em;padding:11px 20px;border:2px solid var(--border-strong);background:var(--cobalt);color:var(--on-accent);cursor:pointer}
.btn-sign:hover{background:var(--border-strong);color:var(--surface-base)}
/* summons strip (mediator-body: agent-first delivery acknowledgment) */
.summons{border:1px solid var(--hair);background:var(--surface-card);margin-top:12px}
.summons .sm-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 14px;padding:12px 20px}
.summons .sm-row + .sm-row{border-top:1px solid var(--hair)}
.sm-who{font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:700;color:var(--text-primary)}
.sm-daemon{font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--text-muted);overflow-wrap:anywhere}
.chip.summoned{background:transparent;color:var(--amber);border-color:var(--amber)}
.chip.acked{background:var(--health);color:var(--on-accent);border-color:var(--border-strong)}
.chip.refused{background:var(--error);color:var(--on-accent);border-color:var(--border-strong)}
.chip.escalated{background:transparent;color:var(--error);border-color:var(--error)}
.sm-hash{font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--text-muted);overflow-wrap:anywhere}
.sm-note{padding:10px 20px 14px;font-size:13.5px;color:var(--text-muted);line-height:1.6;max-width:72ch;border-top:1px solid var(--hair)}
/* gate panel (mediator-body: human approve gate, irreversible actions only) */
.gatebox{margin-top:34px;border:2px solid var(--border-strong);background:var(--surface-raised);padding:20px 22px 22px}
.gatebox h2{font-size:19px;font-weight:700;letter-spacing:-.01em}
.gatebox .gb-lede{margin-top:8px;font-size:14.5px;color:var(--text-secondary);line-height:1.6;max-width:66ch}
.gb-action{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:4px 10px;border:2px solid var(--error);color:var(--error);margin-left:10px;vertical-align:middle}
.gb-verdicts{display:flex;flex-wrap:wrap;gap:12px;margin-top:18px}
.btn-verdict{font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:700;letter-spacing:.02em;padding:11px 20px;border:2px solid var(--border-strong);cursor:pointer;background:var(--surface-base);color:var(--text-primary)}
.btn-verdict.approve{background:var(--health);color:var(--on-accent)}
.btn-verdict.reject{background:var(--error);color:var(--on-accent)}
.btn-verdict:hover{filter:brightness(.92)}
.btn-verdict:disabled{opacity:.45;cursor:not-allowed;filter:none}
.gb-paused{margin-top:14px;font-size:14px;color:var(--amber);line-height:1.6;max-width:64ch;padding-left:14px;box-shadow:inset 3px 0 0 var(--amber)}
.gb-verdict-record{margin-top:16px;padding:14px 18px;border:1px solid var(--hair);background:var(--surface-card)}
.gb-verdict-record .gv-state{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.gb-verdict-record .gv-state.approved{color:var(--health)}
.gb-verdict-record .gv-state.modified{color:var(--cobalt)}
.gb-verdict-record .gv-state.rejected{color:var(--error)}
.gb-verdict-record p{margin-top:6px;font-size:14px;color:var(--text-secondary);line-height:1.6}
.gb-modify-text{margin-top:10px;font-size:14.5px;line-height:1.62;color:var(--text-primary);white-space:pre-wrap;overflow-wrap:anywhere;padding-left:14px;box-shadow:inset 2px 0 0 var(--cobalt)}
.closedbox{margin-top:34px;border:1px dashed var(--hair-strong);padding:20px 22px;max-width:68ch}
.closedbox .cb-title{font-weight:700;font-size:17px}
.closedbox p{margin-top:8px;font-size:14.5px;color:var(--text-secondary);line-height:1.62}
/* empty + degraded */
.empty{margin-top:34px;border:2px dashed var(--hair-strong);padding:26px}
.empty .e-title{font-weight:700;font-size:17px}
.empty p{font-size:14.5px;color:var(--text-secondary);line-height:1.6;margin-top:8px;max-width:68ch}
.empty .cmd{font-family:"IBM Plex Mono",monospace;font-size:13.5px;color:var(--teal);font-weight:600}
.degraded{margin-top:30px;background:var(--surface-card);border:1px solid var(--hair);padding:18px 22px;box-shadow:inset 3px 0 0 var(--amber);max-width:52rem}
.degraded .d-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--amber);margin-bottom:8px}
.degraded p{font-size:14.5px;line-height:1.6;color:var(--text-primary)}
.notice{max-width:52rem;margin:0 auto;padding:64px 0}
.notice h1{font-size:clamp(28px,4vw,40px);font-weight:700;margin:14px 0 16px;letter-spacing:-.03em}
.notice p{font-size:16px;color:var(--text-secondary);line-height:1.62;max-width:58ch}
.backlink{display:inline-block;margin-top:26px;font-family:"IBM Plex Mono",monospace;font-size:13.5px;font-weight:600}
@media (max-width:720px){
  .sh-status{display:none}
  .ko{--ko-r:86%}
  .ko::before{left:-20px}
  .ko .ko-over{clip-path:inset(-14px calc(100% - var(--ko-r)) -14px -20px)}
  .prow{grid-template-columns:minmax(0,1fr)}
  .prow .p-right{grid-column:1;grid-row:auto;align-items:flex-start;text-align:left;flex-direction:row;flex-wrap:wrap}
  .seat-when{margin-left:0;flex-basis:100%}
}
`;

// ── shell ────────────────────────────────────────────────────────────────────

/**
 * Wrap page content in the shared storefront chrome.
 *
 * Centralized so every state of this surface — list, detail, empty, 404 — is
 * unmistakably the same page. A 404 that lost the header would read as a
 * broken deploy rather than as an answer, and on a surface whose 404 is a
 * deliberate message that the surface depends on (see
 * {@link parleyNotFoundPage}) that confusion
 * would undermine the very property the 404 exists to protect.
 *
 * @param title Text for the browser tab (escaped by the caller's contract; escaped here too).
 * @param crumb Right-hand breadcrumb text in the header.
 * @param inner Rendered page body HTML.
 * @returns A complete HTML document.
 */
function shellPage(title: string, crumb: string, inner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><title>${esc(title)}</title>${HEAD}<style>${PARLEY_CSS}</style></head><body>
<header class="site-header">
  <a class="sh-brand" href="/account"><span class="sh-mark" aria-hidden="true">pd</span>Port Daddy</a>
  <span class="sh-status"><a href="/account">account</a>&ensp;/&ensp;${esc(crumb)}</span>
</header>
${inner}
</body></html>`;
}

/**
 * The single 404 this surface serves — for an unknown harbor, a harbor the
 * viewer is not a member of, an unknown parley, and a parley belonging to
 * another harbor, without distinction.
 *
 * That indistinguishability is the entire point and is worth stating plainly:
 * if "no such parley" and "not yours" rendered differently, anyone with a
 * session could enumerate which harbors and parley ids exist by reading the
 * difference. The API established this rule in v1 with identical JSON bodies;
 * this is the same rule rendered. The copy is deliberately vague about which
 * case occurred, and deliberately honest that it is being vague.
 *
 * @returns A 404 Response with the standard page chrome.
 */
/**
 * The single 404 this surface serves.
 *
 * Exported because the ROUTER needs it too. index.ts's `/account/parleys/`
 * branch answered an unroutable path with `new Response('Not Found')` — nine
 * bytes, no headers — and answered a MALFORMED one with a 500, because its
 * `decodeURIComponent` was unguarded and URIError reached the worker's global
 * boundary. Three different replies for three flavours of "no", on a surface
 * whose own text below promises exactly one. Same function, same bytes, or the
 * promise is not kept.
 */
export function parleyNotFoundPage(): Response {
  return htmlResponse(
    shellPage(
      'Port Daddy — Parley not found',
      'parleys',
      `<main class="page"><div class="notice">
        <span class="eyebrow">Parleys</span>
        <h1>Not found</h1>
        <p>There is no such parley here, or it is not yours to read. This page does not say which —
        telling you a parley exists but is closed to you would be its own kind of leak.</p>
        <p><a class="backlink" href="/account/parleys">&larr; Your parleys</a></p>
      </div></main>`,
    ),
    404,
  );
}

/** Session-less browsers go to /login, exactly like the sibling account pages. */
const toLogin = () => new Response(null, { status: 302, headers: { Location: '/login' } });

// ── formatting ───────────────────────────────────────────────────────────────

/**
 * Render a unix-seconds timestamp as a fixed UTC date+time.
 *
 * Design intent, inherited from billing-page.ts's ledger rendering: a
 * per-viewer locale would make two parties to the SAME parley disagree about
 * when a position was signed. On a shared, signed artifact that is not a
 * cosmetic difference — it is two people reading different facts off one
 * record. One fixed UTC rendering is the only honest choice.
 *
 * @param unixSeconds Timestamp in unix seconds.
 * @returns `YYYY-MM-DD HH:MM UTC`.
 */
function fmtWhen(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Render the gap to a deadline as human-scale time remaining.
 *
 * Why this is not just the deadline timestamp: a deadline is the thing an
 * operator has to ACT on, and "2026-08-05 09:00 UTC" requires arithmetic under
 * time pressure to become "you have 40 minutes". Rendering the arithmetic is
 * the page doing its job. Granularity coarsens with distance (days, then
 * hours, then minutes) because false precision on a 6-day deadline is noise,
 * while minutes matter on the last hour.
 *
 * @param deadlineAt Deadline in unix seconds.
 * @param nowSec Current time in unix seconds.
 * @returns Text like `3d 4h left`, `12m left`, or `deadline passed`.
 */
export function fmtRemaining(deadlineAt: number, nowSec: number): string {
  const secs = deadlineAt - nowSec;
  if (secs <= 0) return 'deadline passed';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m left`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h left`;
}

/** State badge markup — the one place a parley state becomes a colour. */
function stateBadge(state: ParleyRow['state']): string {
  return `<span class="badge ${esc(state)}">${esc(state)}</span>`;
}

// ── view models ──────────────────────────────────────────────────────────────

/** One row of the rendered parley list. */
export interface ParleyListItem {
  parley: ParleyRow;
  /** Named parties on this parley (observers excluded). */
  parties: number;
  /** How many of those have signed. */
  signed: number;
}

/** Everything the list page renders. */
export interface ParleyListView {
  harbor: HarborRow;
  /** All harbors this user belongs to — powers the switcher chips. */
  harbors: HarborRow[];
  /** null ⇒ the read failed; render "unknown", never a fabricated empty list. */
  items: ParleyListItem[] | null;
  truncated: boolean;
  notice: string | null;
  nowSec: number;
}

/** Everything the detail page renders. */
export interface ParleyDetailView {
  harbor: HarborRow;
  parley: ParleyRow;
  positions: ParleyPositionRow[];
  /** The viewer's own named-party seat, or null when they are only an observer. */
  viewerSeat: ParleyPositionRow | null;
  notice: string | null;
  nowSec: number;
  /** The human approve gate, when this parley carries one (mediator-body). */
  gate: ParleyGateRow | null;
  /** The delivery-acknowledged summons ledger (mediator-convened parleys). */
  summonses: ParleySummonsRow[];
  /** True ⇒ verdict buttons render DISABLED (no verdict the relay can't enforce). */
  fleetPaused: boolean;
  /** True ⇒ the gate panel renders inert (kill-mediator flag). */
  mediatorKilled: boolean;
}

// ── list rendering ───────────────────────────────────────────────────────────

function noticeStrip(notice: string | null): string {
  if (!notice) return '';
  const n = NOTICES[notice];
  if (!n) return ''; // unknown code: render nothing rather than echo it
  return `<div class="notice-strip ${n.tone}">${esc(n.text)}</div>`;
}

function harborSwitcher(harbors: HarborRow[], current: HarborRow): string {
  if (harbors.length < 2) return '';
  const chips = harbors
    .map((h) => {
      const slug = `${h.namespace}/${h.name}`;
      const on = h.id === current.id ? ' on' : '';
      return `<a class="hs-chip${on}" href="/account/parleys/${encodeURIComponent(h.namespace)}/${encodeURIComponent(h.name)}">${esc(slug)}</a>`;
    })
    .join('');
  return `<div class="harbors"><span class="hs-label">Your harbors</span>${chips}</div>`;
}

/**
 * Render the parley list page for one harbor.
 *
 * Exported so tests can assert on the markup directly without standing up a
 * session, and so the three states this page has — populated, honestly empty,
 * and honestly unknown — can each be exercised as pure functions of a view
 * model. Keeping "unknown" (`items === null`) distinct from "empty" is the
 * same D12 honesty rule billing-page.ts follows: a D1 hiccup rendering as
 * "this harbor has no parleys" would be a lie an operator could act on.
 *
 * @param user The signed-in viewer (named in the header).
 * @param view The assembled list view model.
 * @returns A complete HTML document.
 */
export function renderParleyListPage(user: UserRow, view: ParleyListView): string {
  const slug = `${view.harbor.namespace}/${view.harbor.name}`;
  let body: string;
  if (view.items === null) {
    body = `<div class="degraded">
      <p class="d-label">Unknown — could not read this harbor&rsquo;s parleys</p>
      <p>The relay could not list the parleys for <b>${esc(slug)}</b> just now, so this page shows
      nothing rather than guessing. No parley was changed. Reload to retry.</p>
    </div>`;
  } else if (view.items.length === 0) {
    body = `<div class="empty">
      <div class="e-title">No parleys in ${esc(slug)} yet.</div>
      <p>A parley is a signed multi-party agreement with a hard deadline: a subject, the people (and
      daemons) named to it, and one write-once position from each. It ends <b>agreed</b> only when
      every named party has signed accept — any reject, or the deadline passing, closes it as
      <b>lapsed</b>.</p>
      <p>Convene one with <span class="cmd">POST /v1/harbors/${esc(slug)}/parleys</span>, naming a
      subject and the parties. It appears here the moment it exists.</p>
    </div>`;
  } else {
    const rows = view.items
      .map((it) => {
        const p = it.parley;
        const href = `/account/parleys/${encodeURIComponent(view.harbor.namespace)}/${encodeURIComponent(view.harbor.name)}/${encodeURIComponent(p.id)}`;
        const timing =
          p.state === 'open'
            ? `deadline ${esc(fmtWhen(p.deadline_at))} · <b>${esc(fmtRemaining(p.deadline_at, view.nowSec))}</b>`
            : `${esc(p.state)} ${p.resolved_at !== null ? esc(fmtWhen(p.resolved_at)) : ''}`;
        return `<div class="prow">
        <div class="p-subject"><a href="${esc(href)}">${esc(p.subject)}</a></div>
        <div class="p-meta">proposed by <b>${esc(p.proposer_label)}</b> · convened ${esc(fmtWhen(p.created_at))}<br>${timing}</div>
        <div class="p-right">${stateBadge(p.state)}<span class="p-count">${it.signed} of ${it.parties} signed</span></div>
      </div>`;
      })
      .join('');
    const trunc = view.truncated
      ? `<div class="degraded"><p class="d-label">Partial view</p><p>Only the ${PARLEY_LIST_LIMIT} most
         recent parleys are shown. Older ones still exist and are still readable through
         <span class="cmd">GET /v1/harbors/${esc(slug)}/parleys</span>.</p></div>`
      : '';
    body = `<div class="plist">${rows}</div>${trunc}`;
  }

  return shellPage(
    `Port Daddy — Parleys in ${slug}`,
    'parleys',
    `<main class="page">
  <div class="masthead">
    <span class="eyebrow">Parleys &middot; ${esc(slug)}</span>
    <h1 class="ko">Agreements, <span class="rec">signed</span><span class="ko-over" aria-hidden="true">Agreements, <span class="rec">signed</span></span></h1>
    <span class="lede">Every parley in this harbor: what is being agreed, who is named to it, and how long
    is left. The relay orders and attests — it records who signed what and when, and never judges.
    Signed in as <b>${esc(user.login)}</b>.</span>
    ${noticeStrip(view.notice)}
    ${harborSwitcher(view.harbors, view.harbor)}
  </div>
  ${body}
</main>`,
  );
}

// ── detail rendering ─────────────────────────────────────────────────────────

/** Stance chip for one seat: signed accept/reject, or still awaiting. */
function stanceChip(pos: ParleyPositionRow): string {
  if (pos.signed_at === null || pos.stance === null) return '<span class="chip await">Awaiting</span>';
  return pos.stance === 'accept'
    ? '<span class="chip accept">Accepted</span>'
    : '<span class="chip reject">Rejected</span>';
}

/**
 * Render one named party's seat: who they are, their stance, and the exact
 * text they signed.
 *
 * The position text renders `white-space: pre-wrap` inside an escaped block so
 * an operator sees precisely what was signed, line breaks included, with no
 * markdown interpretation — a signed position must not be able to render as
 * anything other than its own literal text, or the artifact and its display
 * disagree about what was agreed.
 *
 * @param pos One `is_party = 1` position row.
 * @returns An HTML fragment for the seats list.
 */
function renderPartySeat(pos: ParleyPositionRow): string {
  const when = pos.signed_at !== null ? `signed ${fmtWhen(pos.signed_at)}` : 'not signed';
  const text = pos.position
    ? `<div class="seat-pos">${esc(pos.position)}</div>`
    : pos.signed_at !== null
      ? '<p class="seat-none">Signed without position text.</p>'
      : '<p class="seat-none">This party has not signed yet.</p>';
  return `<div class="seat">
    <div class="seat-head">
      <span class="seat-who">${esc(pos.party_label)}</span>
      <span class="seat-kind">${esc(pos.party_kind)} &middot; ${esc(pos.tier)}</span>
      ${stanceChip(pos)}
      <span class="seat-when">${esc(when)}</span>
    </div>
    ${text}
  </div>`;
}

/**
 * Render the reserved pd-mediator observer seat.
 *
 * This seat is rendered even when it has nothing to say, and that is the
 * design. The mediator is a permanent structural feature of every parley, and
 * an operator who can see the seat — labeled, explicitly marked as unable to
 * sign, with its `signed_at` visibly absent — can verify for themselves that
 * the machine participant did not and cannot participate in the outcome.
 * Hiding an idle mediator would save a few pixels and cost exactly the
 * transparency the seat exists to provide.
 *
 * When the mediator has no note the copy says so plainly rather than omitting
 * the row: "nothing to add" is a true statement covering every fail-open case
 * (switched off, no binding, model error, garbage output) without pretending
 * to distinguish them on a page where the distinction would not help.
 *
 * @param pos The mediator's `is_party = 0` observer row, if present.
 * @returns An HTML fragment, or '' when this parley carries no mediator seat.
 */
function renderMediatorSeat(pos: ParleyPositionRow | undefined): string {
  if (!pos) return '';
  const note = pos.position
    ? `<div class="seat-pos">${esc(pos.position)}</div>`
    : '<p class="seat-none">The mediator had nothing to add.</p>';
  return `<div class="seat mediator">
    <div class="seat-head">
      <span class="seat-who">${esc(pos.party_label)}</span>
      <span class="seat-kind">${esc(pos.tier)}</span>
      <span class="chip observer">Observer &mdash; cannot sign</span>
    </div>
    ${note}
    <p class="mediator-note">This seat is reserved and holds no vote. It cannot sign, cannot be named as a
    party, cannot cause or block agreement, and cannot change the deadline or anyone else&rsquo;s position.
    Anything above is a machine-written observation, not a signature.</p>
  </div>`;
}

/**
 * Render the summons ledger for a mediator-convened parley.
 *
 * Every row shows WHO was summoned, WHICH daemon speaks for them (or that
 * none does), the delivery state, and the chain coordinates of the summons —
 * because a summons here is not a notification, it is a signed event on the
 * hash chain, and showing its hash lets anyone verify delivery independently
 * of this page. The D11 legend under the strip states the agent-first rule
 * in the same plain terms the state machine enforces it.
 *
 * @param summonses The parley's summons rows (may be empty ⇒ renders '').
 * @returns An HTML fragment, or '' when this parley has no summonses.
 */
function renderSummonsSection(summonses: ParleySummonsRow[]): string {
  if (summonses.length === 0) return '';
  const rows = summonses
    .map((s) => {
      const daemon = s.daemon_fingerprint
        ? `<span class="sm-daemon">daemon ${esc(s.daemon_fingerprint.slice(0, 16))}…</span>`
        : '<span class="sm-daemon">no declared daemon — escalated to the human</span>';
      const stateChip = `<span class="chip ${esc(s.state)}">${esc(s.state)}</span>`;
      const ack =
        s.response_hash !== null
          ? `<span class="sm-hash">ack ${esc(s.response_hash.slice(0, 16))}… seq ${s.response_seq}</span>`
          : '';
      return `<div class="sm-row">
        <span class="sm-who">${esc(s.party_label)}</span>
        ${daemon}
        ${stateChip}
        <span class="sm-hash">summons ${esc(s.summons_hash.slice(0, 16))}… seq ${s.summons_seq}</span>
        ${ack}
      </div>`;
    })
    .join('');
  return `<p class="sect-label">Summonses &mdash; delivery-acknowledged, on the chain</p>
  <div class="summons">
    ${rows}
    <p class="sm-note">Agent-first: each party&rsquo;s declared daemon is summoned before its human, and only a
    daemon <b>refuse</b> or <b>escalate</b> &mdash; or the absence of any declared daemon &mdash; wakes the human.
    Every summons and every response is a signed, hash-chained relay event; the coordinates above are
    independently verifiable on the chain.</p>
  </div>`;
}

/**
 * Render the human approve gate panel, or nothing when the parley has none.
 *
 * The gate exists for IRREVERSIBLE actions only, and the panel says so. Four
 * genuinely different states render four genuinely different things:
 *
 *   1. decided            → the verdict record (who, what, when, Modify text);
 *   2. pending + can act  → the Approve / Modify / Reject form;
 *   3. pending + paused   → the SAME buttons, disabled, with the reason —
 *                           this is the one place the no-dead-buttons rule
 *                           bends, deliberately: a paused fleet is temporary,
 *                           the action WILL become available again, and
 *                           hiding the buttons would read as "no gate here";
 *   4. pending + viewer not a named party → an honest read-only panel.
 *
 * The kill-mediator flag renders the panel inert (state 3's rendering with
 * its own copy) — no surface offers a verdict the mediator cannot carry.
 *
 * @param view The detail view model.
 * @returns An HTML fragment, or '' when this parley carries no gate.
 */
function renderGateSection(view: ParleyDetailView): string {
  const { gate, harbor, parley, viewerSeat } = view;
  if (!gate) return '';

  const head = `<h2>Human approve gate<span class="gb-action">${esc(gate.action)}</span></h2>
    <p class="gb-lede">This parley guards an <b>irreversible</b> action. The mediator predicted the conflict and
    convened the parley, but only a named human party can let a ${esc(gate.action)} proceed &mdash; agents cannot
    approve their own irreversible actions.</p>`;

  if (gate.state !== 'pending') {
    const when = gate.verdict_at !== null ? ` on ${fmtWhen(gate.verdict_at)}` : '';
    const modify =
      gate.state === 'modified' && gate.modify_text
        ? `<div class="gb-modify-text">${esc(gate.modify_text)}</div>
           <p>These instructions are re-injected into the losing agent&rsquo;s re-execution.</p>`
        : '';
    return `<div class="gatebox">
      ${head}
      <div class="gb-verdict-record">
        <span class="gv-state ${esc(gate.state)}">${esc(gate.state)}</span>
        <p>Decided by <b>${esc(gate.verdict_by_label ?? 'unknown')}</b>${esc(when)}. Verdicts are write-once.</p>
        ${modify}
      </div>
    </div>`;
  }

  const viewerMayDecide = viewerSeat !== null;
  if (!viewerMayDecide) {
    return `<div class="gatebox">
      ${head}
      <div class="gb-verdict-record">
        <span class="gv-state">pending</span>
        <p>Awaiting a verdict from a named party. You can read this gate because you are a member of this
        harbor, but only the parties named to the parley may decide it.</p>
      </div>
    </div>`;
  }

  const blocked = view.fleetPaused || view.mediatorKilled;
  const disabledAttr = blocked ? ' disabled' : '';
  const blockedNote = view.mediatorKilled
    ? `<p class="gb-paused">The <b>kill-mediator</b> flag is set: the mediator is inert and this gate accepts no
       verdicts until an operator clears it.</p>`
    : view.fleetPaused
      ? `<p class="gb-paused">The fleet is <b>paused</b>. These buttons are disabled because the relay refuses to
         record a verdict it cannot enforce &mdash; resume the fleet to decide this gate.</p>`
      : '';
  const action = `/account/parleys/${encodeURIComponent(harbor.namespace)}/${encodeURIComponent(harbor.name)}/${encodeURIComponent(parley.id)}/verdict`;
  return `<form class="gatebox" method="post" action="${esc(action)}">
    ${head}
    <div class="gb-verdicts">
      <button type="submit" class="btn-verdict approve" name="verdict" value="approve"${disabledAttr}>Approve</button>
      <button type="submit" class="btn-verdict" name="verdict" value="modify"${disabledAttr}>Modify</button>
      <button type="submit" class="btn-verdict reject" name="verdict" value="reject"${disabledAttr}>Reject</button>
    </div>
    <div class="sb-field">
      <label for="modify_text">Modify instructions (required for Modify)</label>
      <textarea id="modify_text" name="modify_text" maxlength="2000"${blocked ? ' disabled' : ''}
        placeholder="What the losing agent should do differently on re-execution."></textarea>
    </div>
    ${blockedNote}
  </form>`;
}

/**
 * Render the sign form, or the honest reason there is no form.
 *
 * This function is where the "no dead buttons" rule is actually enforced, and
 * it has four outcomes rather than two because there are four genuinely
 * different reasons a viewer might not be able to sign, and collapsing them
 * would leave someone staring at a missing button with no explanation:
 *
 *   1. terminal parley  → a CLOSED panel explaining immutability;
 *   2. not a named party → a panel saying they may read but not sign;
 *   3. already signed    → a panel restating write-once, pointing at their row;
 *   4. open, named, unsigned → the form.
 *
 * Rendering a disabled button in cases 1-3 would be worse than any of these
 * panels: it would imply the action exists and is merely unavailable right
 * now, when in three of the four cases it will never be available again.
 *
 * @param view The detail view model (state, viewer seat, harbor, parley).
 * @returns An HTML fragment: exactly one of the four outcomes.
 */
function renderSignSection(view: ParleyDetailView): string {
  const { parley, viewerSeat } = view;
  if (parley.state !== 'open') {
    const when = parley.resolved_at !== null ? ` on ${fmtWhen(parley.resolved_at)}` : '';
    const why =
      parley.state === 'agreed'
        ? 'Every named party signed accept.'
        : 'Either a named party rejected, or the deadline passed without full agreement.';
    return `<div class="closedbox">
      <div class="cb-title">This parley is closed &mdash; ${esc(parley.state)}${esc(when)}.</div>
      <p>${esc(why)} A parley that has agreed or lapsed is <b>immutable</b>: no further positions can be
      signed, and the ones above can never be edited or withdrawn. The record stands as it is.</p>
    </div>`;
  }
  if (!viewerSeat) {
    return `<div class="closedbox">
      <div class="cb-title">You are not a named party.</div>
      <p>You can read this parley because you are a member of this harbor, but only the parties named
      when it was convened may sign it. Nothing here is waiting on you.</p>
    </div>`;
  }
  if (viewerSeat.signed_at !== null) {
    return `<div class="closedbox">
      <div class="cb-title">You signed this parley on ${esc(fmtWhen(viewerSeat.signed_at))}.</div>
      <p>Your position is recorded above. Signatures are <b>write-once</b> &mdash; they are never edited or
      withdrawn, which is what makes the artifact worth signing.</p>
    </div>`;
  }
  const action = `/account/parleys/${encodeURIComponent(view.harbor.namespace)}/${encodeURIComponent(view.harbor.name)}/${encodeURIComponent(parley.id)}/sign`;
  return `<form class="signbox" method="post" action="${esc(action)}">
    <h2>Sign your position</h2>
    <p class="sb-lede">You are a named party. Your signature is <b>write-once</b>: once submitted it cannot
    be edited or withdrawn. A reject closes the parley immediately &mdash; because positions are write-once,
    agreement would be permanently impossible after one.</p>
    <div class="sb-stance">
      <label><input type="radio" name="stance" value="accept" required> Accept</label>
      <label><input type="radio" name="stance" value="reject"> Reject</label>
    </div>
    <div class="sb-field">
      <label for="position">Your position (optional)</label>
      <textarea id="position" name="position" maxlength="2000" placeholder="What you are agreeing to, or why you are not."></textarea>
    </div>
    <button type="submit" class="btn-sign">Sign my position</button>
  </form>`;
}

/**
 * Render the full parley detail page.
 *
 * Exported for the same reason the list renderer is: every state this page can
 * be in — open with a form, open without one, agreed, lapsed, hostile text in
 * every field — is assertable as a pure function of a view model, with no
 * session, no D1, and no HTTP in the way.
 *
 * @param user The signed-in viewer.
 * @param view The assembled detail view model.
 * @returns A complete HTML document.
 */
export function renderParleyDetailPage(user: UserRow, view: ParleyDetailView): string {
  const { parley, positions, harbor } = view;
  const slug = `${harbor.namespace}/${harbor.name}`;
  const parties = positions.filter((p) => p.is_party === 1);
  const mediator = positions.find((p) => p.party_kind === 'mediator' && p.is_party === 0);
  const signed = parties.filter((p) => p.signed_at !== null).length;
  const listHref = `/account/parleys/${encodeURIComponent(harbor.namespace)}/${encodeURIComponent(harbor.name)}`;

  const deadlineCell =
    parley.state === 'open'
      ? `<span class="dm-v${parley.deadline_at <= view.nowSec ? ' overdue' : ''}">${esc(fmtRemaining(parley.deadline_at, view.nowSec))}</span>`
      : `<span class="dm-v">${esc(fmtWhen(parley.deadline_at))}</span>`;

  return shellPage(
    `Port Daddy — Parley in ${slug}`,
    'parleys',
    `<main class="page">
  <div class="masthead">
    <span class="eyebrow">Parley &middot; ${esc(slug)}</span>
    <h1 class="subject-h1">${esc(parley.subject)}</h1>
    <span class="lede">Signed in as <b>${esc(user.login)}</b>. <a href="${esc(listHref)}">All parleys in ${esc(slug)}</a></span>
    ${noticeStrip(view.notice)}
    <div class="detail-meta">
      <div class="dm"><span class="dm-k">State</span>${stateBadge(parley.state)}</div>
      <div class="dm"><span class="dm-k">Proposed by</span><span class="dm-v">${esc(parley.proposer_label)}</span></div>
      <div class="dm"><span class="dm-k">Convened</span><span class="dm-v">${esc(fmtWhen(parley.created_at))}</span></div>
      <div class="dm"><span class="dm-k">Deadline</span>${deadlineCell}</div>
      <div class="dm"><span class="dm-k">Deadline (UTC)</span><span class="dm-v">${esc(fmtWhen(parley.deadline_at))}</span></div>
      <div class="dm"><span class="dm-k">Signed</span><span class="dm-v">${signed} of ${parties.length}</span></div>
    </div>
  </div>

  <p class="sect-label">Named parties &mdash; every one must sign accept to agree</p>
  <div class="seats">
    ${parties.map(renderPartySeat).join('')}
  </div>

  ${mediator ? `<p class="sect-label">Reserved seat</p><div class="seats">${renderMediatorSeat(mediator)}</div>` : ''}

  ${renderSummonsSection(view.summonses)}

  ${renderOutcomeSection(view.parley)}

  ${renderGateSection(view)}

  ${renderSignSection(view)}

  <p><a class="backlink" href="${esc(listHref)}">&larr; All parleys in ${esc(slug)}</a></p>
</main>`,
  );
}

/**
 * Render the Helm-default outcome recorded on a lapsed parley, when any.
 *
 * A 'first-proceeds' lapse is the one place a closed parley carries MORE
 * information than "no agreement": the Helm's configured default elected a
 * claim order, and both humans (and both agents) should read the identical
 * fact off this page. The copy is careful to say what this is — a recorded
 * DEFAULT, not a signed agreement — because nobody signed anything.
 *
 * @param parley The parley row (outcome_json read; hostile JSON tolerated).
 * @returns An HTML fragment, or '' when no outcome was recorded.
 */
function renderOutcomeSection(parley: ParleyRow): string {
  if (!parley.outcome_json) return '';
  let outcome: { default?: unknown; proceeds?: { party?: unknown; pr?: unknown }; rebases?: { party?: unknown; pr?: unknown }; repo?: unknown };
  try {
    outcome = JSON.parse(parley.outcome_json) as typeof outcome;
  } catch {
    return ''; // corrupt outcome renders as absent, never as a fabrication
  }
  if (outcome.default !== 'first-claimant-proceeds') return '';
  const pr = (v: unknown) => (typeof v === 'number' ? ` (PR #${v})` : '');
  return `<div class="closedbox">
    <div class="cb-title">Deadline lapsed &mdash; the Helm&rsquo;s default outcome applied.</div>
    <p>No agreement was signed before the deadline, and this harbor&rsquo;s Helm configures expiry as
    <b>first claimant proceeds</b>: <b>${esc(outcome.proceeds?.party)}</b>${esc(pr(outcome.proceeds?.pr))} proceeds,
    and <b>${esc(outcome.rebases?.party)}</b>${esc(pr(outcome.rebases?.pr))} rebases. This is a recorded default,
    not a signed agreement &mdash; the artifact says exactly that, and enforcement stays with daemons and CI.</p>
  </div>`;
}

// ── handlers ─────────────────────────────────────────────────────────────────

/** Whitelisted `?notice=` code, or null. Unknown codes are dropped, not echoed. */
function readNotice(url: URL): string | null {
  const n = url.searchParams.get('notice');
  return n && Object.prototype.hasOwnProperty.call(NOTICES, n) ? n : null;
}

/**
 * GET /account/parleys — send the operator to a harbor they actually belong to.
 *
 * Why a redirect rather than a third page: parleys are always scoped to a
 * harbor, so a harbor-less parley index would be a menu that exists only to be
 * clicked through. Sending a member straight to their newest harbor's list
 * (with switcher chips there for the rest) removes a click from the common
 * case and keeps this surface at two real pages. The one case that genuinely
 * has nothing to show — a user in no harbors at all — gets an honest empty
 * state instead of a redirect to nowhere.
 *
 * @param request Inbound request (session cookie read from it).
 * @param env Worker env.
 * @returns 302 to /login, 302 to a harbor's list, or a 200 empty state.
 */
export async function handleParleysIndex(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return toLogin();
  let harbors: Array<HarborRow & { role: string }>;
  try {
    harbors = await listHarborsForUser(env.DB, session.user.id);
  } catch {
    return htmlResponse(
      shellPage(
        'Port Daddy — Parleys',
        'parleys',
        `<main class="page"><div class="notice">
          <span class="eyebrow">Parleys</span>
          <h1>Temporarily unavailable</h1>
          <p>Your harbors could not be read just now, so this page will not guess at them. No parley was
          changed. Reload to retry.</p>
        </div></main>`,
      ),
      500,
    );
  }
  const first = harbors[0];
  if (first) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/account/parleys/${encodeURIComponent(first.namespace)}/${encodeURIComponent(first.name)}`,
      },
    });
  }
  return htmlResponse(
    shellPage(
      'Port Daddy — Parleys',
      'parleys',
      `<main class="page">
  <div class="masthead">
    <span class="eyebrow">Parleys</span>
    <h1 class="ko">Agreements, <span class="rec">signed</span><span class="ko-over" aria-hidden="true">Agreements, <span class="rec">signed</span></span></h1>
    <span class="lede">A parley is a signed multi-party agreement with a hard deadline &mdash; a subject, the
    parties named to it, and one write-once position from each.</span>
  </div>
  <div class="empty">
    <div class="e-title">You are not a member of any harbor yet.</div>
    <p>Parleys live in <b>harbors</b>, so there is nowhere to show you one. Create a harbor with
    <span class="cmd">POST /v1/harbors</span>, or ask an owner to add you to theirs; your parleys appear
    here as soon as you are a member of one.</p>
  </div>
</main>`,
    ),
  );
}

/**
 * GET /account/parleys/:ns/:name — the rendered parley list for one harbor.
 *
 * Gating order is deliberate and matches the JSON API exactly: session first
 * (302 to login), then harbor membership through the SHARED
 * {@link resolveHarborMembership}, whose null answer becomes the single
 * indistinguishable 404. Only after both gates pass does the handler read any
 * parley data, so a non-member's request never touches a parley row at all.
 *
 * Lazy expiry runs before the list is read, exactly as the JSON list route
 * does it, so this page can never render an expired parley as still open.
 *
 * @param request Inbound request.
 * @param env Worker env.
 * @param namespace Harbor namespace from the path.
 * @param name Harbor name from the path.
 * @returns 302 /login, the 404 page, or the rendered list.
 */
export async function handleParleyListPage(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return toLogin();
  const gate = await resolveHarborMembership(env, session.user, namespace, name);
  if (!gate) return parleyNotFoundPage();

  const url = new URL(request.url);
  const nowSec = Math.floor(Date.now() / 1000);
  let harbors: HarborRow[] = [gate.harbor];
  try {
    harbors = await listHarborsForUser(env.DB, session.user.id);
  } catch {
    // A failed switcher read is cosmetic: fall back to just this harbor.
  }

  let items: ParleyListItem[] | null = null;
  let truncated = false;
  try {
    await applyParleyExpiries(env, gate.harbor.id, nowSec);
    const rows = await listParleys(env.DB, gate.harbor.id, PARLEY_LIST_LIMIT + 1);
    truncated = rows.length > PARLEY_LIST_LIMIT;
    const shown = rows.slice(0, PARLEY_LIST_LIMIT);
    const tallies = await tallyParleySignatures(env.DB, shown.map((p) => p.id));
    const byId = new Map(tallies.map((t) => [t.parley_id, t]));
    items = shown.map((p) => {
      const t = byId.get(p.id);
      return { parley: p, parties: t?.parties ?? 0, signed: t?.signed ?? 0 };
    });
  } catch {
    items = null; // "unknown", never a fabricated empty list
  }

  return htmlResponse(
    renderParleyListPage(session.user, {
      harbor: gate.harbor,
      harbors,
      items,
      truncated,
      notice: readNotice(url),
      nowSec,
    }),
  );
}

/**
 * GET /account/parleys/:ns/:name/:id — one parley rendered in full.
 *
 * Both gates again run before any parley data is read, and both failures
 * funnel into the identical {@link parleyNotFoundPage} — a non-member and a
 * nonexistent id are the same answer, byte for byte.
 *
 * The viewer's own seat is resolved here rather than in the renderer because
 * "can this person sign?" is an authorization question, and answering it next
 * to the gates keeps it away from the markup, where it would be easy to get
 * subtly wrong. The renderer receives the answer, not the question.
 *
 * @param request Inbound request.
 * @param env Worker env.
 * @param namespace Harbor namespace from the path.
 * @param name Harbor name from the path.
 * @param parleyId Parley id from the path.
 * @returns 302 /login, the 404 page, or the rendered detail view.
 */
export async function handleParleyDetailPage(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
  parleyId: string,
): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return toLogin();
  const gate = await resolveHarborMembership(env, session.user, namespace, name);
  if (!gate) return parleyNotFoundPage();

  const nowSec = Math.floor(Date.now() / 1000);
  let parley: ParleyRow | null;
  let positions: ParleyPositionRow[];
  try {
    parley = await resolveParleyInHarbor(env, gate.harbor, parleyId, nowSec);
    if (!parley) return parleyNotFoundPage();
    positions = await listParleyPositions(env.DB, parley.id);
  } catch {
    return htmlResponse(
      shellPage(
        'Port Daddy — Parley',
        'parleys',
        `<main class="page"><div class="notice">
          <span class="eyebrow">Parley</span>
          <h1>Temporarily unavailable</h1>
          <p>This parley could not be read just now. Nothing was changed &mdash; reload to retry.</p>
        </div></main>`,
      ),
      500,
    );
  }

  // The viewer's own seat: a named USER seat matching this session. A daemon
  // seat is never "yours" on this page — vouching for a daemon is an API act
  // (it needs a fingerprint), so the form deliberately cannot do it.
  const viewerSeat =
    positions.find((p) => p.party_kind === 'user' && p.party_id === session.user.id && p.is_party === 1) ?? null;

  // Mediator-body extras — each read best-effort: a failed gate/summons read
  // renders the parley WITHOUT its panel rather than failing the whole page
  // (the parley itself is the artifact; the panels are annotations on it).
  let mediatorGate: ParleyGateRow | null = null;
  let summonses: ParleySummonsRow[] = [];
  let fleetPaused = false;
  let mediatorKilled = false;
  try {
    mediatorGate = await getParleyGate(env.DB, parley.id);
    summonses = await listParleySummonses(env.DB, parley.id);
  } catch {
    mediatorGate = null;
    summonses = [];
  }
  try {
    fleetPaused = await getFleetPaused(env.KV);
    mediatorKilled = await getMediatorKilled(env.KV);
  } catch {
    // Unknown flag state ⇒ treat as BLOCKED, not as clear: rendering live
    // verdict buttons on an unreadable pause flag could accept a verdict the
    // relay cannot enforce, and the server-side twin would refuse it anyway.
    fleetPaused = mediatorGate !== null;
  }

  return htmlResponse(
    renderParleyDetailPage(session.user, {
      harbor: gate.harbor,
      parley,
      positions,
      viewerSeat,
      notice: readNotice(new URL(request.url)),
      nowSec,
      gate: mediatorGate,
      summonses,
      fleetPaused,
      mediatorKilled,
    }),
  );
}

/**
 * Map a gate-verdict outcome onto this surface's notice vocabulary.
 *
 * Total over {@link GateVerdictOutcome} so a new outcome degrades to the
 * generic honest notice rather than a blank page.
 */
function noticeForVerdict(outcome: GateVerdictOutcome): string {
  switch (outcome) {
    case 'approved':
      return 'verdict-approved';
    case 'modified':
      return 'verdict-modified';
    case 'rejected':
      return 'verdict-rejected';
    case 'mediator-killed':
      return 'mediator-killed';
    case 'fleet-paused':
      return 'fleet-paused';
    case 'no-gate':
      return 'no-gate';
    case 'gate-decided':
      return 'gate-decided';
    case 'not-a-party':
      return 'not-a-party';
    case 'bad-verdict':
      return 'bad-verdict';
    case 'modify-text-required':
      return 'modify-text-required';
    default:
      return 'error';
  }
}

/**
 * POST /account/parleys/:ns/:name/:id/verdict — decide the human approve gate.
 *
 * Same discipline as the sign form, for the same reasons: same-origin checked
 * before anything is parsed, session + member + parley gates funneling into
 * the identical 404, a plain urlencoded form under the script-free CSP, and
 * every DECISION delegated to the one state machine
 * ({@link renderGateVerdict} in src/mediator-body.ts) — this handler only
 * parses the form, resolves the viewer's named-party standing, and renders
 * the outcome as a redirect notice.
 *
 * The named-party requirement is resolved HERE, next to the gates, exactly
 * like the sign path resolves viewerSeat: "may this person decide?" is an
 * authorization question and stays out of the state machine's way.
 *
 * @param request The form POST.
 * @param env Worker env.
 * @param namespace Harbor namespace from the path.
 * @param name Harbor name from the path.
 * @param parleyId Parley id from the path.
 * @returns 302 /login, a 403 page, the 404 page, or a 303 back with a notice.
 */
export async function handleParleyVerdictForm(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
  parleyId: string,
): Promise<Response> {
  if (!isSameOrigin(request, env)) {
    return htmlResponse(
      shellPage(
        'Port Daddy — Refused',
        'parleys',
        `<main class="page"><div class="notice">
          <span class="eyebrow">Parleys</span>
          <h1>Cross-origin request refused</h1>
          <p>That verdict did not come from this site, so it was not recorded. Decide from the parley page
          itself. Nothing was changed.</p>
        </div></main>`,
      ),
      403,
    );
  }
  const session = await resolveSession(request, env);
  if (!session) return toLogin();
  const gate = await resolveHarborMembership(env, session.user, namespace, name);
  if (!gate) return parleyNotFoundPage();

  const nowSec = Math.floor(Date.now() / 1000);
  const parley = await resolveParleyInHarbor(env, gate.harbor, parleyId, nowSec);
  if (!parley) return parleyNotFoundPage();

  const detailHref = `/account/parleys/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/${encodeURIComponent(parleyId)}`;
  const back = (notice: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${detailHref}?notice=${encodeURIComponent(notice)}`, 'Cache-Control': 'no-store' },
    });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back('error');
  }
  const verdictRaw = form.get('verdict');
  const modifyRaw = form.get('modify_text');

  let outcome: GateVerdictOutcome;
  try {
    const positions = await listParleyPositions(env.DB, parley.id);
    const viewerSeat =
      positions.find((p) => p.party_kind === 'user' && p.party_id === session.user.id && p.is_party === 1) ?? null;
    const parleyGate = await getParleyGate(env.DB, parley.id);

    // The losing agent's re-execution target: the SECOND CLAIMANT's PR (the
    // first claimant proceeds — the same claim order the expiry default uses).
    let loserTarget: { repo: string; pr: number } | null = null;
    const pair = await getMediatorPairForParley(env.DB, parley.id);
    if (pair) {
      loserTarget = { repo: pair.repo, pr: pair.first_pr === pair.pr_lo ? pair.pr_hi : pair.pr_lo };
    }

    outcome = await renderGateVerdict(env, {
      parley,
      gate: parleyGate,
      viewerIsNamedParty: viewerSeat !== null,
      user: session.user,
      verdict: typeof verdictRaw === 'string' ? verdictRaw : '',
      modifyText: typeof modifyRaw === 'string' ? modifyRaw : null,
      loserTarget,
      now: nowSec,
    });
  } catch {
    outcome = 'error';
  }
  return back(noticeForVerdict(outcome));
}

/**
 * Map the JSON respond route's answer onto this surface's notice vocabulary.
 *
 * Kept as a total function over the codes parleys.ts actually emits, with an
 * `error` fallback, so a new API error code degrades to an honest generic
 * notice rather than a blank page or a leaked internal string.
 *
 * @param status HTTP status from handleRespondParley.
 * @param code The `code` field of its JSON envelope, when present.
 * @returns A key of the NOTICES whitelist.
 */
function noticeForRespond(status: number, code: string | undefined): string {
  if (status === 200) return 'signed';
  switch (code) {
    case 'PARLEY_CLOSED':
      return 'closed';
    case 'ALREADY_SIGNED':
      return 'already-signed';
    case 'NOT_A_PARTY':
      return 'not-a-party';
    case 'BAD_STANCE':
      return 'bad-stance';
    case 'BAD_POSITION':
      return 'bad-position';
    default:
      return 'error';
  }
}

/**
 * POST /account/parleys/:ns/:name/:id/sign — sign a position from the page.
 *
 * ── WHY A PLAIN FORM POST ────────────────────────────────────────────────────
 * This page ships under a script-free CSP, so there is no fetch() available to
 * call the JSON API with. That is a constraint worth keeping rather than
 * working around: the most security-sensitive action on this surface — putting
 * a name on a binding agreement — is performed by the oldest, best-understood
 * mechanism the web has, one that works with JS disabled and cannot be
 * silently triggered by a script that is not there.
 *
 * ── WHY IT FORWARDS TO handleRespondParley ───────────────────────────────────
 * Signing has real rules: terminal parleys are immutable, seats are write-once
 * under a CAS, only named parties may sign, a reject lapses the parley
 * immediately, and a full set of accepts agrees it. Reimplementing any of that
 * here — even carefully — would create a second state machine that could drift
 * from the first, and the drift would live in the path that WRITES agreements.
 * So this handler does exactly two things the API cannot do for itself (parse
 * a urlencoded form; answer with a redirect a browser can follow) and delegates
 * every decision to the one implementation that already makes them correctly.
 * The forwarded request carries the original's Cookie and Origin headers, so
 * the principal and the CSRF check downstream are the real ones, not
 * re-derived.
 *
 * ── CSRF ─────────────────────────────────────────────────────────────────────
 * `isSameOrigin` is checked HERE, before anything is parsed, and again inside
 * handleRespondParley — the same guard the other form surfaces use, applied
 * twice on purpose. A cross-origin post is refused with a 403 page rather than
 * a redirect, because a redirect would imply the request was understood and
 * merely unlucky; it was refused.
 *
 * @param request The form POST.
 * @param env Worker env.
 * @param namespace Harbor namespace from the path.
 * @param name Harbor name from the path.
 * @param parleyId Parley id from the path.
 * @returns 302 /login, a 403 page, the 404 page, or a 303 back to the detail view.
 */
export async function handleParleySignForm(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
  parleyId: string,
): Promise<Response> {
  if (!isSameOrigin(request, env)) {
    return htmlResponse(
      shellPage(
        'Port Daddy — Refused',
        'parleys',
        `<main class="page"><div class="notice">
          <span class="eyebrow">Parleys</span>
          <h1>Cross-origin request refused</h1>
          <p>That signature did not come from this site, so it was not recorded. Sign from the parley page
          itself. Nothing was changed.</p>
        </div></main>`,
      ),
      403,
    );
  }
  const session = await resolveSession(request, env);
  if (!session) return toLogin();
  const gate = await resolveHarborMembership(env, session.user, namespace, name);
  if (!gate) return parleyNotFoundPage();

  const detailHref = `/account/parleys/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/${encodeURIComponent(parleyId)}`;
  const back = (notice: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${detailHref}?notice=${encodeURIComponent(notice)}`, 'Cache-Control': 'no-store' },
    });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back('error');
  }
  const stance = form.get('stance');
  const positionRaw = form.get('position');
  const position = typeof positionRaw === 'string' ? positionRaw : '';

  // Forward to the ONE implementation of the signing rules, carrying the
  // caller's own credentials and origin so the gates downstream are real.
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const cookie = request.headers.get('Cookie');
  if (cookie) headers.set('Cookie', cookie);
  const origin = request.headers.get('Origin');
  if (origin) headers.set('Origin', origin);
  const referer = request.headers.get('Referer');
  if (referer) headers.set('Referer', referer);

  const forwarded = new Request(
    `${new URL(request.url).origin}/v1/harbors/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/parleys/${encodeURIComponent(parleyId)}/respond`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        stance: typeof stance === 'string' ? stance : undefined,
        position: position.trim() === '' ? undefined : position,
      }),
    },
  );

  let res: Response;
  try {
    res = await handleRespondParley(forwarded, env, namespace, name, parleyId);
  } catch {
    return back('error');
  }
  // A 404 from the respond path means the parley is unknown OR foreign to this
  // harbor — the same no-oracle answer the GET renders, so render it the same.
  if (res.status === 404) return parleyNotFoundPage();

  let code: string | undefined;
  try {
    code = ((await res.json()) as { code?: string }).code;
  } catch {
    code = undefined;
  }
  return back(noticeForRespond(res.status, code));
}

/** Re-exported so route wiring and tests can name the reserved seat once. */
export { MEDIATOR_ID };
