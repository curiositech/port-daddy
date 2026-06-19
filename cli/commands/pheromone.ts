/**
 * CLI Pheromone Commands — `pd pheromone <subcommand>`
 *
 * Stigmergic coordination from the terminal. Ant colonies don't hold meetings;
 * they leave chemical trails on the paths they've walked, and other ants read
 * the gradient. PD's pheromones are the same: numeric signals with geometric
 * decay, sprayed on entities (files, services, sessions, agents). High heat
 * means "many agents touched this recently" — a cue, not a rule.
 *
 * Subcommands:
 *   spray <table> <id> <key> <strength>   Set a pheromone value (0..1)
 *   files [--path <prefix>] [--depth N]   File heat map with conflict markers
 *   show <table> <id>                     Read all pheromone keys for an entity
 *   ls                                    List all non-zero pheromones
 *
 * Quick alias: `pd pheromone file <path> <strength>` is sugar for
 *              `pd pheromone spray files <path> heat <strength>`.
 *
 * @example
 *   # After touching a file heavily:
 *   pd pheromone file docs/shipwright/NEXT-SESSION-PROMPTS.md 0.8
 *
 *   # See what the swarm is fighting over:
 *   pd pheromone files
 *   # → path                                            heat  agents  conflict
 *   #   docs/recovery/CURRENT-WORK.md                   0.60  2       yes
 *   #   server.ts                                       0.60  2       yes
 *
 *   # Inspect one entity:
 *   pd pheromone show files server.ts
 *   # → { heat: 0.6, churn: 0.42, ... }
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

interface FileHeatEntry {
  path: string;
  heat: number;
  activeClaims?: number;
  totalClaims?: number;
  agents?: string[];
  conflict?: boolean;
  lastActivity?: string;
}

interface PheromoneEntry {
  table: string;
  id: string;
  key: string;
  strength: number;
}

const VALID_TABLES = new Set(['files', 'services', 'projects', 'sessions', 'agents']);

function parseStrength(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

async function sprayRaw(
  table: string,
  id: string,
  key: string,
  strength: number,
): Promise<{ ok: boolean; error?: string }> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/pheromone/spray`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, id, key, strength }),
  });
  const data = await res.json();
  return res.ok ? { ok: true } : { ok: false, error: (data.error as string) || `HTTP ${res.status}` };
}

async function handleSpray(args: string[], options: CLIOptions): Promise<void> {
  // pd pheromone spray <table> <id> <key> <strength>
  // or: pd pheromone file <path> <strength>  (sugar: table=files, key=heat)
  let table: string | undefined;
  let id: string | undefined;
  let key: string | undefined;
  let strength: number | null = null;

  if (args.length === 2) {
    // Sugar form: pd pheromone file <path> <strength>
    table = 'files';
    key = 'heat';
    id = args[0];
    strength = parseStrength(args[1]);
  } else if (args.length === 4) {
    // Full form: pd pheromone spray <table> <id> <key> <strength>
    table = args[0];
    id = args[1];
    key = args[2];
    strength = parseStrength(args[3]);
  } else {
    ui.error('Usage: pd pheromone spray <table> <id> <key> <strength>');
    ui.error('   or: pd pheromone file <path> <strength>   (spray files/<path>/heat)');
    process.exit(1);
  }

  if (!VALID_TABLES.has(table!)) {
    ui.error(`Invalid table '${table}'. Valid: ${Array.from(VALID_TABLES).join(', ')}`);
    process.exit(1);
  }
  if (strength === null) {
    ui.error('strength must be a number between 0 and 1');
    process.exit(1);
  }

  const result = await sprayRaw(table!, id!, key!, strength);
  if (!result.ok) {
    ui.error(result.error || 'Spray failed');
    process.exit(1);
  }

  if (isQuiet(options)) { console.log('ok'); return; }
  if (isJson(options)) {
    console.log(JSON.stringify({ success: true, table, id, key, strength }));
    return;
  }
  ui.success(`Sprayed ${table}/${id}/${key} = ${strength}`);
}

async function handleFiles(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (options.path) params.append('path', options.path as string);
  if (options.depth) params.append('depth', String(options.depth));

  const qs = params.toString() ? `?${params}` : '';
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/pheromone/files${qs}`);
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to fetch file heat map');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const files = (data.files as FileHeatEntry[]) || [];
  if (files.length === 0) {
    console.log(ui.dim('  (no hot files — harbor is calm)'));
    return;
  }

  const header = `  ${'path'.padEnd(50)}  heat  agents  conflict`;
  console.log('');
  console.log(header);
  console.log('  ' + '\u2500'.repeat(header.length - 2));
  for (const f of files.slice(0, options.limit ? Number(options.limit) : 20)) {
    const p = (f.path || '').padEnd(50).slice(0, 50);
    const heat = f.heat.toFixed(2).padStart(4);
    const agents = String(f.activeClaims ?? 0).padStart(6);
    const conflict = f.conflict ? 'yes' : ui.dim('no ');
    console.log(`  ${p}  ${heat}  ${agents}  ${conflict}`);
  }
  console.log('');
}

async function handleShow(args: string[], options: CLIOptions): Promise<void> {
  if (args.length < 2) {
    ui.error('Usage: pd pheromone show <table> <id>');
    process.exit(1);
  }
  const [table, id] = args;
  const res: PdFetchResponse = await pdFetch(
    `${PORT_DADDY_URL}/pheromone/${encodeURIComponent(table)}/${encodeURIComponent(id)}`,
  );
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to read pheromone');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const pheromones = (data.pheromones as Record<string, number>) || {};
  if (Object.keys(pheromones).length === 0) {
    console.log(ui.dim(`  (no pheromones on ${table}/${id})`));
    return;
  }
  console.log('');
  console.log(`${table}/${id}`);
  for (const [key, value] of Object.entries(pheromones)) {
    console.log(`  ${key.padEnd(20)} ${value.toFixed(3)}`);
  }
  console.log('');
}

async function handleLs(options: CLIOptions): Promise<void> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/pheromone`);
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to list pheromones');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const entries = (data.pheromones as PheromoneEntry[]) || [];
  if (entries.length === 0) {
    console.log(ui.dim('  (no pheromones active)'));
    return;
  }
  console.log('');
  const header = `  ${'table'.padEnd(10)} ${'id'.padEnd(40)} ${'key'.padEnd(14)} strength`;
  console.log(header);
  console.log('  ' + '\u2500'.repeat(header.length - 2));
  for (const e of entries) {
    const t = (e.table || '').padEnd(10);
    const i = (e.id || '').padEnd(40).slice(0, 40);
    const k = (e.key || '').padEnd(14).slice(0, 14);
    const s = e.strength.toFixed(3);
    console.log(`  ${t} ${i} ${k} ${s}`);
  }
  console.log('');
}

/**
 * Handle `pd pheromone <subcommand>` — entry point from the CLI router.
 *
 * @param subcommand - One of: spray, file, files, show, ls
 * @param args - Remaining positional args
 * @param options - Parsed CLI options (--json, --quiet, --path, --depth, --limit)
 */
export async function handlePheromone(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions,
): Promise<void> {
  switch (subcommand) {
    case 'spray':
      return handleSpray(args, options);
    case 'file':
      // Sugar: pd pheromone file <path> <strength> == spray files <path> heat <strength>
      return handleSpray(args, options);
    case 'files':
      return handleFiles(options);
    case 'show':
    case 'read':
      return handleShow(args, options);
    case 'ls':
    case 'list':
      return handleLs(options);
    default:
      console.log('Usage: pd pheromone <spray|file|files|show|ls> [args]');
      console.log('');
      console.log('Subcommands:');
      console.log('  spray <table> <id> <key> <strength>   Set a pheromone (0..1)');
      console.log('  file <path> <strength>                Sugar for files/<path>/heat');
      console.log('  files [--path P] [--depth N]          File heat map');
      console.log('  show <table> <id>                     Read pheromones for entity');
      console.log('  ls                                    List all non-zero pheromones');
      console.log('');
      console.log('Tables: files, services, projects, sessions, agents');
  }
}
