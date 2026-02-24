/**
 * Semantic Identity Parser
 *
 * Format: project:stack:context
 *
 * Examples:
 *   windags              -> { project: 'windags', stack: null, context: null }
 *   windags:api          -> { project: 'windags', stack: 'api', context: null }
 *   windags:api:main     -> { project: 'windags', stack: 'api', context: 'main' }
 *   windags:*:main       -> { project: 'windags', stack: '*', context: 'main' }
 *   *:frontend:*         -> { project: '*', stack: 'frontend', context: '*' }
 */

const IDENTITY_REGEX = /^[a-zA-Z0-9._*-]+$/;
const MAX_SEGMENT_LENGTH = 64;

export interface ParsedIdentityValid {
  valid: true;
  project: string;
  stack: string | null;
  context: string | null;
  full: string;
  normalized: string;
  hasWildcard: boolean;
}

export interface ParsedIdentityInvalid {
  valid: false;
  error: string;
}

export type ParsedIdentity = ParsedIdentityValid | ParsedIdentityInvalid;

/**
 * Parse a semantic identity string into components
 */
export function parseIdentity(id: string): ParsedIdentity {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'identity must be a non-empty string' };
  }

  const parts = id.split(':');

  if (parts.length > 3) {
    return { valid: false, error: 'identity can have at most 3 segments (project:stack:context)' };
  }

  const [project, stack = null, context = null] = parts;

  // Validate each segment
  for (const [name, value] of [['project', project], ['stack', stack], ['context', context]] as const) {
    if (value !== null) {
      if (!IDENTITY_REGEX.test(value)) {
        return { valid: false, error: `${name} contains invalid characters` };
      }
      if (value.length > MAX_SEGMENT_LENGTH) {
        return { valid: false, error: `${name} too long (max ${MAX_SEGMENT_LENGTH} chars)` };
      }
    }
  }

  return {
    valid: true,
    project,
    stack,
    context,
    full: id,
    normalized: [project, stack, context].filter(Boolean).join(':'),
    hasWildcard: id.includes('*')
  };
}

/**
 * Check if an identity matches a pattern (with wildcards)
 *
 * Pattern: windags:*:main
 * Identity: windags:api:main -> true
 * Identity: windags:api:dev -> false
 */
export function matchesPattern(pattern: string, identity: string): boolean {
  const p = parseIdentity(pattern);
  const i = parseIdentity(identity);

  if (!p.valid || !i.valid) return false;

  // Compare each segment
  if (p.project !== '*' && p.project !== i.project) return false;
  if (p.stack !== null && p.stack !== '*' && p.stack !== i.stack) return false;
  if (p.context !== null && p.context !== '*' && p.context !== i.context) return false;

  return true;
}

/**
 * Convert identity pattern to SQL LIKE clause
 *
 * Converts * to % (SQL wildcard) in each segment:
 * - "qa-test*" → "qa-test%"
 * - "qa-test:*" → "qa-test:%"
 * - "myapp:*:main" → "myapp:%:main"
 */
export function patternToSql(pattern: string): string | null {
  const p = parseIdentity(pattern);
  if (!p.valid) return null;

  // Convert * to % in each segment (handles embedded wildcards like "qa-test*")
  const convertWildcards = (s: string): string => s.replace(/\*/g, '%');

  // Build SQL pattern
  let sqlPattern = convertWildcards(p.project);

  if (p.stack !== null) {
    sqlPattern += ':' + convertWildcards(p.stack);
  }

  if (p.context !== null) {
    sqlPattern += ':' + convertWildcards(p.context);
  }

  return sqlPattern;
}

interface NormalizeDefaults {
  stack?: string | null;
  context?: string | null;
}

interface NormalizedIdentityValid {
  valid: true;
  project: string;
  stack: string | null;
  context: string | null;
  full: string;
  normalized: string;
}

export type NormalizedIdentity = NormalizedIdentityValid | ParsedIdentityInvalid;

/**
 * Normalize an identity (fill in defaults, validate)
 */
export function normalizeIdentity(id: string, defaults: NormalizeDefaults = {}): NormalizedIdentity {
  const parsed = parseIdentity(id);
  if (!parsed.valid) return parsed;

  return {
    valid: true,
    project: parsed.project,
    stack: parsed.stack || defaults.stack || null,
    context: parsed.context || defaults.context || null,
    full: parsed.normalized,
    normalized: parsed.normalized
  };
}

/**
 * Generate a display-friendly identity
 */
export function displayIdentity(id: string): string {
  const parsed = parseIdentity(id);
  if (!parsed.valid) return id;

  const parts = [parsed.project];
  if (parsed.stack) parts.push(parsed.stack);
  if (parsed.context) parts.push(parsed.context);

  return parts.join(':');
}
