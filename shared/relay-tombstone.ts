/**
 * Client-side renderer for the relay X6 structured 410 tombstone (RFC 9745 /
 * RFC 8594 machinery; apps/relay/src/deprecations.ts renderTombstone). Ships
 * in the same PR as the server side so a binary that outlives a sunset fails
 * ACTIONABLY - successor path, sunset date, migration docs - instead of a
 * bare 410. The wire shape is pinned on both sides by
 * tests/fixtures/relay-tombstone-golden.json.
 */

export interface RelayTombstoneDeprecation {
  id: string;
  deprecated_at: string | null;
  sunset_at: string | null;
  successor: string | null;
  docs: string | null;
  min_version: string | null;
}

export interface RelayTombstone {
  code: 'SURFACE_SUNSET';
  error: string;
  endpoint: string;
  deprecation: RelayTombstoneDeprecation;
}

/** Null unless (status, body) is a well-formed relay tombstone. */
export function parseRelayTombstone(status: number, body: unknown): RelayTombstone | null {
  if (status !== 410 || typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.code !== 'SURFACE_SUNSET') return null;
  if (typeof b.endpoint !== 'string' || typeof b.error !== 'string') return null;
  const d = (typeof b.deprecation === 'object' && b.deprecation !== null
    ? b.deprecation
    : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    (typeof v === 'string' && v.length > 0 ? v : null);
  return {
    code: 'SURFACE_SUNSET',
    error: b.error,
    endpoint: b.endpoint,
    deprecation: {
      id: str(d.id) ?? 'unknown',
      deprecated_at: str(d.deprecated_at),
      sunset_at: str(d.sunset_at),
      successor: str(d.successor),
      docs: str(d.docs),
      min_version: str(d.min_version),
    },
  };
}

/** Human-actionable multi-line rendering for CLI/daemon error output. */
export function renderRelayTombstone(t: RelayTombstone): string {
  const lines = [`✖ ${t.endpoint} was sunset by the relay (gone for good).`];
  if (t.deprecation.sunset_at) lines.push(`  Sunset date:    ${t.deprecation.sunset_at}`);
  if (t.deprecation.successor) lines.push(`  Use instead:    ${t.deprecation.successor}`);
  if (t.deprecation.min_version) lines.push(`  Minimum client version: ${t.deprecation.min_version}`);
  if (t.deprecation.docs) lines.push(`  Migration docs: ${t.deprecation.docs}`);
  lines.push('  If pd made this request, update it: brew upgrade port-daddy');
  return lines.join('\n');
}
