// tests/unit/purser/deadline-check.test.ts
/**
 * Verify that the fleet‑executor run deadline is hard‑coded to 180 minutes
 * (10800000 ms) and that the runtime enforcement behaves exactly as the
 * contract requires:
 *
 *  • A run that finishes *exactly* at the deadline is allowed.
 *  • A run that exceeds the deadline by even 1 second is rejected.
 *
 * The test deliberately avoids any configuration knobs – the constant must
 * be imported directly from the production source and its value asserted.
 *
 * The validation logic lives in `purser-executability.ts` under the exported
 * (but undocumented) helper `validateRunDeadline`.  It is accessed via a
 * loose‑typed import so the test remains robust to internal refactors that
 * preserve the function’s signature.
 */

import { jest } from '@jest/globals';
import { RUN_ABSOLUTE_DEADLINE_MS } from '../../../apps/fleet-executor/src/execute.ts';
import * as PurserExec from '../../../apps/fleet-executor/src/purser-executability.ts';

// The production code validates a run’s start timestamp (seconds since epoch)
// against the current time and throws if the elapsed time exceeds the deadline.
// We retrieve it via a loose‑typed cast because the function is not part of the
// public API.
const validateRunDeadline = (PurserExec as any).validateRunDeadline as
  ((runStartedAtSec: number | null) => void) | undefined;

if (typeof validateRunDeadline !== 'function') {
  throw new Error(
    'purser-executability.ts must export a `validateRunDeadline` function for deadline tests.'
  );
}

describe('RUN_ABSOLUTE_DEADLINE_MS constant', () => {
  test('is exactly 180 minutes (10800000 ms) and immutable', () => {
    expect(RUN_ABSOLUTE_DEADLINE_MS).toBe(180 * 60 * 1000);
  });
});

describe('run‑deadline enforcement (validateRunDeadline)', () => {
  const FIXED_NOW_MS = 1_600_000_000_000; // deterministic “now” timestamp

  beforeAll(() => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(FIXED_NOW_MS);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test('allows a run that finishes exactly at the deadline', () => {
    // runStartedAtSec such that elapsed == RUN_ABSOLUTE_DEADLINE_MS
    const runStartedAtSec = (FIXED_NOW_MS - RUN_ABSOLUTE_DEADLINE_MS) / 1000;
    expect(() => validateRunDeadline(runStartedAtSec)).not.toThrow();
  });

  test('rejects a run that exceeds the deadline by 1 second', () => {
    // 1 second (1000 ms) over the deadline
    const runStartedAtSec =
      (FIXED_NOW_MS - RUN_ABSOLUTE_DEADLINE_MS - 1000) / 1000;
    expect(() => validateRunDeadline(runStartedAtSec)).toThrow(
      /deadline|exceeded/i
    );
  });

  test('gracefully handles null or undefined start timestamps (no‑op)', () => {
    expect(() => validateRunDeadline(null)).not.toThrow();
    expect(() => validateRunDeadline(undefined as any)).not.toThrow();
  });

  test('rejects nonsensical future timestamps', () => {
    const futureSec = (FIXED_NOW_MS + 10_000) / 1000; // 10 seconds in the future
    expect(() => validateRunDeadline(futureSec)).toThrow(
      /future|invalid/i
    );
  });
});