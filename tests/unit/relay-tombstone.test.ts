/**
 * Client-side X6 tombstone renderer tests (shared/relay-tombstone.ts).
 * The wire shape is pinned by tests/fixtures/relay-tombstone-golden.json,
 * which the relay suite asserts against renderTombstone in
 * apps/relay/tests/deprecations.test.ts - the two suites share ONE fixture so
 * producer and consumer cannot drift apart silently.
 */

import { readFileSync } from 'node:fs';
import { parseRelayTombstone, renderRelayTombstone } from '../../shared/relay-tombstone.js';

const golden = JSON.parse(
  readFileSync(new URL('../fixtures/relay-tombstone-golden.json', import.meta.url), 'utf8'),
) as { status: number; body: Record<string, unknown> };

describe('parseRelayTombstone', () => {
  it('parses the golden relay 410 body', () => {
    const t = parseRelayTombstone(golden.status, golden.body);
    expect(t).not.toBeNull();
    expect(t!.code).toBe('SURFACE_SUNSET');
    expect(t!.endpoint).toBe('/auth/status');
    expect(t!.deprecation.successor).toBe('/v1/auth/status');
    expect(t!.deprecation.sunset_at).toBe('2027-03-01');
    expect(t!.deprecation.docs).toBe('https://portdaddy.dev/docs/relay-deprecations');
    expect(t!.deprecation.min_version).toBeNull();
  });

  it('rejects non-410s, non-tombstone bodies, and junk', () => {
    expect(parseRelayTombstone(404, golden.body)).toBeNull();
    expect(parseRelayTombstone(410, { error: 'Gone' })).toBeNull();
    expect(parseRelayTombstone(410, null)).toBeNull();
    expect(parseRelayTombstone(410, 'gone')).toBeNull();
  });

  it('tolerates a missing deprecation object (older relays)', () => {
    const t = parseRelayTombstone(410, {
      code: 'SURFACE_SUNSET',
      error: 'gone',
      endpoint: '/auth/x',
    });
    expect(t).not.toBeNull();
    expect(t!.deprecation.id).toBe('unknown');
    expect(t!.deprecation.successor).toBeNull();
  });
});

describe('renderRelayTombstone', () => {
  it('renders an actionable message: successor, sunset date, docs', () => {
    const rendered = renderRelayTombstone(parseRelayTombstone(golden.status, golden.body)!);
    expect(rendered).toContain('/auth/status was sunset');
    expect(rendered).toContain('Use instead:');
    expect(rendered).toContain('/v1/auth/status');
    expect(rendered).toContain('2027-03-01');
    expect(rendered).toContain('https://portdaddy.dev/docs/relay-deprecations');
    expect(rendered).toContain('brew upgrade port-daddy');
  });

  it('omits lines whose data is absent rather than printing null', () => {
    const rendered = renderRelayTombstone(
      parseRelayTombstone(410, { code: 'SURFACE_SUNSET', error: 'gone', endpoint: '/auth/x' })!,
    );
    expect(rendered).not.toContain('null');
    expect(rendered).not.toContain('Use instead');
  });
});
