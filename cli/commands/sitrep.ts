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
  '                 [--template] [--quiet] [--json]',
  '',
  'Synthesize recent activity, notes, salvage, and spawned-agent state.',
  'Uses the shared daemon resolver, so socket, local TCP, and explicit remote targets behave consistently.',
].join('\n');

function shortId(id: string | undefined): string {
  if (!id) return '-';
  return id.length > 14 ? `${id.slice(0, 14)}…` : id;
}

function fmtClock(ts: string | number | undefined): string {
  if (!ts) return '        ';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts).slice(-8);
  return d.toISOString().slice(11, 19);
}

/**
 * Handle `pd sitrep` command.
 *
 * Exits non-zero only if the HTTP call fails. Empty sitreps (nothing
 * happened in the window) are valid states, not errors.
 */
export async function handleSitrep(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  const since = options.since as string | number | undefined;
  if (since !== undefined) params.append('since_minutes', String(since));
  if (options.project) params.append('project', options.project as string);
  if (options.stack) params.append('stack', options.stack as string);
  if (options.limitActivity) params.append('limit_activity', String(options.limitActivity));
  if (options.limitNotes) params.append('limit_notes', String(options.limitNotes));

  const qs = params.toString() ? `?${params}` : '';
  const res: PdFetchResponse = await pdFetch(`/sitrep${qs}`);
  const data = (await res.json()) as unknown as SitrepResponse & { error?: string };

  if (!res.ok) {
    ui.error(data.error || 'Failed to fetch sitrep');
    process.exit(1);
  }

  if (options.template) {
    const current = readCurrentContext();
    let agentId = 'unknown';
    let sessionId = 'unknown';
    let telos = 'unknown';
    let purpose = 'unknown';
    let compliance = 'C6';
    let latestPlan = '';
    let transcriptPath = '';

    if (current?.sessionId) {
      sessionId = current.sessionId;
      agentId = current.agentId || 'unknown';
      transcriptPath = `file:///Users/erichowens/.gemini/antigravity-cli/brain/${sessionId}/.system_generated/logs/transcript.jsonl`;

      try {
        const sRes = await pdFetch(`/sessions/${sessionId}`);
        if (sRes.ok) {
          const sData = (await sRes.json()) as any;
          if (sData.success && sData.session) {
            telos = sData.session.telos || sData.session.purpose || 'unknown';
            purpose = sData.session.purpose || 'unknown';
            compliance = sData.session.metadata?.compliance || 'C6';
          }
        }
      } catch {
        // fail-silent
      }

      try {
        const pRes = await pdFetch(`/sessions/${sessionId}/notes?type=todo_list`);
        if (pRes.ok) {
          const pData = (await pRes.json()) as any;
          if (pData.success && pData.notes && pData.notes.length > 0) {
            latestPlan = pData.notes[pData.notes.length - 1].content || pData.notes[pData.notes.length - 1].note;
          }
        }
      } catch {
        // fail-silent
      }
    }

    console.log(`
# Session Sit-Rep: ${sessionId}

## Metadata
- **Agent ID:** ${agentId}
- **Session ID:** ${sessionId}
- **Telos:** ${telos}
- **Purpose:** ${purpose}
- **Compliance Level:** ${compliance}
- **Transcript:** ${transcriptPath || '(No active session)'}

## Plan & Todo List
${latestPlan ? latestPlan : '- [ ] (No plan set yet; run "pd plan set" to define your checklist)'}

## Ideas, Suggestions & Remediations
| Idea / Suggestion / Remediation | Source (Agent/Operator) | Status | Related PR/Issue | Docs / Roadmap Link |
| --- | --- | --- | --- | --- |
| | | | | |

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
