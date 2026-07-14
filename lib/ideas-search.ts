import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';

import { PortDaddy } from './client.js';
import {
  buildIdeasIndex,
  collectRawIdeaResidue,
  searchIdeas,
  type IdeaEntry,
  type IdeaSection,
  type IdeaSource,
  type IdeaStatus,
} from './ideas-trove.js';
import { applyDistinctTokenCoverageBonus } from './search-coverage.js';

export type IdeaSearchSource = 'trove' | 'raw' | 'notes' | 'tuples' | 'markdown';
export type IdeaSearchKind = 'idea' | 'note' | 'tuple' | 'markdown';

export interface IdeaSearchHit {
  id: string;
  kind: IdeaSearchKind;
  source: IdeaSearchSource;
  title: string;
  summary: string;
  score: number;
  matches: string[];
  slug?: string;
  status?: IdeaStatus;
  section?: IdeaSection;
  provenance?: string[];
  location?: string;
  createdAt?: number;
  metadata?: Record<string, unknown>;
}

export interface IdeaSearchResult {
  query: string;
  results: IdeaSearchHit[];
  sources: IdeaSearchSource[];
  warnings: string[];
}

interface IdeaSearchOptions {
  projectDir: string;
  limit?: number;
  status?: IdeaStatus;
  includeRaw?: boolean;
  sources?: IdeaSearchSource[];
}

interface SearchScore {
  score: number;
  matches: string[];
}

interface NoteEntry {
  id: number;
  sessionId: string;
  content: string;
  type: string;
  createdAt: number;
  sessionPurpose?: string;
  agentId?: string;
  identityProject?: string;
}

interface TupleEntry {
  id: number;
  harbor: string | null;
  fields: unknown[];
  writtenBy: string | null;
  createdAt: number;
  expiresAt: number | null;
}

const DEFAULT_SOURCES: IdeaSearchSource[] = ['trove', 'notes', 'tuples', 'markdown'];
const MARKDOWN_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'public/fleet-ui',
  '.spark',
  '.spider',
  // Nested git worktrees (`.claude/worktrees/<slug>/`, `.worktrees/<slug>/`) are
  // each a FULL checkout of this repo — docs/, .cartographer/, everything.
  // Never excluded here, `ideas search` walked every markdown file inside
  // every one of them on every call: 269 nested worktrees observed in one
  // checkout turned a sub-second scan into 90+ seconds (enough to blow the
  // 30s CLI integration-test timeout in tests/integration/cli.test.js's
  // "ideas search finds the ipc disconnect salvage family" test). `.claude`
  // and `.worktrees` are excluded as whole directories (bare segment match
  // via shouldIgnoreMarkdownDir, so any depth of nested worktree matches);
  // `worktrees` alone is excluded too as a defensive catch-all for any other
  // convention this repo or a future one uses.
  '.claude',
  '.worktrees',
  'worktrees',
]);
const MAX_MARKDOWN_BYTES = 256 * 1024;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripInlineMarkdown(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1'),
  );
}

function normalizeText(value: string): string {
  return stripInlineMarkdown(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  const seen = new Set<string>();
  const tokens = normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  const deduped: string[] = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    deduped.push(token);
  }
  return deduped;
}

function scoreFields(query: string, fields: Array<[string, string, number]>): SearchScore {
  const queryNorm = normalizeText(query);
  const tokens = tokenize(query);
  const matches: string[] = [];
  let score = 0;
  let matchedTokenCount = 0;

  for (const token of tokens) {
    let matched = false;
    for (const [label, field, weight] of fields) {
      const normalized = normalizeText(field);
      if (!normalized) continue;
      if (normalized === token) {
        score += weight + 4;
        matched = true;
      } else if (normalized.includes(token)) {
        score += weight;
        matched = true;
      }
      if (matched) {
        matchedTokenCount += 1;
        if (!matches.includes(label)) matches.push(label);
        break;
      }
    }
  }

  if (queryNorm) {
    for (const [label, field, weight] of fields) {
      const normalized = normalizeText(field);
      if (!normalized || !normalized.includes(queryNorm)) continue;
      score += weight + 2;
      if (!matches.includes(label)) matches.push(label);
    }
  }

  if (matchedTokenCount === 0 && score === 0) return { score: 0, matches: [] };
  return {
    score: applyDistinctTokenCoverageBonus(score, matchedTokenCount, tokens.length),
    matches,
  };
}

function sourceRank(source: IdeaSearchSource): number {
  switch (source) {
    case 'trove': return 0;
    case 'notes': return 1;
    case 'tuples': return 2;
    case 'markdown': return 3;
    case 'raw': return 4;
    default: return 5;
  }
}

export function resolveIdeaSearchSources(
  sources: string[] | undefined,
  includeRaw = false,
): IdeaSearchSource[] {
  const resolved = new Set<IdeaSearchSource>();
  const values = sources && sources.length > 0 ? sources : DEFAULT_SOURCES;

  for (const raw of values) {
    for (const part of raw.split(',')) {
      const value = part.trim().toLowerCase();
      if (!value) continue;
      if (value === 'all') {
        DEFAULT_SOURCES.forEach((source) => resolved.add(source));
        resolved.add('raw');
        continue;
      }
      if (value === 'trove' || value === 'raw' || value === 'notes' || value === 'tuples' || value === 'markdown') {
        resolved.add(value);
      }
    }
  }

  if (includeRaw) resolved.add('raw');
  if (resolved.size === 0) DEFAULT_SOURCES.forEach((source) => resolved.add(source));
  return Array.from(resolved);
}

function mapIdeaHit(entry: IdeaEntry): IdeaSearchHit {
  return {
    id: entry.slug,
    kind: 'idea',
    source: entry.source as IdeaSource,
    title: entry.title,
    summary: entry.summary,
    score: entry.score || 0,
    matches: entry.matches || [],
    slug: entry.slug,
    status: entry.status,
    section: entry.section,
    provenance: entry.provenance,
    metadata: {
      sourceKind: entry.source,
    },
  };
}

function toNoteHit(note: NoteEntry, score: SearchScore): IdeaSearchHit {
  const sessionPurpose = note.sessionPurpose ? ` — ${note.sessionPurpose}` : '';
  return {
    id: `note:${note.id}`,
    kind: 'note',
    source: 'notes',
    title: `${note.type}${sessionPurpose}`,
    summary: note.content,
    score: score.score,
    matches: score.matches,
    location: `session:${note.sessionId}`,
    createdAt: note.createdAt,
    metadata: {
      noteId: note.id,
      sessionId: note.sessionId,
      type: note.type,
      agentId: note.agentId ?? null,
      identityProject: note.identityProject ?? null,
    },
  };
}

function summarizeTuple(tuple: TupleEntry): string {
  return normalizeWhitespace(JSON.stringify(tuple.fields));
}

function toTupleHit(tuple: TupleEntry, score: SearchScore): IdeaSearchHit {
  return {
    id: `tuple:${tuple.id}`,
    kind: 'tuple',
    source: 'tuples',
    title: tuple.harbor ? `tuple @${tuple.harbor}` : 'tuple',
    summary: summarizeTuple(tuple),
    score: score.score,
    matches: score.matches,
    location: tuple.harbor ? `harbor:${tuple.harbor}` : 'global',
    createdAt: tuple.createdAt,
    metadata: {
      tupleId: tuple.id,
      harbor: tuple.harbor,
      writtenBy: tuple.writtenBy,
      expiresAt: tuple.expiresAt,
    },
  };
}

function firstHeading(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#{1,3}\s+(.+)$/m)?.[1];
  return stripInlineMarkdown(heading || fallback);
}

function firstMatchingLine(markdown: string, query: string): string {
  const queryNorm = normalizeText(query);
  const tokens = tokenize(query);
  const lines = markdown.split(/\r?\n/);

  for (const line of lines) {
    const cleaned = stripInlineMarkdown(line.trim());
    if (!cleaned) continue;
    const normalized = normalizeText(cleaned);
    if (!normalized) continue;
    if (queryNorm && normalized.includes(queryNorm)) return cleaned;
    if (tokens.some((token) => normalized.includes(token))) return cleaned;
  }

  for (const line of lines) {
    const cleaned = stripInlineMarkdown(line.trim());
    if (cleaned && !cleaned.startsWith('#')) return cleaned;
  }

  return 'Markdown match';
}

function fallbackTitleFromPath(relativePath: string): string {
  return basename(relativePath, extname(relativePath)).replace(/[-_]+/g, ' ');
}

function shouldIgnoreMarkdownDir(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized) return false;
  return MARKDOWN_IGNORE_DIRS.has(normalized) || normalized.split('/').some((part) => MARKDOWN_IGNORE_DIRS.has(part));
}

function walkMarkdownFiles(root: string, currentDir: string, results: string[]): void {
  const dirents = readdirSync(currentDir, { withFileTypes: true });

  for (const dirent of dirents) {
    const absPath = join(currentDir, dirent.name);
    const relPath = relative(root, absPath).replace(/\\/g, '/');

    if (dirent.isDirectory()) {
      if (shouldIgnoreMarkdownDir(relPath)) continue;
      walkMarkdownFiles(root, absPath, results);
      continue;
    }

    if (!dirent.isFile() || !dirent.name.endsWith('.md')) continue;
    if (relPath === 'docs/recovery/IDEAS-TROVE.md') continue;

    try {
      const stat = statSync(absPath);
      if (stat.size > MAX_MARKDOWN_BYTES) continue;
      results.push(absPath);
    } catch {
      continue;
    }
  }
}

export function searchMarkdownFiles(
  projectDir: string,
  query: string,
  options: { limit?: number } = {},
): IdeaSearchHit[] {
  const root = resolve(projectDir);
  const files: string[] = [];
  walkMarkdownFiles(root, root, files);

  const hits: IdeaSearchHit[] = [];

  for (const absPath of files) {
    const relPath = relative(root, absPath).replace(/\\/g, '/');
    const markdown = readFileSync(absPath, 'utf8');
    const title = firstHeading(markdown, fallbackTitleFromPath(relPath));
    const summary = firstMatchingLine(markdown, query);
    const score = scoreFields(query, [
      ['path', relPath, 9],
      ['title', title, 8],
      ['summary', summary, 6],
      ['content', markdown, 2],
    ]);
    if (score.score <= 0) continue;
    hits.push({
      id: relPath,
      kind: 'markdown',
      source: 'markdown',
      title,
      summary,
      score: score.score,
      matches: score.matches,
      provenance: [relPath],
      location: relPath,
    });
  }

  hits.sort((left, right) => {
    const scoreDiff = right.score - left.score;
    if (scoreDiff !== 0) return scoreDiff;
    return left.id.localeCompare(right.id);
  });

  return options.limit ? hits.slice(0, options.limit) : hits;
}

async function searchNotes(query: string, limit: number): Promise<IdeaSearchHit[]> {
  const client = new PortDaddy();
  const data = await client.notes({ limit: Math.max(limit * 5, 200) }) as { notes?: NoteEntry[] };
  const notes = data.notes || [];

  return notes
    .map((note) => {
      const score = scoreFields(query, [
        ['content', note.content, 9],
        ['type', note.type, 6],
        ['purpose', note.sessionPurpose || '', 5],
        ['agent', note.agentId || '', 5],
        ['project', note.identityProject || '', 5],
        ['session', note.sessionId, 4],
      ]);
      return score.score > 0 ? toNoteHit(note, score) : null;
    })
    .filter((hit): hit is IdeaSearchHit => hit !== null);
}

async function searchTuples(query: string, limit: number): Promise<IdeaSearchHit[]> {
  const client = new PortDaddy();
  const data = await client.tupleScan() as { tuples?: TupleEntry[] };
  const tuples = data.tuples || [];

  return tuples
    .map((tuple) => {
      const score = scoreFields(query, [
        ['fields', JSON.stringify(tuple.fields), 9],
        ['harbor', tuple.harbor || '', 6],
        ['writtenBy', tuple.writtenBy || '', 5],
      ]);
      return score.score > 0 ? toTupleHit(tuple, score) : null;
    })
    .filter((hit): hit is IdeaSearchHit => hit !== null)
    .slice(0, Math.max(limit * 5, 200));
}

export async function searchIdeaUniverse(
  query: string,
  options: IdeaSearchOptions,
): Promise<IdeaSearchResult> {
  const limit = options.limit ?? 10;
  const sources = resolveIdeaSearchSources(options.sources, options.includeRaw);
  const warnings: string[] = [];
  const hits: IdeaSearchHit[] = [];

  if (sources.includes('trove') || sources.includes('raw')) {
    try {
      const entries = sources.includes('trove')
        ? buildIdeasIndex(options.projectDir, { includeRaw: sources.includes('raw') })
        : collectRawIdeaResidue(options.projectDir);
      const searched = searchIdeas(entries, query, { limit: Math.max(limit * 5, 50), status: options.status })
        .filter((entry) => {
          if (entry.source === 'raw') return sources.includes('raw');
          return sources.includes('trove');
        })
        .map(mapIdeaHit);
      hits.push(...searched);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Unable to load ideas trove');
    }
  }

  if (sources.includes('notes')) {
    try {
      hits.push(...await searchNotes(query, limit));
    } catch (error) {
      warnings.push(`notes unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  if (sources.includes('tuples')) {
    try {
      hits.push(...await searchTuples(query, limit));
    } catch (error) {
      warnings.push(`tuples unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  if (sources.includes('markdown')) {
    try {
      hits.push(...searchMarkdownFiles(options.projectDir, query, { limit: Math.max(limit * 5, 50) }));
    } catch (error) {
      warnings.push(`markdown search failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  const results = hits
    .sort((left, right) => {
      const scoreDiff = right.score - left.score;
      if (scoreDiff !== 0) return scoreDiff;
      const sourceDiff = sourceRank(left.source) - sourceRank(right.source);
      if (sourceDiff !== 0) return sourceDiff;
      return left.id.localeCompare(right.id);
    })
    .slice(0, limit);

  return { query, results, sources, warnings };
}
