/**
 * CLI Briefing Commands
 *
 * pd briefing               — Generate .portdaddy/briefing.md
 * pd briefing --full        — + session/agent archives + activity.log
 * pd briefing --json        — JSON to stdout, no file write
 * pd briefing --project X   — Override project detection
 * pd history                — Quick view of recent project activity
 * pd history --agent <id>   — Filter to one agent
 * pd history --files        — Show file trajectories
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';

/**
 * Handle `pd briefing` command
 */
export async function handleBriefing(options: CLIOptions): Promise<void> {
  const projectRoot = (options.dir as string) || process.cwd();
  const project = options.project as string | undefined;
  const full = !!options.full;

  // --json mode: return briefing as JSON to stdout, no disk write
  if (isJson(options)) {
    const detectedProject = project || 'auto';
    const qs = `?projectRoot=${encodeURIComponent(projectRoot)}`;
    const res: PdFetchResponse = await pdFetch(
      `${PORT_DADDY_URL}/briefing/${encodeURIComponent(detectedProject)}${qs}`
    );
    const data = await res.json();

    if (!res.ok) {
      console.error((data.error as string) || 'Failed to get briefing');
      process.exit(1);
    }

    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Default: generate and write to disk
  const body: Record<string, unknown> = { projectRoot };
  if (project) body.project = project;
  if (full) body.full = true;

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/briefing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Failed to generate briefing');
    process.exit(1);
  }

  if (isQuiet(options)) {
    console.log(data.briefingPath || 'ok');
    return;
  }

  console.log(`Briefing generated: ${data.briefingPath}`);
  if (data.files) {
    const files = data.files as string[];
    for (const f of files) {
      console.log(`  ${f}`);
    }
  }
  if (full && data.archivedSessions) {
    console.log(`  Archived ${data.archivedSessions} session(s)`);
  }
  if (full && data.archivedAgents) {
    console.log(`  Archived ${data.archivedAgents} agent(s)`);
  }
}

/**
 * Handle `pd history` command
 */
export async function handleHistory(options: CLIOptions): Promise<void> {
  // history uses the activity log filtered by project
  const params = new URLSearchParams();
  params.set('limit', String(options.limit || 20));
  if (options.type) params.set('type', options.type as string);
  if (options.agent) params.set('agent', options.agent as string);

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/activity?${params}`);
  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Failed to get activity');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const entries = data.entries as Array<{
    timestamp: number;
    type: string;
    agentId: string | null;
    targetId: string | null;
    details: string | null;
  }>;

  if (!entries || entries.length === 0) {
    console.log('No recent activity');
    return;
  }

  console.log('');
  for (const entry of entries) {
    const time = new Date(entry.timestamp).toISOString().slice(11, 19);
    const agent = entry.agentId ? ` [${entry.agentId.slice(0, 12)}]` : '';
    const detail = entry.details || entry.type;
    console.log(`  [${time}]${agent} ${detail}`);
  }
  console.log('');
  console.log(`${entries.length} entries`);
}
