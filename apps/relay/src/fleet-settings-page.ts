/** Script-free Cloud Fleet settings using the existing account design system. */
import { HEAD, TOKENS } from './account-theme.js';
import { resolveSession } from './auth-github.js';
import { isFleetAdmin, fleetSameOrigin, managedFleetInstallations, type ManagedFleetInstallation } from './fleet-settings-access.js';
import { readFleetControl, writeFleetControl, installationScope, type FleetControl } from '../../../shared/fleet-controls.js';
import type { Env } from './types.js';

/** Purpose: prevent account text from becoming executable HTML.
 * @param text Account-derived or diagnostic string.
 * @returns Escaped HTML text/attribute content.
 */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** Design: private responses must not survive logout in another account's cache.
 * @param html Server-rendered page.
 * @param status Explicit HTTP outcome.
 * @returns A script-free, non-cacheable response.
 */
function page(html: string, status = 200): Response {
  return new Response(html, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  } });
}

export interface FleetSettingsView {
  global: FleetControl;
  installations: Array<ManagedFleetInstallation & { control: FleetControl }> | null;
  admin: boolean;
  notice?: string;
}

/**
 * Purpose: separate an account's preference from the global effective stop.
 * @param view Server-authorized state, or explicit unavailable state.
 * @returns Responsive, script-free forms with revision preconditions.
 */
export function renderFleetSettings(view: FleetSettingsView): string {
  const title = view.admin ? 'Fleet administration' : 'Cloud Fleet settings';
  /** Purpose: keep global and installation forms on one consistent control card.
   * @param name Escaped display label.
   * @param control Current persisted state, not optimistic client state.
   * @param id Optional authorized installation ID; absent for the global switch.
   * @returns A revision-bound form or an unavailable notice without a button.
   */
  const card = (name: string, control: FleetControl, id?: number) => `
    <section class="control" aria-label="${esc(name)}">
      <div class="control-head"><h2>${esc(name)}</h2><strong class="status">${!control.available ? 'Unverified' : control.enabled ? 'On' : 'Off'}</strong></div>
      <p>${view.admin ? 'This switch overrides every account. Turning it on preserves each installation’s own setting.'
        : !view.global.available ? 'The global setting could not be verified. Work may continue; this page has not saved a global stop.'
        : view.global.enabled ? 'Your installation’s setting controls new Cloud Fleet work.' : 'Globally stopped. This installation cannot run, even if its own setting is on.'}</p>
      ${control.available ? `<form method="post" action="${view.admin ? '/admin/fleet' : '/account/fleet'}">
        <input type="hidden" name="revision" value="${control.revision}">
        ${id === undefined ? '' : `<input type="hidden" name="installationId" value="${id}">`}
        <button name="enabled" value="${control.enabled ? 'false' : 'true'}" ${!view.admin && !view.global.enabled && !control.enabled ? 'disabled' : ''}>${control.enabled ? view.admin ? 'Turn Fleet off globally' : 'Turn Fleet off' : view.admin ? 'Allow Fleet globally' : 'Turn Fleet on'}</button>
      </form>` : '<p class="notice">The saved setting could not be verified. Work may continue. A failed read does not save a stop.</p>'}
    </section>`;
  return `<!DOCTYPE html><html lang="en"><head><title>${title} — Port Daddy</title>${HEAD}<style>${TOKENS}
    .fleet-header{border-bottom:2px solid var(--border-strong);padding:18px max(20px,calc((100vw - 900px)/2));display:flex;gap:24px;align-items:center}
    .fleet-header a{min-height:44px;display:inline-flex;align-items:center;font-weight:600}
    main{max-width:940px;margin:auto;padding:40px 20px 64px}h1{font-size:clamp(30px,6vw,46px);line-height:1.15;margin:12px 0 20px}
    .lede{font-size:18px;max-width:65ch;color:var(--text-secondary)}.global{margin:28px 0;border-left:4px solid var(--cobalt);padding:12px 18px;background:var(--surface-raised)}
    .control{margin-top:24px;border:2px solid var(--border-strong);padding:24px;background:var(--surface-raised)}
    .control-head{display:flex;justify-content:space-between;gap:16px;align-items:baseline;flex-wrap:wrap}.control h2{font-size:22px;overflow-wrap:anywhere}.control p{margin-top:14px}
    .status{font-family:"IBM Plex Mono",monospace;font-size:16px;color:var(--text-primary)}form{margin-top:22px}
    button{min-height:48px;padding:10px 18px;border:2px solid var(--border-strong);background:var(--cobalt);color:var(--on-accent);font-weight:600;cursor:pointer}
    button:hover{background:var(--border-strong);color:var(--surface-base)}button:active{transform:translateY(1px)}button:disabled{background:var(--surface-strong);color:var(--text-muted);cursor:not-allowed}
    .notice{padding:16px;border:1px solid var(--border-strong);margin:24px 0}.limits{margin-top:32px;color:var(--text-secondary);font-size:16px}
    @media(max-width:520px){main{padding-top:24px}.control{padding:18px}button{width:100%}}
    </style></head><body><header class="fleet-header"><b>Port Daddy</b><a href="/account">Back to account</a></header>
    <main><p class="eyebrow">${view.admin ? 'Administrator / Global control' : 'Account / Automation'}</p><h1>${title}</h1>
    <p class="lede">${view.admin ? 'One stop control for Cloud Fleet across every installation. Only Cloudflare-allowlisted administrators can change it.' : 'Choose where Cloud Fleet may review code and run agents. Only GitHub installations you administer appear here.'}</p>
    ${view.notice ? `<p class="notice" role="status">${esc(view.notice)}</p>` : ''}
    <a href="${view.admin ? '/admin/fleet' : '/account/fleet'}">Reload current settings</a>
    ${view.admin ? card('All Cloud Fleet', view.global) : `<p class="global"><strong>Global status: ${!view.global.available ? 'unverified' : view.global.enabled ? 'allowed' : 'off'}.</strong> An installation runs only when both saved controls allow it.</p>
      ${view.installations === null ? '<p class="notice">Could not verify your GitHub administration rights. No installation settings are available. Sign in again or retry.</p>' : view.installations.length === 0 ? '<p class="notice">No installations you administer were found. GitHub read access alone does not grant Fleet control.</p>' : view.installations.map(inst => card(inst.name, inst.control, inst.id)).join('')}`}
    <p class="limits">Turning Fleet off blocks new jobs, queued continuations and subsequent guarded actions. A request already sent may finish. This does not start or stop your local daemon, or control unrelated automation.</p>
    </main></body></html>`;
}

/** Purpose: parse an explicit bounded operation without widening its authority.
 * @param request URL-encoded browser form.
 * @returns Validated values, or null for oversized/ambiguous/invalid input.
 */
async function operation(request: Request): Promise<{ enabled: boolean; revision: number; installationId?: number } | null> {
  if (!(request.headers.get('Content-Type') ?? '').startsWith('application/x-www-form-urlencoded')) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let raw = '', bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024) { await reader.cancel(); return null; }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally { reader.releaseLock(); }
  const form = new URLSearchParams(raw);
  if ([...form.keys()].some(key => !['enabled', 'revision', 'installationId'].includes(key) || form.getAll(key).length !== 1)) return null;
  const enabled = form.get('enabled'), revision = form.get('revision'), id = form.get('installationId');
  if (!['true', 'false'].includes(enabled ?? '') || !/^(0|[1-9]\d*)$/.test(revision ?? '') || !Number.isSafeInteger(Number(revision))) return null;
  if (id !== null && (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) return null;
  return { enabled: enabled === 'true', revision: Number(revision), installationId: id === null ? undefined : Number(id) };
}

/**
 * Purpose: serve and mutate only the exact freshly authorized control target.
 * @param request Browser GET/POST; POST requires same-origin and revision.
 * @param env Existing Cloudflare bindings.
 * @param admin Selects the separate global page; never derived from form data.
 * @returns Rendered state, redirect after save, or an explicit failure.
 */
export async function handleFleetSettingsPage(request: Request, env: Env, admin = false): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (request.method === 'POST' && !fleetSameOrigin(request, env)) return new Response('Cross-origin form refused', { status: 403 });
  try {
    const session = await resolveSession(request, env);
    if (!session) return new Response(null, { status: 302, headers: { Location: '/login', 'Cache-Control': 'no-store' } });
    if (admin && !isFleetAdmin(session.user, env)) return new Response('Fleet administrator required', { status: 403 });
    if (request.method === 'POST') {
      const op = await operation(request);
      if (!op || (admin ? op.installationId !== undefined : op.installationId === undefined)) return new Response('Invalid control form', { status: 400 });
      if (!admin) {
        const managed = await managedFleetInstallations(session, op.installationId);
        if (managed === null) return new Response('GitHub authorization unavailable; nothing changed', { status: 503 });
        if (!managed.some(inst => inst.id === op.installationId)) return new Response('Installation administrator required', { status: 403 });
      }
      await writeFleetControl(env.DB, admin ? 'global' : installationScope(op.installationId!), op.enabled, op.revision, session.user.id);
      return new Response(null, { status: 303, headers: { Location: `${admin ? '/admin/fleet' : '/account/fleet'}?saved=1`, 'Cache-Control': 'no-store' } });
    }
    const global = await readFleetControl(env.DB, 'global');
    const managed = admin ? [] : await managedFleetInstallations(session);
    const installations = managed === null ? null : await Promise.all(managed.map(async inst => ({ ...inst, control: await readFleetControl(env.DB, installationScope(inst.id)) })));
    return page(renderFleetSettings({ global, installations, admin, notice: new URL(request.url).searchParams.get('saved') === '1' ? 'Setting saved. Current effective state is shown below.' : undefined }));
  } catch (error) {
    const stale = error instanceof Error && error.message === 'STALE_CONTROL';
    return page(renderFleetSettings({ global: { scope: 'global', enabled: false, revision: 0, available: false }, installations: null, admin,
      notice: stale ? 'This form is out of date; nothing was changed. Follow “Reload current settings” before making another change.' : 'The control could not be saved or read. Do not assume it changed; follow “Reload current settings” to verify.' }), stale ? 409 : 503);
  }
}
