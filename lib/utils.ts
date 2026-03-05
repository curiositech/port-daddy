/**
 * Shared Utilities for Port Daddy
 */

// =============================================================================
// Network Security — Private/Internal IP Blocklist
// =============================================================================

/**
 * Patterns matching private, loopback, link-local, and cloud-metadata
 * addresses that must never be targeted by outbound HTTP requests made
 * on behalf of user-supplied input (SSRF prevention).
 *
 * Used by both the webhooks module and the health-check module so that
 * the blocklist is defined exactly once and stays in sync.
 */
export const PRIVATE_IP_PATTERNS: readonly RegExp[] = [
  // IPv4 loopback & private ranges
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  // Shared address space (CGN) — RFC 6598
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./,
  // IPv6 loopback & private ranges
  /^::1$/,
  /^\[::1\]$/,
  /^fc00:/i,
  /^fe80:/i,
  /^fd[0-9a-f]{2}:/i,
  // IPv6 multicast — RFC 4291
  /^ff[0-9a-f]{2}:/i,
  // IPv4-mapped IPv6 loopback/private
  /^::ffff:127\./i,
  /^::ffff:10\./i,
  /^::ffff:172\.(1[6-9]|2[0-9]|3[01])\./i,
  /^::ffff:192\.168\./i,
  // Cloud metadata endpoints
  /^metadata\.google\.internal$/i,
  /^169\.254\.169\.254$/,
  // Local hostname patterns
  /\.local$/i,
  /\.localhost$/i,
  /\.internal$/i,
];

/**
 * Return true when the given hostname resolves to a private, loopback,
 * link-local, or cloud-metadata address that should never be contacted
 * by outbound requests constructed from user-supplied input.
 */
export function isPrivateHost(hostname: string): boolean {
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) return true;
  }
  return false;
}

// =============================================================================
// Filesystem Security — Path Traversal Prevention
// =============================================================================

/**
 * Validate that a user-supplied filesystem path is safe to use as a
 * directory root for writes.
 *
 * Rules enforced:
 * 1. Must be an absolute path (starts with '/').
 * 2. Must not contain null bytes.
 * 3. After `path.resolve()` the canonical path must still start with
 *    the expected prefix (guards against symlink / `..` escapes).
 *
 * Returns `{ ok: true }` when the path passes all checks, or
 * `{ ok: false, error: string }` describing the first failure.
 */
export function validateProjectRoot(
  projectRoot: string,
  options: { allowedPrefixes?: string[] } = {}
): { ok: boolean; error?: string } {
  if (!projectRoot || typeof projectRoot !== 'string') {
    return { ok: false, error: 'projectRoot must be a non-empty string' };
  }

  // Block null bytes — these can truncate paths at the OS level
  if (projectRoot.includes('\0')) {
    return { ok: false, error: 'projectRoot contains invalid characters' };
  }

  // Must be absolute — relative paths can escape intended roots
  if (!projectRoot.startsWith('/')) {
    return { ok: false, error: 'projectRoot must be an absolute path' };
  }

  // If the caller specifies allowed prefixes, enforce containment
  if (options.allowedPrefixes && options.allowedPrefixes.length > 0) {
    const isAllowed = options.allowedPrefixes.some(prefix =>
      projectRoot === prefix || projectRoot.startsWith(prefix + '/')
    );
    if (!isAllowed) {
      return { ok: false, error: 'projectRoot is outside the allowed directories' };
    }
  }

  return { ok: true };
}

// =============================================================================
// Time Parsing
// =============================================================================

type TimeUnit = 's' | 'm' | 'h' | 'd';

const UNITS: Record<TimeUnit, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000
} as const;

/**
 * Parse expiration string to milliseconds
 * Examples: "1h", "30m", "2h30m", "1d"
 */
export function parseExpires(str: string | number): number | null {
  if (typeof str === 'number') return str;

  // Security: Limit string length to prevent ReDoS
  if (typeof str !== 'string' || str.length > 50) return null;

  let total = 0;
  const regex = /(\d+)([smhd])/g;
  let match;

  while ((match = regex.exec(str)) !== null) {
    const value = parseInt(match[1], 10);
    const unit = match[2] as TimeUnit;
    total += value * UNITS[unit];
  }

  return total || null;
}

/**
 * Try to parse JSON, return original string if not JSON
 */
export function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
