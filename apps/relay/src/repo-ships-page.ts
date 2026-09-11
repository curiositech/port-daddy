/** Signed-in, repository-admin cloud ship controls. Why separate from personal
 * preferences: an admin's OFF must survive another account saving or removing
 * its own settings. Plain form submissions work without JavaScript.
 */
import type { Env } from './types.js';
import { resolveSession, isSameOrigin, type ResolvedSession } from './auth-github.js';
import { HEAD, TOKENS } from './account-page.js';
import { normalizeRepoFullName } from './repo-settings-page.js';
import { parse as parseYaml } from 'yaml';
import { readRepoShipTelemetry, renderShipTelemetry, type RepoShipTelemetry } from './repo-ship-telemetry.js';
import {
  fleetShipsFromDocument, defaultPRShips, fleetXoFromDocument, fleetMediatorFromDocument,
} from '../../shared/fleet-config.js';
import {
  readRepoShipControls, repoShipEnabled, setRepoShipControl, shipControlRepo,
  validShipControlName, type RepoShipControls,
} from '../../shared/repo-ship-controls.js';

interface ShipView { name: string; role: string; trigger: string; model?: string; blocking?: boolean; }
interface RepoWitness { admin: boolean; headers: Record<string, string>; }
type RepoWitnessResult =
  | { kind: 'verified'; witness: RepoWitness }
  | { kind: 'renew' }
  | { kind: 'denied' }
  | { kind: 'rate-limited'; resetAt: number | null }
  | { kind: 'unavailable'; reason: 'github-status' | 'transport' | 'malformed-response' | 'repository-mismatch'; status?: number; requestId?: string };

/** Why escape: source-controlled names and descriptions are untrusted HTML input.
 * @param value Untrusted text.
 * @returns Text safe in HTML content and quoted attributes.
 */
function esc(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

/** Keep an upstream correlation handle useful without reflecting arbitrary headers. */
function githubRequestId(response: Response): string | undefined {
  const value = response.headers.get('X-GitHub-Request-Id');
  return value && /^[A-Za-z0-9:-]{1,128}$/.test(value) ? value : undefined;
}

/** Bound bytes actually consumed, not a caller-supplied Content-Length. Why:
 * chunked forms must have the same resource ceiling as ordinary browser forms.
 * @param message Incoming request or upstream response body.
 * @param limit Maximum encoded bytes.
 * @returns Complete UTF-8 text, or throws without parsing an oversized body.
 */
async function boundedText(message: Request | Response, limit: number): Promise<string> {
  if (!message.body) return '';
  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('Body limit exceeded');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(joined);
}

/** Why a fresh GitHub response: cached read ACLs cannot grant spending authority.
 * @param session Authenticated browser identity.
 * @param repo Validated exact repository.
 * @returns Fresh repository read/admin witness; failure grants nothing.
 */
async function repoWitness(session: ResolvedSession, repo: string): Promise<RepoWitnessResult> {
  if (!session.ghToken) return { kind: 'renew' };
  const headers = { Authorization: `Bearer ${session.ghToken}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'port-daddy-relay' };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com/repos/${repo}`, {
        headers, signal: AbortSignal.timeout(attempt === 0 ? 6_000 : 4_000), redirect: 'error',
      });
    } catch (error) {
      if (attempt === 0) continue;
      const result = { kind: 'unavailable' as const, reason: 'transport' as const };
      console.warn('repo-witness-unavailable', { reason: result.reason,
        error: error instanceof Error ? error.name : 'unknown' });
      return result;
    }
    if (response.status === 401) return { kind: 'renew' };
    // GitHub documents both 403 and 429 for primary and secondary limits.
    // A 429 is unambiguously throttling even when an intermediary omits the
    // advisory headers; 403 remains a permission denial unless GitHub supplies
    // an explicit rate-limit signal.
    const rateLimited = response.status === 429 || (response.status === 403
      && (response.headers.get('X-RateLimit-Remaining') === '0' || response.headers.has('Retry-After')));
    if (rateLimited) {
      const reset = Number(response.headers.get('X-RateLimit-Reset'));
      return { kind: 'rate-limited', resetAt: Number.isSafeInteger(reset) && reset > 0 ? reset : null };
    }
    if (response.status === 403 || response.status === 404) return { kind: 'denied' };
    if (!response.ok) {
      if (attempt === 0 && [502, 503, 504].includes(response.status) && !response.headers.has('Retry-After')) continue;
      const result = { kind: 'unavailable' as const, reason: 'github-status' as const,
        status: response.status, requestId: githubRequestId(response) };
      console.warn('repo-witness-unavailable', { reason: result.reason,
        status: result.status, requestId: result.requestId });
      return result;
    }
    const body = await response.json().catch(() => null) as { permissions?: { admin?: boolean }; full_name?: string } | null;
    if (!body || typeof body.full_name !== 'string') {
      const result = { kind: 'unavailable' as const, reason: 'malformed-response' as const,
        status: response.status, requestId: githubRequestId(response) };
      console.warn('repo-witness-unavailable', { reason: result.reason,
        status: result.status, requestId: result.requestId });
      return result;
    }
    if (body.full_name.toLowerCase() !== repo) {
      const result = { kind: 'unavailable' as const, reason: 'repository-mismatch' as const,
        status: response.status, requestId: githubRequestId(response) };
      console.warn('repo-witness-unavailable', { reason: result.reason,
        status: result.status, requestId: result.requestId });
      return result;
    }
    return { kind: 'verified', witness: { admin: body.permissions?.admin === true, headers } };
  }
  return { kind: 'unavailable', reason: 'transport' };
}

/** Keep repository authorization failures inside the account experience. */
function repoWitnessFailure(repo: string, result: Exclude<RepoWitnessResult, { kind: 'verified' }>): Response {
  const messages = {
    renew: {
      title: 'Reconnect GitHub to continue.',
      detail: 'Your Port Daddy login is still active, but its GitHub repository credential is missing or expired.',
      action: `<a class="button" href="/auth/github/login?return_to=${encodeURIComponent(`/account/ships?repo=${repo}`)}">Continue with GitHub</a>`,
    },
    denied: {
      title: 'GitHub did not grant repository access.',
      detail: `The current GitHub identity cannot read ${esc(repo)}. If access changed, reconnect GitHub and approve repository access.`,
      action: `<a class="button" href="/auth/github/login?return_to=${encodeURIComponent(`/account/ships?repo=${repo}`)}">Reconnect GitHub</a>`,
    },
    'rate-limited': {
      title: 'GitHub API limit reached.',
      detail: `GitHub temporarily refused another repository check for this account.${result.kind === 'rate-limited' && result.resetAt ? ` Its reported reset time is ${esc(new Date(result.resetAt * 1000).toISOString())}.` : ''} No ship setting changed.`,
      action: `<a class="button" href="/account/ships?repo=${encodeURIComponent(repo)}">Retry repository check</a>`,
    },
    unavailable: {
      title: 'GitHub repository check failed.',
      detail: result.kind === 'unavailable' && result.reason === 'github-status'
        ? `GitHub returned status ${result.status ?? 'unknown'}${result.requestId ? ` (request ${esc(result.requestId)})` : ''}. No permission decision was made and no ship setting changed.`
        : result.kind === 'unavailable' && result.reason === 'malformed-response'
          ? 'GitHub returned a repository response the Relay could not verify. No permission decision was made and no ship setting changed.'
          : result.kind === 'unavailable' && result.reason === 'repository-mismatch'
            ? 'GitHub returned a different repository identity. No permission decision was made and no ship setting changed.'
            : 'The Relay could not complete the GitHub repository check. No permission decision was made and no ship setting changed.',
      action: `<a class="button" href="/account/ships?repo=${encodeURIComponent(repo)}">Retry repository check</a><a class="button secondary" href="/auth/github/login?return_to=${encodeURIComponent(`/account/ships?repo=${repo}`)}">Reconnect GitHub</a>`,
    },
  }[result.kind];
  return html(`<!doctype html><html lang="en"><head>${HEAD}<title>Repository access · Port Daddy</title><style>${TOKENS}
    .shell{max-width:760px;margin:auto;padding:32px}.crumbs{display:flex;gap:18px;border-bottom:2px solid var(--border-strong);padding-bottom:18px}
    h1{font-size:clamp(30px,5vw,48px);margin:48px 0 16px}p{font-size:17px;line-height:1.6;max-width:62ch}.actions{display:flex;gap:14px;flex-wrap:wrap;margin-top:28px}
    .button{display:inline-block;background:var(--cobalt);color:var(--on-accent);padding:12px 16px;border:2px solid var(--border-strong);text-decoration:none}
    .secondary{background:var(--surface-raised);color:var(--text-primary)}a:focus-visible{outline:3px solid var(--health);outline-offset:4px}
  </style></head><body><main class="shell"><nav class="crumbs"><a href="/account">Port Daddy / Account</a><a href="/account/ships">Ship controls</a></nav>
    <h1>${messages.title}</h1><p>${messages.detail}</p><div class="actions">${messages.action}<a class="button secondary" href="/account">Back to account</a></div>
  </main></body></html>`, result.kind === 'unavailable' || result.kind === 'rate-limited' ? 503 : 403);
}

/** List cloud ships using the executor's actual pure parser and defaults. Why:
 * duplicating its roster here could show controls for ships it never runs.
 * @param env Relay configuration; DEFAULT_BRANCH matches executor config.
 * @param repo Authorized repository.
 * @param witness Fresh GitHub authority evidence.
 * @returns Bounded cloud ship inventory, never prompts or the skill catalog.
 */
async function shipInventory(env: Env, repo: string, witness: RepoWitness): Promise<ShipView[]> {
  const ref = encodeURIComponent(env.DEFAULT_BRANCH || 'main');
  const response = await fetch(`https://api.github.com/repos/${repo}/contents/pd-fleet.yml?ref=${ref}`, {
    headers: { ...witness.headers, Accept: 'application/vnd.github.raw+json' },
    signal: AbortSignal.timeout(10_000), redirect: 'error',
  });
  let yaml: string | null = null;
  if (response.status !== 404) {
    if (!response.ok || !response.body) throw new Error('Trusted fleet definition unavailable');
    yaml = await boundedText(response, 262_144);
  }
  let document: unknown = null;
  try { document = yaml ? parseYaml(yaml) : null; } catch { /* Executor inherits defaults on malformed YAML. */ }
  const configured = fleetShipsFromDocument(document, '*') ?? [];
  // The executor falls back per event, so keep default ships visible even when
  // only a different event is configured. ON still cannot create a new trigger.
  const inventory = new Map<string, ShipView>();
  for (const ship of [...defaultPRShips(), ...configured]) {
    if (ship.needsExecution || ship.name === '*' || !validShipControlName(ship.name)) continue;
    inventory.set(ship.name, { name: ship.name, role: ship.role.slice(0, 220), model: ship.cfModel, blocking: ship.blocking,
      trigger: Array.isArray(ship.trigger) ? ship.trigger.join(', ') : ship.trigger });
  }
  if (fleetXoFromDocument(document)) inventory.set('xo', { name: 'xo', role: 'Curates advisory findings and proposals.', trigger: 'After review findings' });
  if (fleetMediatorFromDocument(document).enabled) inventory.set('mediator', { name: 'mediator', role: 'Scans for interactions between pull requests.', trigger: 'After Fleet review' });
  if (inventory.size > 250) throw new Error('Fleet roster exceeds display limit');
  return [...inventory.values()];
}

/** One script-free, accessibly labelled row. Why explicit buttons: each click
 * saves one decision and returns to read-back; there is no unsaved toggle state.
 * @param repo Selected repository.
 * @param ship Cloud ship or repository master gate.
 * @param controls Fresh saved overrides.
 * @param admin Whether the viewer has write authority.
 * @returns The row's HTML.
 */
function controlRow(repo: string, ship: ShipView, controls: RepoShipControls, admin: boolean, telemetry?: RepoShipTelemetry): string {
  const row = controls.rows.find(item => item.ship === ship.name);
  const allowed = repoShipEnabled(controls, ship.name);
  const savedOn = row?.enabled !== 0;
  const label = ship.name === '*' ? 'All cloud ships' : ship.name;
  const state = !controls.available ? 'Unavailable · stopped' : !allowed ? 'Off' : 'On · permitted';
  return `<article class="ship-row"><div><h2>${esc(label)}</h2><p>${esc(ship.role)}</p>
    <p class="meta">${esc(ship.trigger)}${row ? ` · saved ${esc(new Date(row.updated_at * 1000).toISOString())}` : ' · inherited from trusted configuration'}</p>
    ${ship.model ? `<p class="meta">Configured model: ${esc(ship.model)} · ${ship.blocking ? 'Blocking review' : 'Advisory'}</p>` : ''}</div>
    <div class="controls"><strong class="state ${allowed ? 'on' : 'off'}">${state}</strong>
    ${admin && controls.available ? `<form method="post" action="/account/ships/set">
      <input type="hidden" name="repo" value="${esc(repo)}"><input type="hidden" name="ship" value="${esc(ship.name)}">
      <input type="hidden" name="revision" value="${row?.revision ?? 0}">
      <button name="enabled" value="${savedOn ? 'off' : 'on'}" aria-label="Turn ${esc(label)} ${savedOn ? 'off' : 'on'} for ${esc(repo)}">Turn ${savedOn ? 'off' : 'on'}</button>
    </form>` : `<span class="meta">${controls.available ? 'Repository admin required to change' : 'Controls unavailable; changes blocked'}</span>`}
    ${controls.available && ship.name !== '*' && savedOn && !allowed ? '<span class="meta">Held by All cloud ships</span>' : ''}</div>
    <details class="evidence-drawer" ${ship.name === '*' ? 'open' : ''}><summary>${ship.name === '*' ? 'Repository' : esc(ship.name)} activity, costs and transcripts</summary>${renderShipTelemetry(telemetry, ship.name)}</details></article>`;
}

/** Why shared account design tokens: real-state proof must match the signed-in site.
 * @param repo Selected repository or empty picker state.
 * @param ships Trusted cloud roster, without prompts or skills.
 * @param controls Database read-back, distinct from running status.
 * @param admin Fresh permission witness.
 * @param notice Outcome or unavailable explanation.
 * @returns Script-free account HTML.
 */
export function renderRepoShipsPage(repo: string, ships: ShipView[], controls: RepoShipControls, admin: boolean, notice = '', telemetry?: RepoShipTelemetry): string {
  return `<!doctype html><html lang="en"><head>${HEAD}<title>Repository ships · Port Daddy</title><style>${TOKENS}
    .shell{max-width:1100px;margin:auto;padding:28px 32px 72px}nav{display:flex;gap:20px;border-bottom:2px solid var(--border-strong);padding-bottom:18px}
    h1{font-size:clamp(28px,4vw,44px);margin:32px 0 12px}h2{font-size:19px;margin:0 0 8px}p{font-size:16px;line-height:1.6;max-width:72ch}
    .picker{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}input,button{font:inherit;font-size:16px;padding:10px 14px;border:2px solid var(--border-strong)}
    input{background:var(--surface-base);color:var(--text-primary);max-width:100%;box-sizing:border-box}button{background:var(--cobalt);color:var(--on-accent);cursor:pointer}
    button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid var(--health);outline-offset:4px}
    .ship-row{display:grid;grid-template-columns:minmax(0,1fr) 210px;gap:24px;padding:24px;margin-top:16px;border:2px solid var(--border-strong);background:var(--surface-raised)}
    .controls{display:flex;flex-direction:column;gap:12px;align-items:flex-start}.state{font-size:16px}.on{color:var(--health)}.off{color:var(--text-secondary)}
    .meta{font-size:14px;color:var(--text-secondary);overflow-wrap:anywhere}.notice{padding:16px;border:2px solid var(--cobalt);margin:20px 0}.scope{margin-top:28px;border-top:1px solid var(--border-strong);padding-top:20px}
    .evidence-drawer{grid-column:1/-1;border-top:1px solid var(--border-strong);padding-top:16px;min-width:0}summary{cursor:pointer;font-size:16px;font-weight:600;padding:8px 0}summary:focus-visible{outline:3px solid var(--health)}
    .ship-metrics{display:flex;flex-wrap:wrap;gap:18px;margin:16px 0}.ship-metrics dt{font-size:14px;color:var(--text-secondary)}.ship-metrics dd{margin:4px 0;font-size:20px;font-weight:700}
    .cost-chart{height:95px;display:flex;gap:6px;align-items:flex-end;margin:12px 0}.cost-day{flex:1;min-width:0;text-align:center}.cost-day span{display:block;background:var(--cobalt);min-height:2px}.cost-day small{font-size:12px}.ship-evidence figure{margin:16px 0}.ship-evidence figcaption{font-size:14px}
    .cost-day span.unreported{background:transparent;border-bottom:1px dotted var(--text-secondary)}
    .recent-ships{padding-left:22px}.recent-ships li{padding:12px 0;border-bottom:1px solid var(--border-strong);overflow-wrap:anywhere}.recent-ships p{margin:6px 0}.recent-ships small{display:block;font-size:13px;color:var(--text-secondary)}.ship-evidence table{width:100%;text-align:left}.telemetry-note{color:var(--text-secondary);border-left:3px solid var(--cobalt);padding-left:12px}.ship-evidence p{overflow-wrap:anywhere}
    @media(max-width:650px){.shell{padding:20px 16px}.ship-row{grid-template-columns:1fr}.controls{flex-direction:row;align-items:center;flex-wrap:wrap}}
  </style></head><body><main class="shell"><nav><a href="/account">Port Daddy / Account</a><a href="/account/repos">Repo settings</a><a href="/account/runs">Fleet runs</a></nav>
  <h1>Ships, repository by repository.</h1><p>See what each ship does, what happened, and what it cost. Open a ship’s activity for recent transcripts. Each control saves immediately. Turning a ship on permits future events; it does not launch a job.</p>
  <form class="picker" method="get" action="/account/ships"><label>Repository <input required name="repo" value="${esc(repo)}" placeholder="owner/repository"></label><button>Show ships</button></form>
  ${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ''}
  ${repo ? `<h2>${esc(repo)}</h2><p class="meta">${admin ? 'Repository admin · you can save controls' : 'Read-only · a repository admin can change controls'}</p>
    <p class="meta">${telemetry ? `Snapshot ${esc(new Date(telemetry.now * 1000).toISOString())} · last 14 UTC days, at most 200 recent runs${telemetry.truncated ? ' · clipped: not a complete total' : ''}.` : 'Telemetry not loaded.'} <a href="/account/ships?repo=${encodeURIComponent(repo)}">Refresh activity →</a></p>
    ${controlRow(repo, { name: '*', role: 'Pause all cloud review ships in this repository without changing other repositories.', trigger: 'Repository master permission' }, controls, admin, telemetry)}
    ${ships.map(ship => controlRow(repo, ship, controls, admin, telemetry)).join('')}` : ''}
  <section class="scope"><h2>What Off means</h2><p>The executor reads these controls before each ship, including queued retries. Work already in progress may finish; this is not a process-kill button. A skipped review is reported as not reviewed, never as a passing review.</p>
  <p>A global Fleet pause still wins. These controls govern cloud PR review ships, XO, and new Mediator scans. Existing signed human orders remain in force. They do not start or stop local agents, GitHub Actions, or the separate Steward service. Removing a repo from personal settings does not remove its ship controls.</p></section>
  </main></body></html>`;
}

/** Why a script-free, uncached shell: limit exposure of sensitive account state.
 * @param body Rendered HTML.
 * @param status HTTP result.
 * @returns Browser response with no scripts, framing, indexing, or caching.
 */
function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    // Same-origin retains the browser's POST origin for CSRF validation while
    // still sending no referrer to another site. no-referrer made real forms
    // arrive with Origin:null even though synthetic Request tests passed.
    'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' } });
}

/** Why session-only writes: a read bearer must not become spending authority.
 * @param request Browser GET or same-origin form POST.
 * @param env Relay bindings.
 * @returns Saved read-back redirect or explicit failure with no mutation.
 */
export async function handleRepoShips(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return new Response(null, { status: 302, headers: { Location: '/login', 'Cache-Control': 'no-store' } });
  const url = new URL(request.url);
  const writing = request.method === 'POST';
  if (writing && !isSameOrigin(request, env)) return html('Cross-origin change refused.', 403);
  if (writing && Number(request.headers.get('Content-Length')) > 4096) return html('Form too large.', 413);
  let form: URLSearchParams | null = null;
  if (writing) {
    if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return html('Expected an encoded form.', 415);
    try { form = new URLSearchParams(await boundedText(request, 4096)); }
    catch { return html('Form too large or invalid.', 413); }
  }
  const rawRepo = writing ? form?.get('repo') : url.searchParams.get('repo');
  const normalized = normalizeRepoFullName(rawRepo);
  const repo = normalized ? shipControlRepo(normalized) : null;
  if (!repo) return html(renderRepoShipsPage('', [], { available: true, rows: [] }, false, rawRepo ? 'Enter an owner/repository name.' : ''), writing ? 400 : 200);
  const witnessResult = await repoWitness(session, repo);
  if (witnessResult.kind !== 'verified') return repoWitnessFailure(repo, witnessResult);
  const witness = witnessResult.witness;
  if (writing && !witness.admin) return html('Only a repository admin can change its ship controls.', 403);
  const controls = await readRepoShipControls(env.DB, repo);
  let ships: ShipView[] = [];
  let inventoryError = '';
  try { ships = await shipInventory(env, repo, witness); }
  catch { inventoryError = 'Trusted ship list unavailable. The repository master Off control remains available; no new ship can be enabled until the list is verified.'; }
  if (!writing) {
    const telemetry = await readRepoShipTelemetry(env.DB, repo);
    return html(renderRepoShipsPage(repo, ships, controls, witness.admin,
      !controls.available ? controls.reason : inventoryError || (url.searchParams.get('saved') === '1' ? 'Saved. The state below was read back from storage.' : ''), telemetry));
  }
  const ship = form?.get('ship');
  const enabled = form?.get('enabled');
  const revisionText = form?.get('revision');
  if (typeof ship !== 'string' || !validShipControlName(ship) || !['on', 'off'].includes(String(enabled))
    || typeof revisionText !== 'string' || !/^\d{1,12}$/.test(revisionText)) return html('Invalid ship control.', 400);
  if (!controls.available) return html(controls.reason, 503);
  if (inventoryError && enabled === 'on') return html(inventoryError, 503);
  if (ship !== '*' && !ships.some(item => item.name === ship)) return html('That ship is not in the trusted cloud roster.', 400);
  if (controls.rows.length >= 256 && !controls.rows.some(row => row.ship === ship)) return html('Control limit reached; existing controls remain available.', 409);
  try {
    const saved = await setRepoShipControl(env.DB, repo, ship, enabled === 'on', Number(revisionText), session.user.id);
    if (!saved) return html('This control changed in another session. Reload the ship page before saving again.', 409);
  } catch { return html('Could not save. No successful change is confirmed; reload to check current state.', 503); }
  return new Response(null, { status: 303, headers: { Location: `/account/ships?repo=${encodeURIComponent(repo)}&saved=1`, 'Cache-Control': 'no-store' } });
}
