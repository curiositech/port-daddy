/**
 * CLI `pd look` — the consolidated read verb
 *
 * Counterpart to `pd say`. Where `pd say` fans out a write, `pd look`
 * fans in a read. Default is a sitrep (situation report) across activity,
 * notes, salvage queue, and spawned agents. Flags pivot to other lenses:
 *
 *   pd look                     → sitrep of last 60m (what happened while I was away)
 *   pd look --since 120         → sitrep with a 2h window
 *   pd look --heat              → file heat map (pheromone contention)
 *   pd look --project myapp     → sitrep scoped to a project's salvage queue
 *   pd look --json              → machine-readable payload
 *   pd look --quiet             → one-line summary (useful for shell prompts)
 *
 * This command does NOT subsume `pd notes`, `pd activity`, or `pd inbox`.
 * Those stay as their own focused surfaces. `pd look` is strictly the
 * synthesis — the one call that combines four reads. Use `pd look` when
 * you want the story; use the primitives when you want the feed.
 *
 * @example
 *   $ pd look --since 30
 *   SITREP · Last 30m: 8 events, 3 notes, 0 dead agents, 1 spawned agent
 *   Recent activity (last 5 of 8): …
 *
 *   $ pd look --heat --limit 5
 *     path                                                heat  agents  conflict
 *     docs/recovery/CURRENT-WORK.md                       0.60  2       yes
 *     server.ts                                           0.60  2       yes
 *     …
 */

import { handleSitrep } from './sitrep.js';
import { handlePheromone } from './pheromone.js';
import { CLIOptions } from '../types.js';

/**
 * Handle `pd look [flags]` — delegate to sitrep by default, or pivot
 * to the file heat map when `--heat` is set.
 *
 * @param subcommand - Optional positional subcommand (e.g. "heat" as sugar for --heat)
 * @param options - Parsed CLI options
 */
export async function handleLook(subcommand: string | undefined, options: CLIOptions): Promise<void> {
  const wantsHeat = options.heat === true || subcommand === 'heat' || subcommand === 'hot';

  if (wantsHeat) {
    return handlePheromone('files', [], options);
  }

  return handleSitrep(options);
}
