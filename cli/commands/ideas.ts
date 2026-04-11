import { resolve } from 'node:path';

import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';
import { buildIdeasIndex, findIdea, type IdeaEntry, type IdeaStatus } from '../../lib/ideas-trove.js';
import { searchIdeaUniverse, type IdeaSearchHit, type IdeaSearchSource } from '../../lib/ideas-search.js';

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

function parseStatus(value: string | undefined): IdeaStatus | undefined {
  if (!value) return undefined;
  if (value === 'now' || value === 'backlog' || value === 'parked' || value === 'merge' || value === 'local') {
    return value;
  }
  return undefined;
}

function parseSources(value: string | undefined): IdeaSearchSource[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean) as IdeaSearchSource[];
}

function printUsage(): never {
  console.error('Usage: pd ideas list [options]');
  console.error('   or: pd ideas search <query> [options]');
  console.error('   or: pd ideas show <slug> [options]');
  console.error('');
  console.error('Subcommands:');
  console.error('  list                    List canonical trove entries');
  console.error('  search <query>          Search trove, notes, tuples, repo markdown, and optional raw residue');
  console.error('  show <slug>             Show one idea or family in detail');
  console.error('  help                    Show ideas help');
  console.error('');
  console.error('Options:');
  console.error('  --dir <path>            Project directory (defaults to cwd)');
  console.error('  --status <status>       Filter by now|backlog|parked|merge|local');
  console.error('  --limit <n>             Limit results');
  console.error('  --sources <list>        search only: trove,raw,notes,tuples,markdown,all');
  console.error('  --include-raw           Include unpromoted .spark/.spider residue');
  console.error('  -j, --json              JSON output');
  console.error('  -q, --quiet             Quiet output');
  process.exit(1);
}

function printEntry(entry: IdeaEntry): void {
  const source = entry.source === 'raw' ? 'local-residue' : entry.section;
  console.log(`${entry.slug} [${entry.status}; ${source}]`);
  if (entry.summary) console.log(`  ${entry.summary}`);
  if (entry.provenance.length > 0) {
    console.log(`  provenance: ${entry.provenance.join(', ')}`);
  }
  if (entry.matches && entry.matches.length > 0) {
    console.log(`  matches: ${entry.matches.join(', ')}`);
  }
}

function printDetail(entry: IdeaEntry): void {
  console.log(entry.title);
  console.log(`  slug: ${entry.slug}`);
  console.log(`  status: ${entry.status}`);
  console.log(`  section: ${entry.section}`);
  console.log(`  source: ${entry.source}`);
  if (entry.summary) console.log(`  summary: ${entry.summary}`);
  if (entry.details.length > 0) {
    console.log('  details:');
    for (const detail of entry.details) console.log(`    - ${detail}`);
  }
  if (entry.nextCut.length > 0) {
    console.log('  next cut:');
    for (const item of entry.nextCut) console.log(`    - ${item}`);
  }
  if (entry.provenance.length > 0) {
    console.log('  provenance:');
    for (const item of entry.provenance) console.log(`    - ${item}`);
  }
}

function printSearchHit(hit: IdeaSearchHit): void {
  const sourceBits: string[] = [hit.source];
  if (hit.kind === 'idea' && hit.status) sourceBits.push(hit.status);
  console.log(`${hit.kind}:${hit.id} [${sourceBits.join('; ')}]`);
  console.log(`  ${hit.title}`);
  if (hit.summary) console.log(`  ${hit.summary}`);
  if (hit.location) console.log(`  location: ${hit.location}`);
  if (hit.provenance && hit.provenance.length > 0) {
    console.log(`  provenance: ${hit.provenance.join(', ')}`);
  }
  if (hit.matches.length > 0) {
    console.log(`  matches: ${hit.matches.join(', ')}`);
  }
}

export async function handleIdeas(args: string[], options: CLIOptions): Promise<void> {
  const subcommand = args[0] || 'list';
  if (!['list', 'search', 'show', 'help'].includes(subcommand)) printUsage();
  if (subcommand === 'help') printUsage();

  const projectDir = resolve((readOption(options, 'dir') as string) || process.cwd());
  const includeRaw = !!options['include-raw'] || !!options.includeRaw;
  const limit = parseLimit(options.limit);
  const status = parseStatus(readOption(options, 'status'));
  const sources = parseSources(readOption(options, 'sources'));

  if (subcommand === 'show') {
    let entries: IdeaEntry[];
    try {
      entries = buildIdeasIndex(projectDir, { includeRaw });
    } catch (error) {
      ui.error(error instanceof Error ? error.message : 'Failed to load ideas trove');
      process.exit(1);
    }

    const target = args[1] || readOption(options, 'slug', 'id', 'query');
    if (!target) printUsage();

    const entry = findIdea(entries, target);
    if (!entry) {
      ui.error(`No idea entry found for "${target}"`);
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify({ entry }, null, 2));
      return;
    }
    if (isQuiet(options)) {
      console.log(entry.slug);
      return;
    }
    printDetail(entry);
    return;
  }

  if (subcommand === 'search') {
    const query = args.slice(1).join(' ') || readOption(options, 'query', 'q');
    if (!query) printUsage();

    const search = await searchIdeaUniverse(query, {
      projectDir,
      includeRaw,
      limit,
      status,
      sources,
    });
    const results = search.results;
    if (isJson(options)) {
      console.log(JSON.stringify(search, null, 2));
      return;
    }
    if (isQuiet(options)) {
      console.log(results.map((hit) => hit.id).join('\n'));
      return;
    }
    if (results.length === 0) {
      ui.info('No matching ideas found');
      if (search.warnings.length > 0) {
        for (const warning of search.warnings) ui.warn(warning);
      }
      return;
    }
    ui.success(`${results.length} matching result(s)`);
    for (const hit of results) printSearchHit(hit);
    if (search.warnings.length > 0) {
      for (const warning of search.warnings) ui.warn(warning);
    }
    return;
  }

  let entries: IdeaEntry[];
  try {
    entries = buildIdeasIndex(projectDir, { includeRaw });
  } catch (error) {
    ui.error(error instanceof Error ? error.message : 'Failed to load ideas trove');
    process.exit(1);
  }

  const filtered = status ? entries.filter((entry) => entry.status === status) : entries;
  const listed = limit ? filtered.slice(0, limit) : filtered;

  if (isJson(options)) {
    console.log(JSON.stringify({ entries: listed }, null, 2));
    return;
  }
  if (isQuiet(options)) {
    console.log(listed.map((entry) => entry.slug).join('\n'));
    return;
  }
  if (listed.length === 0) {
    ui.info('No idea entries found');
    return;
  }
  ui.success(`${listed.length} idea entry(s)`);
  for (const entry of listed) printEntry(entry);
}
