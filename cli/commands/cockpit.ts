/**
 * CLI Cockpit Command — `pd cockpit`
 *
 * Front-end to the App-Native Development Cockpit's read-only intake
 * surface. The cockpit reads roadmap/recovery markdown into typed
 * mission cards; this command exposes that work queue at the terminal.
 *
 * Usage:
 *   pd cockpit missions                       # all missions for current daemon repo
 *   pd cockpit missions --project /path/...   # scoped to a different project
 *   pd cockpit missions --status blocked,uncommitted
 *   pd cockpit missions --limit 10
 *   pd cockpit missions --json                # raw intake envelope
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

interface MissionCard {
  id: string;
  title: string;
  status: string;
  source: string;
  sourceAnchor: string;
  summary: string;
  evidence: string[];
  files: string[];
  updatedAt: number;
}

interface MissionIntake {
  projectDir: string;
  sources: string[];
  missing: string[];
  missions: MissionCard[];
  generatedAt: number;
}

interface CockpitMissionsResponse {
  success: boolean;
  intake?: MissionIntake;
  count?: number;
  error?: string;
}

const STATUS_ORDER: ReadonlyArray<string> = ['now', 'backlog', 'parked', 'merge', 'done'];

function buildQuery(options: CLIOptions): string {
  const params = new URLSearchParams();
  const project = options.project as string | undefined;
  if (project) params.set('projectDir', project);
  const status = options.status as string | undefined;
  if (status) params.set('status', status);
  const limit = options.limit as number | string | undefined;
  if (limit !== undefined) params.set('limit', String(limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function statusBadge(status: string): string {
  // Plain ASCII labels — no emoji, project rule.
  return `[${status.toUpperCase()}]`;
}

function renderMissions(intake: MissionIntake): void {
  if (intake.missions.length === 0) {
    console.log('');
    console.log(ui.dim('  (no mission cards parsed for this project)'));
    if (intake.missing.length > 0) {
      console.log(ui.dim(`  missing sources: ${intake.missing.join(', ')}`));
    }
    console.log('');
    return;
  }

  const grouped = new Map<string, MissionCard[]>();
  for (const m of intake.missions) {
    const list = grouped.get(m.status) ?? [];
    list.push(m);
    grouped.set(m.status, list);
  }

  console.log('');
  console.log(`COCKPIT · ${intake.missions.length} mission${intake.missions.length === 1 ? '' : 's'} from ${intake.sources.length} source${intake.sources.length === 1 ? '' : 's'}`);
  console.log('─'.repeat(60));

  const orderedKeys: string[] = [];
  for (const key of STATUS_ORDER) {
    if (grouped.has(key)) orderedKeys.push(key);
  }
  for (const key of grouped.keys()) {
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  }

  for (const key of orderedKeys) {
    const list = grouped.get(key) ?? [];
    console.log('');
    console.log(`${statusBadge(key)} ${list.length} mission${list.length === 1 ? '' : 's'}`);
    for (const m of list) {
      const title = m.title.length > 64 ? `${m.title.slice(0, 64)}…` : m.title;
      console.log(`  · ${title}`);
      console.log(ui.dim(`    ${m.source}${m.sourceAnchor}`));
      if (m.files.length > 0) {
        const top = m.files.slice(0, 3).join(', ');
        const overflow = m.files.length > 3 ? ` (+${m.files.length - 3})` : '';
        console.log(ui.dim(`    files: ${top}${overflow}`));
      }
    }
  }

  if (intake.missing.length > 0) {
    console.log('');
    console.log(ui.dim(`  missing sources: ${intake.missing.join(', ')}`));
  }
  console.log('');
}

export async function handleCockpit(positional: string[], options: CLIOptions): Promise<void> {
  const sub = positional[0] || 'missions';

  if (sub === 'missions') {
    const qs = buildQuery(options);
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/cockpit/missions${qs}`);
    const data = (await res.json()) as unknown as CockpitMissionsResponse;

    if (!res.ok || !data.success || !data.intake) {
      ui.error(data.error || 'Failed to fetch cockpit missions');
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    renderMissions(data.intake);
    return;
  }

  ui.error(`Unknown cockpit subcommand: ${sub}`);
  console.log(ui.dim('  pd cockpit missions [--project <dir>] [--status <s,...>] [--limit N] [--json]'));
  process.exit(1);
}
