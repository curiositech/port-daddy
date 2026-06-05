/**
 * `pd periscope` (aliases: `pd sight`, `pd scope`) — the SIGHT stage of the
 * operator loop (Found → Sight → Dispatch → Watch → Intervene → Land).
 *
 * "Raise the periscope": one command that answers *what's the state, what's
 * next* by composing live daemon truth — daemon health + fleet + the roadmap
 * `now` head (the next cut) — into a single glance. It is a thin, additive
 * composition over existing primitives (`/status`, `/roadmap/items`); it adds
 * no new daemon state.
 *
 * The formatting is a PURE function (`composePeriscope`) so it is exhaustively
 * testable without a daemon; the handler only fetches and feeds it. (Same
 * pure-core discipline as lib/cli-liveness.ts.)
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson } from '../types.js';
import * as ui from '../utils/ui.js';

export interface PeriscopeStatus {
  version?: string;
  uptimeHuman?: string;
  status?: string; // 'ok' | 'degraded'
  fleet?: {
    running?: boolean;
    totalAgents?: number;
    totalLaunchableAgents?: number;
    projects?: Array<{ name?: string; agents?: number }>;
  };
}

export interface PeriscopeRoadmap {
  items?: Array<{ slug?: string; title?: string; status?: string }>;
}

export interface PeriscopeGuard {
  mode?: string; // 'enforce' | 'advisory' | 'off'
  ok?: boolean;
}

export interface PeriscopeParts {
  status?: PeriscopeStatus | null;
  roadmapNow?: PeriscopeRoadmap | null;
  guard?: PeriscopeGuard | null;
}

/**
 * PURE: turn fetched daemon truth into the periscope glance. Never throws;
 * a null `status` (daemon unreachable) degrades to an explicit cue rather than
 * a blank or a stack trace.
 */
export function composePeriscope(parts: PeriscopeParts): string[] {
  const lines: string[] = ['🔭 Periscope — what is the state, what is next'];

  const s = parts.status;
  if (!s) {
    lines.push('  daemon   unreachable — is it running?  (pd start)');
    lines.push('  next     (cannot read the roadmap while the daemon is down)');
    return lines;
  }

  const ver = s.version ? `v${s.version}` : 'v?';
  const up = s.uptimeHuman ? `up ${s.uptimeHuman}` : 'up ?';
  const health = s.status || 'ok';
  lines.push(`  daemon   ${ver} · ${up} · ${health}`);

  const f = s.fleet;
  if (f) {
    const agents = f.totalAgents ?? 0;
    const launch = f.totalLaunchableAgents ?? 0;
    const projects = f.projects?.length ?? 0;
    const run = f.running ? 'running' : 'stopped';
    lines.push(`  fleet    ${run} · ${agents} agent${agents === 1 ? '' : 's'} · ${launch} launchable across ${projects} project${projects === 1 ? '' : 's'}`);
  }

  const items = parts.roadmapNow?.items ?? [];
  if (items.length === 0) {
    lines.push('  next     no next cut queued in the roadmap (nothing in "now")');
  } else {
    const top = items[0];
    lines.push(`  next     ▸ ${top.title ?? top.slug ?? '(untitled)'}`);
    for (const it of items.slice(1, 3)) {
      lines.push(`           ▸ ${it.title ?? it.slug ?? '(untitled)'}`);
    }
    const more = items.length - Math.min(items.length, 3);
    if (more > 0) lines.push(`           … +${more} more in "now"`);
  }

  const g = parts.guard;
  if (g && g.mode) {
    lines.push(`  guard    ${g.mode}${g.ok === false ? ' ⚠' : g.ok ? ' ✓' : ''}`);
  }

  return lines;
}

async function fetchJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await pdFetch(`${PORT_DADDY_URL}${path}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Handle `pd periscope` / `pd sight` / `pd scope`. */
export async function handlePeriscope(options: CLIOptions): Promise<void> {
  const project = (options.project as string | undefined) || undefined;
  const status = (await fetchJson('/status')) as PeriscopeStatus | null;
  const roadmapQs = `?status=now&limit=5${project ? `&project=${encodeURIComponent(project)}` : ''}`;
  const roadmapResp = await fetchJson(`/roadmap/items${roadmapQs}`);
  const roadmapNow: PeriscopeRoadmap | null = roadmapResp
    ? { items: (roadmapResp.items as PeriscopeRoadmap['items']) ?? [] }
    : null;

  // Guard mode, best-effort, from the daemon's guardian summary if present.
  let guard: PeriscopeGuard | null = null;
  const guardians = status && (status as Record<string, unknown>).guardians;
  if (guardians && typeof guardians === 'object') {
    const mode = (guardians as Record<string, unknown>).mode;
    if (typeof mode === 'string') guard = { mode, ok: true };
  }

  if (isJson(options)) {
    console.log(JSON.stringify({ status, roadmapNow, guard }, null, 2));
    return;
  }

  for (const line of composePeriscope({ status, roadmapNow, guard })) {
    ui.message(line);
  }
}
