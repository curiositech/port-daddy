import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { applyDistinctTokenCoverageBonus } from './search-coverage.js';

export type IdeaStatus = 'now' | 'backlog' | 'parked' | 'merge' | 'local';
export type IdeaSection = 'immediate' | 'secondary' | 'duplicate' | 'raw';
export type IdeaSource = 'trove' | 'raw';

export interface IdeaEntry {
  slug: string;
  title: string;
  status: IdeaStatus;
  section: IdeaSection;
  source: IdeaSource;
  summary: string;
  details: string[];
  nextCut: string[];
  provenance: string[];
  matches?: string[];
  score?: number;
}

interface ScoredIdeaEntry extends IdeaEntry {
  score: number;
  matches: string[];
}

interface ParseContext {
  order: number;
}

const RAW_IDEA_DIRS = [
  '.spark/ideas',
  '.spider/connections',
];

function stripIdeaTimestampPrefix(value: string): string {
  return value.replace(/^\d{8}(?:-\d{4})?-/, '');
}

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

function slugify(value: string): string {
  return stripInlineMarkdown(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
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

function collectIndentedBullets(lines: string[], startIndex: number): { items: string[]; nextIndex: number } {
  const items: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const match = lines[index]?.match(/^\s{2}-\s+(.*)$/);
    if (!match) break;
    items.push(stripInlineMarkdown(match[1]));
    index += 1;
  }
  return { items, nextIndex: index };
}

function summarize(details: string[], fallback: string[]): string {
  const first = details[0] || fallback[0] || '';
  return normalizeWhitespace(first);
}

function shouldSkipIdeaTitle(title: string): boolean {
  const normalized = stripInlineMarkdown(title).toLowerCase();
  return normalized === 'recommended first two builds';
}

function parseStructuredEntry(
  title: string,
  section: Exclude<IdeaSection, 'raw'>,
  lines: string[],
  context: ParseContext,
): IdeaEntry {
  let status: IdeaStatus = section === 'immediate' ? 'now' : section === 'duplicate' ? 'merge' : 'backlog';
  const why: string[] = [];
  const details: string[] = [];
  const nextCut: string[] = [];
  const provenance: string[] = [];
  const generic: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim();
    if (!trimmed) continue;

    const statusMatch = trimmed.match(/^- status:\s*`?([^`]+)`?$/);
    if (statusMatch) {
      const rawStatus = statusMatch[1]?.trim().toLowerCase();
      if (rawStatus === 'now' || rawStatus === 'backlog' || rawStatus === 'parked' || rawStatus === 'merge') {
        status = rawStatus;
      }
      continue;
    }

    if (
      trimmed === '- why it matters:' ||
      trimmed === '- core themes:' ||
      trimmed === '- provenance:' ||
      trimmed === '- representative provenance:' ||
      trimmed === '- next cut:'
    ) {
      const { items, nextIndex } = collectIndentedBullets(lines, index + 1);
      if (trimmed === '- why it matters:') why.push(...items);
      if (trimmed === '- core themes:') details.push(...items);
      if (trimmed === '- next cut:') nextCut.push(...items);
      if (trimmed === '- provenance:' || trimmed === '- representative provenance:') {
        provenance.push(...items.map((item) => item.replace(/^["']|["']$/g, '')));
      }
      index = nextIndex - 1;
      continue;
    }

    if (section === 'duplicate') {
      const duplicateMatch = lines[index]?.match(/^\s{2}-\s+`?([^`]+)`?\s*$/);
      if (duplicateMatch) {
        provenance.push(stripInlineMarkdown(duplicateMatch[1]));
        continue;
      }
    }

    if (trimmed.startsWith('- ')) {
      generic.push(stripInlineMarkdown(trimmed.slice(2)));
      continue;
    }

    generic.push(stripInlineMarkdown(trimmed));
  }

  const titleText = stripInlineMarkdown(title);
  const slug = slugify(titleText);
  const summary = summarize(why, details.length > 0 ? details : generic);

  context.order += 1;
  return {
    slug,
    title: titleText,
    status,
    section,
    source: 'trove',
    summary,
    details: [...why, ...details, ...generic].filter(Boolean),
    nextCut,
    provenance,
  };
}

function parseDuplicateFamily(
  title: string,
  lines: string[],
  context: ParseContext,
): IdeaEntry {
  const entry = parseStructuredEntry(title, 'duplicate', lines, context);
  return {
    ...entry,
    summary: entry.provenance.length > 0
      ? `Duplicate family covering ${entry.provenance.length} related raw files`
      : 'Duplicate family to collapse',
  };
}

export function defaultIdeasTrovePath(projectDir: string): string {
  return join(resolve(projectDir), 'docs', 'recovery', 'IDEAS-TROVE.md');
}

export function parseIdeasTrove(markdown: string): IdeaEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: IdeaEntry[] = [];
  const context: ParseContext = { order: 0 };

  let section: Exclude<IdeaSection, 'raw'> | null = null;
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  const flush = (): void => {
    if (!section || !currentTitle) return;
    if (shouldSkipIdeaTitle(currentTitle)) {
      currentTitle = null;
      currentLines = [];
      return;
    }
    const entry = section === 'duplicate'
      ? parseDuplicateFamily(currentTitle, currentLines, context)
      : parseStructuredEntry(currentTitle, section, currentLines, context);
    if (entry.slug) entries.push(entry);
    currentTitle = null;
    currentLines = [];
  };

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.*)$/);
    if (h2Match) {
      flush();
      const heading = stripInlineMarkdown(h2Match[1]);
      if (heading === 'Immediate Implementation Candidates') section = 'immediate';
      else if (heading === 'Secondary Backlog Families') section = 'secondary';
      else if (heading === 'Duplicate Families To Collapse') section = 'duplicate';
      else section = null;
      continue;
    }

    if (!section) continue;

    if (section === 'duplicate') {
      const duplicateMatch = line.match(/^- `?([^`]+)`?\s*$/);
      if (duplicateMatch) {
        flush();
        currentTitle = duplicateMatch[1];
        currentLines = [];
        continue;
      }
    } else {
      const h3Match = line.match(/^###\s+(.*)$/);
      if (h3Match) {
        flush();
        currentTitle = h3Match[1];
        currentLines = [];
        continue;
      }
    }

    if (currentTitle) currentLines.push(line);
  }

  flush();
  return entries;
}

export function loadIdeasTrove(projectDir: string): IdeaEntry[] {
  const trovePath = defaultIdeasTrovePath(projectDir);
  if (!existsSync(trovePath)) {
    throw new Error(`ideas trove not found at ${trovePath}`);
  }
  return parseIdeasTrove(readFileSync(trovePath, 'utf-8'));
}

function readRawIdeaTitle(content: string, fallback: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1];
  return stripInlineMarkdown(heading || fallback);
}

function readRawIdeaSummary(content: string): string {
  const lines = content.split(/\r?\n/);
  const summaryLines: string[] = [];
  let started = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (started) break;
      continue;
    }
    if (trimmed.startsWith('#')) continue;
    started = true;
    summaryLines.push(stripInlineMarkdown(trimmed));
    if (summaryLines.length >= 2) break;
  }
  return normalizeWhitespace(summaryLines.join(' '));
}

export function collectRawIdeaResidue(projectDir: string, excludePaths: Iterable<string> = []): IdeaEntry[] {
  const root = resolve(projectDir);
  const excluded = new Set(Array.from(excludePaths, normalizePath));
  const entries: IdeaEntry[] = [];

  for (const relativeDir of RAW_IDEA_DIRS) {
    const dir = join(root, relativeDir);
    if (!existsSync(dir)) continue;

    const dirents = readdirSync(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (!dirent.isFile() || !dirent.name.endsWith('.md')) continue;
      const absPath = join(dir, dirent.name);
      const relPath = normalizePath(relative(root, absPath));
      if (excluded.has(relPath)) continue;

      const content = readFileSync(absPath, 'utf-8');
      const fallbackTitle = stripIdeaTimestampPrefix(dirent.name)
        .replace(/\.md$/i, '')
        .replace(/-/g, ' ');

      entries.push({
        slug: slugify(stripIdeaTimestampPrefix(dirent.name).replace(/\.md$/i, '')),
        title: readRawIdeaTitle(content, fallbackTitle),
        status: 'local',
        section: 'raw',
        source: 'raw',
        summary: readRawIdeaSummary(content) || `Local raw residue from ${relPath}`,
        details: [],
        nextCut: [],
        provenance: [relPath],
      });
    }
  }

  return entries;
}

export function buildIdeasIndex(projectDir: string, options: { includeRaw?: boolean } = {}): IdeaEntry[] {
  const troveEntries = loadIdeasTrove(projectDir);
  if (!options.includeRaw) return troveEntries;

  const promotedPaths = new Set(
    troveEntries.flatMap((entry) => entry.provenance.map((path) => normalizePath(path))),
  );

  return [...troveEntries, ...collectRawIdeaResidue(projectDir, promotedPaths)];
}

function searchScore(entry: IdeaEntry, query: string): { score: number; matches: string[] } {
  const queryNorm = normalizeText(query);
  const tokens = tokenize(query);
  const matches: string[] = [];
  let score = 0;
  let matchedTokenCount = 0;

  const fields: Array<[string, string, number]> = [
    ['slug', normalizeText(entry.slug), 12],
    ['title', normalizeText(entry.title), 10],
    ['summary', normalizeText(entry.summary), 6],
    ['details', normalizeText(entry.details.join(' ')), 4],
    ['provenance', normalizeText(entry.provenance.join(' ')), 5],
  ];

  for (const token of tokens) {
    let matched = false;
    for (const [label, field, weight] of fields) {
      if (!field) continue;
      if (field === token) {
        score += weight + 4;
        matched = true;
      } else if (field.includes(token)) {
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

  if (queryNorm && normalizeText(entry.slug).includes(queryNorm)) score += 18;
  if (queryNorm && normalizeText(entry.title).includes(queryNorm)) score += 14;
  if (queryNorm && normalizeText(entry.summary).includes(queryNorm)) score += 8;

  if (matchedTokenCount === 0) return { score: 0, matches: [] };
  return {
    score: applyDistinctTokenCoverageBonus(score, matchedTokenCount, tokens.length),
    matches,
  };
}

function statusRank(status: IdeaStatus): number {
  switch (status) {
    case 'now': return 0;
    case 'backlog': return 1;
    case 'parked': return 2;
    case 'merge': return 3;
    case 'local': return 4;
    default: return 5;
  }
}

export function searchIdeas(
  entries: IdeaEntry[],
  query: string,
  options: { limit?: number; status?: IdeaStatus } = {},
): IdeaEntry[] {
  const filtered = options.status
    ? entries.filter((entry) => entry.status === options.status)
    : entries;

  const scored: ScoredIdeaEntry[] = filtered
    .map((entry): ScoredIdeaEntry | null => {
      const { score, matches } = searchScore(entry, query);
      return score > 0 ? { ...entry, score, matches } : null;
    })
    .filter((entry): entry is ScoredIdeaEntry => entry !== null)
    .sort((left, right) => {
      const scoreDiff = right.score - left.score;
      if (scoreDiff !== 0) return scoreDiff;
      const sourceDiff = left.source.localeCompare(right.source);
      if (sourceDiff !== 0) return sourceDiff;
      return statusRank(left.status) - statusRank(right.status);
    });

  return options.limit ? scored.slice(0, options.limit) : scored;
}

export function findIdea(entries: IdeaEntry[], slugOrTitle: string): IdeaEntry | undefined {
  const target = slugify(slugOrTitle);
  return entries.find((entry) =>
    entry.slug === target ||
    slugify(entry.title) === target ||
    entry.provenance.some((path) => slugify(path) === target),
  );
}
