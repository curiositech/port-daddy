/**
 * The rent probe's fail-CLOSED wiring (the Door — lib/coast-guard/compulsion-facts.ts).
 *
 * `door-write-boundary.test.js` proves the DOWNSTREAM half: given
 * `rentUnverifiable: true`, `evaluateGuardFacts` blocks with a critical
 * `rent-unverifiable` violation. This file proves the UPSTREAM half:
 * `gatherCommitsSinceLastNote()` actually PRODUCES `{ok:false, reason}` (never
 * silently collapsing to "0 rent owed") when the daemon's coordination truth
 * — the session notes endpoint — cannot be read. Together they cover the
 * `guard.ts:900-910` wiring end to end.
 *
 * The daemon is mocked at the pdFetch boundary via jest.unstable_mockModule
 * (same convention as tests/unit/add-command.test.js) so this stays hermetic
 * — no live daemon, no real network.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

function mockFetch(overrides) {
  jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
    PORT_DADDY_URL: 'http://localhost:9999',
    isDaemonRunning: jest.fn(async () => overrides.daemonRunning ?? true),
    pdFetch: overrides.pdFetch,
  }));
}

describe('gatherCommitsSinceLastNote — fail-CLOSED wiring to the Door', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('daemon-unreachable (notes fetch throws) returns {ok:false, reason} — not silent zero rent', async () => {
    mockFetch({
      daemonRunning: false,
      pdFetch: jest.fn(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:9999');
      }),
    });
    const { gatherCommitsSinceLastNote } = await import('../../lib/coast-guard/compulsion-facts.js');
    const probe = await gatherCommitsSinceLastNote('s1', process.cwd());
    expect(probe.ok).toBe(false);
    if (!probe.ok) {
      expect(typeof probe.reason).toBe('string');
      expect(probe.reason.length).toBeGreaterThan(0);
      expect(probe.reason).toMatch(/ECONNREFUSED/i);
    }
  });

  test('a non-2xx notes response also fails CLOSED — never parsed as an empty notes list', async () => {
    mockFetch({
      pdFetch: jest.fn(async () => ({
        ok: false,
        status: 500,
        headers: {},
        json: async () => ({}),
        text: async () => 'boom',
      })),
    });
    const { gatherCommitsSinceLastNote } = await import('../../lib/coast-guard/compulsion-facts.js');
    const probe = await gatherCommitsSinceLastNote('s1', process.cwd());
    expect(probe.ok).toBe(false);
    // Proves the specific defect this signature exists to prevent: parsing a
    // 500's error body as "zero notes" would make every ahead-commit look
    // un-noted (fail-CLOSED in the wrong direction) instead of surfacing the
    // read failure itself.
    if (!probe.ok) expect(probe.reason).toMatch(/notes fetch failed.*500/i);
  });

  test('a reachable daemon with a readable notes response returns {ok:true, commitsSinceLastNote} — never spuriously unverifiable', async () => {
    mockFetch({
      pdFetch: jest.fn(async (url) => {
        const u = String(url);
        if (u.includes('/notes')) {
          return { ok: true, status: 200, headers: {}, json: async () => ({ notes: [] }), text: async () => '{}' };
        }
        return { ok: true, status: 200, headers: {}, json: async () => ({ files: [] }), text: async () => '{}' };
      }),
    });
    const { gatherCommitsSinceLastNote } = await import('../../lib/coast-guard/compulsion-facts.js');
    const probe = await gatherCommitsSinceLastNote('s1', process.cwd());
    expect(probe.ok).toBe(true);
    if (probe.ok) expect(typeof probe.commitsSinceLastNote).toBe('number');
  });
});
