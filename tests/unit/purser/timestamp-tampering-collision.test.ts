// tests/unit/purser/timestamp-tampering-collision.test.ts

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type LedgerEntry = { file: string; appliedAt: string };
type Ledger = LedgerEntry[];

const EXPECTED_MIGRATION = '2026-08-26-b3-device-keys.sql';
const CRITICAL_LOCUS = 'critical-locus';

/**
 * Returns true iff `value` is a string that matches the strict
 * `YYYY-MM-DDTHH:MM:SSZ` UTC format and is the canonical representation
 * produced by `Date.prototype.toISOString()` (i.e. no fractional seconds).
 */
function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // strict RFC‑3339 without fractional seconds
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const iso = new Date(value).toISOString(); // always ends with ".sssZ"
  // keep only the first 19 characters (YYYY-MM-DDTHH:MM:SS) and re‑append Z
  const canonical = `${iso.slice(0, 19)}Z`;
  return canonical === value;
}

/**
 * Locate the ledger entry for the b3‑device‑keys migration.
 */
function findB3Entry(ledger: Ledger): LedgerEntry | undefined {
  if (!Array.isArray(ledger)) return undefined;
  return ledger.find(
    (e) => e && typeof e === 'object' && e.file === EXPECTED_MIGRATION,
  );
}

/**
 * Minimal handoff‑gate validation that mirrors the production logic:
 * - entry must exist
 * - `appliedAt` must be a canonical UTC ISO‑8601 timestamp
 * Returns `'ready'` on success or the critical locus string on failure.
 */
function validateLedger(ledger: Ledger): string {
  const entry = findB3Entry(ledger);
  if (!entry) return CRITICAL_LOCUS;
  if (!isCanonicalUtcTimestamp(entry.appliedAt)) return CRITICAL_LOCUS;
  return 'ready';
}

/**
 * Load the staging ledger from the repository.
 * Jest runs with the repository root as `process.cwd()`.
 */
function loadLedger(): Ledger {
  const ledgerPath = resolve(
    process.cwd(),
    'apps',
    'relay',
    'migrations',
    'applied-staging.json',
  );
  const raw = readFileSync(ledgerPath, { encoding: 'utf-8' });
  // The file is expected to be a JSON array; any parse error will cause the test to fail.
  return JSON.parse(raw) as Ledger;
}

describe('Relay staging‑migration handoff gate validation', () => {
  const originalLedger = loadLedger();

  test('applied‑staging.json parses to a JSON array', () => {
    expect(Array.isArray(originalLedger)).toBe(true);
  });

  test('ledger contains the expected b3‑device‑keys entry', () => {
    const entry = findB3Entry(originalLedger);
    expect(entry).toBeDefined();
    expect(entry?.file).toBe(EXPECTED_MIGRATION);
  });

  test('appliedAt timestamp is a canonical UTC ISO‑8601 string', () => {
    const entry = findB3Entry(originalLedger);
    expect(entry).toBeDefined();
    expect(isCanonicalUtcTimestamp(entry!.appliedAt)).toBe(true);
  });

  test('validateLedger returns "ready" for the untouched ledger', () => {
    expect(validateLedger(originalLedger)).toBe('ready');
  });

  test('validateLedger returns critical‑locus when the entry is missing', () => {
    const withoutEntry = originalLedger.filter(
      (e) => e.file !== EXPECTED_MIGRATION,
    );
    expect(validateLedger(withoutEntry as Ledger)).toBe(CRITICAL_LOCUS);
  });

  test('validateLedger returns critical‑locus when the timestamp is malformed', () => {
    const tampered = originalLedger.map((e) => ({ ...e }));
    const target = tampered.find((e) => e.file === EXPECTED_MIGRATION);
    if (target) {
      target.appliedAt = 'not-a‑timestamp';
    }
    expect(validateLedger(tampered as Ledger)).toBe(CRITICAL_LOCUS);
  });

  test('validateLedger returns critical‑locus when the timestamp includes fractional seconds', () => {
    const tampered = originalLedger.map((e) => ({ ...e }));
    const target = tampered.find((e) => e.file === EXPECTED_MIGRATION);
    if (target) {
      // `toISOString()` always includes milliseconds; this makes the format non‑canonical.
      target.appliedAt = new Date(target.appliedAt).toISOString();
    }
    // sanity check that our helper recognises the format as non‑canonical
    expect(isCanonicalUtcTimestamp(target?.appliedAt ?? '')).toBe(false);
    expect(validateLedger(tampered as Ledger)).toBe(CRITICAL_LOCUS);
  });
});