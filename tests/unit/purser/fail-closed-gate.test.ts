// tests/unit/purser/fail-closed-gate.test.ts
import { describe, it, expect } from '@jest/globals';
import {
  incompletePrSourceCoverageReason,
  withIncompletePrSourceCoverage,
} from '../../../apps/fleet-executor/src/execute.js';

/**
 * Minimal shape of PRContext sufficient for the functions under test.
 * The executor only reads the following properties:
 * - filesTruncated
 * - diffTruncated
 * - diffBytes
 * - files (array, we only need its length)
 */
type MinimalPRContext = {
  filesTruncated: boolean;
  diffTruncated: boolean;
  diffBytes: number;
  files: { filename: string }[];
};

describe('incompletePrSourceCoverageReason', () => {
  it('returns null when there is no truncation or limit hit', () => {
    const ctx: MinimalPRContext = {
      filesTruncated: false,
      diffTruncated: false,
      diffBytes: 0,
      files: [{ filename: 'README.md' }],
    };
    const result = incompletePrSourceCoverageReason(ctx as any);
    expect(result).toBeNull();
  });

  it('reports all applicable reasons when inventory is incomplete', () => {
    const ctx: MinimalPRContext = {
      filesTruncated: true,
      diffTruncated: true,
      diffBytes: 12345,
      // Keep file count below the internal PR_FILES_PAGE_SIZE limit to avoid the
      // “first‑page limit” clause; the exact constant is unknown here.
      files: new Array(5).fill({ filename: 'src/index.ts' }),
    };
    const reason = incompletePrSourceCoverageReason(ctx as any);
    expect(reason).not.toBeNull();
    expect(reason).toContain('GitHub changed-file inventory was unavailable');
    expect(reason).toContain('GitHub stopped the raw diff read');
    // The message should be a single string with semicolon separators.
    expect(reason?.split(';').length).toBeGreaterThanOrEqual(2);
  });
});

describe('withIncompletePrSourceCoverage', () => {
  const baseResult = {
    // The executor normally includes many fields; we only need the ones we
    // mutate for the test.
    reviewCoverage: 'full' as const,
    reviewCoverageReason: undefined,
  };

  it('leaves the result untouched when no reason is supplied', () => {
    const out = withIncompletePrSourceCoverage({ ...baseResult }, null);
    expect(out.reviewCoverage).toBe('full');
    expect(out.reviewCoverageReason).toBeUndefined();
  });

  it('marks result as partial and records the supplied reason', () => {
    const reason = 'GitHub changed-file inventory was unavailable';
    const out = withIncompletePrSourceCoverage({ ...baseResult }, reason);
    expect(out.reviewCoverage).toBe('partial');
    expect(out.reviewCoverageReason).toContain(reason);
  });

  it('appends to an existing coverage reason without exceeding the limit', () => {
    const longReason = 'a'.repeat(2100); // exceeds the 2 048‑char limit
    const existing = 'existing reason';
    const result = withIncompletePrSourceCoverage(
      {
        ...baseResult,
        reviewCoverageReason: existing,
      },
      longReason,
    );

    expect(result.reviewCoverage).toBe('partial');
    // The final string must be ≤ 2048 characters.
    expect(result.reviewCoverageReason?.length).toBeLessThanOrEqual(2048);
    // It should start with the new reason, then a semicolon, then the old one.
    expect(result.reviewCoverageReason?.startsWith(`${longReason.slice(0, 2045)}...; ${existing}`)).toBe(
      true,
    );
  });
});