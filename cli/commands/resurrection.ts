/**
 * CLI Resurrection Commands
 *
 * Self-healing agent system commands for discovering and
 * reclaiming work from stale or dead agents.
 */

import { JOLLY_ROGER, JOLLY_ROGER_COMPACT, ANSI } from '../../lib/banner.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

interface StaleAgent {
  id: string;
  name: string;
  purpose: string | null;
  sessionId: string | null;
  lastHeartbeat: number;
  staleSince: number;
  status: 'stale' | 'dead' | 'resurrecting';
  notes?: string[];
  identityProject: string | null;
  identityStack: string | null;
  identityContext: string | null;
}

export interface SalvageTriageSummary {
  total: number;
  statuses: Record<string, number>;
  ageBuckets: {
    recent: number;
    sameDay: number;
    stale: number;
  };
  projects: Array<{ project: string; count: number }>;
  encryptedNotes: number;
}

function parseEncryptedNote(note: string): boolean {
  try {
    const parsed = JSON.parse(note) as Record<string, unknown>;
    return typeof parsed.iv === 'string' && typeof parsed.ct === 'string' && typeof parsed.tag === 'string';
  } catch {
    return false;
  }
}

export function formatSalvageNote(note: string): string {
  if (parseEncryptedNote(note)) {
    return '[encrypted note redacted; use the original session context or keychain-backed tooling if the content is needed]';
  }
  return note;
}

export function summarizeSalvageAgents(agents: StaleAgent[], now: number = Date.now()): SalvageTriageSummary {
  const statuses: Record<string, number> = {};
  const projectCounts = new Map<string, number>();
  const ageBuckets = { recent: 0, sameDay: 0, stale: 0 };
  let encryptedNotes = 0;

  for (const agent of agents) {
    statuses[agent.status] = (statuses[agent.status] ?? 0) + 1;
    const project = agent.identityProject || '(unknown project)';
    projectCounts.set(project, (projectCounts.get(project) ?? 0) + 1);

    const ageMs = Math.max(0, now - agent.staleSince);
    if (ageMs < 2 * 60 * 60 * 1000) {
      ageBuckets.recent++;
    } else if (ageMs < 24 * 60 * 60 * 1000) {
      ageBuckets.sameDay++;
    } else {
      ageBuckets.stale++;
    }

    encryptedNotes += (agent.notes ?? []).filter(parseEncryptedNote).length;
  }

  const projects = [...projectCounts.entries()]
    .map(([project, count]) => ({ project, count }))
    .sort((a, b) => b.count - a.count || a.project.localeCompare(b.project));

  return {
    total: agents.length,
    statuses,
    ageBuckets,
    projects,
    encryptedNotes,
  };
}

function formatCount(name: string, count: number): string | null {
  return count > 0 ? `${count} ${name}` : null;
}

function printSalvageTriage(summary: SalvageTriageSummary): void {
  const statusLine = Object.entries(summary.statuses)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${count} ${status}`)
    .join(', ');
  const ageLine = [
    formatCount('<2h', summary.ageBuckets.recent),
    formatCount('2-24h', summary.ageBuckets.sameDay),
    formatCount('>24h', summary.ageBuckets.stale),
  ].filter(Boolean).join(', ');
  const projectLine = summary.projects
    .slice(0, 5)
    .map(entry => `${entry.project}:${entry.count}`)
    .join(', ');

  console.log(`${ANSI.bold}Triage:${ANSI.reset} ${summary.total} non-live queue entr${summary.total === 1 ? 'y' : 'ies'}`);
  if (statusLine) console.log(`  status: ${statusLine}`);
  if (ageLine) console.log(`  age:    ${ageLine}`);
  if (projectLine) console.log(`  scope:  ${projectLine}${summary.projects.length > 5 ? ', ...' : ''}`);
  if (summary.encryptedNotes > 0) {
    console.log(`  notes:  ${summary.encryptedNotes} encrypted note${summary.encryptedNotes === 1 ? '' : 's'} redacted from CLI output`);
  }
  console.log(`  active: compare with ${ANSI.fgCyan}pd sessions --active${ANSI.reset} and ${ANSI.fgCyan}pd agents --active${ANSI.reset}`);
  console.log('');
}

/**
 * Handle `pd salvage` command
 * Lists agents pending resurrection with their context
 */
export async function handleSalvage(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  if (subcommand === 'help') {
    console.error('Usage: port-daddy salvage [subcommand] [options]');
    console.error('');
    console.error('Salvage work from dead/stale agents');
    console.error('');
    console.error('Subcommands:');
    console.error('  (none)                          Show agents awaiting salvage (filtered by --project)');
    console.error('  claim <agent-id>                Claim an agent\'s work');
    console.error('  complete <old-id> <new-id>      Mark salvage complete');
    console.error('  abandon <agent-id>              Return agent to queue');
    console.error('  dismiss <agent-id>              Remove from queue (reviewed)');
    console.error('');
    console.error('Options:');
    console.error('  --project <name>                Filter to agents in this project (e.g., myapp)');
    console.error('  --stack <name>                  Further filter by stack (requires --project)');
    console.error('  --all                           Show ALL queue entries globally (use sparingly)');
    console.error('  --limit <n>                     Limit number of results');
    console.error('  --summary                       Show only grouped stale/dead triage');
    console.error('');
    console.error('By default, salvage shows agents in the current project. Use --all for global view.');
    process.exit(0);
  }

  switch (subcommand) {
    case 'claim': {
      const agentId = args[0];
      if (!agentId) {
        console.error('Usage: pd salvage claim <agent-id>');
        process.exit(1);
      }

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/salvage/claim/${encodeURIComponent(agentId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newAgentId: options.agent || `cli-${process.pid}` })
      });
      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to claim agent');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      ui.success(`Claimed ${agentId} for salvage`);
      const context = data.context as { sessionId?: string; purpose?: string; notes?: string[] } | undefined;
      if (context) {
        console.log('');
        console.log('Context:');
        if (context.sessionId) console.log(`  Session: ${context.sessionId}`);
        if (context.purpose) console.log(`  Purpose: ${context.purpose}`);
        if (context.notes?.length) {
          console.log('  Notes:');
          for (const note of context.notes) {
            console.log(`    - ${note.slice(0, 80)}${note.length > 80 ? '...' : ''}`);
          }
        }
      }
      break;
    }

    case 'complete': {
      const oldAgentId = args[0];
      const newAgentId = args[1];

      if (!oldAgentId || !newAgentId) {
        console.error('Usage: pd salvage complete <old-agent-id> <new-agent-id>');
        process.exit(1);
      }

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/salvage/complete/${encodeURIComponent(oldAgentId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newAgentId })
      });
      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to complete salvage');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        ui.success(`Salvage complete: ${oldAgentId} -> ${newAgentId}`);
      }
      break;
    }

    case 'abandon': {
      const agentId = args[0];
      if (!agentId) {
        console.error('Usage: pd salvage abandon <agent-id>');
        process.exit(1);
      }

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/salvage/abandon/${encodeURIComponent(agentId)}`, {
        method: 'POST'
      });
      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to abandon salvage');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(`Returned ${agentId} to salvage queue`);
      }
      break;
    }

    case 'dismiss': {
      const agentId = args[0];
      if (!agentId) {
        console.error('Usage: pd salvage dismiss <agent-id>');
        process.exit(1);
      }

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/salvage/${encodeURIComponent(agentId)}`, {
        method: 'DELETE'
      });
      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to dismiss');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(`Dismissed ${agentId} from salvage queue`);
      }
      break;
    }

    default: {
      // List pending resurrections - filter by project unless --all
      const endpoint = options.all ? '/salvage' : '/salvage/pending';
      const params = new URLSearchParams();
      if (options.limit) params.append('limit', String(options.limit));
      if (options.project) params.append('project', options.project as string);
      if (options.stack) params.append('stack', options.stack as string);

      // Warn about global salvage (can be noisy)
      if (options.all && !options.project && !isQuiet(options) && !isJson(options)) {
        ui.warn('Showing ALL agents globally. Use --project to filter.');
        console.log('');
      }

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}${endpoint}${params.toString() ? '?' + params : ''}`);
      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to list salvage queue');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const agents = data.agents as StaleAgent[];

      if (agents.length === 0) {
        if (!isQuiet(options)) {
          const scope = options.project ? `${options.project}:*` : 'any project';
          ui.info(`No agents awaiting salvage in ${scope}`);
        }
        return;
      }

      // Show the jolly roger when we have dead agents to salvage
      const deadCount = agents.filter(a => a.status === 'dead').length;
      if (deadCount > 0) {
        console.log(JOLLY_ROGER);
      }

      const scopeLabel = options.project
        ? `${ANSI.fgCyan}${options.project}${options.stack ? ':' + options.stack : ''}:*${ANSI.reset}`
        : `${ANSI.fgGray}(all projects)${ANSI.reset}`;

      console.log(`${ANSI.fgYellow}${ANSI.bold}⚓ Salvage Report${ANSI.reset} ${scopeLabel}`);
      console.log(`${ANSI.fgGray}${'─'.repeat(60)}${ANSI.reset}`);
      console.log('');

      const summary = summarizeSalvageAgents(agents);
      printSalvageTriage(summary);

      if (options.summary === true) {
        return;
      }

      for (const agent of agents) {
        const statusIcon = agent.status === 'dead' ? JOLLY_ROGER_COMPACT : agent.status === 'resurrecting' ? '↻' : '⚠';
        const ago = formatAge(Date.now() - agent.staleSince);

        // Show identity if available
        const identity = agent.identityProject
          ? `${agent.identityProject}${agent.identityStack ? ':' + agent.identityStack : ''}${agent.identityContext ? ':' + agent.identityContext : ''}`
          : null;

        console.log(`${statusIcon} ${agent.name || agent.id} (${agent.status}, ${ago})`);
        if (identity) console.log(`  Identity: ${ANSI.fgCyan}${identity}${ANSI.reset}`);
        if (agent.purpose) console.log(`  Purpose: ${agent.purpose}`);
        if (agent.sessionId) console.log(`  Session: ${agent.sessionId}`);
        if (agent.notes?.length) {
          console.log('  Notes:');
          for (const note of agent.notes.slice(0, 3)) {
            const formatted = formatSalvageNote(note);
            console.log(`    - ${formatted.slice(0, 90)}${formatted.length > 90 ? '...' : ''}`);
          }
          if (agent.notes.length > 3) {
            console.log(`    ... and ${agent.notes.length - 3} more`);
          }
        }
        console.log(`  Salvage: pd salvage claim ${agent.id}`);
        console.log('');
      }

      const filterNote = data.filtered ? ' (filtered)' : '';
      console.log(`${data.count} agent(s) in salvage queue${filterNote}`);
    }
  }
}

/**
 * Format age in human-readable form
 */
function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
