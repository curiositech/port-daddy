/**
 * Tuple Space CLI Commands
 *
 * pd tuple out <fields-json-array> [--harbor <name>] [--ttl <ms>] [--as <agent-id>]
 * pd tuple rd <pattern-json-array> [--harbor <name>] [--limit <n>]
 * pd tuple in <pattern-json-array> [--harbor <name>] [--limit <n>]   # take (remove)
 * pd tuple scan [--harbor <name>]
 * pd tuple count [--harbor <name>]
 */

import PortDaddy from '../../lib/client.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import * as ui from '../utils/ui.js';

type TupleOutResult = Awaited<ReturnType<PortDaddy['tupleOut']>>;
type TupleReadResult = Awaited<ReturnType<PortDaddy['tupleRd']>>;
type TupleTakeResult = Awaited<ReturnType<PortDaddy['tupleIn']>>;
type TupleScanResult = Awaited<ReturnType<PortDaddy['tupleScan']>>;
type TupleEntryResult = TupleReadResult['tuples'][number];

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
      console.error('  out   <fields-json-array>   Write a tuple into the space');
      console.error('  rd    <pattern-json-array>  Read (copy) matching tuples');
      console.error('  in    <pattern-json-array>  Take (remove) matching tuples');
      console.error('  scan                        List all tuples in the space');
      console.error('  count                       Count tuples in the space');
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

function parseJsonArray(raw: string, label: string): unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    ui.error(`Invalid JSON for ${label}`);
    process.exit(1);
  }

  if (!Array.isArray(value)) {
    ui.error(`${label} must be a JSON array`);
    process.exit(1);
  }

  return value;
}

// =============================================================================
// pd tuple out <fields-json-array> [--harbor <name>] [--ttl <ms>] [--as <agent-id>]
// =============================================================================

async function handleTupleOut(
  rest: string[],
  options: CLIOptions,
): Promise<void> {
  const fieldsRaw = rest[0];
  if (!fieldsRaw) {
    console.error('Usage: pd tuple out \'["task","pending"]\'');
    console.error('  --harbor <name>   Scope to a harbor');
    console.error('  --ttl <ms>        Time-to-live in milliseconds');
    console.error('  --as <agent-id>   Agent ID');
    process.exit(1);
  }

  const fields = parseJsonArray(fieldsRaw, 'fields');
  if (fields.length === 0) {
    ui.error('Fields must be a non-empty JSON array');
    process.exit(1);
  }

  const pd = new PortDaddy({ agentId: typeof options.as === 'string' ? options.as : undefined });

  let data: TupleOutResult;
  try {
    data = await pd.tupleOut(fields, {
      harbor: typeof options.harbor === 'string' ? options.harbor : undefined,
      writtenBy: typeof options.as === 'string' ? options.as : undefined,
      ttlMs: options.ttl ? parseInt(String(options.ttl), 10) : undefined,
    });
  } catch (error: any) {
    ui.error(error?.body?.error || error?.message || 'Failed to write tuple');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(String(data.tuple?.id || 'ok'));
    return;
  }

  ui.success(`Tuple written: ${data.tuple?.id}`);
  if (options.harbor) console.error(`  Harbor: ${options.harbor}`);
  if (options.ttl) console.error(`  TTL: ${options.ttl}ms`);
}

// =============================================================================
// pd tuple rd <pattern-json-array> [--harbor <name>] [--limit <n>]
// =============================================================================

async function handleTupleRd(
  rest: string[],
  options: CLIOptions,
): Promise<void> {
  const patternRaw = rest[0];
  if (!patternRaw) {
    console.error('Usage: pd tuple rd \'["task","*"]\'');
    console.error('  --harbor <name>   Scope to a harbor');
    console.error('  --limit <n>       Max results');
    process.exit(1);
  }

  const pattern = parseJsonArray(patternRaw, 'pattern');
  const pd = new PortDaddy();

  let data: TupleReadResult;
  try {
    data = await pd.tupleRd(pattern, {
      harbor: typeof options.harbor === 'string' ? options.harbor : undefined,
      limit: options.limit ? parseInt(String(options.limit), 10) : undefined,
    });
  } catch (error: any) {
    ui.error(error?.body?.error || error?.message || 'Failed to read tuples');
    process.exit(1);
  }

  const tuples: TupleEntryResult[] = data.tuples || [];

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
  for (const tuple of tuples) {
    console.error(`  ${tuple.id}: ${JSON.stringify(tuple.fields)}`);
  }
}

// =============================================================================
// pd tuple in <pattern-json-array> [--harbor <name>] [--limit <n>]
// =============================================================================

async function handleTupleIn(
  rest: string[],
  options: CLIOptions,
): Promise<void> {
  const patternRaw = rest[0];
  if (!patternRaw) {
    console.error('Usage: pd tuple in \'["task","done"]\'');
    console.error('  --harbor <name>   Scope to a harbor');
    console.error('  --limit <n>       Max tuples to take');
    process.exit(1);
  }

  const pattern = parseJsonArray(patternRaw, 'pattern');
  const pd = new PortDaddy();

  let data: TupleTakeResult;
  try {
    data = await pd.tupleIn(pattern, {
      harbor: typeof options.harbor === 'string' ? options.harbor : undefined,
      limit: options.limit ? parseInt(String(options.limit), 10) : undefined,
    });
  } catch (error: any) {
    ui.error(error?.body?.error || error?.message || 'Failed to take tuples');
    process.exit(1);
  }

  const removed: TupleEntryResult[] = data.taken || [];

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
  for (const tuple of removed) {
    console.error(`  ${tuple.id}: ${JSON.stringify(tuple.fields)}`);
  }
}

// =============================================================================
// pd tuple scan [--harbor <name>]
// =============================================================================

async function handleTupleScan(
  options: CLIOptions,
): Promise<void> {
  const pd = new PortDaddy();

  let data: TupleScanResult;
  try {
    data = await pd.tupleScan(typeof options.harbor === 'string' ? options.harbor : undefined);
  } catch (error: any) {
    ui.error(error?.body?.error || error?.message || 'Failed to scan tuples');
    process.exit(1);
  }

  const tuples: TupleEntryResult[] = data.tuples || [];

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
  for (const tuple of tuples) {
    const harbor = tuple.harbor ? ` [${tuple.harbor}]` : '';
    const writtenBy = tuple.writtenBy ? ` (${tuple.writtenBy})` : '';
    console.error(`  ${tuple.id}:${harbor}${writtenBy} ${JSON.stringify(tuple.fields)}`);
  }
}

// =============================================================================
// pd tuple count [--harbor <name>]
// =============================================================================

async function handleTupleCount(
  options: CLIOptions,
): Promise<void> {
  const pd = new PortDaddy();

  let data;
  try {
    data = await pd.tupleCount(typeof options.harbor === 'string' ? options.harbor : undefined);
  } catch (error: any) {
    ui.error(error?.body?.error || error?.message || 'Failed to count tuples');
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
