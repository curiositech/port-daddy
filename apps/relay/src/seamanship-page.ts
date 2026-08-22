/**
 * apps/relay/src/seamanship-page.ts — the Seamanship surfaces.
 *
 *   GET  /account/seamanship          — the operator's own skill catalog,
 *                                       grouped by the repo each skill lives in.
 *   POST /account/seamanship/publish  — plain-form listing sync (same-origin).
 *   GET  /skills                      — the PUBLIC directory: names and
 *                                       descriptions of opted-in skills only.
 *   GET  /skills/@:login/:id          — one public skill. The full SKILL.md body
 *                                       renders only for a signed-in account AND
 *                                       only at `visibility: public`.
 *
 * ── WHAT THIS PAGE IS ALLOWED TO SAY ────────────────────────────────────────
 *
 * The operator's ruling governs the copy as much as the code:
 *
 *   "Skills need to be particular to a person and a repo for now. We do not
 *    distribute these 300 skills, they're Erich Owens' and they are particular
 *    to his repos."
 *
 * So the account page renders PRIVATE AS THE UNMARKED CASE. A private skill gets
 * no badge, no lock glyph, no "restricted" chip — because private is not a state
 * a skill is in, it is the absence of a decision to publish, and marking it would
 * imply the opposite default. Only `listed` and `public` are marked, because only
 * they are things someone chose. This mirrors the CLI's `formatVisibilityMarker`
 * exactly, and for the same reason: a fully-private catalog must render exactly
 * as it did before visibility existed.
 *
 * Every exposure decision on these pages routes through `isPublishableSkill`
 * (src/seamanship.ts, itself re-exporting lib/shipwright/skill-visibility.ts).
 * This module never compares `visibility` to authorize anything; it compares it
 * only to choose a label.
 *
 * ── NO POTEMKIN ─────────────────────────────────────────────────────────────
 *
 * At the time of writing, zero of the operator's ~306 SKILL.md files declare
 * `visibility:`. That means the honest primary state of the public listing is
 * EMPTY, and the account page's job is to teach the opt-in rather than to imply
 * one already happened. The empty states below are the design, not a placeholder
 * for one. Likewise the graft-history section states plainly that graft events
 * are recorded by the daemon's engine and are not mirrored to this relay yet —
 * it renders no rows rather than inventing them.
 *
 * Script-free (no client JS, no nonce), no-store, noindex on the member page.
 */

import type { Env } from './types.js';
import type { UserRow } from './db.js';
import { isSameOrigin, resolveSession } from './auth-github.js';
import { HEAD, TOKENS } from './account-page.js';
import {
  allSkills,
  isPublishableSkill,
  parseQualifiedSkillId,
  qualifySkillId,
  resolvePairsWith,
  resolveSkillBody,
  scanOperatorCatalog,
  syncSkillListings,
  MAX_REPOS_SCANNED,
  MAX_SKILL_READS,
  PUBLIC_LISTING_LIMIT,
  SKILL_CACHE_TTL_SECONDS,
  type CatalogScan,
  type ListedSkill,
  type RelaySkillEntry,
  type ScannedRepo,
  type SkillVisibility,
} from './seamanship.js';

/**
 * Minimal HTML-escape for interpolated data (XSS guard). Each storefront page
 * owns its own copy on purpose, so no page can be made unsafe by an edit to
 * somebody else's module. Skill names, descriptions and tags come out of
 * arbitrary repository files — treat every one of them as hostile.
 */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const toLogin = () => new Response(null, { status: 302, headers: { Location: '/login' } });

/** Response wrapper for the MEMBER page: no-store, noindex, script-free. */
function memberHtml(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/** Response wrapper for the PUBLIC directory: indexable, briefly cacheable. */
function publicHtml(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  Design tokens — story-linework, plus three ICS signal flags
// ══════════════════════════════════════════════════════════════════════════
//
// Flags are chosen for their real meaning in the International Code of
// Signals, never decoratively (unified-design-language rule 7):
//
//   PAPA  ("Blue Peter") — in harbour: "all persons should report on board,
//          the vessel is about to proceed to sea." The muster flag. A skill
//          catalog is exactly that: what is aboard, checked before sailing.
//   SIERRA — "I am operating astern propulsion." The one flag in the code
//          whose meaning is purely an engine order — the right hoist over a
//          section about the engine-room crew.
//   CHARLIE — "Yes / affirmative." The public directory holds precisely the
//          skills whose authors answered yes. Nothing else is in it.
const SEAMANSHIP_CSS = `
${TOKENS}
/* ICS red is a flag colour, not a UI state colour — theme-invariant. */
:root{--ics-red:#c0202a}
.site-header{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:14px clamp(20px,4vw,40px);background:var(--surface-base);border-bottom:2px solid var(--border-strong)}
.sh-brand{display:flex;align-items:baseline;gap:10px;font-weight:700;font-size:17px;letter-spacing:-.01em;color:var(--text-primary);text-decoration:none}
.sh-mark{color:var(--cobalt);font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:19px}
.sh-status{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:500;color:var(--text-muted)}
.page{max-width:74rem;margin:0 auto;padding:0 clamp(20px,4vw,40px) 88px}
.masthead{padding:40px 0 10px}
.masthead .eyebrow{display:block;margin-bottom:16px}
.ko{position:relative;z-index:0;display:inline-block;--ko-r:60%;font-size:clamp(30px,4.4vw,52px);font-weight:700;line-height:1.08;letter-spacing:-.03em;max-width:20ch}
.ko::before{content:"";position:absolute;z-index:-1;left:-56px;right:calc(100% - var(--ko-r));top:-14px;bottom:-14px;background:var(--cobalt-slab)}
.ko .ko-over{position:absolute;inset:0;color:var(--cream);pointer-events:none;clip-path:inset(-14px calc(100% - var(--ko-r)) -14px -56px)}
.ko .rec{color:var(--cobalt)}
.ko .ko-over .rec{color:var(--cream)}
.lede{display:block;margin-top:22px;max-width:64ch;font-size:15px;color:var(--text-secondary);line-height:1.6}
/* ICS flags — pure CSS, 28x20, hairline bordered */
.flag{display:inline-block;width:28px;height:20px;flex:none;border:1px solid var(--hair-strong)}
.flag-papa{background:linear-gradient(var(--flag-white),var(--flag-white)) center/50% 50% no-repeat,var(--cobalt-slab)}
.flag-sierra{background:linear-gradient(var(--cobalt-slab),var(--cobalt-slab)) center/50% 50% no-repeat,var(--flag-white)}
.flag-charlie{background:linear-gradient(to bottom,var(--cobalt-slab) 0 20%,var(--flag-white) 20% 40%,var(--ics-red) 40% 60%,var(--flag-white) 60% 80%,var(--cobalt-slab) 80% 100%)}
.flag-title{display:flex;align-items:center;gap:12px}
.flag-mean{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)}
section.sect{padding-top:52px;margin-top:52px;position:relative}
section.sect::before{content:"";position:absolute;top:0;left:0;right:0;height:var(--lw-weight);background-image:linear-gradient(to right,transparent 0 32%,var(--border-strong) 32% 68%,transparent 68% 100%)}
.sect-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px}
.sect-head h2{font-size:24px;font-weight:700;letter-spacing:-.02em}
.sect-head .eyebrow{display:block;margin-bottom:6px}
.prose{max-width:66ch}
.prose p{margin-top:14px;font-size:15.5px;line-height:1.65;color:var(--text-secondary)}
.prose p:first-child{margin-top:0}
.prose strong{color:var(--text-primary);font-weight:700}
.prose code{font-size:14px;color:var(--teal);font-weight:600}
/* repo group */
.repo-group{margin-top:28px;border:2px solid var(--border-strong);background:var(--surface-raised)}
.rg-head{display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:14px 20px;border-bottom:2px solid var(--border-strong);background:var(--surface-strong)}
.rg-head h3{font-family:"IBM Plex Mono",monospace;font-size:16px;font-weight:700;letter-spacing:-.01em;min-width:0;word-break:break-word}
.rg-count{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;color:var(--text-muted);white-space:nowrap}
.skill-list{list-style:none}
.skill-row{padding:16px 20px;border-top:1px solid var(--hair)}
.skill-list li:first-child .skill-row{border-top:none}
.sk-top{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.sk-id{font-family:"IBM Plex Mono",monospace;font-size:15px;font-weight:700;color:var(--text-primary);word-break:break-word}
.sk-desc{margin-top:7px;font-size:14.5px;line-height:1.6;color:var(--text-secondary);max-width:78ch}
.sk-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:11px;align-items:center}
.tag{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:600;padding:3px 9px;border:1px solid var(--hair-strong);color:var(--text-muted)}
.tag-cat{border-color:var(--violet);color:var(--violet)}
/* visibility markers — PRIVATE IS DELIBERATELY ABSENT (see module header) */
.vis{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 9px;border:2px solid var(--border-strong)}
.vis-listed{box-shadow:inset var(--lw-stripe) 0 0 var(--amber);color:var(--amber)}
.vis-public{background:var(--cobalt-slab);color:var(--cream);border-color:var(--border-strong)}
.pairs{margin-top:11px;font-size:13.5px;color:var(--text-muted);line-height:1.6}
.pairs .pw-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-right:8px}
.pairs code{font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--teal);font-weight:600}
.pairs .absent{color:var(--text-ghost);text-decoration:line-through}
.empty{border:1px dashed var(--hair-strong);background:transparent;padding:22px 24px;margin-top:24px}
.empty .e-title{font-weight:700;font-size:16px}
.empty p{font-size:14.5px;color:var(--text-secondary);line-height:1.6;margin-top:8px;max-width:70ch}
.empty .cmd{font-family:"IBM Plex Mono",monospace;font-size:13.5px;color:var(--teal);font-weight:600}
pre.snippet{margin-top:14px;padding:14px 16px;border:1px solid var(--hair-strong);background:var(--surface-card);overflow-x:auto;font-family:"IBM Plex Mono",monospace;font-size:13px;line-height:1.6;color:var(--text-primary)}
.notice{margin-top:22px;padding:14px 18px;border:2px solid var(--border-strong);box-shadow:inset var(--lw-stripe) 0 0 var(--amber);font-size:14.5px;color:var(--text-secondary);line-height:1.6;max-width:74ch}
.notice b{color:var(--text-primary)}
.cta{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:14.5px;font-weight:700;letter-spacing:.02em;padding:12px 20px;border:2px solid var(--border-strong);background:var(--cobalt-slab);color:var(--cream);text-decoration:none;cursor:pointer;margin-top:18px}
.cta:hover{background:var(--border-strong);color:var(--surface-base)}
.pub-form{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.pub-form .caption{max-width:52ch}
.body-md{margin-top:24px;padding:22px 24px;border:2px solid var(--border-strong);background:var(--surface-raised);white-space:pre-wrap;overflow-wrap:break-word;font-family:"IBM Plex Mono",monospace;font-size:13.5px;line-height:1.7;color:var(--text-primary)}
.dir-list{list-style:none;margin-top:28px;border:2px solid var(--border-strong);background:var(--surface-raised)}
.dir-row{display:block;padding:16px 20px;border-top:1px solid var(--hair);text-decoration:none;color:var(--text-primary)}
.dir-list li:first-child .dir-row{border-top:none}
.dir-row:hover{background:var(--surface-strong)}
.dir-id{font-family:"IBM Plex Mono",monospace;font-size:15px;font-weight:700;color:var(--cobalt);word-break:break-word}
.dir-desc{margin-top:6px;font-size:14.5px;line-height:1.6;color:var(--text-secondary);max-width:78ch}
@media (max-width:720px){.ko::before{left:-20px}.ko .ko-over{clip-path:inset(-14px calc(100% - var(--ko-r)) -14px -20px)}}
`;

function shellPage(title: string, crumb: string, inner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><title>${esc(title)}</title>${HEAD}<style>${SEAMANSHIP_CSS}</style></head><body>
<header class="site-header">
  <a class="sh-brand" href="/account"><span class="sh-mark" aria-hidden="true">pd</span>Port Daddy</a>
  <span class="sh-status">${crumb}</span>
</header>
${inner}
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════
//  Renderers
// ══════════════════════════════════════════════════════════════════════════

/**
 * The visibility marker for one skill.
 *
 * PRIVATE RENDERS AS NOTHING — the same law the CLI's `formatVisibilityMarker`
 * encodes. Private is the unmarked, overwhelmingly common case: marking it
 * would turn "nobody opted this in" into a badge, and a catalog covered in
 * badges reads as a catalog of exceptions rather than a catalog of defaults.
 */
export function visibilityMarker(visibility: SkillVisibility): string {
  if (visibility === 'private') return '';
  const cls = visibility === 'public' ? 'vis-public' : 'vis-listed';
  return `<span class="vis ${cls}">${esc(visibility)}</span>`;
}

function renderPairsWith(entry: RelaySkillEntry, scan: CatalogScan): string {
  const neighbours = resolvePairsWith(entry, scan);
  if (neighbours.length === 0) return '';
  const items = neighbours
    .map((n) =>
      n.known
        ? `<code>${esc(n.id)}</code>`
        : `<code class="absent" title="declared, but not among the skills read on this view">${esc(n.id)}</code>`,
    )
    .join(', ');
  return `<div class="pairs"><span class="pw-label">pairs&#8209;with</span>${items}</div>`;
}

function renderSkillRow(entry: RelaySkillEntry, scan: CatalogScan): string {
  const marker = visibilityMarker(entry.visibility);
  const chips: string[] = [];
  if (entry.category) chips.push(`<span class="tag tag-cat">${esc(entry.category)}</span>`);
  for (const t of entry.tags.slice(0, 8)) chips.push(`<span class="tag">${esc(t)}</span>`);
  if (entry.owner) chips.push(`<span class="tag">owner: ${esc(entry.owner)}</span>`);
  return `<li><div class="skill-row">
    <div class="sk-top"><span class="sk-id">${esc(entry.id)}</span>${marker}</div>
    <p class="sk-desc">${esc(entry.description)}</p>
    ${chips.length ? `<div class="sk-meta">${chips.join('')}</div>` : ''}
    ${renderPairsWith(entry, scan)}
  </div></li>`;
}

function renderRepoGroup(repo: ScannedRepo, scan: CatalogScan): string {
  if (repo.noSkillsDir) return '';
  const n = repo.skills.length;
  if (n === 0) return '';
  return `<div class="repo-group">
    <div class="rg-head">
      <h3>${esc(repo.repoFullName)}</h3>
      <span class="rg-count">${n} skill${n === 1 ? '' : 's'} &middot; ${esc(repo.ref)}</span>
    </div>
    <ul class="skill-list">${repo.skills.map((s) => renderSkillRow(s, scan)).join('')}</ul>
  </div>`;
}

const OPT_IN_SNIPPET = `---
name: my-skill
description: What it does, and when to reach for it.
visibility: listed      # or: public
---`;

/** The teaching block: what the three tiers mean and how the opt-in is written. */
function renderTiersExplainer(listedCount: number, publicCount: number): string {
  return `<div class="prose">
    <p>These skills are <strong>yours</strong>, and they are scoped to <strong>your repos</strong>.
    Nothing on this page is distributed anywhere by default, and nothing becomes visible to another
    person because a page was built. A skill leaves your repos only when you write a
    <code>visibility:</code> line into its own <code>SKILL.md</code> &mdash; per skill, by hand.</p>
    <p><strong>private</strong> is the default and it is the absence of that line. It is also the
    unmarked case below: a private skill carries no badge, because a badge would suggest the
    default runs the other way.</p>
    <p><strong>listed</strong> publishes a name and a description &mdash; a directory row, the size
    of a search result. Nothing else: not the body, not the tags, not the repository it lives in.</p>
    <p><strong>public</strong> publishes the full <code>SKILL.md</code> body, and even then only to
    someone signed in to a portdaddy.dev account. Public implies listed; listed does not imply
    public.</p>
    <pre class="snippet">${esc(OPT_IN_SNIPPET)}</pre>
    <p>Right now <strong>${listedCount}</strong> of your skills carry a listed-or-wider tier, and
    <strong>${publicCount}</strong> carry <code>public</code>. Publishing re-reads every
    <code>SKILL.md</code> and makes the directory agree with it &mdash; including removing anything
    whose <code>visibility:</code> line you deleted.</p>
  </div>`;
}

const SNIPE_PROSE = `<div class="prose">
  <p>In a warship the <strong>snipes</strong> are the engine-room crew &mdash; the enginemen,
  machinist&rsquo;s mates and boiler technicians who stand their watch below the waterline, where
  the plant is. Nobody topside sees them. The ship moves because they keep it moving, and the good
  ones spend the quiet part of a watch building the jig that means the next watch will not have to
  improvise.</p>
  <p>Port Daddy&rsquo;s <strong>Snipe</strong> is that rate. It wakes on
  <code>pull_request:opened</code>, reads the code and the ideas the pull request actually
  introduces, and asks one question: would a reusable skill make this kind of work materially
  easier next time? A pull request that hand-rolls a fixture harness, walks a
  migration-then-backfill-then-verify dance by hand, or buries hard-won domain knowledge in a
  one-off script is a pull request telling you a tool is missing.</p>
  <p>What Snipe may do is narrow, deliberately. Its class is <code>ideation</code>, which in this
  fleet means <strong>advisory</strong>: it closes every run with
  <code>FLEET-VERDICT: PASS (advisory)</code> and can never block a merge. Its tools are
  <code>Read</code>, <code>Grep</code> and <code>Glob</code> &mdash; it cannot write a file, cut a
  branch, or push a commit. It is <code>singleton: true</code>, so one Snipe per pull request
  rather than a chorus of them.</p>
  <p>And what it produces is one comment carrying at most a <strong>single</strong> proposal,
  <code>action: "skill"</code>, with a brief concrete enough for someone else to start from: what
  the skill would do, when to reach for it, its inputs and outputs, and the research that has to
  happen before anyone writes a line of it. The executor renders that brief into a
  <code>pd dispatch propose</code> command which tasks an agent to author the skill through the
  <code>skill-architect</code> skill. Snipe does not write the skill. It says which skill is worth
  writing, and hands over the order.</p>
  <p>Most pull requests warrant nothing at all, and Snipe returns an empty array. That is a
  result, not a failure &mdash; an engine room reporting &ldquo;nothing to fix&rdquo; is an engine
  room doing its job.</p>
</div>`;

const GRAFT_HISTORY_EMPTY = `<div class="empty">
  <div class="e-title">Graft history lives in your daemon, not here.</div>
  <p>When an agent is handed a skill mid-task, the fleet engine records a graft event &mdash; which
  skill, for which task, on whose authority, and whether it turned out to help. Those records are
  written to your daemon&rsquo;s own event stream, which is the authority; this relay is not a
  mirror of it and does not hold a copy. Read them where they are written, with
  <span class="cmd">pd seamanship outcomes</span>. This section stays empty rather than showing you
  a plausible-looking table assembled from nothing.</p>
</div>`;

function renderScanNotices(scan: CatalogScan): string {
  const parts: string[] = [];
  if (!scan.installationsKnown) {
    parts.push(`<div class="notice"><b>Your repositories could not be read.</b> This page reaches
      your skills through your own GitHub App installation, and GitHub did not answer. That is a
      degraded read, not an empty catalog &mdash; nothing below should be taken as
      &ldquo;you have no skills&rdquo;.</div>`);
  }
  if (scan.reposTruncated) {
    parts.push(`<div class="notice"><b>Partial view.</b> At most ${MAX_REPOS_SCANNED} repositories
      are scanned per page load, so skills in further repositories are <b>not shown here</b> &mdash;
      they are not hidden for permission reasons, they simply were not read.</div>`);
  }
  if (scan.skillsTruncated) {
    parts.push(`<div class="notice"><b>Read budget reached.</b> At most ${MAX_SKILL_READS} skill
      files are read per page load. The rest are not shown on this view; reload once the cached
      entries settle (${SKILL_CACHE_TTL_SECONDS / 60} minutes) to walk further down the catalog.</div>`);
  }
  return parts.join('');
}

/** Render /account/seamanship for a signed-in operator. Pure — no I/O. */
export function renderSeamanshipPage(
  user: UserRow,
  scan: CatalogScan,
  opts: { publishedCount?: number | null; publishError?: string | null } = {},
): string {
  const skills = allSkills(scan);
  const listedCount = skills.filter((s) => isPublishableSkill(s, 'listed')).length;
  const publicCount = skills.filter((s) => isPublishableSkill(s, 'public')).length;
  const groups = scan.repos.map((r) => renderRepoGroup(r, scan)).join('');
  const total = skills.length;

  const catalogBody = groups
    ? groups
    : `<div class="empty">
        <div class="e-title">No <span class="cmd">skills/</span> directory found in the repositories read.</div>
        <p>This page looks for <span class="cmd">skills/&lt;id&gt;/SKILL.md</span> at the default
        branch of each repository reachable through your GitHub App installation. Nothing matched.
        Add a skill to a repository the app is installed on and it appears here &mdash; the
        repository stays the source of truth, and this page never keeps a copy of the text.</p>
      </div>`;

  const publishBanner = opts.publishError
    ? `<div class="notice"><b>Nothing was published.</b> ${esc(opts.publishError)}</div>`
    : typeof opts.publishedCount === 'number'
      ? `<div class="notice"><b>Directory updated.</b> ${opts.publishedCount} skill${opts.publishedCount === 1 ? '' : 's'}
         ${opts.publishedCount === 1 ? 'is' : 'are'} now listed under <b>@${esc(user.login)}</b>.
         Anything whose <code>visibility:</code> line you removed has been taken down.</div>`
      : '';

  const inner = `<main class="page">
  <div class="masthead">
    <span class="eyebrow">portdaddy.dev &middot; account &middot; seamanship</span>
    <h1 class="ko">Your <span class="rec">seamanship</span><span class="ko-over" aria-hidden="true">Your <span class="rec">seamanship</span></span></h1>
    <span class="lede">Every skill your agents can reach for, read live from the repositories that
    hold them. ${total} skill${total === 1 ? '' : 's'} across
    ${scan.repos.length} repositor${scan.repos.length === 1 ? 'y' : 'ies'} on this view.</span>
    ${publishBanner}
    ${renderScanNotices(scan)}
  </div>

  <section class="sect" aria-labelledby="tiers-h" style="padding-top:34px;margin-top:24px">
    <div class="sect-head">
      <div class="flag-title">
        <i class="flag flag-papa" role="img" aria-label="Papa signal flag: all persons should report on board, the vessel is about to proceed to sea"></i>
        <div><span class="eyebrow">Ownership</span><h2 id="tiers-h">Yours, and scoped to your repos</h2></div>
      </div>
      <span class="flag-mean">Papa &mdash; report on board, we are about to sail</span>
    </div>
    ${renderTiersExplainer(listedCount, publicCount)}
    <form class="pub-form" method="post" action="/account/seamanship/publish">
      <button class="cta" type="submit">Sync my public directory &rarr;</button>
      <span class="caption">Re-reads every <span class="cmd">SKILL.md</span> and republishes
      <a href="/skills?namespace=@${esc(user.login)}">@${esc(user.login)}</a> to match. Withdrawals
      take effect in the same pass.</span>
    </form>
  </section>

  <section class="sect" aria-labelledby="catalog-h">
    <div class="sect-head">
      <div><span class="eyebrow">Catalog</span><h2 id="catalog-h">By repository</h2></div>
      <span class="flag-mean">${total} read &middot; ${listedCount} listed &middot; ${publicCount} public</span>
    </div>
    ${catalogBody}
  </section>

  <section class="sect" aria-labelledby="snipe-h">
    <div class="sect-head">
      <div class="flag-title">
        <i class="flag flag-sierra" role="img" aria-label="Sierra signal flag: I am operating astern propulsion"></i>
        <div><span class="eyebrow">The engine room</span><h2 id="snipe-h">Snipe, the Engineman</h2></div>
      </div>
      <span class="flag-mean">Sierra &mdash; an engine order</span>
    </div>
    ${SNIPE_PROSE}
  </section>

  <section class="sect" aria-labelledby="graft-h">
    <div class="sect-head">
      <div><span class="eyebrow">Grafts</span><h2 id="graft-h">Which skills were actually spliced in</h2></div>
    </div>
    ${GRAFT_HISTORY_EMPTY}
  </section>
</main>`;
  return shellPage('Port Daddy — Your seamanship', '<a href="/account">account</a>&ensp;/&ensp;seamanship', inner);
}

/** Render the PUBLIC directory. Takes only listed-tier rows — by type. */
export function renderPublicDirectory(skills: readonly ListedSkill[], namespace: string | null): string {
  const rows = skills
    .map(
      (s) => `<li><a class="dir-row" href="/skills/${esc(s.qualifiedId)}">
        <span class="dir-id">${esc(s.qualifiedId)}</span>
        <span class="dir-desc">${esc(s.description)}</span>
      </a></li>`,
    )
    .join('');
  const body = rows
    ? `<ul class="dir-list">${rows}</ul>`
    : `<div class="empty">
        <div class="e-title">Nothing is published here yet, and that is the default.</div>
        <p>This directory lists a skill only when its author wrote <span class="cmd">visibility: listed</span>
        (or <span class="cmd">public</span>) into that skill&rsquo;s own <span class="cmd">SKILL.md</span> and
        then published. There is no bulk export, no opt-out, and no migration that would have swept a
        catalog in here. An empty directory means nobody has opted anything in &mdash; which is what
        &ldquo;private by default&rdquo; looks like when it is true.</p>
      </div>`;
  const inner = `<main class="page">
  <div class="masthead">
    <span class="eyebrow">portdaddy.dev &middot; skills${namespace ? ` &middot; @${esc(namespace)}` : ''}</span>
    <h1 class="ko">Published <span class="rec">skills</span><span class="ko-over" aria-hidden="true">Published <span class="rec">skills</span></span></h1>
    <span class="lede">Names and descriptions of skills whose authors opted them in, one skill at a
    time. This is the whole listed tier: no bodies, no tags, no repository names. Opening one shows
    its full text only if its author marked it <code>public</code> and you are signed in.</span>
    <div class="sect-head" style="margin-top:26px">
      <div class="flag-title">
        <i class="flag flag-charlie" role="img" aria-label="Charlie signal flag: yes, affirmative"></i>
        <span class="flag-mean">Charlie &mdash; yes. Exactly the skills that said so.</span>
      </div>
    </div>
  </div>
  ${body}
  ${skills.length >= PUBLIC_LISTING_LIMIT ? `<div class="notice"><b>Showing the first ${PUBLIC_LISTING_LIMIT}.</b> Narrow the view with <code>?namespace=@login</code>.</div>` : ''}
</main>`;
  return shellPage('Port Daddy — Published skills', '<a href="/skills">skills</a>', inner);
}

// ══════════════════════════════════════════════════════════════════════════
//  Handlers
// ══════════════════════════════════════════════════════════════════════════

/** GET /account/seamanship — session-gated; 302 /login when signed out. */
export async function handleSeamanshipPage(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return toLogin();
  const url = new URL(request.url);
  const listedRaw = url.searchParams.get('listed');
  const listedParsed = listedRaw === null ? null : Number.parseInt(listedRaw, 10);
  const publishedCount =
    listedParsed !== null && Number.isFinite(listedParsed) && listedParsed >= 0 ? listedParsed : null;
  try {
    const scan = await scanOperatorCatalog(env, session);
    return memberHtml(
      renderSeamanshipPage(session.user, scan, {
        publishedCount,
        publishError: url.searchParams.get('publish_error'),
      }),
    );
  } catch {
    return memberHtml(
      shellPage(
        'Port Daddy — Your seamanship',
        '<a href="/account">account</a>&ensp;/&ensp;seamanship',
        `<main class="page"><div class="masthead">
          <span class="eyebrow">Port Daddy</span>
          <h1 class="ko">Temporarily <span class="rec">unavailable</span><span class="ko-over" aria-hidden="true">Temporarily <span class="rec">unavailable</span></span></h1>
          <span class="lede">Your catalog could not be read. Nothing was published or changed. Try again shortly.</span>
        </div></main>`,
      ),
      500,
    );
  }
}

/**
 * POST /account/seamanship/publish — the script-free form path.
 *
 * Redirects back to the page either way (303, so a reload does not re-POST),
 * carrying the outcome in the query string. The JSON twin lives at
 * POST /v1/seamanship/publish.
 */
export async function handleSeamanshipPublishForm(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return toLogin();
  if (!isSameOrigin(request, env)) {
    return new Response('cross-origin request refused', { status: 403 });
  }
  const outcome = await syncSkillListings(env, session);
  const location = outcome.ok
    ? `/account/seamanship?listed=${outcome.listed}`
    : `/account/seamanship?publish_error=${encodeURIComponent(outcome.error)}`;
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

/** GET /skills — the public directory (HTML). */
export async function handlePublicSkillsPage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const nsParam = url.searchParams.get('namespace');
  const login = nsParam ? (nsParam.startsWith('@') ? nsParam.slice(1) : nsParam) : null;
  try {
    const res = login
      ? await env.DB.prepare(
          `SELECT namespace, skill_id, name, description FROM skill_listings
            WHERE namespace = ? ORDER BY skill_id ASC LIMIT ?`,
        )
          .bind(login, PUBLIC_LISTING_LIMIT)
          .all<{ namespace: string; skill_id: string; name: string; description: string }>()
      : await env.DB.prepare(
          `SELECT namespace, skill_id, name, description FROM skill_listings
            ORDER BY namespace ASC, skill_id ASC LIMIT ?`,
        )
          .bind(PUBLIC_LISTING_LIMIT)
          .all<{ namespace: string; skill_id: string; name: string; description: string }>();
    const skills: ListedSkill[] = (res.results ?? []).map((r) => ({
      qualifiedId: qualifySkillId(r.namespace, r.skill_id),
      name: r.name,
      description: r.description,
    }));
    return publicHtml(renderPublicDirectory(skills, login));
  } catch {
    return publicHtml(renderPublicDirectory([], login), 500);
  }
}

/**
 * GET /skills/@:login/:id — one published skill.
 *
 * The full body renders only when `resolveSkillBody` says `ok`, which requires
 * a live `isPublishableSkill(entry, 'public')` against the repo's current
 * frontmatter AND a signed-in session. Everything else renders the listed
 * payload with an honest reason, or a 404 that is byte-identical whether the id
 * was never published or never existed.
 */
export async function handlePublicSkillPage(
  request: Request,
  env: Env,
  qualifiedId: string,
): Promise<Response> {
  if (!parseQualifiedSkillId(qualifiedId)) return notFoundPage();
  const session = await resolveSession(request, env);
  const outcome = await resolveSkillBody(env, session, qualifiedId);
  if (outcome.kind === 'not-found') return notFoundPage();
  if (outcome.kind === 'auth-required') {
    const inner = `<main class="page">
      <div class="masthead">
        <span class="eyebrow">portdaddy.dev &middot; skills</span>
        <h1 class="ko">${esc(outcome.qualifiedId)}<span class="ko-over" aria-hidden="true">${esc(outcome.qualifiedId)}</span></h1>
        <span class="lede">${esc(outcome.description)}</span>
      </div>
      <div class="empty">
        <div class="e-title">The full text is not open here.</div>
        <p>This skill is <strong>listed</strong>: its author published its name and description and
        stopped there. Reading the whole <span class="cmd">SKILL.md</span> takes two things at once
        &mdash; a portdaddy.dev account, and an author who marked this particular skill
        <span class="cmd">public</span>. One without the other is not enough, and the check runs
        against the repository&rsquo;s current file every time, so an author who withdraws
        <span class="cmd">public</span> closes this door on the next request.</p>
        <p><a href="/login">Sign in</a> &middot; <a href="/skills">back to the directory</a></p>
      </div>
    </main>`;
    return publicHtml(shellPage(`Port Daddy — ${outcome.qualifiedId}`, '<a href="/skills">skills</a>', inner), 403);
  }
  const entry = outcome.entry;
  const chips = [
    entry.category ? `<span class="tag tag-cat">${esc(entry.category)}</span>` : '',
    ...entry.tags.slice(0, 10).map((t) => `<span class="tag">${esc(t)}</span>`),
  ].join('');
  const inner = `<main class="page">
    <div class="masthead">
      <span class="eyebrow">portdaddy.dev &middot; skills</span>
      <h1 class="ko">${esc(outcome.qualifiedId)}<span class="ko-over" aria-hidden="true">${esc(outcome.qualifiedId)}</span></h1>
      <span class="lede">${esc(entry.description)}</span>
      ${chips ? `<div class="sk-meta">${chips}</div>` : ''}
    </div>
    <div class="body-md">${esc(outcome.body)}</div>
    <p class="caption" style="margin-top:20px"><a href="/skills">&larr; back to the directory</a></p>
  </main>`;
  return new Response(
    shellPage(`Port Daddy — ${outcome.qualifiedId}`, '<a href="/skills">skills</a>', inner),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        // Body access is session-gated — never cached by a shared cache.
        'Cache-Control': 'private, no-store',
      },
    },
  );
}

/**
 * The ONE 404 for this surface. A skill that was never published and a skill id
 * that never existed get the identical response — no existence oracle over a
 * private catalog (the same doctrine the harbor pages hold).
 */
function notFoundPage(): Response {
  const inner = `<main class="page">
    <div class="masthead">
      <span class="eyebrow">portdaddy.dev &middot; skills</span>
      <h1 class="ko">Not <span class="rec">found</span><span class="ko-over" aria-hidden="true">Not <span class="rec">found</span></span></h1>
      <span class="lede">No published skill goes by that name. <a href="/skills">Back to the directory</a>.</span>
    </div>
  </main>`;
  return publicHtml(shellPage('Port Daddy — Not found', '<a href="/skills">skills</a>', inner), 404);
}
