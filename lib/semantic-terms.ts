import { createHash } from 'node:crypto';

/**
 * Deterministic lexical alias generated from free-form agent text.
 *
 * Example:
 * ```ts
 * {
 *   raw: 'Writing the CSS for Port Daddy website design system',
 *   canonical: 'css design-system port-daddy site',
 *   tokens: ['css', 'design-system', 'port-daddy', 'site'],
 *   fingerprint: '9b0f8cc4aef1d2a4'
 * }
 * ```
 */
export interface SemanticAlias {
  raw: string;
  canonical: string;
  tokens: string[];
  fingerprint: string;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'for',
  'to',
  'of',
  'in',
  'on',
  'with',
  'by',
  'from',
  'into',
  'at',
  'new',
  'now',
  'work',
  'working',
  'write',
  'writes',
  'writing',
  'task',
  'tasks',
  'agent',
  'agents',
  'doing',
  'do',
  'make',
  'making',
  'build',
  'building',
]);

const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bport[\s-]?daddy(?:'s)?\b/gi, 'port-daddy'],
  [/\bdesign systems?\b/gi, 'design-system'],
  [/\bdesign tokens?\b/gi, 'design-system'],
  [/\bweb\s*sites?\b/gi, 'site'],
];

const TOKEN_SYNONYMS = new Map<string, string>([
  ['portdaddy', 'port-daddy'],
  ['website', 'site'],
  ['web', 'site'],
  ['styles', 'css'],
  ['style', 'css'],
  ['styling', 'css'],
]);

/**
 * Normalize multi-word phrases before tokenization.
 */
function normalizePhrase(input: string): string {
  let value = input.toLowerCase();
  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return value
    .replace(/['`]/g, '')
    .replace(/[^a-z0-9._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Collapse simple English plurals into their singular canonical form.
 */
function singularize(token: string): string {
  if (token === 'css' || token.length <= 3) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('sses')) return token;
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

/**
 * Normalize a single token by trimming punctuation, applying synonym rewrites,
 * singularizing, and dropping filler words.
 */
function normalizeToken(token: string): string | null {
  const cleaned = token.trim().replace(/^-+|-+$/g, '');
  if (!cleaned) return null;
  const synonym = TOKEN_SYNONYMS.get(cleaned) ?? cleaned;
  const singular = singularize(synonym);
  if (!singular || STOP_WORDS.has(singular)) return null;
  return singular;
}

/**
 * Convert free-form text snippets into stable semantic aliases.
 *
 * This is intentionally cheap and deterministic. It is the lexical layer used
 * before the embedding-based semantic resolver.
 *
 * Example input:
 * ```ts
 * collectSemanticAliases([
 *   'Writing the CSS for Port Daddy website design system',
 *   'PortDaddy site design-system css work',
 * ]);
 * ```
 *
 * Example output:
 * ```ts
 * [
 *   {
 *     raw: 'Writing the CSS for Port Daddy website design system',
 *     canonical: 'css design-system port-daddy site',
 *     tokens: ['css', 'design-system', 'port-daddy', 'site'],
 *     fingerprint: '9b0f8cc4aef1d2a4'
 *   }
 * ]
 * ```
 */
export function collectSemanticAliases(
  inputs: Array<string | null | undefined>,
  options: { limit?: number } = {},
): SemanticAlias[] {
  const results: SemanticAlias[] = [];
  const seen = new Set<string>();
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 32);

  for (const input of inputs) {
    const raw = input?.trim();
    if (!raw) continue;

    const normalized = normalizePhrase(raw);
    if (!normalized) continue;

    const tokenSet = new Set<string>();
    for (const token of normalized.split(/\s+/)) {
      const canonicalToken = normalizeToken(token);
      if (canonicalToken) tokenSet.add(canonicalToken);
    }

    const tokens = [...tokenSet].sort();
    if (tokens.length === 0) continue;

    const canonical = tokens.join(' ');
    if (seen.has(canonical)) continue;
    seen.add(canonical);

    results.push({
      raw,
      canonical,
      tokens,
      fingerprint: createHash('sha1').update(canonical).digest('hex').slice(0, 16),
    });

    if (results.length >= limit) break;
  }

  return results;
}
