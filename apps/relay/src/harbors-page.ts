/**
 * apps/relay/src/harbors-page.ts — the logged-in HARBORS section (grand-plan
 * wave E1/E2): the operator-facing HTML surface for X2 remote harbors.
 *
 *   GET /account/harbors            → every harbor this account belongs to
 *   GET /account/harbors/:ns/:name  → one harbor: members, presence, reachability
 *
 * WHY THIS EXISTS. X2/X3 shipped harbors, memberships, and presence as a
 * complete JSON API and no way to look at any of it. An operator deciding
 * whether a harbor can take work right now — is a daemon online? who else is
 * in the water? — had to compose an authenticated curl, which nobody does.
 * This page renders the same member-gated facts the API serves, and nothing
 * the API would not serve.
 *
 * ── DISCIPLINE (matching the relay's established storefront idiom) ───────────
 *  - SESSION-GATED. No session ⇒ 302 /login, exactly like /account/runs and
 *    /account/parleys. The pdu_ bearer path stays on the JSON API.
 *  - MEMBER-GATED, sharing the API's gate. The detail page calls the SAME
 *    resolveHarborMembership the parley routes call, so the no-existence-oracle
 *    property holds identically: a harbor you are not a member of renders the
 *    same 404 as one that does not exist, byte for byte. The list page reads
 *    ONLY listHarborsForUser(session.user.id) — every query on this surface is
 *    scoped to the authenticated account's memberships.
 *  - SCRIPT-FREE CSP. `default-src 'none'` with no `script-src` at all; this
 *    page ships zero script tags. Shipwright stays the ONE nonce-relaxed route.
 *  - `no-store` + `noindex`. Member rosters and daemon fingerprints are
 *    member-only content; they must not land in a shared cache or a crawler.
 *  - DEGRADE-IN-PLACE. A presence read that fails renders the reachability
 *    verdict as `unknown` and each member's chip as `unknown`; a member-list
 *    read that fails renders an honest "unknown" panel. The page itself never
 *    splash-blocks on hot-path data being unreadable — stale chips, not 500s.
 *  - HONEST STATES. No harbors, no daemon members, a never-seen member, and a
 *    failed read each render as themselves. The roadmap-head slot is a marked
 *    placeholder (it lands with the roadmap-projection wave), never fake data.
 *
 * ── REACHABILITY VERDICT (derived, advisory, presence-TTL based) ─────────────
 * X2 deferred reachability verdicts; this page derives one from what X3 can
 * already prove. A harbor is reachable when a daemon is there to take work:
 *
 *   possible    every daemon member has a live heartbeat (≤ PRESENCE_TTL_SECONDS)
 *   degraded    some daemon members are live, some are not
 *   impossible  no daemon member is live — including "no daemon members at all"
 *   unknown     membership or presence could not be read just now
 *
 * The verdict is ADVISORY, like everything on the operator plane: it reports
 * what the presence roster proves, and proves nothing about the daemons'
 * zero-trust channel, which this page cannot see and does not pretend to.
 */

import type { Env } from './types.js';
import type { UserRow } from './db.js';
import { resolveSession } from './auth-github.js';
import {
  listHarborMembers,
  listHarborsForUser,
  type HarborMemberListRow,
  type HarborRole,
  type HarborRow,
} from './db.js';
import { resolveHarborMembership } from './parleys.js';
import { PRESENCE_TTL_SECONDS } from './presence.js';
import { harborChannelKey, type PresenceEntry } from './harbor-channel.js';
import { HEAD, TOKENS } from './account-page.js';

// ── escaping + transport ─────────────────────────────────────────────────────

/**
 * Minimal HTML-escape for every interpolated value on this page (XSS guard).
 * Deliberately a local copy of the sibling pages' five-replacement function —
 * each storefront page owns its own so no page can be made unsafe by an edit
 * to somebody else's module.
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
 * Wrap rendered HTML in this surface's response headers. One function, every
 * response — the header set IS the policy. Script-free CSP (no script-src at
 * all), no-store, noindex: member rosters do not belong in caches or crawlers.
 */
function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; base-uri 'none'; " +
        "form-action 'self'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/** Session-less browsers go to /login, exactly like the sibling account pages. */
const toLogin = () => new Response(null, { status: 302, headers: { Location: '/login' } });

// ── page CSS (story-linework; TOKENS single-sourced from account-page.ts) ────

const HARBORS_CSS = `
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
/* HOTEL — "I have a pilot on board": the harbor roster flag */
.flag-hotel{display:inline-block;width:28px;height:20px;flex:none;border:1px solid var(--hair-strong);align-self:center;background:linear-gradient(to right,var(--flag-white) 0 50%,var(--rust-slab) 50% 100%)}
.flag-title{display:flex;align-items:center;gap:12px}
.flag-mean{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)}
/* the detail headline is a user-named slug of arbitrary length — ink rule, not
   the knockout slab (same reasoning as the parley subject headline). */
.slug-h1{margin-top:6px;font-family:"IBM Plex Mono",monospace;font-size:clamp(24px,3.2vw,38px);font-weight:700;line-height:1.14;letter-spacing:-.02em;overflow-wrap:anywhere;padding-left:18px;box-shadow:inset 4px 0 0 var(--cobalt)}
/* reachability verdict chip — the page's one loud color block per harbor */
.reach{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:4px 10px;border:2px solid var(--border-strong);white-space:nowrap}
.reach-possible{background:var(--health);color:var(--on-accent)}
.reach-degraded{background:var(--amber);color:var(--on-accent)}
.reach-impossible{background:var(--error);color:var(--on-accent)}
.reach-unknown{background:transparent;color:var(--text-muted);border-color:var(--hair-strong)}
/* presence chips — degrade-in-place: stale is a state, not an error page */
.pres{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:3px 9px;border:1px solid var(--hair-strong);white-space:nowrap}
.pres.online{background:var(--health);color:var(--on-accent);border-color:var(--border-strong)}
.pres.stale{background:transparent;color:var(--amber);border-color:var(--amber)}
.pres.never{background:transparent;color:var(--text-ghost);border-color:var(--hair)}
.pres.unknown{background:transparent;color:var(--text-muted);border-color:var(--hair-strong)}
.rolechip{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:3px 9px;border:1px solid var(--hair-strong);color:var(--text-secondary)}
.rolechip.owner{border-color:var(--cobalt);color:var(--cobalt)}
/* harbor list */
.hlist{margin-top:26px;border:2px solid var(--border-strong);background:var(--surface-raised)}
.hrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 18px;padding:16px 20px;align-items:baseline}
.hrow + .hrow{border-top:1px solid var(--hair)}
.hrow .h-slug{font-family:"IBM Plex Mono",monospace;font-size:17px;font-weight:600;letter-spacing:-.01em;min-width:0;overflow-wrap:anywhere}
.hrow .h-slug a{color:var(--text-primary);text-decoration:none;box-shadow:inset 0 -1px 0 var(--hair-strong)}
.hrow .h-slug a:hover{color:var(--cobalt);box-shadow:inset 0 -1px 0 var(--cobalt)}
.hrow .h-meta{grid-column:1;font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--text-muted);line-height:1.7;overflow-wrap:anywhere}
.hrow .h-meta b{color:var(--text-secondary);font-weight:600}
.hrow .h-right{grid-column:2;grid-row:1 / span 2;display:flex;flex-direction:column;align-items:flex-end;gap:8px;text-align:right}
/* detail meta plate */
.detail-meta{display:flex;flex-wrap:wrap;gap:10px 26px;margin-top:24px;padding:16px 20px;border:1px solid var(--hair);background:var(--surface-card)}
.dm{display:flex;flex-direction:column;gap:3px;min-width:0}
.dm .dm-k{font-family:"IBM Plex Mono",monospace;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted)}
.dm .dm-v{font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:600;color:var(--text-primary);overflow-wrap:anywhere}
.sect-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--text-muted);margin:34px 0 12px}
/* member roster */
.roster{border:2px solid var(--border-strong);background:var(--surface-raised)}
.member{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px 14px;padding:15px 20px}
.member + .member{border-top:1px solid var(--hair)}
.m-who{font-family:"IBM Plex Mono",monospace;font-size:15px;font-weight:700;color:var(--text-primary);overflow-wrap:anywhere;min-width:0}
.m-kind{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--text-muted)}
.m-when{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--text-muted);margin-left:auto;white-space:nowrap}
/* doors into sibling surfaces */
.doors{display:flex;flex-wrap:wrap;gap:12px;margin-top:4px}
.door-cta{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:700;letter-spacing:.02em;padding:11px 18px;border:2px solid var(--border-strong);background:var(--cobalt-slab);color:var(--cream);text-decoration:none}
.door-cta:hover{background:var(--border-strong);color:var(--surface-base)}
.door-cta.ghost{background:transparent;color:var(--text-primary);box-shadow:inset var(--lw-stripe) 0 0 var(--teal)}
.door-cta.ghost:hover{background:var(--border-strong);color:var(--surface-base)}
.doors-note{display:block;margin-top:10px;font-size:13.5px;color:var(--text-muted);line-height:1.6;max-width:66ch}
/* marked placeholder — the roadmap head lands with the roadmap-projection wave */
.soonbox{border:1px dashed var(--hair-strong);padding:20px 22px;max-width:68ch}
.soonbox .soon-label{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);border:1px solid var(--hair-strong);padding:3px 9px;margin-bottom:10px}
.soonbox p{font-size:14.5px;color:var(--text-secondary);line-height:1.6}
/* empty + degraded */
.empty{margin-top:34px;border:2px dashed var(--hair-strong);padding:26px}
.empty .e-title{font-weight:700;font-size:17px}
.empty p{font-size:14.5px;color:var(--text-secondary);line-height:1.6;margin-top:8px;max-width:68ch}
.empty .cmd{font-family:"IBM Plex Mono",monospace;font-size:13.5px;color:var(--teal);font-weight:600}
.degraded{margin-top:14px;background:var(--surface-card);border:1px solid var(--hair);padding:18px 22px;box-shadow:inset 3px 0 0 var(--amber);max-width:52rem}
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
  .hrow{grid-template-columns:minmax(0,1fr)}
  .hrow .h-right{grid-column:1;grid-row:auto;align-items:flex-start;text-align:left;flex-direction:row;flex-wrap:wrap}
  .m-when{margin-left:0;flex-basis:100%}
}
`;

// ── shell + 404 ──────────────────────────────────────────────────────────────

/** Wrap page content in the shared storefront chrome (same idiom as parleys). */
function shellPage(title: string, crumb: string, inner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><title>${esc(title)}</title>${HEAD}<style>${HARBORS_CSS}</style></head><body>
<header class="site-header">
  <a class="sh-brand" href="/account"><span class="sh-mark" aria-hidden="true">pd</span>Port Daddy</a>
  <span class="sh-status"><a href="/account">account</a>&ensp;/&ensp;${esc(crumb)}</span>
</header>
${inner}
</body></html>`;
}

/**
 * The single 404 this surface serves — for an unknown harbor and for a harbor
 * the viewer is not a member of, without distinction. Identical bytes, or a
 * session holder could enumerate which namespaces and names exist by reading
 * the difference. Same rule, same copy shape, as the parley surface's 404.
 */
function notFoundPage(): Response {
  return htmlResponse(
    shellPage(
      'Port Daddy — Harbor not found',
      'harbors',
      `<main class="page"><div class="notice">
        <span class="eyebrow">Harbors</span>
        <h1>Not found</h1>
        <p>There is no such harbor here, or it is not yours to read. This page does not say which —
        telling you a harbor exists but is closed to you would be its own kind of leak.</p>
        <p><a class="backlink" href="/account/harbors">&larr; Your harbors</a></p>
      </div></main>`,
    ),
    404,
  );
}

// ── formatting ───────────────────────────────────────────────────────────────

/** Unix seconds → fixed `YYYY-MM-DD HH:MM UTC` (shared-artifact honesty rule). */
function fmtWhen(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Render "how long ago" at human scale — seconds, then minutes, hours, days.
 * Used on stale presence chips, where the gap IS the information.
 */
export function fmtAgo(deltaSec: number): string {
  if (deltaSec < 60) return `${Math.max(deltaSec, 0)}s ago`;
  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── reachability (pure derivation — unit-tested across TTL fixtures) ─────────

export type ReachabilityVerdict = 'possible' | 'degraded' | 'impossible' | 'unknown';

export interface ReachabilityView {
  verdict: ReachabilityVerdict;
  onlineDaemons: number;
  totalDaemons: number;
}

/**
 * Derive the advisory reachability verdict for one harbor.
 *
 * Pure by design: membership and presence are read (and allowed to fail)
 * elsewhere, so this function can be pinned across TTL fixtures without a DO
 * in the room. Two independent "unknown" inputs exist because two independent
 * reads can fail: `daemonMemberIds === null` means the MEMBERSHIP read failed,
 * `presence === null` means the PRESENCE read failed; either alone is enough
 * to make any possible/impossible claim a guess, so either yields `unknown`.
 *
 * A daemon counts as online while `now - last_seen <= PRESENCE_TTL_SECONDS` —
 * the exact predicate presence.ts serves on GET /presence, deliberately
 * duplicated at the same constant so the chip and the API can never disagree.
 * Only entries that are BOTH daemon-kind AND currently in the membership list
 * count: a stray roster entry for a since-removed daemon proves nothing about
 * whether this harbor's work can land.
 *
 * @param daemonMemberIds Fingerprints of the harbor's daemon members, or null
 *   when the membership read failed.
 * @param presence The harbor's presence roster, or null when unreadable.
 * @param nowSec Current unix seconds.
 */
export function deriveReachability(
  daemonMemberIds: readonly string[] | null,
  presence: readonly PresenceEntry[] | null,
  nowSec: number,
): ReachabilityView {
  if (daemonMemberIds === null || presence === null) {
    return { verdict: 'unknown', onlineDaemons: 0, totalDaemons: daemonMemberIds?.length ?? 0 };
  }
  const total = daemonMemberIds.length;
  if (total === 0) return { verdict: 'impossible', onlineDaemons: 0, totalDaemons: 0 };
  const online = daemonMemberIds.filter((id) =>
    presence.some((e) => e.kind === 'daemon' && e.id === id && nowSec - e.last_seen <= PRESENCE_TTL_SECONDS),
  ).length;
  if (online === 0) return { verdict: 'impossible', onlineDaemons: 0, totalDaemons: total };
  if (online === total) return { verdict: 'possible', onlineDaemons: online, totalDaemons: total };
  return { verdict: 'degraded', onlineDaemons: online, totalDaemons: total };
}

/** The verdict chip — the one place a reachability verdict becomes a colour. */
export function reachabilityChip(reach: ReachabilityView): string {
  const detail =
    reach.verdict === 'unknown'
      ? 'presence unreadable'
      : reach.totalDaemons === 0
        ? 'no daemon members'
        : `${reach.onlineDaemons}/${reach.totalDaemons} daemons online`;
  return `<span class="reach reach-${reach.verdict}">${reach.verdict} &middot; ${esc(detail)}</span>`;
}

// ── presence reads (fail-to-null: honest "unknown", never a splash-block) ────

/**
 * Read a harbor's presence roster from its HarborChannel DO. Any failure —
 * DO unreachable, bad body — returns null, which every consumer renders as
 * `unknown`. Hot-path data being unreadable must never sink the page.
 */
async function readPresence(env: Env, harborId: string): Promise<PresenceEntry[] | null> {
  try {
    const doId = env.HARBOR_CHANNEL.idFromName(harborChannelKey(harborId, 'presence'));
    const res = await env.HARBOR_CHANNEL.get(doId).fetch('http://do/?action=presence-list');
    const body = (await res.json()) as { entries?: PresenceEntry[] };
    return Array.isArray(body.entries) ? body.entries : [];
  } catch {
    return null;
  }
}

// ── view models ──────────────────────────────────────────────────────────────

/** One member row with its presence chip state resolved. */
export interface MemberPresenceView {
  member: HarborMemberListRow;
  /** online = beat within TTL; stale = seen, expired; never = no roster entry;
   *  unknown = the roster itself was unreadable. */
  state: 'online' | 'stale' | 'never' | 'unknown';
  lastSeenAt: number | null;
}

/**
 * Resolve one membership row against the presence roster. Pure, exported for
 * the TTL fixture tests: online/stale/never/unknown are decided here and only
 * here, on the same TTL constant the API uses.
 */
export function memberPresence(
  member: HarborMemberListRow,
  presence: readonly PresenceEntry[] | null,
  nowSec: number,
): MemberPresenceView {
  if (presence === null) return { member, state: 'unknown', lastSeenAt: null };
  const entry = presence.find((e) => e.kind === member.member_kind && e.id === member.member_id);
  if (!entry) return { member, state: 'never', lastSeenAt: null };
  return {
    member,
    state: nowSec - entry.last_seen <= PRESENCE_TTL_SECONDS ? 'online' : 'stale',
    lastSeenAt: entry.last_seen,
  };
}

/** One row of the rendered harbor list. */
export interface HarborListItem {
  harbor: HarborRow & { role: HarborRole };
  /** null ⇒ the member read failed — render "members unknown", never a zero. */
  memberCount: number | null;
  reach: ReachabilityView;
}

/** Everything the detail page renders. */
export interface HarborDetailView {
  harbor: HarborRow;
  role: HarborRole;
  /** null ⇒ the member read failed; render "unknown", never a fabricated roster. */
  members: MemberPresenceView[] | null;
  reach: ReachabilityView;
  nowSec: number;
}

// ── list rendering ───────────────────────────────────────────────────────────

function roleChip(role: HarborRole): string {
  return `<span class="rolechip ${esc(role)}">${esc(role)}</span>`;
}

/**
 * Render the harbors list page. Exported so tests can assert on markup as a
 * pure function of a view model. Three states: populated, honestly empty, and
 * (via each row's null memberCount / unknown verdict) honestly degraded.
 */
export function renderHarborsListPage(user: UserRow, items: HarborListItem[]): string {
  let body: string;
  if (items.length === 0) {
    body = `<div class="empty">
      <div class="e-title">Personal harbor only.</div>
      <p>Your local daemon is your personal harbor — you are the only authority and nothing leaves the
      machine unless you say so. Remote harbors are the shared rooms: a name in a namespace, an ed25519
      key generated on YOUR machine, and a membership list the relay merely keeps.</p>
      <p>Create one with <span class="cmd">POST /v1/harbors</span> (name + client-generated pubkey — the
      namespace is your GitHub login, and the relay never holds a private key), or ask an owner to add
      you to theirs. Your harbors appear here the moment you are a member of one.</p>
    </div>`;
  } else {
    const rows = items
      .map((it) => {
        const h = it.harbor;
        const slug = `${h.namespace}/${h.name}`;
        const href = `/account/harbors/${encodeURIComponent(h.namespace)}/${encodeURIComponent(h.name)}`;
        const count =
          it.memberCount === null
            ? 'members unknown'
            : `${it.memberCount} member${it.memberCount === 1 ? '' : 's'}`;
        return `<div class="hrow">
        <div class="h-slug"><a href="${esc(href)}">${esc(slug)}</a></div>
        <div class="h-meta"><b>${esc(count)}</b> &middot; created ${esc(fmtWhen(h.created_at))}</div>
        <div class="h-right">${reachabilityChip(it.reach)}${roleChip(h.role)}</div>
      </div>`;
      })
      .join('');
    body = `<div class="hlist">${rows}</div>`;
  }

  return shellPage(
    'Port Daddy — Your harbors',
    'harbors',
    `<main class="page">
  <div class="masthead">
    <span class="eyebrow">Harbors</span>
    <h1 class="ko">Where your <span class="rec">agents</span> work<span class="ko-over" aria-hidden="true">Where your <span class="rec">agents</span> work</span></h1>
    <span class="lede">Every remote harbor your account belongs to: who is in it, and whether it can take
    work right now. The verdict is advisory — it reports the presence roster (heartbeats with a
    ${PRESENCE_TTL_SECONDS}s time-to-live), and the relay never holds a harbor&rsquo;s private key.
    Signed in as <b>${esc(user.login)}</b>.</span>
  </div>
  ${body}
</main>`,
  );
}

// ── detail rendering ─────────────────────────────────────────────────────────

/** One member row: identity, kind, role, added date, presence chip. */
function renderMemberRow(mp: MemberPresenceView, nowSec: number): string {
  const m = mp.member;
  const who = m.member_kind === 'user' ? (m.login ?? m.member_id) : m.member_id;
  let chip: string;
  let when: string;
  switch (mp.state) {
    case 'online':
      chip = '<span class="pres online">Online</span>';
      when = 'heartbeat live';
      break;
    case 'stale':
      chip = `<span class="pres stale">Last seen ${esc(fmtAgo(nowSec - (mp.lastSeenAt ?? nowSec)))}</span>`;
      when = mp.lastSeenAt !== null ? `last heartbeat ${fmtWhen(mp.lastSeenAt)}` : '';
      break;
    case 'never':
      chip = '<span class="pres never">Never seen here</span>';
      when = 'no heartbeat recorded';
      break;
    default:
      chip = '<span class="pres unknown">Presence unknown</span>';
      when = 'roster unreadable just now';
  }
  return `<div class="member">
    <span class="m-who">${esc(who)}</span>
    <span class="m-kind">${esc(m.member_kind)}</span>
    ${roleChip(m.role)}
    ${chip}
    <span class="m-when">added ${esc(fmtWhen(m.added_at))}${when ? ` &middot; ${esc(when)}` : ''}</span>
  </div>`;
}

/**
 * Render the harbor detail page: the meta plate, the member roster with live
 * presence chips, the doors into sibling surfaces, and the honestly-marked
 * roadmap-head placeholder. Exported for pure-render tests.
 */
export function renderHarborDetailPage(user: UserRow, view: HarborDetailView): string {
  const { harbor, members, reach, nowSec } = view;
  const slug = `${harbor.namespace}/${harbor.name}`;
  const parleysHref = `/account/parleys/${encodeURIComponent(harbor.namespace)}/${encodeURIComponent(harbor.name)}`;

  const roster =
    members === null
      ? `<div class="degraded">
      <p class="d-label">Unknown — could not read this harbor&rsquo;s members</p>
      <p>The relay could not list the members of <b>${esc(slug)}</b> just now, so this page shows
      nothing rather than guessing. Nothing was changed. Reload to retry.</p>
    </div>`
      : `<div class="roster">${members.map((mp) => renderMemberRow(mp, nowSec)).join('')}</div>`;

  const presenceNote =
    reach.verdict === 'unknown'
      ? `<div class="degraded">
      <p class="d-label">Presence unreadable</p>
      <p>The live roster could not be read just now, so every presence chip below says <b>unknown</b>
      and the reachability verdict does too — stale answers beat invented ones. Reload to retry.</p>
    </div>`
      : '';

  return shellPage(
    `Port Daddy — Harbor ${slug}`,
    'harbors',
    `<main class="page">
  <div class="masthead">
    <span class="eyebrow">Harbor</span>
    <h1 class="slug-h1">${esc(slug)}</h1>
    <span class="lede">Signed in as <b>${esc(user.login)}</b>. <a href="/account/harbors">All your harbors</a></span>
    <div class="detail-meta">
      <div class="dm"><span class="dm-k">Reachability</span>${reachabilityChip(reach)}</div>
      <div class="dm"><span class="dm-k">Your role</span>${roleChip(view.role)}</div>
      <div class="dm"><span class="dm-k">Created</span><span class="dm-v">${esc(fmtWhen(harbor.created_at))}</span></div>
      <div class="dm"><span class="dm-k">Members</span><span class="dm-v">${members === null ? 'unknown' : members.length}</span></div>
      <div class="dm"><span class="dm-k">Harbor pubkey (ed25519, client-held key)</span><span class="dm-v">${esc(harbor.pubkey)}</span></div>
    </div>
    ${presenceNote}
  </div>

  <div class="flag-title" style="margin-top:34px">
    <i class="flag-hotel" role="img" aria-label="Hotel signal flag: I have a pilot on board"></i>
    <p class="sect-label" style="margin:0">Members &mdash; who may read this harbor</p>
    <span class="flag-mean">Hotel &mdash; I have a pilot on board</span>
  </div>
  ${roster}
  <span class="doors-note">Presence is a heartbeat roster with a ${PRESENCE_TTL_SECONDS}s time-to-live —
  <b>online</b> means a live heartbeat, <b>last seen</b> shows exactly how stale a silent member is, and
  daemon liveness here is vouched by an authenticated member operator, not proven on the daemons&rsquo;
  own zero-trust channel.</span>

  <p class="sect-label">Doors</p>
  <div class="doors">
    <a class="door-cta" href="${esc(parleysHref)}">Parleys in this harbor &rarr;</a>
    <a class="door-cta ghost" href="/account/runs">Fleet-run receipts &rarr;</a>
  </div>
  <span class="doors-note">Receipts are account-scoped today — every run your GitHub identity can read
  on <a href="/account/runs">Your fleet runs</a>. A per-harbor filter is not built yet, and this page
  will not pretend otherwise.</span>

  <p class="sect-label">Roadmap head</p>
  <div class="soonbox">
    <span class="soon-label">Landing with the roadmap-projection wave</span>
    <p>Each harbor will surface the head of its roadmap here — the next gate, who holds it, and what is
    blocked on whom — projected from the same roadmap document the daemon and console read. Until that
    wave lands, this slot stays honestly empty rather than guessing.</p>
  </div>

  <p><a class="backlink" href="/account/harbors">&larr; All your harbors</a></p>
</main>`,
  );
}

// ── handlers ─────────────────────────────────────────────────────────────────

/**
 * GET /account/harbors — every harbor the signed-in account belongs to.
 *
 * Tenancy: the ONLY harbor query is listHarborsForUser(session.user.id); this
 * page cannot render a harbor the viewer is not a member of. Per-harbor member
 * and presence reads each fail to null independently, so one sick harbor (or
 * one cold DO) degrades its own row and nothing else.
 */
export async function handleHarborsPage(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return toLogin();

  let harbors: Array<HarborRow & { role: HarborRole }>;
  try {
    harbors = await listHarborsForUser(env.DB, session.user.id);
  } catch {
    return htmlResponse(
      shellPage(
        'Port Daddy — Your harbors',
        'harbors',
        `<main class="page"><div class="notice">
          <span class="eyebrow">Harbors</span>
          <h1>Temporarily unavailable</h1>
          <p>Your harbors could not be read just now, so this page will not guess at them. Nothing was
          changed. Reload to retry.</p>
        </div></main>`,
      ),
      500,
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const items: HarborListItem[] = [];
  for (const harbor of harbors) {
    let members: HarborMemberListRow[] | null;
    try {
      members = await listHarborMembers(env.DB, harbor.id);
    } catch {
      members = null; // this row renders "members unknown"; the page survives
    }
    const presence = await readPresence(env, harbor.id);
    const daemonIds = members === null ? null : members.filter((m) => m.member_kind === 'daemon').map((m) => m.member_id);
    items.push({
      harbor,
      memberCount: members === null ? null : members.length,
      reach: deriveReachability(daemonIds, presence, nowSec),
    });
  }

  return htmlResponse(renderHarborsListPage(session.user, items));
}

/**
 * GET /account/harbors/:ns/:name — one harbor rendered in full.
 *
 * Gating order matches the JSON API exactly: session first (302 /login), then
 * membership through the SHARED resolveHarborMembership, whose null answer
 * becomes the single indistinguishable 404. Only after both gates pass does
 * the handler read members or presence, so a non-member's request never
 * touches a roster at all.
 */
export async function handleHarborDetailPage(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return toLogin();
  const gate = await resolveHarborMembership(env, session.user, namespace, name);
  if (!gate) return notFoundPage();

  const nowSec = Math.floor(Date.now() / 1000);
  let members: HarborMemberListRow[] | null;
  try {
    members = await listHarborMembers(env.DB, gate.harbor.id);
  } catch {
    members = null; // "unknown", never a fabricated empty roster
  }
  const presence = await readPresence(env, gate.harbor.id);
  const daemonIds = members === null ? null : members.filter((m) => m.member_kind === 'daemon').map((m) => m.member_id);

  return htmlResponse(
    renderHarborDetailPage(session.user, {
      harbor: gate.harbor,
      role: gate.role,
      members: members === null ? null : members.map((m) => memberPresence(m, presence, nowSec)),
      reach: deriveReachability(daemonIds, presence, nowSec),
      nowSec,
    }),
  );
}
