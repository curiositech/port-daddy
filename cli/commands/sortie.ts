import { pdFetch } from '../utils/fetch.js';
import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

function usage(): never {
  console.error('Usage: pd sortie <goal text> [options]');
  console.error('   or: pd sortie run <goal text> [options]');
  console.error('   or: pd sortie list [--all] [--limit N]');
  console.error('   or: pd sortie status <id>');
  console.error('   or: pd sortie logs <id> [--limit N]');
  console.error('');
  console.error('Options for run:');
  console.error('  --backend <name>      Required backend');
  console.error('  --model <name>        Model override');
  console.error('  --tier <level>        Model tier override (low, mid, high)');
  console.error('  --budget <usd>        Required spend ceiling');
  console.error('  --dir <path>          Project directory (default: cwd)');
  console.error('  --recipe <name>       Mission recipe label');
  console.error('  --expected <text>     Expected output summary');
  console.error('  --context <text>      Extra context / constraints');
  process.exit(1);
}

function parseBudget(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export async function handleSortie(args: string[], options: CLIOptions): Promise<void> {
  const subcommand = args[0];
  const known = new Set(['help', 'run', 'list', 'status', 'logs']);
  const inferredRun = !!subcommand && !known.has(subcommand);

  if (!subcommand || subcommand === 'help') usage();

  if (subcommand === 'list') {
    const projectDir = options.all ? undefined : ((options.dir as string) || process.cwd());
    const limit = options.limit ? parseInt(String(options.limit), 10) : 25;
    const params = new URLSearchParams();
    if (projectDir) params.set('projectDir', projectDir);
    if (Number.isFinite(limit)) params.set('limit', String(limit));
    const res: PdFetchResponse = await pdFetch(`/sorties?${params.toString()}`);
    const data = await res.json() as any;
    if (!res.ok) {
      ui.error(data.error || 'Failed to list sorties');
      process.exit(1);
    }
    const sorties = data.sorties || [];
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    if (sorties.length === 0) {
      console.log('No sorties found');
      return;
    }
    for (const sortie of sorties) {
      console.log(`${sortie.id}\t${sortie.status}\t${sortie.project}\t${sortie.goal}`);
    }
    return;
  }

  if (subcommand === 'status') {
    const id = args[1];
    if (!id) usage();
    const res: PdFetchResponse = await pdFetch(`/sorties/${encodeURIComponent(id)}`);
    const data = await res.json() as any;
    if (!res.ok) {
      ui.error(data.error || `Failed to fetch sortie ${id}`);
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    const sortie = data.sortie;
    console.log(`${sortie.id} (${sortie.status})`);
    console.log(`  Project: ${sortie.project}`);
    console.log(`  Harbor: ${sortie.harbor}`);
    console.log(`  Goal: ${sortie.goal}`);
    console.log(`  Runtime: ${sortie.backend}${sortie.model ? ` / ${sortie.model}` : ''}`);
    console.log(`  Budget: $${Number(sortie.budgetUsd).toFixed(2)}`);
    if (sortie.expectedOutput) console.log(`  Expected: ${sortie.expectedOutput}`);
    if (sortie.spawnAgentId) console.log(`  Spawned: ${sortie.spawnAgentId}`);
    if (sortie.error) console.log(`  Error: ${sortie.error}`);
    if (sortie.resultOutput) {
      console.log('');
      console.log('--- Result ---');
      console.log(sortie.resultOutput);
    }
    return;
  }

  if (subcommand === 'logs') {
    const id = args[1];
    if (!id) usage();
    const limit = options.limit ? parseInt(String(options.limit), 10) : 200;
    const res: PdFetchResponse = await pdFetch(`/sorties/${encodeURIComponent(id)}/logs?limit=${limit}`);
    const data = await res.json() as any;
    if (!res.ok) {
      ui.error(data.error || `Failed to fetch sortie logs for ${id}`);
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    for (const event of data.events || []) {
      const when = new Date(event.createdAt).toLocaleString();
      console.log(`${when}  ${event.type}${event.summary ? `  ${event.summary}` : ''}`);
    }
    return;
  }

  const goal = inferredRun
    ? args.join(' ').trim()
    : subcommand === 'run'
      ? args.slice(1).join(' ').trim()
      : '';
  if (!goal) usage();

  const backend = options.backend as string | undefined;
  const budgetUsd = parseBudget(options.budget);
  if (!backend) {
    ui.error('pd sortie run requires --backend');
    process.exit(1);
  }
  if (budgetUsd == null || budgetUsd <= 0) {
    ui.error('pd sortie run requires --budget <usd> with a positive ceiling');
    process.exit(1);
  }

  const body: Record<string, unknown> = {
    goal,
    projectDir: (options.dir as string) || process.cwd(),
    backend,
    budgetUsd,
  };
  if (typeof options.model === 'string') body.model = options.model;
  if (typeof options.tier === 'string') body.modelTier = options.tier;
  if (typeof options.recipe === 'string') body.recipe = options.recipe;
  if (typeof options.expected === 'string') body.expectedOutput = options.expected;
  if (typeof options.context === 'string') body.context = options.context;
  if (typeof options.identity === 'string') body.identity = options.identity;
  if (typeof options.purpose === 'string') body.purpose = options.purpose;
  if (typeof options.allowedTools === 'string') body.allowedTools = options.allowedTools;
  if (options.deadlineMs != null) body.deadlineMs = parseInt(String(options.deadlineMs), 10);
  else if (options['deadline-ms'] != null) body.deadlineMs = parseInt(String(options['deadline-ms']), 10);
  if (options.maxTokens != null) body.maxTokens = parseInt(String(options.maxTokens), 10);

  const res: PdFetchResponse = await pdFetch('/sorties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json() as any;
  if (!res.ok) {
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      ui.error(data.error || 'Failed to run sortie');
      if (data.sortie?.id) console.error(`  Sortie: ${data.sortie.id}`);
    }
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const sortie = data.sortie;
  const result = data.result;
  if (!isQuiet(options)) {
    ui.success(`Sortie ${sortie.id}: ${sortie.status}`);
    console.error(`  Project: ${sortie.project}`);
    console.error(`  Harbor: ${sortie.harbor}`);
    if (sortie.spawnAgentId) console.error(`  Spawned: ${sortie.spawnAgentId}`);
    if (result?.error) console.error(`  Error: ${result.error}`);
  }
  if (sortie.resultOutput) console.log(sortie.resultOutput);
}
