// tests/unit/purser/repair-limits.test.ts
/**
 * Unit tests for the repair‑limits contract enforced by the Purser subsystem.
 *
 * The PR contract requires:
 *   • MAX_AUTHORED_REPAIR_CALLS = MAX_PLANNED_FILES + 1
 *   • A per‑file retry cap (MAX_AUTHORED_REPAIR_ATTEMPTS_PER_FILE) that is
 *     a positive integer.
 *   • The total call limit must be stricter than naïvely multiplying the
 *     per‑file cap across all planned files, guaranteeing that the overall
 *     budget cannot be exceeded even when every file is retried.
 *
 * These tests validate those invariants directly against the exported
 * constants from the Purser implementation.
 */

import {
  MAX_PLANNED_FILES,
  MAX_AUTHORED_REPAIR_CALLS,
  MAX_AUTHORED_REPAIR_ATTEMPTS_PER_FILE,
} from '../../../apps/fleet-executor/src/purser.ts';

describe('Purser repair limits', () => {
  test('total repair call limit equals planned files plus one', () => {
    // Contract: the overall budget is exactly one call more than the number of
    // files we intend to repair.
    expect(MAX_AUTHORED_REPAIR_CALLS).toBe(MAX_PLANNED_FILES + 1);
  });

  test('per‑file retry limit is a positive integer', () => {
    // The per‑file cap must be an integer greater than zero; otherwise the
    // retry logic would be nonsensical.
    expect(Number.isInteger(MAX_AUTHORED_REPAIR_ATTEMPTS_PER_FILE)).toBe(true);
    expect(MAX_AUTHORED_REPAIR_ATTEMPTS_PER_FILE).toBeGreaterThan(0);
  });

  test('combined per‑file attempts exceed total limit, enforcing the total cap', () => {
    // If every planned file were retried the maximum number of times, the
    // naïve total would be:
    const naiveTotalAttempts = MAX_PLANNED_FILES * MAX_AUTHORED_REPAIR_ATTEMPTS_PER_FILE;

    // The contract guarantees the overall budget is stricter than that naïve
    // total, i.e. the system must stop before reaching it.
    expect(naiveTotalAttempts).toBeGreaterThanOrEqual(MAX_AUTHORED_REPAIR_CALLS);
    // Explicitly assert the relationship for clarity.
    expect(MAX_AUTHORED_REPAIR_CALLS).toBeLessThanOrEqual(naiveTotalAttempts);
  });
});