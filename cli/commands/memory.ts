/**
 * pd memory — Three-tier memory introspection.
 *
 * Dispatches between the new Core/Recall/Archival vocabulary subcommands
 * (`tiers`, `tier <construct>`, `summary`) and the existing episodic memory
 * subcommands (`episodes`, `stats`) which still live in semantic.ts.
 *
 * The Core/Recall/Archival mapping itself is documented in
 * docs/adr/0035-three-tier-memory-vocabulary.md. This file owns the wire
 * shape and the rendering; the substrate is untouched.
 */

import { pdFetch } from '../utils/fetch.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { handleMemory as handleEpisodicMemory } from './semantic.js';

export type MemoryTier = 'Core' | 'Recall' | 'Archival' | 'Recall→Archival';

export interface TierRow {
  construct: string;
  tier: MemoryTier;
  eviction: string;
  access: string;
  /** Live count from the daemon; undefined when the daemon is unreachable. */
  count?: number;
  /** When count is undefined, why. */
  countError?: string;
}

/**
 * Static mapping. Kept as data so tests can assert against a stable shape and
 * so `pd memory tier <construct>` can resolve names without an HTTP call.
 */
export const TIER_TABLE: ReadonlyArray<Omit<TierRow, 'count' | 'countError'>> = [
  {
    construct: 'active-sessions',
    tier: 'Core',
    eviction: 'session end OR heartbeat loss',
    access: 'pd whoami, pd briefing',
  },
  {
    construct: 'active-file-claims',
    tier: 'Core',
    eviction: 'release OR heartbeat loss',
    access: 'pd sessions, claim resolution',
  },
  {
    construct: 'active-notes',
    tier: 'Recall',
    eviction: 'display-layer TTL (compaction in flight)',
    access: 'pd notes, pd briefing',
  },
  {
    construct: 'archived-notes',
    tier: 'Archival',
    eviction: 'never destroyed; display-compactable',
    access: 'pd notes --since, semantic search',
  },
  {
    construct: 'blobs',
    tier: 'Archival',
    eviction: 'configurable GC',
    access: 'pd blob',
  },
  {
    construct: 'skill-index',
    tier: 'Archival',
    eviction: 're-embed on edit',
    access: 'pd skill find',
  },
  {
    construct: 'salvageable-sessions',
    tier: 'Recall→Archival',
    eviction: 'salvage-queue compaction (in flight)',
    access: 'pd salvage',
  },
];

interface CountFetcher {
  (): Promise<number>;
}

/**
 * Count fetchers map construct → live count source. Each must tolerate
 * daemon errors by throwing; the caller catches and records `countError`.
 *
 * The endpoints chosen are read-only listing routes we know exist. We
 * never reach into the SQLite file directly — that's the substrate the
 * Wave 4 agents are editing.
 */
function buildCountFetchers(): Record<string, CountFetcher> {
  const recallNotesWindowMs = 60 * 60 * 1000; // 1h

  return {
    'active-sessions': async () => {
      // all=true so the count reflects every worktree, not just the caller's.
      const res: PdFetchResponse = await pdFetch('/sessions?status=active&all=true&limit=1000');
      const data: any = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const arr = Array.isArray(data) ? data : (data.sessions || []);
      return arr.length;
    },

    'active-file-claims': async () => {
      const res: PdFetchResponse = await pdFetch('/files');
      const data: any = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const arr = Array.isArray(data) ? data : (data.claims || data.files || []);
      return arr.length;
    },

    'active-notes': async () => {
      const since = Date.now() - recallNotesWindowMs;
      const res: PdFetchResponse = await pdFetch(`/notes?since=${since}&limit=1000`);
      const data: any = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const arr = Array.isArray(data) ? data : (data.notes || []);
      return arr.length;
    },

    'archived-notes': async () => {
      // Total notes minus the Recall window. We approximate with the same
      // /notes endpoint with a high limit; if the daemon returns a separate
      // `total`, prefer it.
      const res: PdFetchResponse = await pdFetch('/notes?limit=10000');
      const data: any = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (typeof data?.total === 'number') return data.total;
      const arr = Array.isArray(data) ? data : (data.notes || []);
      return arr.length;
    },

    blobs: async () => {
      const res: PdFetchResponse = await pdFetch('/blob?limit=10000');
      const data: any = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (typeof data?.total === 'number') return data.total;
      const arr = Array.isArray(data) ? data : (data.blobs || []);
      return arr.length;
    },

    'skill-index': async () => {
      const res: PdFetchResponse = await pdFetch('/memory/stats');
      const data: any = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      // Episodic memory stats is the closest existing surface. If a dedicated
      // skill-index count endpoint lands, swap it in here.
      return Number(data?.total ?? 0);
    },

    'salvageable-sessions': async () => {
      const res: PdFetchResponse = await pdFetch('/resurrection/pending');
      const data: any = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const arr = Array.isArray(data) ? data : (data.pending || data.sessions || []);
      return arr.length;
    },
  };
}

async function collectRows(): Promise<TierRow[]> {
  const fetchers = buildCountFetchers();
  const rows: TierRow[] = [];
  for (const entry of TIER_TABLE) {
    const fetcher = fetchers[entry.construct];
    if (!fetcher) {
      rows.push({ ...entry });
      continue;
    }
    try {
      const count = await fetcher();
      rows.push({ ...entry, count });
    } catch (err) {
      rows.push({ ...entry, countError: (err as Error).message || 'fetch failed' });
    }
  }
  return rows;
}

function padCell(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + ' '.repeat(width - value.length);
}

function renderTable(rows: TierRow[]): string {
  const headers = ['CONSTRUCT', 'TIER', 'COUNT', 'EVICTION', 'ACCESS'];
  const data = rows.map((r) => [
    r.construct,
    r.tier,
    r.countError ? `err: ${r.countError}` : String(r.count ?? '?'),
    r.eviction,
    r.access,
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i].length)),
  );
  const renderRow = (cells: string[]) =>
    cells.map((c, i) => padCell(c, widths[i])).join('  ');
  const lines: string[] = [];
  lines.push(renderRow(headers));
  lines.push(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const row of data) lines.push(renderRow(row));
  return lines.join('\n');
}

interface TierSummary {
  tier: MemoryTier;
  count: number | undefined;
  constructs: string[];
  errors: string[];
}

function summarize(rows: TierRow[]): TierSummary[] {
  const order: MemoryTier[] = ['Core', 'Recall', 'Archival', 'Recall→Archival'];
  const buckets = new Map<MemoryTier, TierSummary>();
  for (const tier of order) {
    buckets.set(tier, { tier, count: undefined, constructs: [], errors: [] });
  }
  for (const row of rows) {
    const bucket = buckets.get(row.tier);
    if (!bucket) continue;
    bucket.constructs.push(row.construct);
    if (typeof row.count === 'number') {
      bucket.count = (bucket.count ?? 0) + row.count;
    } else if (row.countError) {
      bucket.errors.push(`${row.construct}: ${row.countError}`);
    }
  }
  return order.map((t) => buckets.get(t)!).filter((b) => b.constructs.length > 0);
}

function printUsage(): never {
  console.error('Usage: pd memory <subcommand> [options]');
  console.error('');
  console.error('Tier introspection (read-only):');
  console.error('  tiers                     Print the construct → tier mapping with live counts');
  console.error('  tier <construct>          Print the tier for a single construct');
  console.error('  summary                   One-line-per-tier rollup');
  console.error('');
  console.error('Episodic memory (existing):');
  console.error('  episodes                  List episodic memory entries');
  console.error('  stats                     Summarize episodic memory counts');
  console.error('');
  console.error('Options:');
  console.error('  --json, -j                Machine-readable output');
  console.error('  --quiet, -q               Bare value (single number / tier name)');
  console.error('');
  console.error('See: docs/adr/0035-three-tier-memory-vocabulary.md');
  process.exit(1);
}

// =============================================================================
// handleMemoryTiers — pd memory tiers
// =============================================================================

export async function handleMemoryTiers(options: CLIOptions): Promise<void> {
  const rows = await collectRows();
  if (isJson(options)) {
    console.log(JSON.stringify({ rows }, null, 2));
    return;
  }
  if (isQuiet(options)) {
    console.log(String(rows.length));
    return;
  }
  console.log('Port Daddy Memory Tiers');
  console.log('');
  console.log(renderTable(rows));
  console.log('');
  console.log('See docs/adr/0035-three-tier-memory-vocabulary.md for the full mapping.');
}

// =============================================================================
// handleMemoryTier — pd memory tier <construct>
// =============================================================================

export async function handleMemoryTier(
  construct: string | undefined,
  options: CLIOptions,
): Promise<void> {
  if (!construct) {
    ui.error('Usage: pd memory tier <construct>');
    console.error('');
    console.error('Known constructs:');
    for (const row of TIER_TABLE) {
      console.error(`  ${row.construct}`);
    }
    process.exit(1);
  }
  const row = TIER_TABLE.find((r) => r.construct === construct);
  if (!row) {
    ui.error(`Unknown construct: ${construct}`);
    console.error('');
    console.error('Known constructs:');
    for (const r of TIER_TABLE) console.error(`  ${r.construct}`);
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify(row, null, 2));
    return;
  }
  if (isQuiet(options)) {
    console.log(row.tier);
    return;
  }
  console.log(`Construct: ${row.construct}`);
  console.log(`Tier:      ${row.tier}`);
  console.log(`Eviction:  ${row.eviction}`);
  console.log(`Access:    ${row.access}`);
}

// =============================================================================
// handleMemorySummary — pd memory summary
// =============================================================================

export async function handleMemorySummary(options: CLIOptions): Promise<void> {
  const rows = await collectRows();
  const summaries = summarize(rows);
  if (isJson(options)) {
    console.log(JSON.stringify({ tiers: summaries }, null, 2));
    return;
  }
  if (isQuiet(options)) {
    for (const s of summaries) {
      console.log(`${s.tier}\t${s.count ?? '?'}`);
    }
    return;
  }
  for (const s of summaries) {
    const constructList = s.constructs.join(', ');
    const errSuffix = s.errors.length > 0 ? `  (errors: ${s.errors.length})` : '';
    const countLabel = s.count === undefined ? '?' : String(s.count);
    console.log(`${s.tier}: ${countLabel} total across ${s.constructs.length} construct(s) — ${constructList}${errSuffix}`);
  }
}

// =============================================================================
// handleMemory — dispatcher
// =============================================================================

const TIER_SUBCOMMANDS = new Set(['tiers', 'tier', 'summary']);
const EPISODIC_SUBCOMMANDS = new Set(['episodes', 'stats']);

export async function handleMemory(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0];

  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    printUsage();
  }

  if (TIER_SUBCOMMANDS.has(sub)) {
    if (sub === 'tiers') return handleMemoryTiers(options);
    if (sub === 'tier') return handleMemoryTier(args[1], options);
    if (sub === 'summary') return handleMemorySummary(options);
  }

  if (EPISODIC_SUBCOMMANDS.has(sub)) {
    return handleEpisodicMemory(args, options);
  }

  ui.error(`Unknown memory subcommand: ${sub}`);
  printUsage();
}
