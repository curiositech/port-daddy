/**
 * CLI Suggest Commands
 *
 * pd suggest                — List pending fleet suggestions from Tender
 * pd suggest --json         — JSON output
 * pd suggest approve <id>   — Approve a suggestion (triggers run if action=run-now)
 * pd suggest dismiss <id>   — Dismiss a suggestion
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson } from '../types.js';
import * as ui from '../utils/ui.js';

const PRIORITY_LABELS: Record<number, string> = { 1: 'critical', 2: 'high', 3: 'medium', 4: 'low', 5: 'info' };
const ACTION_VERBS: Record<string, string> = {
  'run-now': 'Run',
  'adjust-cooldown': 'Tune',
  'pause': 'Pause',
  'review-prompt': 'Review prompt',
  'graft-skill': 'Graft skill',
};

export async function handleSuggest(args: string[], options: CLIOptions): Promise<void> {
  const subcommand = args[0];

  if (subcommand === 'approve' || subcommand === 'dismiss') {
    const id = args[1];
    if (!id) { ui.error(`Usage: pd suggest ${subcommand} <suggestion-id>`); process.exit(1); }
    const res = await pdFetch(`${PORT_DADDY_URL}/fleet/suggestions/${id}/${subcommand}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { ui.error((data.error as string) || `Failed to ${subcommand}`); process.exit(1); }
    if (isJson(options)) { console.log(JSON.stringify(data, null, 2)); return; }
    if (subcommand === 'approve' && (data as { run_triggered?: boolean }).run_triggered) {
      ui.success(`Approved and triggered run for ${id}`);
    } else {
      ui.success(`${subcommand === 'approve' ? 'Approved' : 'Dismissed'} suggestion ${id}`);
    }
    return;
  }

  const res = await pdFetch(`${PORT_DADDY_URL}/fleet/suggestions`);
  const data = await res.json();
  if (!res.ok) { ui.error((data.error as string) || 'Failed to fetch suggestions'); process.exit(1); }

  if (isJson(options)) { console.log(JSON.stringify(data, null, 2)); return; }

  const suggestions = (data as { suggestions: Array<{
    id: string; ship_name: string; reason: string; priority: number; action: string;
  }> }).suggestions;

  if (!suggestions.length) {
    console.log('No pending suggestions. Run pd fleet up to start Tender.');
    return;
  }

  console.log(`\n  Fleet Suggestions (${suggestions.length})\n`);
  for (const s of suggestions) {
    const priority = PRIORITY_LABELS[s.priority] ?? String(s.priority);
    const action = ACTION_VERBS[s.action] ?? s.action;
    console.log(`  [${s.id}]  ${s.ship_name}  (${priority})`);
    console.log(`    ${s.reason}`);
    console.log(`    → ${action}  |  pd suggest approve ${s.id}\n`);
  }
}
