/**
 * CLI Sitrep Command — `pd sitrep`
 *
 * Situation report: one synthesis across recent activity, notes, the salvage
 * queue, and spawned agents. Call this when you return to a project after
 * being away — instead of reading `pd activity`, `pd notes`, `pd salvage`,
 * and `pd spawn` in sequence and stitching the story yourself.
 *
 * The maritime nomenclature is not decoration: PD's voice is sitrep/mayday/
 * pan-pan/securite (see `lib/maritime.ts`). Radio discipline beats ad-hoc
 * narration.
 *
 * Usage:
 *   pd sitrep                       # last 60 minutes, all projects
 *   pd sitrep --since 120           # last 2 hours
 *   pd sitrep --project myapp       # scoped to one project's salvage queue
 *   pd sitrep --json                # machine-readable payload
 *   pd sitrep --quiet               # one-line summary only (good for prompts)
 *
 * @example
 *   $ pd sitrep --since 30
 *   SITREP · Last 30m · 8 events · 3 notes · 0 dead agents · 1 spawned agent
 *
 *   Recent activity (last 5 of 8):
 *     [15:07:34] session.note   agent-a374e18c  Note added to session-2471d576…
 *     ...
 *
 *   Session notes (last 3):
 *     [15:07:34] agent-a374e1 · session-2471d576 · "fixed agent-lifecycle TTL drift"
 *     ...
 */

import { pdFetch } from '../utils/fetch.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { readCurrentContext } from '../utils/current-context.js';

interface ActivityEntry {
  timestamp?: string;
  type?: string;
  agent_id?: string;
  agentId?: string;
  details?: string;
}

interface NoteEntry {
  timestamp?: string;
  created_at?: string;
  agent_id?: string;
  agentId?: string;
  session_id?: string;
  sessionId?: string;
  content?: string;
  note?: string;
}

interface SalvageEntry {
  agentId?: string;
  agent_id?: string;
  purpose?: string;
}

interface SpawnedEntry {
  id?: string;
  identity?: string;
  status?: string;
}

interface SitrepResponse {
  success: boolean;
  summary: string;
  since_minutes: number;
  since_ms: number;
  activity: ActivityEntry[];
  notes: NoteEntry[];
  salvage_queue: SalvageEntry[];
  spawned_agents: SpawnedEntry[];
  /** Held trust-gate spawn approvals (ADR-0093 L2). */
  approvals?: Array<{ id: string; agent: string; trigger: string; tier: string; project: string; timestamp: number }>;
}

export const SITREP_HELP: string = [
  'Usage: pd sitrep [--since MINUTES] [--project NAME] [--stack NAME]',
  '                 [--limit-activity N] [--limit-notes N] [--limit-salvage N]',
  '                 [--template] [--quiet] [--json]',
  '',
  'Synthesize recent activity, notes, salvage, and spawned-agent state.',
  'Uses the shared daemon resolver, so socket, local TCP, and explicit remote targets behave consistently.',
].join('\n');

/**
 * Truncate an agent/session identifier for column-aligned terminal output.
 *
 * Why: sitrep lines are radio traffic, not archives — a 14-character prefix
 * is enough to disambiguate live IDs while keeping every row on one line.
 *
 * @param id - The full identifier, or undefined when the record lacks one.
 * @returns The identifier trimmed to 14 characters (with an ellipsis), or `-`.
 */
function shortId(id: string | undefined): string {
  if (!id) return '-';
  return id.length > 14 ? `${id.slice(0, 14)}…` : id;
}

/**
 * Render a timestamp as a fixed-width `HH:MM:SS` UTC clock for sitrep rows.
 *
 * Design intent: fixed width keeps the activity/notes columns aligned even
 * when a record carries no timestamp (blank pad) or a malformed one (the
 * tail of the raw string, still 8 chars).
 *
 * @param ts - ISO string, epoch millis, or undefined.
 * @returns An 8-character clock string.
 */
function fmtClock(ts: string | number | undefined): string {
  if (!ts) return '        ';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts).slice(-8);
  return d.toISOString().slice(11, 19);
}

/**
 * Handle `pd sitrep` command.
 *
 * Purpose: one synthesis call replacing the four-read catch-up dance, plus
 * `--template`, which prints the end-of-turn SITREP scaffold the harness
 * compels via the `sitrep.endOfTurn` dial — pre-filled from active
 * exact-session roadmap-pop claims in the returned preview. Missing session
 * evidence stays unavailable; this projection grants no new authority.
 *
 * Exits non-zero only if the HTTP call fails. Empty sitreps (nothing
 * happened in the window) are valid states, not errors.
 *
 * @param options - Parsed CLI options (window, scoping, limits, output mode).
 * @returns Resolves once the report (or template) has been printed.
 */
export async function handleSitrep(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  const since = options.since as string | number | undefined;
  if (since !== undefined) params.append('since_minutes', String(since));
  if (options.project) params.append('project', options.project as string);
  if (options.stack) params.append('stack', options.stack as string);
  const limitActivity = options.limitActivity ?? options['limit-activity'];
  const limitNotes = options.limitNotes ?? options['limit-notes'];
  const limitSalvage = options.limitSalvage ?? options['limit-salvage'];
  const limitSalvageNotes = options.limitSalvageNotes ?? options['limit-salvage-notes'];
  const limitSpawned = options.limitSpawned ?? options['limit-spawned'];
  if (limitActivity) params.append('limit_activity', String(limitActivity));
  if (limitNotes) params.append('limit_notes', String(limitNotes));
  if (limitSalvage) params.append('limit_salvage', String(limitSalvage));
  if (limitSalvageNotes) params.append('limit_salvage_notes', String(limitSalvageNotes));
  if (limitSpawned) params.append('limit_spawned', String(limitSpawned));
  if (isQuiet(options)) params.append('summary_only', '1');

  const qs = params.toString() ? `?${params}` : '';
  const res: PdFetchResponse = await pdFetch(`/sitrep${qs}`);
  const data = (await res.json()) as unknown as SitrepResponse & { error?: string };

  if (!res.ok) {
    ui.error(data.error || 'Failed to fetch sitrep');
    process.exit(1);
  }

  if (options.template) {
    const current = readCurrentContext();
    const record = (value: unknown): Record<string, unknown> | null =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
    const identifier = (value: unknown): value is string =>
      typeof value === 'string' && value.length > 0 && value.length <= 512
      && value.trim() === value && !/[\s|\u0000-\u001f\u007f]/u.test(value);
    const field = (value: unknown, limit = 200): string | null =>
      typeof value === 'string' && value.trim()
        ? value.replace(/[\u0000-\u001f\u007f\s]+/gu, ' ').trim().slice(0, limit) : null;
    const cell = (value: unknown, limit: number): string | null =>
      field(value, limit)?.replace(/\|/g, '/') ?? null;
    const sessionId = identifier(current?.sessionId) ? current.sessionId : 'unknown';
    const agentId = identifier(current?.agentId) ? current.agentId : 'unknown';
    let telos = 'unknown';
    let purpose = 'unknown';
    let compliance = 'unavailable (not recorded)';
    let sessionMatched = false;
    let sessionEvidence = 'unavailable (no exact session and agent context)';
    let latestPlan = 'Plan unavailable (session evidence has not been matched).';

    if (sessionId !== 'unknown' && agentId !== 'unknown') {
      sessionEvidence = 'unavailable (session lookup failed)';
      try {
        const sRes = await pdFetch(`/sessions/${encodeURIComponent(sessionId)}`);
        if (sRes.ok) {
          const sData = record(await sRes.json());
          const session = record(sData?.session);
          if (sData?.success === true && session?.id === sessionId && session.agentId === agentId) {
            sessionMatched = true;
            sessionEvidence = 'matched returned session ID and agent ID (not an authority proof)';
            purpose = field(session.purpose) ?? 'unknown';
            telos = field(session.telos) ?? purpose;
            const recordedCompliance = field(record(session.metadata)?.compliance, 64);
            if (recordedCompliance) compliance = `${recordedCompliance} (recorded; not an authority proof)`;
          } else {
            sessionEvidence = 'unavailable (returned session or agent does not match context)';
          }
        }
      } catch {
        // Keep fixed unavailable diagnostics; never print transport/response data.
      }
    }

    if (sessionMatched) {
      latestPlan = 'Plan unavailable (session notes lookup failed).';
      try {
        const pRes = await pdFetch(`/sessions/${encodeURIComponent(sessionId)}/notes?type=todo_list`);
        if (pRes.ok) {
          const pData = record(await pRes.json());
          if (pData?.success === true && Array.isArray(pData.notes)) {
            const plans = pData.notes.map(record).filter(
              (note) => note?.sessionId === sessionId && note.type === 'todo_list',
            );
            const latest = plans.at(-1);
            const content = latest?.content ?? latest?.note;
            latestPlan = plans.length === 0
              ? 'No matching plan in returned session notes; inspect existing history with "pd plan" before setting a checklist.'
              : typeof content === 'string' && content.trim()
                ? content : 'Plan unavailable (latest returned plan has no readable content).';
          }
        }
      } catch {
        // Unavailable is not an assertion that the session has no plan.
      }
    }

    // This API returns a bounded preview, not a complete session-scoped store.
    // Never substitute another session's rows, even for the same agent.
    const claimRows: string[] = [];
    let claimsEvidence = 'Roadmap preview unavailable (session evidence has not been matched).';
    if (sessionMatched) {
      claimsEvidence = 'Roadmap preview unavailable (claims lookup failed or malformed).';
      try {
        const cRes = await pdFetch('/cartographer/roadmap-claims');
        if (cRes.ok) {
          const cData = record(await cRes.json());
          if (cData?.success === true && Array.isArray(cData.claims)) {
            const mine = cData.claims.map(record).filter(
              (claim) => claim && identifier(claim.slug) && claim.releasedAt === null
                && claim.sessionId === sessionId
                && (claim.agentId == null || claim.agentId === agentId),
            );
            for (const claim of mine.slice(0, 8)) {
              if (!claim) continue;
              const label = cell(claim.summary, 60) ?? cell(claim.slug, 60);
              const by = cell(claim.claimedBy, 30) ?? 'unknown';
              claimRows.push(`| ${label} | ${by} | claimed (recorded) | | ${claim.slug} |`);
            }
            claimsEvidence = `${claimRows.length} of ${mine.length} matching active rows shown from the returned preview; not a complete roadmap or ownership proof.`;
          }
        }
      } catch {
        // Preserve the blank scaffold with an explicit unavailable explanation.
      }
    }

    console.log(`
# Session Sit-Rep: ${sessionId}

## Metadata
- **Agent ID:** ${agentId}
- **Session ID:** ${sessionId}
- **Session evidence:** ${sessionEvidence}
- **Telos:** ${telos}
- **Purpose:** ${purpose}
- **Compliance Level:** ${compliance}
- **Backend:** unavailable (not recorded by this session API)
- **Transcript:** unavailable (no recorded locator from this session API)

## Plan & Todo List
${latestPlan}

## Ideas, Suggestions & Remediations
${claimsEvidence}

| Idea / Suggestion / Remediation | Source (Agent/Operator) | Status | Related PR/Issue | Docs / Roadmap Link |
| --- | --- | --- | --- | --- |
${claimRows.length > 0 ? claimRows.join('\n') : '| | | | | |'}

Rules: track every idea raised this session, every roadmap claim, and work assigned
by other agents. Update Status with this turn's progress; carry unresolved rows
forward. Any row you write code for MUST carry a roadmap link from the moment the
row is created. Reuse the existing linked roadmap item and its ownership; reconcile
new work through the planning authority rather than creating a duplicate to fill this table.

## Recent Activity Summary
${data.summary}
`);
    return;
  }


  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(data.summary);
    return;
  }

  console.log('');
  console.log(`SITREP · ${data.summary}`);
  console.log('\u2500'.repeat(Math.min(80, data.summary.length + 9)));

  // Held spawn approvals lead everything else — a pending human gate is
  // the most actionable line in a sitrep and must be impossible to miss.
  const approvals = (data.approvals ?? []) as Array<{ id: string; agent: string; trigger: string; tier: string; project: string; timestamp: number }>;
  if (approvals.length > 0) {
    console.log('');
    console.log(`⚠ HITL — ${approvals.length} SPAWN APPROVAL${approvals.length === 1 ? '' : 'S'} WAITING:`);
    for (const p of approvals) {
      const ageMin = Math.floor((Date.now() - p.timestamp) / 60_000);
      console.log(`  ${p.id}  ${p.agent} ← ${p.trigger}  (${p.tier}, ${p.project}, ${ageMin}m)`);
    }
    console.log('  Decide: pd fleet approve <id> | pd fleet reject <id> --feedback "<why>"');
  }

  if (data.activity.length > 0) {
    const preview = data.activity.slice(0, 5);
    console.log('');
    console.log(`Recent activity (last ${preview.length} of ${data.activity.length}):`);
    for (const e of preview) {
      const clock = fmtClock(e.timestamp);
      const agent = shortId(e.agent_id || e.agentId);
      const type = (e.type || '').padEnd(18).slice(0, 18);
      const detail = (e.details || '').slice(0, 60);
      console.log(`  [${clock}] ${type} ${agent.padEnd(16)} ${detail}`);
    }
  }

  if (data.notes.length > 0) {
    const preview = data.notes.slice(0, 5);
    console.log('');
    console.log(`Session notes (last ${preview.length} of ${data.notes.length}):`);
    for (const n of preview) {
      const clock = fmtClock(n.timestamp || n.created_at);
      const agent = shortId(n.agent_id || n.agentId);
      const session = shortId(n.session_id || n.sessionId);
      const content = (n.content || n.note || '').slice(0, 72).replace(/\s+/g, ' ');
      console.log(`  [${clock}] ${agent} · ${session} · "${content}"`);
    }
  }

  if (data.salvage_queue.length > 0) {
    console.log('');
    console.log(`Salvage queue (${data.salvage_queue.length} dead agent${data.salvage_queue.length === 1 ? '' : 's'}):`);
    for (const s of data.salvage_queue.slice(0, 5)) {
      const id = shortId(s.agentId || s.agent_id);
      const purpose = (s.purpose || '').slice(0, 72);
      console.log(`  ${id.padEnd(16)} ${purpose}`);
    }
    console.log('');
    console.log(ui.dim('  pd salvage claim <id>   # to pick up their work'));
  }

  if (data.spawned_agents.length > 0) {
    console.log('');
    console.log(`Spawned agents (${data.spawned_agents.length}):`);
    for (const s of data.spawned_agents.slice(0, 5)) {
      const id = shortId(s.id);
      const identity = (s.identity || '').slice(0, 50);
      const status = s.status || '';
      console.log(`  ${id.padEnd(16)} ${identity.padEnd(50)} ${status}`);
    }
  }

  if (
    data.activity.length === 0 &&
    data.notes.length === 0 &&
    data.salvage_queue.length === 0 &&
    data.spawned_agents.length === 0
  ) {
    console.log('');
    console.log(ui.dim('  (harbor quiet — nothing to report)'));
  }

  console.log('');
}
