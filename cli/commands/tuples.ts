/**
 * Tuple Space CLI Commands
 *
 * pd tuple out <fields-json> [--harbor <name>] [--ttl <ms>] [--as <agent-id>]
 * pd tuple rd <pattern-json> [--harbor <name>] [--limit <n>]
 * pd tuple in <pattern-json> [--harbor <name>] [--limit <n>]   # take (remove)
 * pd tuple scan [--harbor <name>]
 * pd tuple count [--harbor <name>]
 */

import { pdFetch } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

// =============================================================================
// handleTuple — dispatcher for pd tuple <subcommand> [args] [options]
// =============================================================================

export async function handleTuple(
  positional: string[],
  options: CLIOptions,
): Promise<void> {
  const sub = positional[0];
  const rest = positional.slice(1);

  switch (sub) {
    case 'out':
      await handleTupleOut(rest, options);
      break;
    case 'rd':
    case 'read':
      await handleTupleRd(rest, options);
      break;
    case 'in':
    case 'take':
      await handleTupleIn(rest, options);
      break;
    case 'scan':
      await handleTupleScan(options);
      break;
    case 'count':
      await handleTupleCount(options);
      break;
    default:
      console.error('Usage: pd tuple <out|rd|in|scan|count> [args] [options]');
      console.error('');
      console.error('Subcommands:');
      console.error('  out   <fields-json>    Write a tuple into the space');
      console.error('  rd    <pattern-json>    Read (copy) matching tuples');
      console.error('  in    <pattern-json>    Take (remove) matching tuples');
      console.error('  scan                    List all tuples in the space');
      console.error('  count                   Count tuples in the space');
      console.error('');
      console.error('Options:');
      console.error('  --harbor <name>         Scope to a harbor namespace');
      console.error('  --ttl <ms>              Time-to-live in milliseconds (out only)');
      console.error('  --as <agent-id>         Agent ID to associate with the tuple');
      console.error('  --limit <n>             Max results to return (rd/in only)');
      console.error('  -j, --json              JSON output');
      console.error('  -q, --quiet             Suppress non-essential output');
      process.exit(1);
  }
}

// =============================================================================
// pd tuple out <fields-json> [--harbor <name>] [--ttl <ms>] [--as <agent-id>]
// =============================================================================

async function handleTupleOut(
  rest: string[],
  options: CLIOptions,
): Promise<void> {
  const fieldsRaw = rest[0];
  if (!fieldsRaw) {
    console.error('Usage: pd tuple out \'{"type":"task","status":"pending"}\'');
    console.error('  --harbor <name>   Scope to a harbor');
    console.error('  --ttl <ms>        Time-to-live in milliseconds');
    console.error('  --as <agent-id>   Agent ID');
    process.exit(1);
  }

  let fields: Record<string, unknown>;
  try {
    fields = JSON.parse(fieldsRaw) as Record<string, unknown>;
  } catch {
    ui.error('Invalid JSON for fields');
    process.exit(1);
  }

  const body: Record<string, unknown> = { fields };
  if (options.harbor) body.harbor = options.harbor;
  if (options.ttl) body.ttl = parseInt(String(options.ttl), 10);
  if (options.as) body.agentId = options.as;

  const res: PdFetchResponse = await pdFetch('/tuples', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to write tuple');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(data.id || 'ok');
    return;
  }

  ui.success(`Tuple written: ${data.id}`);
  if (options.harbor) console.error(`  Harbor: ${options.harbor}`);
  if (options.ttl) console.error(`  TTL: ${options.ttl}ms`);
}

// =============================================================================
// pd tuple rd <pattern-json> [--harbor <name>] [--limit <n>]
// =============================================================================

async function handleTupleRd(
  rest: string[],
  options: CLIOptions,
): Promise<void> {
  const patternRaw = rest[0];
  if (!patternRaw) {
    console.error('Usage: pd tuple rd \'{"type":"task"}\'');
    console.error('  --harbor <name>   Scope to a harbor');
    console.error('  --limit <n>       Max results');
    process.exit(1);
  }

  let pattern: Record<string, unknown>;
  try {
    pattern = JSON.parse(patternRaw) as Record<string, unknown>;
  } catch {
    ui.error('Invalid JSON for pattern');
    process.exit(1);
  }

  const params = new URLSearchParams();
  params.set('pattern', JSON.stringify(pattern));
  if (options.harbor) params.set('harbor', String(options.harbor));
  if (options.limit) params.set('limit', String(options.limit));

  const res: PdFetchResponse = await pdFetch(`/tuples?${params}`, {
    method: 'GET',
  });

  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to read tuples');
    process.exit(1);
  }

  const tuples = (data.tuples || []) as Array<Record<string, unknown>>;

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(String(tuples.length));
    return;
  }

  if (tuples.length === 0) {
    ui.info('No matching tuples found');
    return;
  }

  ui.success(`${tuples.length} tuple(s) matched`);
  for (const t of tuples) {
    console.error(`  ${t.id}: ${JSON.stringify(t.fields)}`);
  }
}

// =============================================================================
// pd tuple in <pattern-json> [--harbor <name>] [--limit <n>]
// =============================================================================

async function handleTupleIn(
  rest: string[],
  options: CLIOptions,
): Promise<void> {
  const patternRaw = rest[0];
  if (!patternRaw) {
    console.error('Usage: pd tuple in \'{"type":"task","status":"done"}\'');
    console.error('  --harbor <name>   Scope to a harbor');
    console.error('  --limit <n>       Max tuples to take');
    process.exit(1);
  }

  let pattern: Record<string, unknown>;
  try {
    pattern = JSON.parse(patternRaw) as Record<string, unknown>;
  } catch {
    ui.error('Invalid JSON for pattern');
    process.exit(1);
  }

  const body: Record<string, unknown> = { pattern };
  if (options.harbor) body.harbor = String(options.harbor);
  if (options.limit) body.limit = parseInt(String(options.limit), 10);

  const res: PdFetchResponse = await pdFetch('/tuples', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to take tuples');
    process.exit(1);
  }

  const removed = (data.tuples || []) as Array<Record<string, unknown>>;

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(String(removed.length));
    return;
  }

  if (removed.length === 0) {
    ui.info('No matching tuples to take');
    return;
  }

  ui.success(`${removed.length} tuple(s) taken`);
  for (const t of removed) {
    console.error(`  ${t.id}: ${JSON.stringify(t.fields)}`);
  }
}

// =============================================================================
// pd tuple scan [--harbor <name>]
// =============================================================================

async function handleTupleScan(
  options: CLIOptions,
): Promise<void> {
  const params = new URLSearchParams();
  if (options.harbor) params.set('harbor', String(options.harbor));

  const qs = params.toString();
  const path = qs ? `/tuples/scan?${qs}` : '/tuples/scan';

  const res: PdFetchResponse = await pdFetch(path, {
    method: 'GET',
  });

  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to scan tuples');
    process.exit(1);
  }

  const tuples = (data.tuples || []) as Array<Record<string, unknown>>;

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(String(tuples.length));
    return;
  }

  if (tuples.length === 0) {
    ui.info('Tuple space is empty');
    return;
  }

  ui.success(`${tuples.length} tuple(s) in space`);
  for (const t of tuples) {
    const harbor = t.harbor ? ` [${t.harbor}]` : '';
    const agent = t.agentId ? ` (${t.agentId})` : '';
    console.error(`  ${t.id}:${harbor}${agent} ${JSON.stringify(t.fields)}`);
  }
}

// =============================================================================
// pd tuple count [--harbor <name>]
// =============================================================================

async function handleTupleCount(
  options: CLIOptions,
): Promise<void> {
  const params = new URLSearchParams();
  if (options.harbor) params.set('harbor', String(options.harbor));

  const qs = params.toString();
  const path = qs ? `/tuples/count?${qs}` : '/tuples/count';

  const res: PdFetchResponse = await pdFetch(path, {
    method: 'GET',
  });

  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to count tuples');
    process.exit(1);
  }

  const count = data.count as number;

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(String(count));
    return;
  }

  ui.info(`${count} tuple(s) in space${options.harbor ? ` (harbor: ${options.harbor})` : ''}`);
}
