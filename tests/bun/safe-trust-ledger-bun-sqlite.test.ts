/**
 * A5 trust-ledger regression test under the SHIPPED runtime: bun:sqlite.
 *
 * RUNTIME: `bun test` only. The trust ledger is daemon-resident state and the
 * compiled daemon (`bun build --compile`) runs on bun:sqlite, NOT
 * better-sqlite3. Per ADR-0088 § Test plan (and the repo's
 * "regression-test-under-the-REAL-runtime" rule) the schema migration MUST boot
 * clean under bun, the precedence resolver MUST work over a real bun table, and
 * the re-scan cache hit MUST be observable so a scanner can skip re-shelling
 * `codesign`. The jest unit world never opens this DB — bun:sqlite differs in
 * `run()`/`get()` null + ON CONFLICT semantics, which this pins.
 */

import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import {
  TrustLedger,
  ensureTrustLedgerSchema,
  ledgerKey,
  defaultVerdictFor,
  type LedgerVerdict,
} from '../../lib/safe/trust-ledger.ts';
import type { BinaryTrust } from '../../lib/safe/types.ts';

let db: Database;
let clock: number;

beforeEach(() => {
  db = new Database(':memory:');
  clock = 1_700_000_000_000;
});

afterEach(() => {
  db.close();
});

function bin(overrides: Partial<BinaryTrust> = {}): BinaryTrust {
  return {
    path: '/usr/local/bin/some-tool',
    trustClass: 'dev-id-notarized',
    pathOrigin: 'other',
    quarantine: 'no-quarantine',
    teamId: 'ABCDE12345',
    signingId: 'com.example.tool',
    authority: ['Developer ID Application: Example (ABCDE12345)', 'Apple Root CA'],
    cdhash: 'aaaa1111bbbb2222cccc3333',
    adhoc: false,
    verified: true,
    notarized: true,
    ...overrides,
  };
}

describe('A5 trust-ledger schema migration (bun:sqlite)', () => {
  test('ensureTrustLedgerSchema boots clean on a fresh bun DB and is idempotent', () => {
    expect(() => ensureTrustLedgerSchema(db as never)).not.toThrow();
    // Calling it twice must not error (CREATE TABLE IF NOT EXISTS).
    expect(() => ensureTrustLedgerSchema(db as never)).not.toThrow();
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'safe_trust_%'")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name).sort();
    expect(names).toEqual(['safe_trust_ledger', 'safe_trust_scan_cache']);
  });

  test('TrustLedger constructor self-initialises the schema', () => {
    expect(() => new TrustLedger(db as never, { now: () => clock })).not.toThrow();
    const ledger = new TrustLedger(db as never, { now: () => clock });
    expect(ledger.count()).toBe(0);
  });
});

describe('A5 trust-ledger record + precedence resolve (bun:sqlite)', () => {
  test('insert → resolve by cdhash (highest precedence)', () => {
    const ledger = new TrustLedger(db as never, { now: () => clock });
    const row = ledger.record(bin());
    expect(row.cdhash).toBe('aaaa1111bbbb2222cccc3333');
    expect(row.cdhashIsFallback).toBe(false);
    expect(row.verdict).toBe('allow'); // dev-id-notarized → allow by default
    expect(row.source).toBe('default');
    expect(ledger.count()).toBe(1);

    const resolved = ledger.resolve({
      cdhash: 'aaaa1111bbbb2222cccc3333',
      signingId: 'com.example.tool',
      teamId: 'ABCDE12345',
    });
    expect(resolved.scope).toBe('cdhash');
    expect(resolved.verdict).toBe('allow');
    expect(resolved.matchedCdhash).toBe('aaaa1111bbbb2222cccc3333');
  });

  test('precedence: cdhash > signing_id > team_id', () => {
    const ledger = new TrustLedger(db as never, { now: () => clock });
    // A team_id-level deny rule…
    ledger.record(bin({ cdhash: 'team-rule-hash', signingId: 'com.other', teamId: 'TEAMXX' }), {
      verdict: 'deny',
      source: 'user',
    });
    // …a signing_id-level allow rule (same team)…
    ledger.record(
      bin({ cdhash: 'sign-rule-hash', signingId: 'com.specific', teamId: 'TEAMXX' }),
      { verdict: 'allow', source: 'user' },
    );
    // …and a cdhash-exact prompt rule (distinct signing id so the signing_id
    // axis resolves unambiguously to the allow rule when no cdhash matches).
    ledger.record(
      bin({ cdhash: 'exact-hash', signingId: 'com.exact', teamId: 'TEAMXX' }),
      { verdict: 'prompt', source: 'user' },
    );

    // cdhash present → cdhash rule wins regardless of the looser rules.
    expect(
      ledger.resolve({ cdhash: 'exact-hash', signingId: 'com.exact', teamId: 'TEAMXX' }),
    ).toMatchObject({ scope: 'cdhash', verdict: 'prompt' });

    // No cdhash match → signing_id rule wins over the team rule.
    expect(
      ledger.resolve({ cdhash: 'unknown-hash', signingId: 'com.specific', teamId: 'TEAMXX' }),
    ).toMatchObject({ scope: 'signing_id', verdict: 'allow' });

    // No cdhash, no signing match → team rule wins.
    expect(
      ledger.resolve({ cdhash: 'unknown-hash', signingId: 'com.nomatch', teamId: 'TEAMXX' }),
    ).toMatchObject({ scope: 'team_id', verdict: 'deny' });

    // Nothing matches → fail-safe prompt.
    expect(ledger.resolve({ cdhash: 'x', signingId: 'y', teamId: 'z' })).toMatchObject({
      scope: null,
      verdict: 'prompt',
    });
  });

  test('within one axis, a deny is never overridden by a sibling allow (fail-safe)', () => {
    const ledger = new TrustLedger(db as never, { now: () => clock });
    // Two binaries from the same team, opposite verdicts, same source rank.
    ledger.record(bin({ cdhash: 'h-allow', signingId: 'com.a', teamId: 'TEAMYY' }), {
      verdict: 'allow',
      source: 'user',
    });
    ledger.record(bin({ cdhash: 'h-deny', signingId: 'com.b', teamId: 'TEAMYY' }), {
      verdict: 'deny',
      source: 'user',
    });
    // Resolving by team_id alone (no cdhash/signing match) → the deny wins.
    expect(
      ledger.resolve({ cdhash: 'nomatch', signingId: 'nomatch', teamId: 'TEAMYY' }),
    ).toMatchObject({ scope: 'team_id', verdict: 'deny' });
  });

  test('a bare re-scan never downgrades a user verdict back to default', () => {
    const ledger = new TrustLedger(db as never, { now: () => clock });
    ledger.record(bin());
    ledger.setVerdict('aaaa1111bbbb2222cccc3333', 'deny', 'user');
    expect(ledger.get('aaaa1111bbbb2222cccc3333')!.verdict).toBe('deny');

    // Re-observe with no explicit verdict (a normal re-scan): metadata refreshes
    // but the user's deny stands.
    clock += 1000;
    const row = ledger.record(bin({ path: '/usr/local/bin/some-tool-renamed' }));
    expect(row.verdict).toBe('deny');
    expect(row.source).toBe('user');
    // Path union recorded the new location.
    expect(row.paths).toContain('/usr/local/bin/some-tool');
    expect(row.paths).toContain('/usr/local/bin/some-tool-renamed');
  });

  test('unsigned binary keys on a sha256 fallback', () => {
    const ledger = new TrustLedger(db as never, { now: () => clock });
    const row = ledger.record(
      bin({ cdhash: null, trustClass: 'unsigned', notarized: false, teamId: null, signingId: null }),
    );
    expect(row.cdhashIsFallback).toBe(true);
    expect(row.cdhash.startsWith('sha256:')).toBe(true);
    expect(row.verdict).toBe('prompt');
  });
});

describe('A5 re-scan cache hit avoids a second codesign shell (bun:sqlite)', () => {
  test('isCached is false before record, true after, for the same (path, cdhash)', () => {
    const ledger = new TrustLedger(db as never, { now: () => clock });
    const b = bin();
    const { cdhash } = ledgerKey(b);

    expect(ledger.isCached(b.path, cdhash)).toBe(false);
    ledger.record(b);
    expect(ledger.isCached(b.path, cdhash)).toBe(true);

    // A different cdhash (tampered binary at the same path) misses the cache,
    // so the scanner re-assesses it instead of trusting a stale entry.
    expect(ledger.isCached(b.path, 'different-cdhash')).toBe(false);
  });

  test('simulated re-scan: cached path short-circuits the assessor', () => {
    const ledger = new TrustLedger(db as never, { now: () => clock });
    const b = bin();
    const { cdhash } = ledgerKey(b);

    let codesignShells = 0;
    const assess = (): BinaryTrust => {
      codesignShells += 1;
      return b;
    };

    // First pass: not cached → assess + record.
    if (!ledger.isCached(b.path, cdhash)) {
      ledger.record(assess());
    }
    // Second pass: cached → skip the codesign shell entirely.
    if (!ledger.isCached(b.path, cdhash)) {
      ledger.record(assess());
    }

    expect(codesignShells).toBe(1);
  });
});

describe('A5 pure helpers', () => {
  test('defaultVerdictFor maps trust classes to fail-safe verdicts', () => {
    const cases: Array<[BinaryTrust['trustClass'], LedgerVerdict]> = [
      ['platform', 'allow'],
      ['dev-id-notarized', 'allow'],
      ['dev-id-unnotarized', 'prompt'],
      ['ad-hoc', 'prompt'],
      ['unsigned', 'prompt'],
      ['unknown', 'prompt'],
    ];
    for (const [cls, verdict] of cases) {
      expect(defaultVerdictFor(cls)).toBe(verdict);
    }
  });
});
