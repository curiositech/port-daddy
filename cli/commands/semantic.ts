import { pdFetch } from '../utils/fetch.js';
import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

function readOption(options: CLIOptions, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function parseLimit(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function buildParams(entries: Array<[string, string | number | undefined]>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  return params;
}

function printUsage(command: 'graph' | 'memory'): never {
  if (command === 'graph') {
    console.error('Usage: pd graph edges [options]');
    console.error('   or: pd graph stats [options]');
    console.error('');
    console.error('Subcommands:');
    console.error('  edges                   List semantic graph edges');
    console.error('  stats                   Summarize graph edge counts');
    console.error('');
    console.error('Options for edges:');
    console.error('  --dir <path>            Project directory filter');
    console.error('  --scope <scope>         Scope filter');
    console.error('  --source-type <type>    Source entity type');
    console.error('  --source-id <id>        Source entity id');
    console.error('  --edge-type <type>      Edge type');
    console.error('  --target-type <type>    Target entity type');
    console.error('  --target-id <id>        Target entity id');
    console.error('  --query <text>          Text search');
    console.error('  --limit <n>             Max edges to return');
  } else {
    console.error('Usage: pd memory episodes [options]');
    console.error('   or: pd memory stats [options]');
    console.error('');
    console.error('Subcommands:');
    console.error('  episodes                List episodic memory entries');
    console.error('  stats                   Summarize episodic memory counts');
    console.error('');
    console.error('Options for episodes:');
    console.error('  --dir <path>            Project directory filter');
    console.error('  --project <name>        Logical project filter');
    console.error('  --harbor <name>         Harbor filter');
    console.error('  --agent <id>            Agent filter');
    console.error('  --type <episode-type>   Episode type filter');
    console.error('  --query <text>          Text search');
    console.error('  --limit <n>             Max episodes to return');
  }
  console.error('');
  console.error('Common flags:');
  console.error('  -j, --json              JSON output');
  console.error('  -q, --quiet             Suppress non-essential output');
  process.exit(1);
}

export async function handleGraph(args: string[], options: CLIOptions): Promise<void> {
  const subcommand = args[0] || 'edges';
  if (!['edges', 'stats', 'help'].includes(subcommand)) printUsage('graph');
  if (subcommand === 'help') printUsage('graph');

  const projectDir = readOption(options, 'dir', 'project-dir', 'projectDir');

  if (subcommand === 'stats') {
    const params = buildParams([['projectDir', projectDir]]);
    const res: PdFetchResponse = await pdFetch(`/graph/stats?${params.toString()}`);
    const data = await res.json() as any;
    if (!res.ok) {
      ui.error(data.error || 'Failed to fetch graph stats');
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    if (isQuiet(options)) {
      console.log(String(data.totalEdges ?? 0));
      return;
    }

    console.log('Graph Stats');
    console.log(`  Total edges: ${data.totalEdges ?? 0}`);
    console.log(`  Edge types: ${data.edgeTypes ?? 0}`);
    console.log(`  Source nodes: ${data.sourceNodes ?? 0}`);
    console.log(`  Target nodes: ${data.targetNodes ?? 0}`);
    return;
  }

  const params = buildParams([
    ['projectDir', projectDir],
    ['scope', readOption(options, 'scope')],
    ['sourceType', readOption(options, 'source-type', 'sourceType')],
    ['sourceId', readOption(options, 'source-id', 'sourceId')],
    ['edgeType', readOption(options, 'edge-type', 'edgeType')],
    ['targetType', readOption(options, 'target-type', 'targetType')],
    ['targetId', readOption(options, 'target-id', 'targetId')],
    ['query', readOption(options, 'query', 'q')],
    ['limit', parseLimit(options.limit)],
  ]);
  const res: PdFetchResponse = await pdFetch(`/graph/edges?${params.toString()}`);
  const data = await res.json() as any;
  if (!res.ok) {
    ui.error(data.error || 'Failed to fetch graph edges');
    process.exit(1);
  }

  const edges = data.edges || [];
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (isQuiet(options)) {
    console.log(String(edges.length));
    return;
  }
  if (edges.length === 0) {
    ui.info('No graph edges found');
    return;
  }

  ui.success(`${edges.length} edge(s)`);
  for (const edge of edges) {
    const source = `${edge.sourceType}:${edge.sourceId}`;
    const target = `${edge.targetType}:${edge.targetId}`;
    const scope = edge.scope ? ` [${edge.scope}]` : '';
    console.log(`${source} -${edge.edgeType}-> ${target}${scope}`);
  }
}

export async function handleMemory(args: string[], options: CLIOptions): Promise<void> {
  const subcommand = args[0] || 'episodes';
  if (!['episodes', 'stats', 'help'].includes(subcommand)) printUsage('memory');
  if (subcommand === 'help') printUsage('memory');

  const projectDir = readOption(options, 'dir', 'project-dir', 'projectDir');
  const project = readOption(options, 'project');

  if (subcommand === 'stats') {
    const params = buildParams([
      ['projectDir', projectDir],
      ['project', project],
    ]);
    const res: PdFetchResponse = await pdFetch(`/memory/stats?${params.toString()}`);
    const data = await res.json() as any;
    if (!res.ok) {
      ui.error(data.error || 'Failed to fetch memory stats');
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    if (isQuiet(options)) {
      console.log(String(data.total ?? 0));
      return;
    }

    console.log('Memory Stats');
    console.log(`  Total episodes: ${data.total ?? 0}`);
    console.log(`  Episode types: ${data.episodeTypes ?? 0}`);
    console.log(`  Agents: ${data.agents ?? 0}`);
    console.log(`  Harbors: ${data.harbors ?? 0}`);
    return;
  }

  const params = buildParams([
    ['projectDir', projectDir],
    ['project', project],
    ['harbor', readOption(options, 'harbor')],
    ['agentId', readOption(options, 'agent', 'agent-id', 'agentId')],
    ['episodeType', readOption(options, 'type', 'episode-type', 'episodeType')],
    ['query', readOption(options, 'query', 'q')],
    ['limit', parseLimit(options.limit)],
  ]);
  const res: PdFetchResponse = await pdFetch(`/memory/episodes?${params.toString()}`);
  const data = await res.json() as any;
  if (!res.ok) {
    ui.error(data.error || 'Failed to fetch episodic memory');
    process.exit(1);
  }

  const episodes = data.episodes || [];
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (isQuiet(options)) {
    console.log(String(episodes.length));
    return;
  }
  if (episodes.length === 0) {
    ui.info('No episodic memory entries found');
    return;
  }

  ui.success(`${episodes.length} episode(s)`);
  for (const episode of episodes) {
    const agent = episode.agentId ? ` [${episode.agentId}]` : '';
    const harbor = episode.harbor ? ` @${episode.harbor}` : '';
    console.log(`${episode.episodeType}: ${episode.title}${agent}${harbor}`);
    if (episode.summary) console.log(`  ${episode.summary}`);
  }
}
