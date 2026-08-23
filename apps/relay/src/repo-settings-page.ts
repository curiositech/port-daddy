/**
 * apps/relay/src/repo-settings-page.ts — the per-repo configuration screen
 * (`/account/repos`), session-gated, plus the device-facing JSON read path
 * (`GET /v1/repo-settings`).
 *
 * Purpose: this is where a signed-in operator configures how agents behave in
 * each of their repositories, across every device on the account. The first
 * (and launch) setting is the SITREP dial — `sitrep.endOfTurn` — which asks
 * (or requires) agents to end every turn with the SITREP table (ideas /
 * roadmap claims / assigned work, code rows linked to roadmap items at
 * creation).
 *
 * Honesty (repo law: no Potemkin): the ENFORCEMENT point is each clone's local
 * dial (`agent.config.json` → `sitrep.endOfTurn`, read locally by whatever
 * harness the operator runs). This screen is the account-of-record for the
 * operator's cross-device intent, and `GET /v1/repo-settings` (pdu_ device
 * token or session cookie) is what a device polls to converge its clones. The
 * page SAYS this — it renders the exact local snippet per repo rather than
 * pretending the server reaches into checkouts.
 *
 * Design: server-rendered, script-free CSP, ch20 story-linework — the same
 * shell as /account (account-page.ts exports HEAD + TOKENS for exactly this).
 * Writes are plain HTML form POSTs (`/account/repos/set`, `/account/repos/remove`),
 * gated by the same GitHub repo ACL as /account/runs: you can only configure a
 * repository your GitHub identity can read (userCanReadRepo).
 */

import type { Env } from './types.js';
import type { UserRow } from './db.js';
import { resolveSession, userCanReadRepo } from './auth-github.js';
import { resolveUserFromRequest } from './device-flow.js';
import { HEAD, TOKENS } from './account-page.js';
import {
  aiCallDeadlineMsFromSettingsJson,
  DEFAULT_AI_CALL_DEADLINE_MS,
  MAX_AI_CALL_DEADLINE_MS,
  MIN_AI_CALL_DEADLINE_MS,
  parseAiCallDeadlineMs,
} from '../../shared/repo-ai-settings.js';

/** The closed enum of SITREP dial levels the screen (and the DB CHECK) accept. */
export type SitrepLevel = 'off' | 'suggest' | 'enforce';

const SITREP_LEVELS: SitrepLevel[] = ['off', 'suggest', 'enforce'];

/** One configured repository row as stored in `repo_settings`. */
export interface RepoSettingRow {
  repo_full_name: string;
  sitrep_end_of_turn: SitrepLevel;
  settings_json: string;
  updated_at: number;
}

/**
 * Minimal HTML-escape for interpolated data (XSS guard).
 *
 * Why: repo names and login handles are user-controlled and round-trip into
 * markup; escaping at every interpolation point is the page's whole scripting
 * defense (the CSP allows no scripts at all, so an injection would still be
 * inert — but we do not rely on a single layer).
 *
 * @param s - The raw value (null/undefined collapse to '').
 * @returns The value with &, <, >, ", ' escaped.
 */
function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap a rendered document in the account surface's response contract.
 *
 * Why these headers: script-free CSP (design intent — the page has no JS to
 * allow), no-referrer, nosniff, and — because this is a per-user authz-filtered
 * page — no-store + noindex, matching the runs-page convention.
 *
 * @param body - The full HTML document.
 * @param status - HTTP status (default 200).
 * @returns The HTML Response with the locked-down header set.
 */
function htmlPage(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; img-src 'self' https://avatars.githubusercontent.com data:; " +
        "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      // A per-user authz-filtered page must not land in caches or indexes.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/**
 * JSON response helper for the device-facing API path.
 *
 * Why local: keeps this module dependency-free and the response shape
 * ({ code, ... }) consistent with the relay's other v1 endpoints by design.
 *
 * @param status - HTTP status code.
 * @param body - The JSON-serializable payload.
 * @returns The JSON Response.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * Validate an `owner/name` GitHub repository full name.
 *
 * Why strict: the value round-trips into SQL rows, HTML, the GitHub ACL probe
 * URL, and local config snippets — one closed shape at the entry door keeps
 * every downstream surface simple. GitHub's own rules are looser in places;
 * this accepts the practical intersection (word chars, dots, dashes; no
 * leading dot on either segment — the rejection lives in the regex itself so
 * there is exactly one shape to reason about; both segments 1..100 chars).
 * The pasted-URL prefix is matched case-insensitively and accepts both
 * http and https by design: RFC 3986 makes scheme and host case-insensitive,
 * GitHub serves one canonical https redirect for http, and honoring the
 * URL's own semantics is the honest contract for an input we advertise
 * accepting. URL fragments/queries are rejected — they are not part of a
 * repository's identity.
 *
 * @param raw - The user-typed repository identifier.
 * @returns The trimmed `owner/name`, or null when the shape is invalid.
 */
export function normalizeRepoFullName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '');
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?)\/([A-Za-z0-9_-][A-Za-z0-9._-]{0,99})$/.exec(trimmed);
  const owner = m?.[1];
  const name = m?.[2];
  if (!owner || !name) return null;
  return `${owner}/${name}`;
}

/**
 * Normalize a submitted SITREP level to the closed enum.
 *
 * Why closed: the value lands in a CHECK-constrained column and in rendered
 * agent guidance — an unknown level must collapse to null (reject the write)
 * rather than pass through as free text.
 *
 * Casing contract: input is trimmed and lowercased before matching, so
 * 'ENFORCE', ' Suggest ', and 'off\n' all normalize; the returned (and
 * stored) value is always the lowercase enum member.
 *
 * @param raw - The form/JSON-supplied level.
 * @returns The level, or null when not one of off|suggest|enforce.
 */
export function normalizeSitrepLevel(raw: unknown): SitrepLevel | null {
  if (typeof raw !== 'string') return null;
  const level = raw.trim().toLowerCase();
  return (SITREP_LEVELS as string[]).includes(level) ? (level as SitrepLevel) : null;
}

/**
 * List the signed-in user's configured repositories, newest change first.
 *
 * Why a thin helper: both the HTML page and the device JSON API serve the same
 * rows; one query keeps the two surfaces incapable of disagreeing.
 *
 * @param env - Worker bindings (D1).
 * @param userId - The resolved account id.
 * @returns The user's repo_settings rows.
 */
export async function listRepoSettings(env: Env, userId: string): Promise<RepoSettingRow[]> {
  const res = await env.DB.prepare(
    `SELECT repo_full_name, sitrep_end_of_turn, settings_json, updated_at
       FROM repo_settings WHERE user_id = ? ORDER BY updated_at DESC`,
  )
    .bind(userId)
    .all<RepoSettingRow>();
  return res.results ?? [];
}

// ── page rendering ────────────────────────────────────────────────────────────

const REPOS_CSS = `
${TOKENS}
.shell{max-width:1080px;margin:0 auto;padding:0 40px 88px}
.site-header{position:sticky;top:0;z-index:50;display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:14px 0;background:var(--surface-base);border-bottom:2px solid var(--border-strong)}
.sh-brand{display:flex;align-items:baseline;gap:10px;font-weight:700;font-size:17px;color:var(--text-primary);text-decoration:none}
.sh-mark{color:var(--cobalt);font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:19px}
.crumbs{font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--text-muted)}
.page-head{padding-top:34px}
.page-head h1{font-size:clamp(30px,3.4vw,42px);font-weight:700;line-height:1.05;letter-spacing:-.03em}
.page-head .caption{margin-top:10px;max-width:62ch}
.notice{margin-top:18px;border:2px solid var(--border-strong);padding:12px 18px;font-size:14.5px;box-shadow:inset 3px 0 0 var(--health)}
.notice.err{box-shadow:inset 3px 0 0 var(--error);color:var(--error)}
.repo-card{margin-top:30px;border:2px solid var(--border-strong);background:var(--surface-raised)}
.rc-head{display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap;border-bottom:1.5px solid var(--hair-strong);padding:14px 22px}
.rc-head h2{font-family:"IBM Plex Mono",monospace;font-size:17px;font-weight:700;letter-spacing:-.01em}
.rc-head .when{font-family:"IBM Plex Mono",monospace;font-size:12.5px;color:var(--text-muted)}
.rc-body{padding:18px 22px 20px}
.setting-name{font-weight:700;font-size:16px}
.setting-desc{font-size:14.5px;color:var(--text-secondary);line-height:1.6;max-width:66ch;margin-top:4px}
.dial{display:flex;gap:0;margin-top:14px;flex-wrap:wrap}
.dial label{display:flex;align-items:center;gap:8px;font-family:"IBM Plex Mono",monospace;font-size:13.5px;font-weight:700;padding:9px 16px;border:1.5px solid var(--hair-strong);cursor:pointer}
.dial label + label{border-left:none}
.dial input{accent-color:var(--cobalt)}
.rc-actions{display:flex;gap:12px;align-items:center;margin-top:16px;flex-wrap:wrap}
.btn-save{font-family:"IBM Plex Mono",monospace;font-size:13.5px;font-weight:700;letter-spacing:.04em;padding:9px 18px;border:2px solid var(--border-strong);background:var(--cobalt);color:var(--on-accent);cursor:pointer}
.btn-save:hover{background:var(--border-strong);color:var(--surface-base)}
.btn-remove{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:700;padding:8px 14px;border:1px solid var(--error);color:var(--error);background:transparent;cursor:pointer}
.btn-remove:hover{background:var(--error);color:var(--surface-base)}
.snippet{margin-top:16px;border:1px dashed var(--hair-strong);padding:12px 16px}
.snippet .s-label{font-family:"IBM Plex Mono",monospace;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:6px}
.snippet code{display:block;white-space:pre;overflow-x:auto;font-size:12.5px;line-height:1.55;color:var(--teal)}
.add-card{margin-top:34px;border:2px solid var(--border-strong);background:var(--surface-card);padding:20px 22px}
.add-card h2{font-size:20px;font-weight:700;margin-bottom:6px}
.add-row{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
.add-row input[type="text"]{flex:1;min-width:240px;border:1.5px solid var(--hair-strong);background:var(--surface-raised);padding:10px 14px;font-family:"IBM Plex Mono",monospace;font-size:14px}
.empty{border:1px dashed var(--hair-strong);padding:22px 24px;margin-top:30px}
.empty .e-title{font-weight:700;font-size:16px}
.empty p{font-size:14.5px;color:var(--text-secondary);line-height:1.6;margin-top:6px;max-width:64ch}
.truth{margin-top:34px;background:var(--surface-card);border:1px solid var(--hair);padding:18px 22px;box-shadow:inset 3px 0 0 var(--teal);max-width:72ch}
.truth .t-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--teal);margin-bottom:6px}
.truth p{font-size:14.5px;line-height:1.62;color:var(--text-primary)}
.truth code{font-size:13px;color:var(--teal)}
@media (max-width:640px){.shell{padding:0 20px 64px}}
`;

/**
 * Render the local-enforcement snippet the page prints for one repo's dial.
 *
 * Why rendered at all: the page's honesty contract — the server never reaches
 * into checkouts, so it must show the operator the exact local config that
 * actually enforces their intent.
 *
 * @param level - The dial level to embed.
 * @returns The agent.config.json snippet text (comment line + JSON body).
 */
function localSnippet(level: SitrepLevel): string {
  return `// agent.config.json (repo root) — the dial each clone reads locally
{
  "sitrep": { "endOfTurn": "${level}" }
}`;
}

/**
 * Render one configured repository as a settings card.
 *
 * Why one card per repo: each row is an independent form (save / remove POST
 * per repo) so the page stays script-free by design — no client-side state.
 *
 * @param row - The stored repo_settings row.
 * @returns The card's HTML.
 */
function repoCard(row: RepoSettingRow): string {
  const repo = esc(row.repo_full_name);
  const when = new Date(row.updated_at * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const radios = SITREP_LEVELS.map(
    (level) =>
      `<label><input type="radio" name="sitrep" value="${level}"${
        row.sitrep_end_of_turn === level ? ' checked' : ''
      }>${level}</label>`,
  ).join('');
  const aiCallDeadlineMinutes = Math.round(
    aiCallDeadlineMsFromSettingsJson(row.settings_json) / 60_000,
  );
  const minMinutes = Math.round(MIN_AI_CALL_DEADLINE_MS / 60_000) || 1;
  const maxMinutes = Math.round(MAX_AI_CALL_DEADLINE_MS / 60_000);
  return `<article class="repo-card" aria-label="Settings for ${repo}">
  <header class="rc-head"><h2>${repo}</h2><span class="when">updated ${when} UTC</span></header>
  <div class="rc-body">
    <form method="post" action="/account/repos/set">
      <input type="hidden" name="repo" value="${repo}">
      <div class="setting-name">Sitrep — end-of-turn report</div>
      <p class="setting-desc">Asks every agent working this repository to end each turn with the
      SITREP table: ideas raised in the session, roadmap claims, and work assigned by other agents,
      with progress per turn. Rows that have code being written must link a roadmap item at creation.
      <strong>suggest</strong> asks; <strong>enforce</strong> makes an unclosed turn incomplete.</p>
      <div class="dial" role="radiogroup" aria-label="Sitrep level for ${repo}">${radios}</div>
      <div class="setting-name" style="margin-top:22px">Fleet AI call timeout</div>
      <p class="setting-desc">How long one Fleet Workers AI call may run before Fleet treats it as
      hung, opens the run's circuit, and lets the next queue delivery retry. Cloudflare's binding
      has no cancel signal, so this is a client-side wall clock, not a provider-side limit.</p>
      <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-family:'IBM Plex Mono',monospace;font-size:13.5px">
        <input type="number" name="aiCallDeadlineMinutes" min="${minMinutes}" max="${maxMinutes}"
          step="1" value="${aiCallDeadlineMinutes}" style="width:64px;border:1.5px solid var(--hair-strong);background:var(--surface-raised);padding:6px 8px;font-family:inherit;font-size:inherit">
        minutes (${minMinutes}–${maxMinutes}, default ${Math.round(DEFAULT_AI_CALL_DEADLINE_MS / 60_000)})
      </label>
      <div class="rc-actions"><button class="btn-save" type="submit">Save</button></div>
    </form>
    <div class="snippet"><div class="s-label">What each device enforces locally</div><code>${esc(
      localSnippet(row.sitrep_end_of_turn),
    )}</code></div>
    <form method="post" action="/account/repos/remove" style="margin-top:14px">
      <input type="hidden" name="repo" value="${repo}">
      <button class="btn-remove" type="submit">Remove from account</button>
    </form>
  </div>
</article>`;
}

/**
 * Render the /account/repos screen for a signed-in user.
 *
 * Why exported: pure render → unit tests assert on real HTML without a Worker
 * runtime, matching the account-page test pattern (design intent).
 *
 * @param user - The resolved session's user row.
 * @param rows - The user's configured repositories.
 * @param notice - One-line feedback from the last form POST (already decided
 *   ok/err by the caller), or null for none.
 * @returns The full HTML document.
 */
export function renderRepoSettingsPage(
  user: UserRow,
  rows: RepoSettingRow[],
  notice: { text: string; err: boolean } | null = null,
): string {
  const cards = rows.map(repoCard).join('\n');
  const empty = `<div class="empty">
    <div class="e-title">No repositories configured yet.</div>
    <p>Add a repository your GitHub identity can read, and its per-repo agent settings — starting
    with the Sitrep end-of-turn report — live here on your account, one record across all of your
    devices.</p>
  </div>`;
  return `<!DOCTYPE html><html lang="en"><head><title>Port Daddy — Repo settings</title>${HEAD}<style>${REPOS_CSS}</style></head><body>
<div class="shell">
  <header class="site-header">
    <a class="sh-brand" href="/account"><span class="sh-mark" aria-hidden="true">pd</span>Port Daddy</a>
    <span class="crumbs"><a href="/account">account</a> / repos · ${esc(user.login)}</span>
  </header>
  <div class="page-head">
    <span class="eyebrow">portdaddy.dev · account · repo settings</span>
    <h1 style="margin-top:8px">Per-repo <span class="rec">agent settings</span></h1>
    <p class="caption">How your agents must behave, repository by repository — recorded once on your
    account, converged onto every device you pair. Signed-in eyes only.</p>
    ${notice ? `<p class="notice${notice.err ? ' err' : ''}">${esc(notice.text)}</p>` : ''}
  </div>
  ${rows.length > 0 ? cards : empty}
  <section class="add-card" aria-labelledby="add-h">
    <h2 id="add-h">Add a repository</h2>
    <p class="setting-desc">Only repositories your GitHub identity can read may be configured —
    GitHub's own ACL decides, same as your fleet runs page.</p>
    <form method="post" action="/account/repos/set">
      <div class="add-row">
        <input type="text" name="repo" placeholder="owner/name" required aria-label="Repository full name">
        <input type="hidden" name="sitrep" value="enforce">
        <button class="btn-save" type="submit">Add with Sitrep enforced</button>
      </div>
    </form>
  </section>
  <div class="truth">
    <p class="t-label">How this reaches your devices</p>
    <p>The daemon is the authority; this page is the record. Each device converges by reading
    <code>GET /v1/repo-settings</code> with its paired device token (<code>pd account login</code>),
    and each clone enforces the dial locally from
    <code>agent.config.json</code> — the snippet under every repository above. The server never
    reaches into your checkouts.</p>
  </div>
</div>
</body></html>`;
}

// ── handlers ─────────────────────────────────────────────────────────────────

/**
 * Redirect helper for the form POSTs (303 → GET /account/repos?notice=…).
 *
 * Why POST-redirect-GET: refresh-safe outcomes on a script-free page — the
 * notice rides the query string by design instead of any client-side state.
 *
 * @param notice - The one-line outcome to show.
 * @param err - Whether to style the notice as an error.
 * @returns The 303 redirect Response.
 */
function backToRepos(notice: string, err = false): Response {
  const q = new URLSearchParams({ notice, ...(err ? { err: '1' } : {}) });
  return new Response(null, {
    status: 303,
    headers: { Location: `/account/repos?${q.toString()}` },
  });
}

/**
 * GET /account/repos — session-gated screen; redirects to /login signed out.
 *
 * Why 302 (not 401): this is a browser surface — the account pages' shared
 * design sends humans to the login page rather than showing an error body.
 *
 * @param request - The incoming request.
 * @param env - Worker bindings.
 * @returns The rendered page, or the /login redirect.
 */
export async function handleRepoSettingsPage(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  const rows = await listRepoSettings(env, session.user.id);
  const url = new URL(request.url);
  const noticeText = url.searchParams.get('notice');
  const notice = noticeText ? { text: noticeText.slice(0, 200), err: url.searchParams.get('err') === '1' } : null;
  return htmlPage(renderRepoSettingsPage(session.user, rows, notice));
}

/**
 * POST /account/repos/set — upsert one repository's settings from the plain
 * HTML form.
 *
 * Why the ACL probe: session-gated is not enough — the repo must pass the same
 * GitHub read-ACL gate as /account/runs so an account can only configure
 * repositories its GitHub identity can actually read (and enumeration probes
 * learn nothing).
 *
 * @param request - The incoming form POST.
 * @param env - Worker bindings.
 * @returns A 303 back to the screen with an ok/err notice (302 /login signed out).
 */
export async function handleRepoSettingsSet(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  const form = await request.formData().catch(() => null);
  const repo = normalizeRepoFullName(form?.get('repo'));
  const level = normalizeSitrepLevel(form?.get('sitrep'));
  if (!repo) return backToRepos('That does not look like an owner/name repository.', true);
  if (!level) return backToRepos('Pick a sitrep level: off, suggest, or enforce.', true);
  // Blank/absent (e.g. the "Add a repository" form, which has no timeout
  // field yet) means "use the default", not "reject the save" — only a value
  // that cannot possibly be a duration is an error.
  const deadlineMinutesRaw = form?.get('aiCallDeadlineMinutes');
  const deadlineMinutesText = typeof deadlineMinutesRaw === 'string' ? deadlineMinutesRaw.trim() : '';
  const aiCallDeadlineMs =
    deadlineMinutesText === ''
      ? DEFAULT_AI_CALL_DEADLINE_MS
      : parseAiCallDeadlineMs(Number(deadlineMinutesText) * 60_000);
  if (aiCallDeadlineMs == null) {
    return backToRepos(
      `Pick an AI call timeout between ${Math.round(MIN_AI_CALL_DEADLINE_MS / 60_000) || 1} and ` +
        `${Math.round(MAX_AI_CALL_DEADLINE_MS / 60_000)} minutes.`,
      true,
    );
  }
  const [owner = '', name = ''] = repo.split('/');
  const readable = await userCanReadRepo(env, session, owner, name);
  if (!readable) {
    return backToRepos(`GitHub says ${repo} is not readable by ${session.user.login}.`, true);
  }
  // Read-modify-write settings_json: it is the forward-compatible bag for
  // every setting this screen grows, so a write here must preserve any other
  // key already stored there rather than clobbering the bag with `'{}'`.
  const existing = await env.DB.prepare(
    `SELECT settings_json FROM repo_settings WHERE user_id = ? AND repo_full_name = ?`,
  )
    .bind(session.user.id, repo)
    .first<{ settings_json: string }>();
  let bag: Record<string, unknown> = {};
  try {
    if (existing?.settings_json) bag = JSON.parse(existing.settings_json) as Record<string, unknown>;
  } catch {
    bag = {};
  }
  bag.aiCallDeadlineMs = aiCallDeadlineMs;
  const settingsJson = JSON.stringify(bag);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO repo_settings (user_id, repo_full_name, sitrep_end_of_turn, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, repo_full_name)
     DO UPDATE SET sitrep_end_of_turn = excluded.sitrep_end_of_turn,
                   settings_json = excluded.settings_json,
                   updated_at = excluded.updated_at`,
  )
    .bind(session.user.id, repo, level, settingsJson, now, now)
    .run();
  return backToRepos(`${repo}: sitrep ${level}, AI call timeout ${Math.round(aiCallDeadlineMs / 60_000)}m.`);
}

/**
 * POST /account/repos/remove — drop one repository's settings row.
 *
 * Why no ACL probe here: removal only ever deletes the caller's OWN row
 * (user_id is bound from the session), so the GitHub probe would add a network
 * round-trip without widening or narrowing what the delete can touch.
 *
 * @param request - The incoming form POST.
 * @param env - Worker bindings.
 * @returns A 303 back to the screen with a notice (302 /login signed out).
 */
export async function handleRepoSettingsRemove(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  const form = await request.formData().catch(() => null);
  const repo = normalizeRepoFullName(form?.get('repo'));
  if (!repo) return backToRepos('That does not look like an owner/name repository.', true);
  await env.DB.prepare('DELETE FROM repo_settings WHERE user_id = ? AND repo_full_name = ?')
    .bind(session.user.id, repo)
    .run();
  return backToRepos(`${repo} removed.`);
}

/**
 * GET /v1/repo-settings — the device-facing JSON read path.
 *
 * Why the dual gate: auth is a pdu_ device token (from `pd account login`) or
 * the browser session cookie — the same design as /auth/whoami, so a paired
 * daemon and a signed-in browser read the identical record. Optional
 * `?repo=owner/name` narrows to one repository. This is what a device polls to
 * converge its clones' local dials with the account record.
 *
 * @param request - The incoming request.
 * @param env - Worker bindings.
 * @returns 200 { code:'OK', settings:[…] }; 401 unauthenticated; 400 bad repo filter.
 */
export async function handleRepoSettingsApi(request: Request, env: Env): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return json(401, { code: 'UNAUTHENTICATED', error: 'no session or token' });
  const url = new URL(request.url);
  const repoFilter = url.searchParams.get('repo');
  let rows = await listRepoSettings(env, user.id);
  if (repoFilter) {
    const normalized = normalizeRepoFullName(repoFilter);
    if (!normalized) return json(400, { code: 'BAD_REPO', error: 'repo must be owner/name' });
    rows = rows.filter((r) => r.repo_full_name === normalized);
  }
  return json(200, {
    code: 'OK',
    settings: rows.map((r) => ({
      repo: r.repo_full_name,
      sitrep: { endOfTurn: r.sitrep_end_of_turn },
      aiCallDeadlineMs: aiCallDeadlineMsFromSettingsJson(r.settings_json),
      updatedAt: r.updated_at,
    })),
  });
}
