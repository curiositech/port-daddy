/**
 * pd nudge — the agent-facing surface of the suggestibility layer (ADR-0039).
 *
 * Named `nudge` (not `suggest`/`suggestion`) deliberately: `pd suggest` is the
 * Tender→operator fleet-health queue (PR #322). These are agent↔agent coaching
 * nudges — "another live session is on your surface" — a different audience and a
 * different table. Keeping the verbs distinct avoids the homophone trap.
 *
 *   pd nudge                     list your pending nudges (default)
 *   pd nudge --json              machine-readable
 *   pd nudge scan                run the claim-overlap detector across the fleet now
 *   pd nudge accept <id>         you acted on it
 *   pd nudge decline <id>        not relevant — primes the cooldown
 *
 * Identity resolution: --agent <id> > $PD_AGENT_ID > .portdaddy/current.json
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson } from '../types.js';
import { readCurrentContext } from '../utils/current-context.js';
import * as ui from '../utils/ui.js';

function resolveAgentId(options: CLIOptions): string | null {
  if (typeof options.agent === 'string' && options.agent) return options.agent;
  if (process.env.PD_AGENT_ID) return process.env.PD_AGENT_ID;
  return readCurrentContext()?.agentId ?? null;
}

interface NudgePayload {
  filePath?: string;
  message?: string;
  other?: { agentId?: string | null; sessionId?: string; purpose?: string };
  state?: string;
  action?: string;
  mermaid?: string;
}

interface Nudge {
  id: number;
  agentId: string;
  kind: string;
  payload: NudgePayload;
  status: string;
  createdAt: number;
}

export async function handleNudge(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0];

  if (sub === 'scan') {
    const res = await pdFetch(`${PORT_DADDY_URL}/suggestions/scan`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      ui.error((data.error as string) || 'Scan failed');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    ui.success(
      `Scan complete: ${data.pairs ?? 0} shared-surface pair(s), ${data.surfaced} claim-tree trouble nudge(s), ${data.suppressed} suppressed, ${data.delivered} delivered.`,
    );
    return;
  }

  if (sub === 'accept' || sub === 'decline') {
    const id = args[1];
    if (!id) {
      ui.error(`Usage: pd nudge ${sub} <id>`);
      process.exit(1);
    }
    const res = await pdFetch(`${PORT_DADDY_URL}/suggestions/${id}/${sub}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      ui.error((data.error as string) || `Failed to ${sub}`);
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    ui.success(`${sub === 'accept' ? 'Accepted' : 'Declined'} nudge ${id}`);
    return;
  }

  // default: list this agent's pending nudges
  const agentId = resolveAgentId(options);
  if (!agentId) {
    ui.error('No agent identity. Pass --agent <id>, set $PD_AGENT_ID, or run pd begin first.');
    process.exit(1);
  }

  const res = await pdFetch(
    `${PORT_DADDY_URL}/suggestions?agentId=${encodeURIComponent(agentId)}&status=pending`,
  );
  const data = await res.json();
  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to fetch nudges');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const nudges = (data as { suggestions: Nudge[] }).suggestions;
  if (!nudges.length) {
    console.log('No pending nudges. (Run pd nudge scan to check for claim overlaps now.)');
    return;
  }

  console.log(`\n  Nudges for ${agentId} (${nudges.length})\n`);
  for (const n of nudges) {
    const p = n.payload || {};
    const headline = p.message || `${n.kind} on ${p.filePath ?? '?'}`;
    console.log(`  [${n.id}]  ${n.kind}`);
    if (p.state) console.log(`    state: ${p.state}`);
    console.log(`    ${headline}`);
    if (p.action) console.log(`    next: ${p.action}`);
    if (options.mermaid && p.mermaid) console.log(`\n${p.mermaid}`);
    console.log(`    → pd nudge accept ${n.id}   |   pd nudge decline ${n.id}\n`);
  }
}
