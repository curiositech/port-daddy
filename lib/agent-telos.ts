export type AgentTelosSource = 'creator' | 'self' | 'derived' | 'system';

export interface AgentTelos {
  headline: string;
  facets: string[];
  hierarchy: string[];
  currentIntent: string | null;
  source: AgentTelosSource;
}

export interface NormalizeAgentTelosOptions {
  fallbackHeadline?: string | null;
  fallbackCurrentIntent?: string | null;
  source?: AgentTelosSource;
}

export interface NormalizeAgentTelosResult {
  success: boolean;
  telos?: AgentTelos;
  error?: string;
}

const VALID_SOURCES = new Set<AgentTelosSource>(['creator', 'self', 'derived', 'system']);
const MAX_HEADLINE_LENGTH = 240;
const MAX_LIST_ITEMS = 12;

function cleanText(value: unknown, maxLength = MAX_HEADLINE_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  return compact.slice(0, maxLength);
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    const cleaned = cleanText(item);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    items.push(cleaned);
    if (items.length >= MAX_LIST_ITEMS) break;
  }
  return items;
}

function normalizeSource(value: unknown, fallback: AgentTelosSource): AgentTelosSource {
  return typeof value === 'string' && VALID_SOURCES.has(value as AgentTelosSource)
    ? value as AgentTelosSource
    : fallback;
}

export function normalizeAgentTelos(input: unknown, options: NormalizeAgentTelosOptions = {}): NormalizeAgentTelosResult {
  const fallbackHeadline = cleanText(options.fallbackHeadline);
  const fallbackCurrentIntent = cleanText(options.fallbackCurrentIntent);
  const defaultSource = options.source || (fallbackHeadline ? 'derived' : 'system');

  if (typeof input === 'string') {
    const headline = cleanText(input);
    if (!headline) return { success: false, error: 'telos must have a non-empty headline' };
    return {
      success: true,
      telos: {
        headline,
        facets: [headline],
        hierarchy: [],
        currentIntent: fallbackCurrentIntent,
        source: defaultSource,
      },
    };
  }

  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    const facets = cleanList(record.facets ?? record.purposes ?? record.tags);
    const hierarchy = cleanList(record.hierarchy ?? record.lineage ?? record.parents);
    const headline = cleanText(record.headline)
      || cleanText(record.tagline)
      || cleanText(record.purpose)
      || facets[0]
      || fallbackHeadline;

    if (!headline) return { success: false, error: 'telos must have a non-empty headline' };

    return {
      success: true,
      telos: {
        headline,
        facets: facets.length > 0 ? facets : [headline],
        hierarchy,
        currentIntent: cleanText(record.currentIntent ?? record.intent) || fallbackCurrentIntent,
        source: normalizeSource(record.source, defaultSource),
      },
    };
  }

  if (fallbackHeadline) {
    return {
      success: true,
      telos: {
        headline: fallbackHeadline,
        facets: [fallbackHeadline],
        hierarchy: [],
        currentIntent: fallbackCurrentIntent,
        source: defaultSource,
      },
    };
  }

  return { success: false, error: 'telos is required for every agent' };
}

export function serializeAgentTelos(telos: AgentTelos): string {
  return JSON.stringify(telos);
}

export function parseAgentTelos(value: string | null, fallbackHeadline?: string | null): AgentTelos {
  if (value) {
    try {
      const normalized = normalizeAgentTelos(JSON.parse(value));
      if (normalized.success && normalized.telos) return normalized.telos;
    } catch {
      const normalized = normalizeAgentTelos(value);
      if (normalized.success && normalized.telos) return normalized.telos;
    }
  }

  const fallback = normalizeAgentTelos(undefined, {
    fallbackHeadline: fallbackHeadline || 'Operate as a Port Daddy agent',
    source: fallbackHeadline ? 'derived' : 'system',
  });
  return fallback.telos!;
}

export function agentTelosHeadline(value: unknown, fallbackHeadline?: string | null): string {
  return normalizeAgentTelos(value, { fallbackHeadline }).telos?.headline
    || fallbackHeadline
    || 'Operate as a Port Daddy agent';
}
