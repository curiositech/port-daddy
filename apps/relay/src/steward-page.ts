/**
 * apps/relay/src/steward-page.ts — "is the Steward alive, and what has it
 * decided?" (ADR-0109; docs/plans/THE_FULL_WHEEL.md §4, §5.3, §9).
 *
 *   GET /account/steward — session-gated view of the Steward's two append-only
 *   ledgers for every repo the signed-in user can read on GitHub.
 *
 * WHY THIS PAGE EXISTS. The seat's design names `steward_deck_log` its vital
 * sign: every wake must write exactly one entry, ALL QUIET included, because a
 * silent seat is indistinguishable from a dead one. That property held — and
 * the table sat at zero rows through four green PRs, because nothing armed the
 * seat's first alarm and *nothing could display the table that would have said
 * so*. Reading it required a terminal, Cloudflare credentials, and knowing the
 * schema. A vital sign no operator can read is not a vital sign; it is a file.
 * This page is the half that closes that loop, and it is deliberately the
 * smallest thing that does: read-only, no new auth surface, no writes.
 *
 * AUTHORIZATION: GitHub stays the single source of authz truth, exactly as
 * runs-page.ts does it. Repos come from the ledger itself (the roster lives in
 * the steward Worker's config, which the relay cannot see), and each distinct
 * repo is probed with `userCanReadRepo` before any of its rows render.
 * Malformed names fail closed without spending a probe.
 *
 * DATA PLANE: the relay and the steward Worker bind the same D1 database
 * (`port-daddy-relay`), so this reads the seat's tables directly through
 * `apps/shared/steward-ledgers.ts` — no service binding, no network hop, and
 * one definition of each SELECT rather than two that drift.
 *
 * Rendering is strictly server-side, story-linework via the shared TOKENS
 * block, every interpolated value esc()'d (deck-log summaries embed PR titles
 * and error text from GitHub — treat as hostile), no-store + noindex under a
 * script-free CSP.
 */

import type { Env } from './types.js';
import type { UserRow } from './db.js';
import { resolveSession, userCanReadRepo, type ResolvedSession } from './auth-github.js';
import { HEAD, TOKENS } from './account-page.js';
import {
  listStewardRepos,
  readStewardDeckLog,
  readStewardMergeLedger,
  type StewardDeckLogRow,
  type StewardMergeLedgerRow,
} from '../../shared/steward-ledgers.js';

/** Deck-log entries shown per repo. */
const DECK_LIMIT = 25;
/** Merge-ledger verdicts shown per repo. */
const LEDGER_LIMIT = 25;
/** Cap on distinct-repo GitHub readability probes per page view. */
export const MAX_REPO_CHECKS = 10;

/**
 * How long without a deck-log entry counts as overdue, in seconds.
 *
 * Matches the seat's own `STALE_WAKE_MS` (two 6h heartbeats). Kept as a
 * separate constant rather than imported because the seat's copy governs
 * *behavior* and this one governs *presentation*: if they ever diverge the
 * page should still render, showing a stale badge slightly early rather than
 * failing to load. The number is the same today and the reason they are
 * allowed to drift is written here so a future reader does not "fix" it.
 */
const STALE_AFTER_SEC = 12 * 3600;

/**
 * Minimal HTML-escape for interpolated data.
 *
 * WHY IT MATTERS HERE SPECIFICALLY: deck-log summaries embed PR titles and
 * GitHub error text, and merge-ledger evidence embeds check-run names — all
 * of it attacker-influenced by anyone who can open a PR. The page is
 * script-free by CSP, but this is the layer that must not regress, because a
 * CSP is one header edit from being weakened while an escape is local.
 *
 * @param v - Any value destined for HTML.
 * @returns The value with HTML metacharacters entity-encoded.
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
 * Wrap a rendered body in the page's security headers.
 *
 * DESIGN — same posture as runs-page.ts, for the same reason: a per-user
 * authz-filtered page must never land in a shared cache or a search index,
 * and this one needs no scripts at all, so the CSP forbids them outright
 * rather than trusting that none are ever added.
 *
 * @param body - Fully rendered HTML.
 * @param status - HTTP status.
 * @returns The response, no-store and noindex under a script-free CSP.
 */
function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/**
 * Coarse relative time ("4h ago"); ISO date beyond ~30 days.
 *
 * PURPOSE: an operator scanning for "is this seat beating" reasons in
 * elapsed time, not timestamps. Absolute dates return past a month because
 * that far out the age stops being the question and the date becomes it.
 *
 * @param nowSec - Current epoch seconds.
 * @param thenSec - Entry epoch seconds.
 * @returns Human-scannable age.
 */
function relTime(nowSec: number, thenSec: number): string {
  const d = Math.max(0, nowSec - thenSec);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 30 * 86400) return `${Math.floor(d / 86400)}d ago`;
  return new Date(thenSec * 1000).toISOString().slice(0, 10);
}

/**
 * Map a verdict onto its badge class.
 *
 * DESIGN: LAND reads as success, NEEDS-WORK as the amber "acted on, not
 * finished" state, and anything else — including SURFACE — as the neutral
 * attention colour. SURFACE is deliberately not an error style: it means the
 * seat correctly declined to decide, which is the system working.
 *
 * @param v - The stored verdict.
 * @returns The CSS badge class.
 */
function verdictClass(v: string): string {
  if (v === 'LAND') return 'success';
  if (v === 'NEEDS-WORK') return 'retrying';
  return 'other';
}

// ── seat vitals ──────────────────────────────────────────────────────────────

/** What the page can say about one seat's health from the ledger alone. */
export interface SeatVitals {
  repo: string;
  /** Epoch seconds of the newest deck-log entry, or null when never woken. */
  lastEntryAt: number | null;
  /** Total entries shown (bounded by DECK_LIMIT). */
  entries: number;
  /** `dead` — never woken. `stale` — overdue. `alive` — beating. */
  state: 'dead' | 'stale' | 'alive';
}

/**
 * Judge a seat's liveness from its deck log.
 *
 * DESIGN — three states, not two, because "never woken" and "stopped beating"
 * are different failures with different fixes and the P1 incident was the
 * first. A seat with zero entries has never run; a seat whose newest entry is
 * older than two heartbeats was running and stopped. Collapsing them into
 * "unhealthy" would have hidden exactly the thing that needed finding.
 *
 * @param repo - `owner/repo`.
 * @param deck - Deck-log rows, newest first.
 * @param nowSec - Current epoch seconds.
 * @returns The seat's vitals for the header row.
 */
export function seatVitals(
  repo: string,
  deck: StewardDeckLogRow[],
  nowSec: number,
): SeatVitals {
  const newest = deck[0];
  if (!newest) return { repo, lastEntryAt: null, entries: 0, state: 'dead' };
  const age = nowSec - newest.createdAt;
  return {
    repo,
    lastEntryAt: newest.createdAt,
    entries: deck.length,
    state: age > STALE_AFTER_SEC ? 'stale' : 'alive',
  };
}

/** One repo's fully-read seat, ready to render. */
export interface SeatView {
  vitals: SeatVitals;
  deck: StewardDeckLogRow[];
  ledger: StewardMergeLedgerRow[];
}

/**
 * Read every seat the session's user may see.
 *
 * DESIGN — repos come from the deck log rather than from configuration: the
 * roster (`STEWARD_REPOS`) lives in the steward Worker and the relay cannot read it,
 * and showing only seats that have actually written something is the honest
 * set anyway — a configured-but-never-woken repo has nothing to display and
 * should not appear as though it does.
 *
 * @param env - Relay bindings (D1 + GitHub auth).
 * @param session - The resolved session.
 * @returns Readable seats newest-activity-first, and whether the probe cap
 * hid any.
 */
export async function loadSeats(
  env: Env,
  session: ResolvedSession,
): Promise<{ seats: SeatView[]; truncated: boolean }> {
  const repos = await listStewardRepos(env.DB);
  const nowSec = Math.floor(Date.now() / 1000);
  const seats: SeatView[] = [];
  let checks = 0;
  let truncated = false;

  for (const repo of repos) {
    const parts = repo.split('/');
    const owner = parts[0];
    const name = parts[1];
    // Malformed names fail closed WITHOUT spending a GitHub probe — the probe
    // budget exists to bound fan-out, and a name that cannot be a repo should
    // never consume it.
    if (parts.length !== 2 || !owner || !name) continue;
    if (checks >= MAX_REPO_CHECKS) {
      truncated = true;
      continue;
    }
    checks += 1;
    if (!(await userCanReadRepo(env, session, owner, name))) continue;

    const [deck, ledger] = await Promise.all([
      readStewardDeckLog(env.DB, repo, DECK_LIMIT),
      readStewardMergeLedger(env.DB, repo, LEDGER_LIMIT),
    ]);
    seats.push({ vitals: seatVitals(repo, deck, nowSec), deck, ledger });
  }

  return { seats, truncated };
}

// ── page CSS (story-linework, shared TOKENS) ─────────────────────────────────

const STEWARD_CSS = `
${TOKENS}
.site-header{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:14px clamp(20px,4vw,40px);background:var(--surface-base);border-bottom:2px solid var(--border-strong)}
.sh-brand{display:flex;align-items:baseline;gap:10px;font-weight:700;font-size:17px;letter-spacing:-.01em;color:var(--text-primary);text-decoration:none}
.sh-mark{color:var(--cobalt);font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:19px}
.sh-status{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:500;color:var(--text-muted)}
.page{max-width:74rem;margin:0 auto;padding:0 clamp(20px,4vw,40px) 88px}
.masthead{padding:40px 0 10px}
.eyebrow{display:block;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:var(--text-muted)}
.masthead h1{font-size:clamp(28px,4vw,40px);font-weight:700;margin:14px 0 10px;letter-spacing:-.03em}
.masthead p{font-size:16px;color:var(--text-secondary);line-height:1.62;max-width:62ch;margin:0}
.seat{margin:36px 0 0;border:2px solid var(--border-strong);background:var(--surface-card)}
.seat-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;padding:16px 20px;border-bottom:2px solid var(--border-strong);background:var(--surface-base)}
.seat-repo{font-family:"IBM Plex Mono",monospace;font-size:16px;font-weight:700;color:var(--text-primary)}
.seat-meta{font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--text-muted);margin-left:auto}
.badge{display:inline-flex;align-items:center;gap:7px;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border:2px solid var(--border-strong);white-space:nowrap}
.badge .dot{width:8px;height:8px;flex:none;border:1px solid rgba(0,0,0,.35)}
.badge.success{background:var(--health);color:var(--on-accent)}.badge.success .dot{background:var(--on-accent)}
.badge.failure{background:var(--error);color:var(--on-accent)}.badge.failure .dot{background:var(--on-accent)}
.badge.retrying{background:var(--amber);color:var(--ink)}.badge.retrying .dot{background:var(--error)}
.badge.other{background:var(--amber);color:var(--ink)}.badge.other .dot{background:var(--ink)}
.section{padding:18px 20px 6px}
.section h2{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin:0 0 12px}
.rows{display:flex;flex-direction:column;gap:0;margin:0 0 16px}
.row{display:grid;grid-template-columns:auto auto 1fr;gap:12px;align-items:baseline;padding:10px 0;border-top:1px solid var(--hair-strong)}
.row:first-child{border-top:none}
.when{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--text-muted);white-space:nowrap}
.kind{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;color:var(--text-secondary)}
.kind.quiet{color:var(--text-muted)}
.what{font-size:14px;line-height:1.55;color:var(--text-primary);overflow-wrap:anywhere}
.what .ev{display:block;color:var(--text-secondary);font-size:13px;margin-top:3px}
.empty-line{font-size:14px;color:var(--text-muted);padding:8px 0 16px;line-height:1.6}
.notice{max-width:52rem;margin:0 auto;padding:64px 0}
.notice h1{font-size:clamp(28px,4vw,40px);font-weight:700;margin:14px 0 16px;letter-spacing:-.03em}
.notice p{font-size:16px;color:var(--text-secondary);line-height:1.62;max-width:56ch}
.footnote{margin:28px 0 0;font-size:13px;color:var(--text-muted);line-height:1.6;max-width:62ch}
`;

/**
 * Wrap page content in the shared site chrome.
 *
 * PURPOSE: one document shape for both the rendered page and the failure
 * notice, so an operator who hits an error still lands somewhere that looks
 * like Port Daddy and offers a way back to /account.
 *
 * @param inner - The `<main>` block.
 * @returns A complete HTML document.
 */
function shellPage(inner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><title>Port Daddy — The Steward</title>${HEAD}<style>${STEWARD_CSS}</style></head><body>
<header class="site-header">
  <a class="sh-brand" href="/account"><span class="sh-mark" aria-hidden="true">pd</span>Port Daddy</a>
  <span class="sh-status"><a href="/account">account</a>&ensp;/&ensp;steward</span>
</header>
${inner}
</body></html>`;
}

/**
 * Render one seat's liveness badge.
 *
 * The three states read as different sentences on purpose: "never woken" is a
 * provisioning problem, "no entry in Xh" is a runtime problem, and they want
 * different reactions from whoever is looking.
 *
 * @param v - The seat's vitals.
 * @param nowSec - Current epoch seconds.
 * @returns Badge HTML.
 */
function vitalsBadge(v: SeatVitals, nowSec: number): string {
  if (v.state === 'dead') {
    return `<span class="badge failure"><span class="dot"></span>never woken</span>`;
  }
  if (v.state === 'stale') {
    const h = Math.floor((nowSec - (v.lastEntryAt ?? nowSec)) / 3600);
    return `<span class="badge retrying"><span class="dot"></span>no entry in ${h}h</span>`;
  }
  return `<span class="badge success"><span class="dot"></span>beating</span>`;
}

/**
 * Render one seat card: vitals, deck log, merge ledger.
 *
 * DESIGN — vitals first, then the deck log, then the verdicts. That order is
 * the reading order of the question actually being asked: is it alive, what
 * has it been doing, and what did it decide. A card that led with verdicts
 * would invite trusting decisions from a seat that stopped beating days ago.
 *
 * @param seat - The loaded seat.
 * @param nowSec - Current epoch seconds.
 * @returns Card HTML.
 */
function renderSeat(seat: SeatView, nowSec: number): string {
  const { vitals, deck, ledger } = seat;
  const last = vitals.lastEntryAt === null
    ? 'no deck-log entry, ever'
    : `last beat ${relTime(nowSec, vitals.lastEntryAt)}`;

  const deckRows = deck.length
    ? deck
        .map(
          e => `<div class="row">
  <span class="when">${esc(relTime(nowSec, e.createdAt))}</span>
  <span class="kind${e.entryKind === 'all-quiet' ? ' quiet' : ''}">${esc(e.entryKind)}${
            e.wakeEvents > 0 ? ` ×${esc(e.wakeEvents)}` : ''
          }</span>
  <span class="what">${esc(e.summary)}</span>
</div>`,
        )
        .join('')
    : '';

  const ledgerRows = ledger.length
    ? ledger
        .map(
          v => `<div class="row">
  <span class="when">${esc(relTime(nowSec, v.createdAt))}</span>
  <span class="badge ${verdictClass(v.verdict)}"><span class="dot"></span>${esc(v.verdict)}</span>
  <span class="what">#${esc(v.prNumber)} &middot; requested by ${esc(v.requestedBy)}
    <span class="ev">${esc(v.evidence)}</span></span>
</div>`,
        )
        .join('')
    : '';

  return `<section class="seat">
  <div class="seat-head">
    <span class="seat-repo">${esc(vitals.repo)}</span>
    ${vitalsBadge(vitals, nowSec)}
    <span class="seat-meta">${esc(last)}</span>
  </div>
  <div class="section">
    <h2>Deck log &mdash; the vital sign</h2>
    ${deckRows || `<p class="empty-line">No entries. Every wake writes exactly one entry, so an empty
      deck log means this seat has never run &mdash; not that it has been quiet.</p>`}
  </div>
  <div class="section">
    <h2>Merge ledger &mdash; every verdict</h2>
    ${ledgerRows || `<p class="empty-line">No verdicts recorded yet.</p>`}
  </div>
</section>`;
}

/**
 * Render the whole page.
 *
 * PURPOSE: the masthead states the invariant in prose — every wake writes one
 * entry, ALL QUIET included — because the page's central claim is only
 * meaningful to a reader who knows that silence is supposed to be impossible.
 * Without it, an empty log reads as "nothing happened" instead of "something
 * is wrong".
 *
 * @param user - The signed-in user (for the chrome).
 * @param seats - Readable seats.
 * @param opts - Truncation flag and clock.
 * @returns Complete HTML.
 */
export function renderStewardPage(
  user: UserRow,
  seats: SeatView[],
  opts: { truncated: boolean; nowSec: number },
): string {
  void user;
  const body = seats.length
    ? seats.map(s => renderSeat(s, opts.nowSec)).join('')
    : `<p class="empty-line">No Steward seats are visible on your account. A seat appears here once it
       has woken at least once in a repository you can read on GitHub.</p>`;

  const truncNote = opts.truncated
    ? `<p class="footnote">Some repositories were not checked: this page probes at most
       ${MAX_REPO_CHECKS} distinct repositories per view to bound GitHub calls. Seats beyond that
       cap are not shown &mdash; this list is not complete.</p>`
    : '';

  return shellPage(`<main class="page">
  <div class="masthead">
    <span class="eyebrow">Port Daddy &middot; ADR-0109</span>
    <h1>The Steward</h1>
    <p>One seat per repository holds merge authority. Every wake writes one deck-log entry &mdash;
      including &ldquo;all quiet&rdquo; &mdash; so a silent seat is never mistaken for a healthy one.
      Every verdict it renders is recorded below with the evidence behind it.</p>
  </div>
  ${body}
  ${truncNote}
</main>`);
}

/**
 * `GET /account/steward` — session-gated Steward view.
 *
 * DESIGN — degrades to a 500 notice rather than an exception page. The ledger
 * readers already swallow their own errors and return empty, so reaching this
 * catch means the session or authz layer failed rather than the data layer,
 * and those are worth distinguishing: an empty page is a finding about the
 * seat, whereas this notice is a finding about the relay.
 *
 * @param request - The inbound request.
 * @param env - Relay bindings.
 * @returns The rendered page, or a redirect to /login.
 */
export async function handleStewardPage(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  try {
    const { seats, truncated } = await loadSeats(env, session);
    return htmlResponse(
      renderStewardPage(session.user, seats, {
        truncated,
        nowSec: Math.floor(Date.now() / 1000),
      }),
      200,
    );
  } catch {
    return htmlResponse(
      shellPage(`<main class="page"><div class="notice">
        <span class="eyebrow">Port Daddy &middot; The Steward</span>
        <h1>Temporarily unavailable</h1>
        <p>The Steward&rsquo;s ledgers could not be read. Try again shortly.</p>
      </div></main>`),
      500,
    );
  }
}
