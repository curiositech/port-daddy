import { describe, expect, test } from '@jest/globals';

import { applyDistinctTokenCoverageBonus } from '../../lib/search-coverage.js';

describe('distinct token coverage bonus', () => {
  test('caps repeated field matches at the number of distinct query tokens', () => {
    const completeCoverage = applyDistinctTokenCoverageBonus(10, 2, 2);
    const repeatedFieldMatches = applyDistinctTokenCoverageBonus(10, 7, 2);

    expect(repeatedFieldMatches).toBe(completeCoverage);
  });

  test('rewards complete coverage more than partial coverage', () => {
    const partialCoverage = applyDistinctTokenCoverageBonus(10, 1, 3);
    const completeCoverage = applyDistinctTokenCoverageBonus(10, 3, 3);

    expect(completeCoverage).toBeGreaterThan(partialCoverage);
  });
});
